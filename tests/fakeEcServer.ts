import * as net from "node:net";
import * as zlib from "node:zlib";
import * as crypto from "node:crypto";
import { expect } from "chai";
import * as ec from "../src/index.js";
import * as srp from "../src/ECSRP.js";
import * as aead from "../src/ECAEADCipher.js";

/**
 * Buffers a socket's incoming bytes and lets callers await an exact byte
 * count, mirroring ECConnection's own readBytes()/flushPendingReads() but
 * simplified for a test double: only ever one pending read at a time.
 */
class SocketReader {
   private buffer = Buffer.alloc(0);
   private waiting: { length: number; resolve: (buffer: Buffer) => void } | undefined;

   public constructor(socket: net.Socket) {
      socket.on("data", (chunk: Buffer) => {
         this.buffer = Buffer.concat([this.buffer, chunk]);
         this.flush();
      });
   }

   private flush(): void {
      if (!this.waiting || this.buffer.length < this.waiting.length) {
         return;
      }
      const { length, resolve } = this.waiting;
      this.waiting = undefined;
      resolve(this.buffer.subarray(0, length));
      this.buffer = this.buffer.subarray(length);
   }

   public readBytes(length: number): Promise<Buffer> {
      if (length === 0) {
         return Promise.resolve(Buffer.alloc(0));
      }
      return new Promise((resolve) => {
         this.waiting = { length, resolve };
         this.flush();
      });
   }
}

/**
 * The fake server's side of one accepted TCP connection, speaking the same wire framing as
 * ECConnection.
 */
export interface FakeEcPeer {
   readonly socket: net.Socket;
   aeadSession?: aead.ECAEADSession;
   readPacket(): Promise<ec.ECPacket>;
   writePacket(packet: ec.ECPacket, options?: { capabilities?: ec.ECCapabilities; compressed?: boolean }): void;
}

function wrapPeer(socket: net.Socket): FakeEcPeer {
   const reader = new SocketReader(socket);
   const peer: FakeEcPeer = {
      socket,
      aeadSession: undefined,
      async readPacket(): Promise<ec.ECPacket> {
         const headerBuffer = await reader.readBytes(ec.TransmissionHeader.SIZE);
         const header = ec.TransmissionHeader.decode(headerBuffer);
         let body = await reader.readBytes(header.bodyLength);
         let clearFlags = header.flags;
         if (peer.aeadSession) {
            if (!ec.ECFlags.isEncrypted(header.flags)) {
               throw new Error("FakeEcPeer: received unencrypted packet while AEAD session is active");
            }
            const unsealed = peer.aeadSession.unsealPacket(header.flags, body);
            clearFlags = unsealed.clearFlags;
            body = unsealed.body;
         }
         if (ec.ECFlags.isCompressed(clearFlags)) {
            body = zlib.inflateSync(body);
         }
         const capabilities = new ec.ECCapabilities();
         capabilities.utf8Numbers = ec.ECFlags.usesUtf8Numbers(clearFlags);
         capabilities.largeTagCount = ec.ECFlags.usesLargeTagCount(clearFlags);
         return ec.ECPacket.decode(body, capabilities);
      },
      writePacket(packet: ec.ECPacket, options = {}): void {
         const capabilities = options.capabilities ?? new ec.ECCapabilities();
         const compressed = options.compressed ?? false;
         let body = packet.encode(capabilities);
         if (compressed) {
            body = zlib.deflateSync(body);
         }
         const flags = ec.ECFlags.create(compressed, capabilities.utf8Numbers, capabilities.largeTagCount);
         const header = new ec.TransmissionHeader(flags, body.length);
         let fullPacket: Uint8Array = Buffer.concat([header.encode(), body]);
         if (peer.aeadSession) {
            fullPacket = peer.aeadSession.sealPacket(fullPacket);
         }
         socket.write(fullPacket);
      },
   };
   return peer;
}

export interface FakeEcServer {
   readonly port: number;
   /**
    * Resolves with the next inbound connection, wrapped for packet read/write - queued if it
    * already arrived.
    */
   nextPeer(): Promise<FakeEcPeer>;
   close(): Promise<void>;
}

