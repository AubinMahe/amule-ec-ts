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
import { ECUInt16Tag, ECUInt64Tag, ECStringTag, ECHash16Tag, ECCustomTag, ECTagDecoder } from "./ECTags.js";
import { assertLoopbackOrAllowed } from "./ECValidation.js";

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

/**
 * The daemon answered EC_OP_AUTH_FAIL: it refused the credentials (or the protocol version), and
 * asking again with the same ones cannot succeed. `message` is the reason it gave, if any. Any
 * other failure of the handshake (a timeout, a dropped connection) is a plain Error, and may well
 * be transient.
 */
export class ECAuthenticationError extends Error {
   public constructor(message: string) {
      super(message);
      this.name = "ECAuthenticationError";
   }
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

   /**
    * A request whose encoded body is larger than this is refused before anything is written. The
    * daemon drops a peer announcing more than 16 MiB before authentication (`CECSocket::ReadHeader`
    * in the C++ `ECSocket.cpp`), and no request built by this library comes anywhere near it.
    */
   private static readonly MAX_REQUEST_BYTES = 16 * 1024 * 1024;

   /**
    * Default for `requestTimeoutMs`.
    */
   public static readonly DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

   /**
    * How long request() waits for the whole exchange (write, then reply) before giving up. On
    * expiry the connection is closed, since EC has no request id: a reply arriving late could
    * only be paired with the wrong request. It emits "disconnected" like any other loss of the
    * connection, so ECEngine's reconnect loop takes over. `Infinity` disables the timeout. Read
    * on every request, so it can be changed at any time; it is not applied to receive(), which
    * stays a bare wait for the next packet.
    */
   public requestTimeoutMs = ECConnection.DEFAULT_REQUEST_TIMEOUT_MS;

   /**
    * Default for `connectTimeoutMs`.
    */
   public static readonly DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

   /**
    * How long connect()/reconnect() wait for the TCP handshake before giving up (`Infinity`
    * disables it) - neither has a timeout of its own otherwise, so connecting to an unresponsive
    * host waits for the operating system's own TCP timeout, which is typically minutes, not
    * seconds. connect() reads this off the instance created by its own call (see its doc);
    * reconnect() defaults to whatever value is already set here, so a value passed to connect()
    * (or set directly) is reused on every later reconnect without having to repeat it.
    */
   public connectTimeoutMs: number;

   /**
    * Whether connect()/reconnect() may target a non-loopback `host` - refused by default (see
    * assertLoopbackOrAllowed()'s own doc for why: EC is neither encrypted nor authenticated per
    * packet). connect() reads this off the instance created by its own call, the same way
    * connectTimeoutMs works; reconnect() defaults to whatever value is already set here.
    */
   public allowNonLoopback: boolean;

   /**
    * Default for `maxPacketBytesUnauthenticated`.
    */
   public static readonly DEFAULT_MAX_PACKET_BYTES_UNAUTHENTICATED = 16 * 1024 * 1024;

   /**
    * Default for `maxPacketBytesAuthenticated`.
    */
   public static readonly DEFAULT_MAX_PACKET_BYTES_AUTHENTICATED = 256 * 1024 * 1024;

   /**
    * A packet whose transmission header announces a body larger than this, before this
    * connection has authenticated, is refused and the connection aborted (see readPacket()) -
    * mirrors the bound the daemon itself applies to a peer before authentication
    * (`CECSocket::ReadHeader` in the C++ `ECSocket.cpp`). Checked against the announced length,
    * before any of the body is read, so an oversized announcement never gets buffered at all -
    * confirmed live: an earlier version with no such bound took a process from 92 MB to 512 MB
    * RSS reading a stream behind a header announcing a 1 GB body, with no error and no
    * disconnect.
    */
   public maxPacketBytesUnauthenticated = ECConnection.DEFAULT_MAX_PACKET_BYTES_UNAUTHENTICATED;

