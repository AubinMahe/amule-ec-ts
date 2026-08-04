import * as net from "node:net";
import * as events from "node:events";
import * as crypto from "node:crypto";
import * as zlib from "node:zlib";
import { debuglog } from "node:util";
import { ECCapabilities } from "./ECCapabilities.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECFlags } from "./ECFlags.js";
import { ECVersion } from "./ECVersion.js";
import { TransmissionHeader } from "./Transmission.js";
import {
   ECUInt16Tag,
   ECUInt64Tag,
   ECStringTag,
   ECHash16Tag,
   ECCustomTag,
} from "./ECTags.js";

const debug = debuglog("amule-ec:connection");

/**
 * MD5 isn't a security choice here - it's what the EC wire protocol
 * itself mandates for password hashing (see ECConnection.authenticateWithHash's
 * doc: it's exactly what aMule's own ECPassword storage and
 * challenge/response salting use). There's no substitute algorithm to
 * negotiate, so this is a reviewed, protocol-mandated exception - kept to
 * this single definition rather than disabled at every call site.
 */
function md5Digest(input: string): Buffer {
   // eslint-disable-next-line sonarjs/hashing
   return crypto.createHash("md5").update(input, "utf8").digest();
}

function md5Hex(input: string): string {
   return md5Digest(input).toString("hex").toLowerCase();
}

interface PendingRead {
   length: number;
   resolve: (buffer: Buffer) => void;
   reject: (error: Error) => void;
}

interface PendingReceive {
   resolve: (packet: ECPacket) => void;
   reject: (error: Error) => void;
}

/**
 * A connection to an aMule EC (External Connections) server.
 *
 * Emits a "notification" event with an ECPacket whenever the server pushes
 * an unsolicited packet - see the class-level doc on `dispatchPacket` for
 * how that's told apart from an awaited `receive()` reply, and its limits.
 *
 * Emits a "disconnected" event (no payload) once when the underlying socket
 * closes or errors unexpectedly - see onClose(). Not emitted when close()
 * caused the closure (see its doc) - a deliberate shutdown shouldn't trigger
 * ECEngine's automatic reconnect. reconnect() re-establishes the TCP socket
 * in place afterward (same instance, so every service that captured
 * `ec.ECEngine.connection` keeps working); ECEngine wires the two together
 * into an automatic reconnect loop, see its doc.
 */
export class ECConnection extends events.EventEmitter {

   /**
    * Payloads larger than this are always zlib-compressed when the zlib
    * capability is available, even if EC_TAG_PREFER_NO_ZLIB was set (the
    * preference is a "skip compression for small/medium payloads" hint,
    * not an absolute veto for large ones).
    */
   private static readonly ZLIB_OVERSIZED_THRESHOLD = 100_000;

   public readonly localCapabilities = new ECCapabilities();
   public readonly remoteCapabilities = new ECCapabilities();
   private readonly receiveChunks: Buffer[] = [];
   private receiveBufferedLength = 0;
   private readonly pendingReads: PendingRead[] = [];
   /**
    * Callers of receive(), each waiting for the next packet the pump loop
    * decodes. FIFO: the oldest pending receive() claims the next packet.
    */
   private readonly pendingReceives: PendingReceive[] = [];
   private closed = false;
   private closeError: Error | undefined;
   private intentionalClose = false;

   public constructor(private socket: net.Socket) {
      super();
      this.localCapabilities.zlib = false;
      this.localCapabilities.largeTagCount = false;
      this.wireSocket();
   }

   /**
    * Attaches the data/error/close listeners to `this.socket` - called from
    * the constructor and again from reconnect() once a fresh socket is in place.
    */
   private wireSocket(): void {
      this.socket.on("data", (chunk: Buffer) => {
         this.onData(chunk);
      });
      this.socket.on("error", (error: Error) => {
         this.onClose(error);
      });
      this.socket.on("close", () => {
         this.onClose(this.closeError ?? new Error("EC connection closed."));
      });
   }

