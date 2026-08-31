import * as net from "node:net";
import * as zlib from "node:zlib";
import * as crypto from "node:crypto";
import * as ec from "../src/index.js";

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
   readPacket(): Promise<ec.ECPacket>;
   writePacket(packet: ec.ECPacket, options?: { capabilities?: ec.ECCapabilities; compressed?: boolean }): void;
}

function wrapPeer(socket: net.Socket): FakeEcPeer {
   const reader = new SocketReader(socket);
   return {
      socket,
      async readPacket(): Promise<ec.ECPacket> {
         const headerBuffer = await reader.readBytes(ec.TransmissionHeader.SIZE);
         const header = ec.TransmissionHeader.decode(headerBuffer);
         let body = await reader.readBytes(header.bodyLength);
         if (header.compressed) {
            body = zlib.inflateSync(body);
         }
         const capabilities = new ec.ECCapabilities();
         capabilities.utf8Numbers = header.utf8Numbers;
         capabilities.largeTagCount = header.largeTagCount;
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
         socket.write(Buffer.concat([header.encode(), body]));
      },
   };
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