function createNextPeer(queuedPeers: FakeEcPeer[], waitingResolvers: ((peer: FakeEcPeer) => void)[]): () => Promise<FakeEcPeer> {
   return function nextPeer(): Promise<FakeEcPeer> {
      const queued = queuedPeers.shift();
      if (queued) {
         return Promise.resolve(queued);
      }
      return new Promise((resolve) => {
         waitingResolvers.push(resolve);
      });
   };
}

/**
 * close() force-drops any socket a test forgot to end - otherwise server.close()'s callback never
 * fires.
 */
function createClose(server: net.Server, openSockets: Set<net.Socket>): () => Promise<void> {
   return function close(): Promise<void> {
      return new Promise((resolve) => {
         server.close(() => {
            resolve();
         });
         for (const socket of openSockets) {
            socket.destroy();
         }
      });
   };
}

/**
 * Starts a real TCP server on an ephemeral loopback port, for ECConnection/ECEngine tests to
 * connect to for real.
 */
export function startFakeEcServer(): Promise<FakeEcServer> {
   return new Promise((resolve, reject) => {
      const queuedPeers: FakeEcPeer[] = [];
      const waitingResolvers: ((peer: FakeEcPeer) => void)[] = [];
      const openSockets = new Set<net.Socket>();
      const server = net.createServer((socket) => {
         openSockets.add(socket);
         socket.once("close", () => {
            openSockets.delete(socket);
         });
         const peer = wrapPeer(socket);
         const waiter = waitingResolvers.shift();
         if (waiter) {
            waiter(peer);
         } else {
            queuedPeers.push(peer);
         }
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
         const address = server.address();
         if (!address || typeof address === "string") {
            reject(new Error("Fake EC server failed to bind to a loopback port."));
            return;
         }
         resolve({
            port: address.port,
            nextPeer: createNextPeer(queuedPeers, waitingResolvers),
            close: createClose(server, openSockets),
         });
      });
   });
}

/**
 * Replicates ECConnection.authenticateWithHash()'s client-side salting math
 * (MD5(passwordHash + MD5(uppercase-hex(salt)))) so the fake server can
 * verify the EC_TAG_PASSWD_HASH it receives, and tests can assert on it.
 */
export function computeSaltedHash(passwordHash: string, salt: bigint): Uint8Array {
   const saltHex = salt.toString(16).toUpperCase();
   /* eslint-disable sonarjs/hashing -- MD5 is what the EC wire protocol itself mandates, see ECConnection.ts's md5Digest doc. */
   const saltHash = crypto.createHash("md5").update(saltHex, "utf8").digest("hex").toLowerCase();
   return new Uint8Array(
      crypto
         .createHash("md5")
         .update(passwordHash + saltHash, "utf8")
         .digest(),
   );
   /* eslint-enable sonarjs/hashing */
}

/**
 * Drives the fake server's side of one successful modern SRP-6a + AEAD 4-step handshake.
 */