   /**
    * Starts the pump loop - kept out of the constructor (called instead
    * right after `new ECConnection(...)`, still synchronously, before
    * anything else can run) so that starting async work isn't tangled up
    * with object construction. Runs for the lifetime of the connection,
    * independently of whether anyone is currently awaiting receive() -
    * this is what lets a notification arrive and get emitted even between
    * two explicit request/reply calls.
    */
   private beginPump(): void {
      void this.pump();
   }

   private static connectSocket(host: string, port: number): Promise<net.Socket> {
      return new Promise<net.Socket>((resolve, reject) => {
         const candidate = net.createConnection({ host, port });
         const onConnect = (): void => {
            candidate.removeListener("error", onError);
            resolve(candidate);
         };
         const onError = (error: Error): void => {
            candidate.removeListener("connect", onConnect);
            reject(error);
         };
         candidate.once("connect", onConnect);
         candidate.once("error", onError);
      });
   }

   public static async connect(
      host = "localhost",
      port = 4712,
   ): Promise<ECConnection> {
      const socket = await ECConnection.connectSocket(host, port);
      const connection = new ECConnection(socket);
      connection.beginPump();
      return connection;
   }

   /**
    * Re-establishes the underlying TCP socket after a disconnect (see the
    * "disconnected" event, emitted from onClose()) and resumes the pump
    * loop - same ECConnection instance/identity, so every service that
    * captured `ec.ECEngine.connection` at construction keeps working with
    * no changes of their own. Callers must re-authenticate afterward (the
    * daemon requires a fresh EC_OP_AUTH_REQ handshake per TCP connection) -
    * see ECEngine's reconnect loop.
    */
   public async reconnect(host: string, port: number): Promise<void> {
      const socket = await ECConnection.connectSocket(host, port);
      this.socket = socket;
      this.closed = false;
      this.closeError = undefined;
      this.receiveChunks.length = 0;
      this.receiveBufferedLength = 0;
      this.pendingReads.length = 0;
      this.pendingReceives.length = 0;
      this.wireSocket();
      this.beginPump();
   }

   /**
    * Runs the three-step EC challenge-response authentication handshake,
    * hashing `password` first - see authenticateWithHash() for the rest
    * of the handshake and for use with aMule's own already-hashed form.
    */
   public async authenticate(password: string): Promise<void> {
      return this.authenticateWithHash(md5Hex(password));
   }