   /**
    * Same as `maxPacketBytesUnauthenticated`, once this connection has authenticated - mirrors
    * the daemon's own higher post-authentication bound, for the same reason it exists there: a
    * `SharedFiles.fetch()`-style full-detail reply against a large library can legitimately run
    * to tens of megabytes uncompressed.
    */
   public maxPacketBytesAuthenticated = ECConnection.DEFAULT_MAX_PACKET_BYTES_AUTHENTICATED;

   /**
    * Default for `maxInflatedBytes`.
    */
   public static readonly DEFAULT_MAX_INFLATED_BYTES = 256 * 1024 * 1024;

   /**
    * Upper bound passed as zlib's own `maxOutputLength` when inflating a compressed reply -
    * without it, a small compressed body can decompress to the runtime's maximum buffer size,
    * and the synchronous inflate blocks the event loop while it does.
    */
   public maxInflatedBytes = ECConnection.DEFAULT_MAX_INFLATED_BYTES;

   /**
    * Default for `maxTagDepth`.
    */
   public static readonly DEFAULT_MAX_TAG_DEPTH = ECTagDecoder.DEFAULT_MAX_DEPTH;

   /**
    * How deeply a reply's tag tree may nest before decoding it fails with `ECDecodeError` - see
    * ECTagDecoder's own doc on why this exists and on this default.
    */
   public maxTagDepth = ECConnection.DEFAULT_MAX_TAG_DEPTH;

   /**
    * Default for `maxTagCount`.
    */
   public static readonly DEFAULT_MAX_TAG_COUNT = ECTagDecoder.DEFAULT_MAX_TAG_COUNT;

   /**
    * How many tags in total a single reply's tree may contain before decoding it fails with
    * `ECDecodeError` - see ECTagDecoder's own doc on why this exists and on this default.
    */
   public maxTagCount = ECConnection.DEFAULT_MAX_TAG_COUNT;

   public readonly localCapabilities = new ECCapabilities();
   public readonly remoteCapabilities = new ECCapabilities();
   /**
    * The daemon process's `EC_TAG_SESSION_ID`, set on every successful
    * `authenticateWithHash()` - see the tag's own doc. A caller that keeps
    * state indexed by ECID across a `reconnect()` should compare this
    * against its previous value and discard that state if it changed,
    * rather than assume the daemon (and its ECID numbering) survived.
    */
   public sessionId: bigint | undefined;
   private readonly receiveChunks: Buffer[] = [];
   private receiveBufferedLength = 0;
   private readonly pendingReads: PendingRead[] = [];
   /**
    * Callers of receive(), each waiting for the next packet the pump loop
    * decodes. FIFO: the oldest pending receive() claims the next packet.
    */
   private readonly pendingReceives: PendingReceive[] = [];
   /**
    * Tail of the chain request() serializes its exchanges on: settled once the last one has.
    */
   private requestQueue: Promise<void> = Promise.resolve();
   /**
    * Set by reconnect(), called (once) by authenticateWithHash() - see reconnect().
    */
   private releaseHeldRequests: (() => void) | undefined;
   private closed = false;
   private closeError: Error | undefined;
   private intentionalClose = false;
   /**
    * Whether authenticateWithHash() has completed successfully on the current socket - gates
    * maxPacketBytesUnauthenticated/Authenticated in readPacket(). reconnect() resets this: the
    * fresh socket needs its own handshake, same as the daemon's own `IsAuthorized()`.
    */
   private authenticated = false;

   public constructor(
      private socket: net.Socket,
      connectTimeoutMs: number = ECConnection.DEFAULT_CONNECT_TIMEOUT_MS,
      allowNonLoopback = false,
   ) {
      super();
      this.connectTimeoutMs = connectTimeoutMs;
      this.allowNonLoopback = allowNonLoopback;
      this.localCapabilities.zlib = false;
      this.localCapabilities.largeTagCount = false;
      this.wireSocket();
   }