export async function acceptModernSRPAuthentication(
   peer: FakeEcPeer,
   passwordHash: string,
   options?: { cipherId?: aead.ECAEADCipherId },
): Promise<{ authRequest: ec.ECPacket; cipherId: aead.ECAEADCipherId }> {
   const authRequest = await peer.readPacket();
   expect(authRequest.opcode).to.equal(ec.ECOpcode.EC_OP_AUTH_REQ);

   const srpATag = authRequest.find(ec.ECTagNames.EC_TAG_SRP_A);
   const clientPubTag = authRequest.find(ec.ECTagNames.EC_TAG_AEAD_CLIENT_PUBKEY);
   const clientNonceTag = authRequest.find(ec.ECTagNames.EC_TAG_AEAD_CLIENT_NONCE);
   const canAeadTag = authRequest.find(ec.ECTagNames.EC_TAG_CAN_AEAD);

   const clientA = srpATag?.bytesValue;
   const clientPub = clientPubTag?.bytesValue;
   const clientNonce = clientNonceTag?.bytesValue;
   const offeredCiphers = canAeadTag?.bytesValue;

   if (!clientA || !clientPub || !clientNonce || !offeredCiphers) {
      throw new Error("Missing SRP-6a or AEAD tags in client AUTH_REQ");
   }

   const selectedCipherId = options?.cipherId ?? aead.ECAEADCipherId.AES_128_GCM;

   // Server generates ephemeral keys and SRP B
   const serverKeys = aead.generateX25519KeyPair();
   const serverNonce = crypto.randomBytes(32);
   const salt = crypto.randomBytes(16);

   const bBytes = crypto.randomBytes(32);
   const b = srp.bufferToBigInt(bBytes);
   const digestRaw = Buffer.from(passwordHash, "hex");
   const x = srp.deriveSRPX(digestRaw, salt);
   const v = srp.modPow(srp.SRP_G, x, srp.SRP_N);
   const B = (srp.SRP_K * v + srp.modPow(srp.SRP_G, b, srp.SRP_N)) % srp.SRP_N;
   const serverB = srp.padBigInt(B);

   const transcript = aead.buildAEADTranscript({
      offeredCiphers,
      selectedCipherId,
      clientNonce,
      serverNonce,
      clientPublicKey: clientPub,
      serverPublicKey: serverKeys.rawPublicKey,
   });

   const saltPacket = new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_SALT)
      .add(new ec.ECCustomTag(ec.ECTagNames.EC_TAG_SRP_B, serverB))
      .add(new ec.ECCustomTag(ec.ECTagNames.EC_TAG_SRP_SALT, salt))
      .add(new ec.ECCustomTag(ec.ECTagNames.EC_TAG_SRP_PROFILE, srp.SRP_PROFILE_BYTES))
      .add(new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_AEAD_CIPHER, selectedCipherId))
      .add(new ec.ECCustomTag(ec.ECTagNames.EC_TAG_AEAD_SERVER_NONCE, serverNonce))
      .add(new ec.ECCustomTag(ec.ECTagNames.EC_TAG_AEAD_SERVER_PUBKEY, serverKeys.rawPublicKey));

   peer.writePacket(saltPacket);

   // Establish server-side AEAD session
   const sharedSecret = aead.computeX25519SharedSecret(serverKeys.privateKey, clientPub);
   peer.aeadSession = new aead.ECAEADSession({
      sharedSecret,
      clientNonce,
      serverNonce,
      selectedCipherId,
      transcript,
      isServer: true,
   });

   // Server computes S and proofs M1/M2 to verify client proof
   const A = srp.bufferToBigInt(clientA);
   const uBuf = crypto.createHash("sha256").update(Buffer.concat([Buffer.from(clientA), serverB])).digest();
   const u = srp.bufferToBigInt(uBuf);
   const S = srp.modPow((A * srp.modPow(v, u, srp.SRP_N)) % srp.SRP_N, b, srp.SRP_N);
   const ctx = srp.buildProofContext(0, salt, transcript, A, B);
   const { m1: expectedM1, m2 } = srp.computeProofs(S, ctx);

   // Next packet from client is sealed AUTH_PASSWD
   const authPasswd = await peer.readPacket();
   expect(authPasswd.opcode).to.equal(ec.ECOpcode.EC_OP_AUTH_PASSWD);
   const clientM1 = authPasswd.find(ec.ECTagNames.EC_TAG_SRP_M1)?.bytesValue;
   if (!clientM1) {
      throw new Error("Missing client M1 proof tag");
   }
   expect(crypto.timingSafeEqual(Buffer.from(clientM1), expectedM1)).to.equal(true);

   // Reply with sealed AUTH_OK carrying M2
   const authOk = new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_OK)
      .add(new ec.ECCustomTag(ec.ECTagNames.EC_TAG_SRP_M2, m2))
      .add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_SERVER_VERSION, "aMule 3.3.0"));
   peer.writePacket(authOk);

   return { authRequest, cipherId: selectedCipherId };
}