   /**
    * Runs the three-step EC challenge-response authentication handshake
    * described in the protocol documentation:
    *   1. send EC_OP_AUTH_REQ with our protocol version and capabilities,
    *   2. receive EC_OP_AUTH_SALT and compute the salted password hash,
    *   3. send EC_OP_AUTH_PASSWD and check the server's reply.
    *
    * `passwordHash` is MD5(plaintext password), lowercase hex - exactly
    * the form aMule itself stores as ECPassword in amule.conf's
    * [ExternalConnect] section (confirmed against
    * Cfg_Str_Encrypted::TransferFromWindow, .../Preferences.cpp:438, and
    * the server salting thePrefs::ECPassword() directly with no
    * un-hashing step, .../ExternalConn.cpp:735) - so a value read
    * straight from that file can be passed here without re-hashing.
    *
    * Set `localCapabilities.notify = true` before calling this to ask the
    * server to push unsolicited update packets on this connection (see
    * "notification" events) once authenticated. Unlike largeTagCount/
    * partialUpdate, the server doesn't echo this capability back in
    * EC_OP_AUTH_OK - confirmed against
    * https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L701, which reads
    * EC_TAG_CAN_NOTIFY off our own EC_OP_AUTH_REQ and registers the socket
    * with ECNotifier unconditionally if present, with no acknowledgement.
    */
   public async authenticateWithHash(passwordHash: string): Promise<void> {
      const authRequest = new ECPacket(ECOpcode.EC_OP_AUTH_REQ);
      authRequest.add(
         new ECUInt16Tag(
            ECTagNames.EC_TAG_PROTOCOL_VERSION,
            ECVersion.PROTOCOL,
         ),
      );
      authRequest.add(
         new ECStringTag(
            ECTagNames.EC_TAG_CLIENT_NAME,
            ECVersion.CLIENT_NAME
         ),
      );
      authRequest.add(
         new ECStringTag(
            ECTagNames.EC_TAG_CLIENT_VERSION,
            ECVersion.CLIENT_VERSION,
         ),
      );
      if (this.localCapabilities.zlib) {
         authRequest.add(
            new ECCustomTag(
               ECTagNames.EC_TAG_CAN_ZLIB,
               new Uint8Array()
            ),
         );
      }
      if (this.localCapabilities.utf8Numbers) {
         authRequest.add(
            new ECCustomTag(
               ECTagNames.EC_TAG_CAN_UTF8_NUMBERS,
               new Uint8Array(),
            ),
         );
      }
      if (this.localCapabilities.notify) {
         authRequest.add(
            new ECCustomTag(
               ECTagNames.EC_TAG_CAN_NOTIFY,
               new Uint8Array()
            ),
         );
      }
      if (this.localCapabilities.largeTagCount) {
         authRequest.add(
            new ECCustomTag(
               ECTagNames.EC_TAG_CAN_LARGE_TAG_COUNT,
               new Uint8Array(),
            ),
         );
      }
      if (this.localCapabilities.preferNoZlib) {
         authRequest.add(
            new ECCustomTag(
               ECTagNames.EC_TAG_PREFER_NO_ZLIB,
               new Uint8Array()),
         );
      }
      if (this.localCapabilities.multiSearch) {
         authRequest.add(
            new ECCustomTag(
               ECTagNames.EC_TAG_CAN_MULTI_SEARCH,
               new Uint8Array(),
            ),
         );
      }
      // Unconditional, unlike every capability above - no client-side
      // preference exists to gate it on, see ECCapabilities.sharedDirsConfig's doc.
      authRequest.add(
         new ECCustomTag(
            ECTagNames.EC_TAG_CAN_SHAREDDIRS_CONFIG,
            new Uint8Array(),
         ),
      );
      // Unconditional too - see ECCapabilities.searchList's doc.
      authRequest.add(
         new ECCustomTag(
            ECTagNames.EC_TAG_CAN_SEARCH_LIST,
            new Uint8Array(),
         ),
      );
      debug("EC_OP_AUTH_REQ has(EC_TAG_CAN_NOTIFY) = %s", authRequest.has(ECTagNames.EC_TAG_CAN_NOTIFY));
      await this.send(authRequest);
      const saltPacket = await this.receive();
      if (saltPacket.opcode !== ECOpcode.EC_OP_AUTH_SALT) {
         throw new Error(
            `Expected EC_OP_AUTH_SALT, received opcode 0x${saltPacket.opcode.toString(16)}.`,
         );
      }
      const saltTag = saltPacket.find(ECTagNames.EC_TAG_PASSWD_SALT);
      if (!saltTag || !(saltTag instanceof ECUInt64Tag)) {
         throw new Error("Server did not send a valid EC_TAG_PASSWD_SALT.");
      }
      const salt = saltTag.value;
      const saltHex = salt.toString(16).toUpperCase();
      const saltHash = md5Hex(saltHex);
      const finalHash = md5Digest(passwordHash + saltHash);
      const saltedHash = new Uint8Array(finalHash);
      const authPasswd = new ECPacket(ECOpcode.EC_OP_AUTH_PASSWD);
      authPasswd.add(
         new ECHash16Tag(
            ECTagNames.EC_TAG_PASSWD_HASH,
            saltedHash
         ),
      );
      await this.send(authPasswd);
      const reply = await this.receive();
      if (reply.opcode === ECOpcode.EC_OP_AUTH_FAIL) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason =
            reasonTag instanceof ECStringTag
               ? reasonTag.value
               : "EC authentication failed.";
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_AUTH_OK) {
         throw new Error(
            `Unexpected opcode 0x${reply.opcode.toString(16)} in reply to EC_OP_AUTH_PASSWD.`,
         );
      }
      // The client must not use a capability unless the server echoed it.
      this.remoteCapabilities.largeTagCount =
         this.localCapabilities.largeTagCount &&
         reply.has(ECTagNames.EC_TAG_CAN_LARGE_TAG_COUNT);
      this.remoteCapabilities.partialUpdate =
         this.localCapabilities.partialUpdate &&
         reply.has(ECTagNames.EC_TAG_CAN_PARTIAL_UPDATE);
      this.remoteCapabilities.multiSearch =
         this.localCapabilities.multiSearch &&
         reply.has(ECTagNames.EC_TAG_CAN_MULTI_SEARCH);
      // Unconditional request above, so no ANDing with a local flag here -
      // see ECCapabilities.sharedDirsConfig's doc.
      this.remoteCapabilities.sharedDirsConfig = reply.has(
         ECTagNames.EC_TAG_CAN_SHAREDDIRS_CONFIG,
      );
      // Unconditional request above too - see ECCapabilities.searchList's doc.
      this.remoteCapabilities.searchList = reply.has(ECTagNames.EC_TAG_CAN_SEARCH_LIST);
   }

   public async send(packet: ECPacket): Promise<void> {
      let body = packet.encode(this.localCapabilities);
      const oversized = body.length > ECConnection.ZLIB_OVERSIZED_THRESHOLD;
      const compress =
         this.localCapabilities.zlib &&
         (oversized || !this.localCapabilities.preferNoZlib);
      if (compress) {
         body = zlib.deflateSync(body);
      }
      const flags = ECFlags.create(
         compress,
         this.localCapabilities.utf8Numbers,
         this.localCapabilities.largeTagCount,
      );
      const header = new TransmissionHeader(flags, body.length);
      await new Promise<void>((resolve, reject) => {
         this.socket.write(Buffer.concat([header.encode(), body]), (error) => {
            if (error) reject(error);
            else resolve();
         });
      });
   }

   /**
    * Resolves with the next packet the pump loop dispatches to this call -
    * i.e. the reply to whatever was last sent, under the normal
    * request/reply usage pattern. See `dispatchPacket` for what happens
    * when there's no matching receive() call.
    */
   public receive(): Promise<ECPacket> {
      if (this.closed) {
         return Promise.reject(
            this.closeError ?? new Error("EC connection closed."),
         );
      }
      return new Promise<ECPacket>((resolve, reject) => {
         this.pendingReceives.push({ resolve, reject });
      });
   }

   /** Type-safe shorthand for on("notification", listener). */
   public onNotification(listener: (packet: ECPacket) => void): this {
      return this.on("notification", listener);
   }

   /**
    * Closes the socket without triggering ECEngine's automatic reconnect -
    * confirmed live 2026-08-04: before this flag existed, close() still
    * fired onClose() -> "disconnected" like any other drop, so every
    * deliberate shutdown (e.g. the REPL's terminate()) made ECEngine
    * reconnect anyway. The reconnected socket was then never closed again
    * (nothing was left running to call close() a second time), leaking a
    * live, open connection that kept the process running forever - 17
    * such orphaned `tests/repl/main.ts` processes were found still running
    * from earlier in this same session.
    */
   public close(): void {
      this.intentionalClose = true;
      this.socket.end();
   }

   /**
    * Continuously decodes whatever packets arrive on the socket and hands
    * each one to dispatchPacket(), for the lifetime of the connection.
    * Runs independently of receive() calls so that a notification pushed
    * while nobody is awaiting a reply still gets emitted.
    */
   private async pump(): Promise<void> {
      try {
         for (;;) {
            const packet = await this.readPacket();
            this.dispatchPacket(packet);
         }
      } catch (error) {
         const reason =
            error instanceof Error ? error : new Error(String(error));
         while (this.pendingReceives.length > 0) {
            this.pendingReceives.shift()?.reject(reason);
         }
      }
   }

   /**
    * Hands a freshly decoded packet to the oldest pending receive() call,
    * if any - preserving the existing request/reply behaviour exactly.
    * Otherwise, nothing is waiting for it, so it must be a server-pushed
    * update (only sent at all if localCapabilities.notify was set before
    * authenticate()) and is emitted as a "notification" event instead.
    *
    * NOT resolvable client-side: EC has no request-id field (confirmed
    * across the whole protocol doc and ECCodes.h), so if the server ever
    * interleaves a pushed notification ahead of the reply to a request
    * that's still in flight, this will hand the notification to that
    * pending receive() by mistake. In practice this hasn't been observed -
    * aMule's ECNotifier only drains its queue between writes
    * (WriteDoneAndQueueEmpty / NextPacketToSocket in ExternalConn.cpp) and
    * a request's reply is produced synchronously within the same
    * OnReceive call - but it isn't ruled out by the wire format itself.
    */
   private dispatchPacket(packet: ECPacket): void {
      const waiter = this.pendingReceives.shift();
      if (waiter) {
         debug("dispatch: opcode 0x%s -> pending receive()", packet.opcode.toString(16));
         waiter.resolve(packet);
         return;
      }
      debug("dispatch: opcode 0x%s -> notification (no pending receive())", packet.opcode.toString(16));
      this.emit("notification", packet);
   }

   private async readPacket(): Promise<ECPacket> {
      const headerBuffer = await this.readBytes(TransmissionHeader.SIZE);
      const header = TransmissionHeader.decode(headerBuffer);
      let body = await this.readBytes(header.bodyLength);
      if (header.compressed) {
         body = zlib.inflateSync(body);
      }
      // The transmission-layer flags tell us exactly how *this* packet's
      // application-layer data was encoded, so we decode against those
      // rather than assuming they match our negotiated remoteCapabilities.
      const wireCapabilities = new ECCapabilities();
      wireCapabilities.utf8Numbers = header.utf8Numbers;
      wireCapabilities.largeTagCount = header.largeTagCount;
      return ECPacket.decode(body, wireCapabilities);
   }

   private onData(chunk: Buffer): void {
      this.receiveChunks.push(chunk);
      this.receiveBufferedLength += chunk.length;
      this.flushPendingReads();
   }

   private flushPendingReads(): void {
      for (;;) {
         const next = this.pendingReads[0];
         if (!next || this.receiveBufferedLength < next.length) return;
         this.pendingReads.shift();
         const [firstChunk] = this.receiveChunks;
         const combined =
            firstChunk && this.receiveChunks.length === 1
               ? firstChunk
               : Buffer.concat(this.receiveChunks, this.receiveBufferedLength);
         const result = Buffer.from(combined.subarray(0, next.length));
         const rest = combined.subarray(next.length);
         this.receiveChunks.length = 0;
         if (rest.length > 0) this.receiveChunks.push(rest);
         this.receiveBufferedLength = rest.length;
         next.resolve(result);
      }
   }

   private readBytes(length: number): Promise<Buffer> {
      if (length === 0) return Promise.resolve(Buffer.alloc(0));
      if (this.closed) {
         return Promise.reject(
            this.closeError ?? new Error("EC connection closed."),
         );
      }
      return new Promise<Buffer>((resolve, reject) => {
         this.pendingReads.push({ length, resolve, reject });
         this.flushPendingReads();
      });
   }

   /**
    * Marks the connection closed and rejects whatever was pending - then
    * emits "disconnected" once (guarded by the same `closed` check) so
    * ECEngine's reconnect loop can react. pump()'s own catch block rejects
    * pendingReceives; this handles pendingReads (readBytes() callers still
    * waiting on the socket directly) and the reconnect signal.
    *
    * Skips the "disconnected" emit entirely when close() caused this - see
    * its doc for why reconnecting after a deliberate close is a bug, not a
    * feature.
    */
   private onClose(error: Error): void {
      if (this.closed) return;
      this.closed = true;
      this.closeError = error;
      while (this.pendingReads.length > 0) {
         this.pendingReads.shift()?.reject(error);
      }
      if (!this.intentionalClose) {
         this.emit("disconnected");
      }
   }
}