   /**
    * Attaches the data/error/close listeners to `this.socket` - called from
    * the constructor and again from reconnect() once a fresh socket is in place.
    * Events of a socket reconnect() has since replaced are ignored: a destroyed
    * socket still delivers its own "close" afterwards, which must not mark the
    * new connection closed.
    */
   private wireSocket(): void {
      const socket = this.socket;
      socket.on("data", (chunk: Buffer) => {
         if (socket === this.socket) {
            this.onData(chunk);
         }
      });
      socket.on("error", (error: Error) => {
         if (socket === this.socket) {
            this.onClose(error);
         }
      });
      socket.on("close", () => {
         if (socket === this.socket) {
            this.onClose(this.closeError ?? new Error("EC connection closed."));
         }
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
      void this.pump(this.socket);
   }

   private static connectSocket(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
      return new Promise<net.Socket>((resolve, reject) => {
         const candidate = net.createConnection({ host, port });
         let timer: NodeJS.Timeout | undefined;
         const cleanup = (): void => {
            clearTimeout(timer);
            candidate.removeListener("connect", onConnect);
            candidate.removeListener("error", onError);
         };
         const onConnect = (): void => {
            cleanup();
            resolve(candidate);
         };
         const onError = (error: Error): void => {
            cleanup();
            reject(error);
         };
         candidate.once("connect", onConnect);
         candidate.once("error", onError);
         if (Number.isFinite(timeoutMs)) {
            timer = setTimeout(() => {
               cleanup();
               candidate.destroy();
               reject(new Error(`Could not connect to ${host}:${port} within ${timeoutMs} ms.`));
            }, timeoutMs);
         }
      });
   }

   /**
    * `connectTimeoutMs`/`allowNonLoopback` become this connection's own (see their own doc),
    * reused by `reconnect()` by default so neither has to be repeated on every call. A
    * non-loopback `host` is refused unless `allowNonLoopback` is set - see
    * assertLoopbackOrAllowed()'s doc.
    */
   public static async connect(
      host = "localhost",
      port = 4712,
      connectTimeoutMs: number = ECConnection.DEFAULT_CONNECT_TIMEOUT_MS,
      allowNonLoopback = false,
   ): Promise<ECConnection> {
      assertLoopbackOrAllowed(host, allowNonLoopback);
      const socket = await ECConnection.connectSocket(host, port, connectTimeoutMs);
      const connection = new ECConnection(socket, connectTimeoutMs, allowNonLoopback);
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
    *
    * The previous socket is destroyed and whatever was still pending on it is
    * rejected: it may well still be open (a failed authenticate() leaves its
    * socket so), and would otherwise stay open on the daemon's side for as long
    * as the daemon tolerates it.
    */
   public async reconnect(
      host: string,
      port: number,
      connectTimeoutMs: number = this.connectTimeoutMs,
      allowNonLoopback: boolean = this.allowNonLoopback,
   ): Promise<void> {
      assertLoopbackOrAllowed(host, allowNonLoopback);
      const socket = await ECConnection.connectSocket(host, port, connectTimeoutMs);
      this.connectTimeoutMs = connectTimeoutMs;
      this.allowNonLoopback = allowNonLoopback;
      const previous = this.socket;
      this.socket = socket;
      const replaced = new Error("EC connection replaced by reconnect().");
      this.rejectPending(replaced);
      previous.destroy();
      this.closed = false;
      this.closeError = undefined;
      this.authenticated = false;
      this.receiveChunks.length = 0;
      this.receiveBufferedLength = 0;
      this.wireSocket();
      this.beginPump();
      // The daemon answers anything but EC_OP_AUTH_REQ on a fresh connection with EC_OP_AUTH_FAIL
      // and drops it, so a request() made by a caller polling while the new socket is still
      // authenticating (see ECEngine's reconnect loop) must wait for authenticateWithHash().
      this.releaseHeldRequests?.();
      const held = new Promise<void>((resolve) => {
         this.releaseHeldRequests = resolve;
      });
      this.requestQueue = this.requestQueue.then(() => held);
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
   /**
    * Adds this connection's client-opt-in capability tags to `authRequest` - the ones with a
    * `localCapabilities` flag to gate on, unlike the unconditional version-probes
    * `authenticateWithHash()` adds itself (see ECCapabilities.sharedDirsConfig's doc). Split out
    * purely to keep authenticateWithHash() under the cognitive-complexity limit - these seven
    * independent `if`s don't interact with anything else in that function.
    */
   private addOptionalCapabilityTags(authRequest: ECPacket): void {
      if (this.localCapabilities.zlib) {
         authRequest.add(new ECCustomTag(ECTagNames.EC_TAG_CAN_ZLIB, new Uint8Array()));
      }
      if (this.localCapabilities.utf8Numbers) {
         authRequest.add(new ECCustomTag(ECTagNames.EC_TAG_CAN_UTF8_NUMBERS, new Uint8Array()));
      }
      if (this.localCapabilities.notify) {
         authRequest.add(new ECCustomTag(ECTagNames.EC_TAG_CAN_NOTIFY, new Uint8Array()));
      }
      if (this.localCapabilities.largeTagCount) {
         authRequest.add(new ECCustomTag(ECTagNames.EC_TAG_CAN_LARGE_TAG_COUNT, new Uint8Array()));
      }
      if (this.localCapabilities.preferNoZlib) {
         authRequest.add(new ECCustomTag(ECTagNames.EC_TAG_PREFER_NO_ZLIB, new Uint8Array()));
      }
      if (this.localCapabilities.multiSearch) {
         authRequest.add(new ECCustomTag(ECTagNames.EC_TAG_CAN_MULTI_SEARCH, new Uint8Array()));
      }
      if (this.localCapabilities.chatSessions) {
         authRequest.add(new ECCustomTag(ECTagNames.EC_TAG_CAN_CHAT_SESSIONS, new Uint8Array()));
      }
   }

   public async authenticateWithHash(passwordHash: string): Promise<void> {
      try {
         await this.handshake(passwordHash);
      } catch (error) {
         // A connection whose handshake failed is of no use, and the daemon expects the client to
         // drop it: close it here rather than leave an unauthenticated socket open on the daemon.
         this.abort(error instanceof Error ? error : new Error(String(error)));
         throw error;
      } finally {
         // Whatever the outcome, requests held since reconnect() may go now: after a failure
         // they fail on the closed connection instead of waiting for an authentication that
         // isn't coming.
         this.releaseHeldRequests?.();
         this.releaseHeldRequests = undefined;
      }
   }

   /**
    * The handshake's own exchanges skip request()'s queue: it is precisely what the requests held
    * by reconnect() wait behind.
    */
   private async handshake(passwordHash: string): Promise<void> {
      const authRequest = new ECPacket(ECOpcode.EC_OP_AUTH_REQ);
      authRequest.add(new ECUInt16Tag(ECTagNames.EC_TAG_PROTOCOL_VERSION, ECVersion.PROTOCOL));
      authRequest.add(new ECStringTag(ECTagNames.EC_TAG_CLIENT_NAME, ECVersion.CLIENT_NAME));
      authRequest.add(new ECStringTag(ECTagNames.EC_TAG_CLIENT_VERSION, ECVersion.CLIENT_VERSION));
      this.addOptionalCapabilityTags(authRequest);
      // Unconditional, unlike every capability above - no client-side
      // preference exists to gate it on, see ECCapabilities.sharedDirsConfig's doc.
      authRequest.add(new ECCustomTag(ECTagNames.EC_TAG_CAN_SHAREDDIRS_CONFIG, new Uint8Array()));
      // Unconditional too - see ECCapabilities.searchList's doc.
      authRequest.add(new ECCustomTag(ECTagNames.EC_TAG_CAN_SEARCH_LIST, new Uint8Array()));
      // Unconditional too - see ECCapabilities.partialUpdate's doc.
      authRequest.add(new ECCustomTag(ECTagNames.EC_TAG_CAN_PARTIAL_UPDATE, new Uint8Array()));
      // Unconditional too - see ECCapabilities.clientHistory's doc.
      authRequest.add(new ECCustomTag(ECTagNames.EC_TAG_CAN_CLIENT_HISTORY, new Uint8Array()));
      debug("EC_OP_AUTH_REQ has(EC_TAG_CAN_NOTIFY) = %s", authRequest.has(ECTagNames.EC_TAG_CAN_NOTIFY));
      const saltPacket = await this.exchange(authRequest);
      if (saltPacket.opcode !== ECOpcode.EC_OP_AUTH_SALT) {
         throw new Error(`Expected EC_OP_AUTH_SALT, received opcode 0x${saltPacket.opcode.toString(16)}.`);
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
      authPasswd.add(new ECHash16Tag(ECTagNames.EC_TAG_PASSWD_HASH, saltedHash));
      const reply = await this.exchange(authPasswd);
      if (reply.opcode === ECOpcode.EC_OP_AUTH_FAIL) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason = reasonTag instanceof ECStringTag ? reasonTag.value : "EC authentication failed.";
         throw new ECAuthenticationError(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_AUTH_OK) {
         throw new Error(`Unexpected opcode 0x${reply.opcode.toString(16)} in reply to EC_OP_AUTH_PASSWD.`);
      }
      // From here on, readPacket() applies maxPacketBytesAuthenticated rather than
      // maxPacketBytesUnauthenticated - mirrors the daemon's own IsAuthorized() gate.
      this.authenticated = true;
      // The client must not use a capability unless the server echoed it.
      this.remoteCapabilities.largeTagCount =
         this.localCapabilities.largeTagCount && reply.has(ECTagNames.EC_TAG_CAN_LARGE_TAG_COUNT);
      this.remoteCapabilities.multiSearch = this.localCapabilities.multiSearch && reply.has(ECTagNames.EC_TAG_CAN_MULTI_SEARCH);
      this.remoteCapabilities.chatSessions = this.localCapabilities.chatSessions && reply.has(ECTagNames.EC_TAG_CAN_CHAT_SESSIONS);
      // Unconditional request above, so no ANDing with a local flag here -
      // see ECCapabilities.sharedDirsConfig's doc.
      this.remoteCapabilities.sharedDirsConfig = reply.has(ECTagNames.EC_TAG_CAN_SHAREDDIRS_CONFIG);
      // Unconditional request above too - see ECCapabilities.searchList's doc.
      this.remoteCapabilities.searchList = reply.has(ECTagNames.EC_TAG_CAN_SEARCH_LIST);
      // Unconditional request above too - see ECCapabilities.partialUpdate's doc.
      this.remoteCapabilities.partialUpdate = reply.has(ECTagNames.EC_TAG_CAN_PARTIAL_UPDATE);
      // Unconditional request above too - see ECCapabilities.clientHistory's doc.
      this.remoteCapabilities.clientHistory = reply.has(ECTagNames.EC_TAG_CAN_CLIENT_HISTORY);
      this.sessionId = reply.find(ECTagNames.EC_TAG_SESSION_ID)?.intValue;
   }

   public async send(packet: ECPacket): Promise<void> {
      let body = packet.encode(this.localCapabilities);
      if (body.length > ECConnection.MAX_REQUEST_BYTES) {
         throw new RangeError(`EC request of ${body.length} bytes exceeds the ${ECConnection.MAX_REQUEST_BYTES}-byte limit.`);
      }
      const oversized = body.length > ECConnection.ZLIB_OVERSIZED_THRESHOLD;
      const compress = this.localCapabilities.zlib && (oversized || !this.localCapabilities.preferNoZlib);
      if (compress) {
         body = zlib.deflateSync(body);
      }
      const flags = ECFlags.create(compress, this.localCapabilities.utf8Numbers, this.localCapabilities.largeTagCount);
      const header = new TransmissionHeader(flags, body.length);
      await new Promise<void>((resolve, reject) => {
         this.socket.write(Buffer.concat([header.encode(), body]), (error) => {
            if (error) {
               reject(error);
            } else {
               resolve();
            }
         });
      });
   }

   /**
    * Sends `packet` and resolves with the daemon's reply - the way every request/reply exchange
    * of this library goes. Unlike a separate send() then receive(), it is safe to call
    * concurrently: EC has no request id, so replies can only be paired with requests by order,
    * and exchanges are therefore run one at a time, in call order, on a per-connection queue. A
    * failed or timed-out exchange does not stop the ones queued behind it (they fail on their
    * own, on a closed connection, or succeed after a reconnect()). See `requestTimeoutMs`.
    *
    * Not for a notification-only connection (see `dispatchPacket`), and not for requests the
    * daemon never answers (Daemon.shutdown() keeps using send()).
    */
   public request(packet: ECPacket): Promise<ECPacket> {
      const exchange = this.requestQueue.then(() => this.exchange(packet));
      this.requestQueue = exchange.then(
         () => undefined,
         () => undefined,
      );
      return exchange;
   }

   private async exchange(packet: ECPacket): Promise<ECPacket> {
      if (this.closed) {
         throw this.closeError ?? new Error("EC connection closed.");
      }
      const timeoutMs = this.requestTimeoutMs;
      let timer: NodeJS.Timeout | undefined;
      const expired = new Promise<never>((_resolve, reject) => {
         if (Number.isFinite(timeoutMs)) {
            timer = setTimeout(() => {
               const error = new Error(`No reply from the daemon within ${timeoutMs} ms.`);
               this.abort(error);
               reject(error);
            }, timeoutMs);
         }
      });
      // The timeout can fire while send() is still pending, before anything races against it.
      expired.catch(() => undefined);
      try {
         await this.send(packet);
         return await Promise.race([this.receive(), expired]);
      } finally {
         clearTimeout(timer);
      }
   }

   /**
    * Resolves with the next packet the pump loop dispatches to this call -
    * i.e. the reply to whatever was last sent, under the normal
    * request/reply usage pattern. See `dispatchPacket` for what happens
    * when there's no matching receive() call.
    */
   public receive(): Promise<ECPacket> {
      if (this.closed) {
         return Promise.reject(this.closeError ?? new Error("EC connection closed."));
      }
      return new Promise<ECPacket>((resolve, reject) => {
         this.pendingReceives.push({ resolve, reject });
      });
   }

   /**
    * Type-safe shorthand for on("notification", listener).
    */
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
   private async pump(socket: net.Socket): Promise<void> {
      try {
         for (;;) {
            const packet = await this.readPacket();
            if (socket !== this.socket) {
               return;
            }
            this.dispatchPacket(packet);
         }
      } catch (error) {
         if (socket !== this.socket) {
            return;
         }
         const reason = error instanceof Error ? error : new Error(String(error));
         // Whatever ended the loop (socket closed, or a packet that could not be framed or
         // decoded), the byte stream cannot be trusted from here on and nobody is reading it
         // any more: close the connection for good rather than leave it open, buffering
         // whatever the peer keeps sending, with every later receive() waiting forever.
         // A no-op on the state side when the socket closing is what ended the loop.
         this.abort(reason);
      }
   }

   /**
    * Closes the connection for good because of `reason`: marks it closed (emitting
    * "disconnected", unless close() caused it), destroys the socket and rejects whatever was
    * still waiting. Used when the byte stream can no longer be trusted or has stopped answering.
    */
   private abort(reason: Error): void {
      this.onClose(reason);
      this.socket.destroy();
      this.rejectPending(reason);
   }

   private rejectPending(reason: Error): void {
      while (this.pendingReads.length > 0) {
         this.pendingReads.shift()?.reject(reason);
      }
      while (this.pendingReceives.length > 0) {
         this.pendingReceives.shift()?.reject(reason);
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
    * pending receive() by mistake, desyncing every later request/reply
    * pairing on this connection. Confirmed to actually happen with several
    * requests polling concurrently on one connection that also has
    * `notify: true` enabled - not just a theoretical risk. The only safe
    * pattern is a second, dedicated ECConnection purely for `notify: true`
    * + onNotification(), never used for send()/receive(), while every
    * other connection stays `notify: false`.
    */
   private dispatchPacket(packet: ECPacket): void {
      const waiter = this.pendingReceives.shift();
      if (waiter) {
         debug("dispatch: opcode 0x%s -> pending receive()", packet.opcode.toString(16));
         waiter.resolve(packet);
         return;
      }
      debug("dispatch: opcode 0x%s -> notification (no pending receive())", packet.opcode.toString(16));
      this.emitGuarded("notification", packet);
   }

   /**
    * Like emit(), but a listener that throws is reported and skipped instead of propagating:
    * emit() runs listeners synchronously, so an exception from one would escape into pump()
    * (or a socket event handler) and stop the read loop, taking the whole connection down for
    * a bug in the caller's code, and skipping the listeners registered after it.
    */
   private emitGuarded(event: "notification" | "disconnected", ...args: unknown[]): void {
      for (const listener of this.rawListeners(event)) {
         try {
            listener.apply(this, args);
         } catch (error) {
            console.error(`amule-ec: a "${event}" listener threw:`, error);
         }
      }
   }

   private async readPacket(): Promise<ECPacket> {
      const headerBuffer = await this.readBytes(TransmissionHeader.SIZE);
      const header = TransmissionHeader.decode(headerBuffer);
      const maxPacketBytes = this.authenticated ? this.maxPacketBytesAuthenticated : this.maxPacketBytesUnauthenticated;
      if (header.bodyLength > maxPacketBytes) {
         throw new RangeError(
            `Announced packet body of ${header.bodyLength} bytes exceeds the ${maxPacketBytes}-byte limit ` +
               `(${this.authenticated ? "authenticated" : "unauthenticated"} connection).`,
         );
      }
      let body = await this.readBytes(header.bodyLength);
      if (header.compressed) {
         // Reject rather than trust the wire flag blindly: this only ever inflates a reply this
         // connection is prepared to receive compressed, because it is the one that asked for
         // zlib in the first place (localCapabilities.zlib) - not something an unauthenticated,
         // possibly hostile, peer gets to switch on by merely setting a bit in the header.
         if (!this.localCapabilities.zlib) {
            throw new RangeError("Received a compressed packet, but zlib was never negotiated on this connection.");
         }
         body = zlib.inflateSync(body, { maxOutputLength: this.maxInflatedBytes });
      }
      // The transmission-layer flags tell us exactly how *this* packet's
      // application-layer data was encoded, so we decode against those
      // rather than assuming they match our negotiated remoteCapabilities.
      const wireCapabilities = new ECCapabilities();
      wireCapabilities.utf8Numbers = header.utf8Numbers;
      wireCapabilities.largeTagCount = header.largeTagCount;
      return ECPacket.decode(body, wireCapabilities, this.maxTagDepth, this.maxTagCount);
   }

   private onData(chunk: Buffer): void {
      this.receiveChunks.push(chunk);
      this.receiveBufferedLength += chunk.length;
      this.flushPendingReads();
   }

   private flushPendingReads(): void {
      for (;;) {
         const next = this.pendingReads[0];
         if (!next || this.receiveBufferedLength < next.length) {
            return;
         }
         this.pendingReads.shift();
         const [firstChunk] = this.receiveChunks;
         const combined =
            firstChunk && this.receiveChunks.length === 1
               ? firstChunk
               : Buffer.concat(this.receiveChunks, this.receiveBufferedLength);
         const result = Buffer.from(combined.subarray(0, next.length));
         const rest = combined.subarray(next.length);
         this.receiveChunks.length = 0;
         if (rest.length > 0) {
            this.receiveChunks.push(rest);
         }
         this.receiveBufferedLength = rest.length;
         next.resolve(result);
      }
   }

   private readBytes(length: number): Promise<Buffer> {
      if (length === 0) {
         return Promise.resolve(Buffer.alloc(0));
      }
      if (this.closed) {
         return Promise.reject(this.closeError ?? new Error("EC connection closed."));
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
    * waiting on the socket directly) and the reconnect signal. pump() also calls it
    * when a packet can't be decoded, closing the connection the same way.
    *
    * Skips the "disconnected" emit entirely when close() caused this - see
    * its doc for why reconnecting after a deliberate close is a bug, not a
    * feature.
    */
   private onClose(error: Error): void {
      if (this.closed) {
         return;
      }
      this.closed = true;
      this.closeError = error;
      while (this.pendingReads.length > 0) {
         this.pendingReads.shift()?.reject(error);
      }
      if (!this.intentionalClose) {
         this.emitGuarded("disconnected");
      }
   }
}
