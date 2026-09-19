import { expect } from "chai";
import * as ec from "../src/index.js";
import { startFakeEcServer, computeSaltedHash, type FakeEcServer, type FakeEcPeer } from "./fakeEcServer.js";
import { expectRejection, hexHash } from "./testUtils.js";

describe("ECEngine.connection", () => {
   it("throws before ECEngine.start() has ever completed", () => {
      expect(() => ec.ECEngine.connection).to.throw(/ECEngine\.start\(\)/);
   });
});

describe("armReconnect", () => {
   const PASSWORD_HASH = hexHash("b");
   const SALT = 0xfedc_ba98_7654_3210n;
   let server: FakeEcServer;

   beforeEach(async () => {
      server = await startFakeEcServer();
   });

   afterEach(async () => {
      await server.close();
   });

   async function acceptAuthentication(peer: FakeEcPeer): Promise<void> {
      await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_SALT).add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PASSWD_SALT, SALT)),
      );
      const authPasswd = await peer.readPacket();
      const hashTag = authPasswd.find(ec.ECTagNames.EC_TAG_PASSWD_HASH) as ec.ECHash16Tag;
      expect(Buffer.from(hashTag.value)).to.deep.equal(Buffer.from(computeSaltedHash(PASSWORD_HASH, SALT)));
      peer.writePacket(new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_OK));
   }

   it("reconnects and re-authenticates automatically once the connection drops", async function () {
      this.timeout(5_000);
      const [connection, firstPeer] = await Promise.all([ec.ECConnection.connect("127.0.0.1", server.port), server.nextPeer()]);
      await Promise.all([connection.authenticateWithHash(PASSWORD_HASH), acceptAuthentication(firstPeer)]);

      ec.armReconnect(connection, "127.0.0.1", server.port, PASSWORD_HASH, false, false, false);

      const secondPeerPromise = server.nextPeer();
      firstPeer.socket.destroy();
      const secondPeer = await secondPeerPromise;
      await acceptAuthentication(secondPeer);
      // The client's own authenticateWithHash()/armReconnect() continuation runs a beat
      // after the server-side write above (real loopback I/O) - give it room to settle
      // before disarming, below, or the re-arm could land after removeAllListeners().
      await new Promise<void>((resolve) => {
         setTimeout(resolve, 100);
      });

      // Proves the reconnected socket is genuinely wired for both directions, not just
      // re-authenticated.
      await connection.send(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));
      const afterReconnect = await secondPeer.readPacket();
      expect(afterReconnect.opcode).to.equal(ec.ECOpcode.EC_OP_NOOP);

      // armReconnect() re-arms itself on every successful reconnect (see its doc) - without
      // this, the fake server's cleanup below (destroying the still-open second socket)
      // would be seen as yet another disconnect and spawn a real, unstoppable reconnect
      // loop with live timers, hanging the test process.
      connection.removeAllListeners("disconnected");
   });
});

describe("ECEngine.start", () => {
   const PASSWORD_HASH = hexHash("c");
   const SALT = 0x0011_2233_4455_6677n;
   let server: FakeEcServer;

   beforeEach(async () => {
      server = await startFakeEcServer();
   });

   afterEach(async () => {
      // ECEngine.start() always arms a reconnect loop (see armReconnect's doc) -
      // disarm it before closing the fake server, same reasoning as the
      // armReconnect describe block above.
      ec.ECEngine.connection.removeAllListeners("disconnected");
      await server.close();
   });

   async function acceptAuthentication(peer: FakeEcPeer): Promise<ec.ECPacket> {
      const authRequest = await peer.readPacket();
      peer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_SALT).add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PASSWD_SALT, SALT)),
      );
      const authPasswd = await peer.readPacket();
      const hashTag = authPasswd.find(ec.ECTagNames.EC_TAG_PASSWD_HASH) as ec.ECHash16Tag;
      expect(Buffer.from(hashTag.value)).to.deep.equal(Buffer.from(computeSaltedHash(PASSWORD_HASH, SALT)));
      peer.writePacket(new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_OK));
      return authRequest;
   }

   it("connects, authenticates and exposes the connection via .connection - capabilities default to off", async () => {
      const [, authRequest] = await Promise.all([
         ec.ECEngine.start({ host: "127.0.0.1", port: server.port, passwordHash: PASSWORD_HASH }),
         server.nextPeer().then((peer) => acceptAuthentication(peer)),
      ]);

      expect(ec.ECEngine.connection).to.be.instanceOf(ec.ECConnection);
      expect(ec.ECEngine.connection.localCapabilities.notify).to.equal(false);
      expect(ec.ECEngine.connection.localCapabilities.multiSearch).to.equal(false);
      expect(authRequest.has(ec.ECTagNames.EC_TAG_CAN_NOTIFY)).to.equal(false);
      expect(authRequest.has(ec.ECTagNames.EC_TAG_CAN_MULTI_SEARCH)).to.equal(false);
   });

   it("keeps the default request timeout unless requestTimeoutMs is given, and applies it when it is", async () => {
      await Promise.all([
         ec.ECEngine.start({ host: "127.0.0.1", port: server.port, passwordHash: PASSWORD_HASH }),
         server.nextPeer().then((peer) => acceptAuthentication(peer)),
      ]);
      expect(ec.ECEngine.connection.requestTimeoutMs).to.equal(ec.ECConnection.DEFAULT_REQUEST_TIMEOUT_MS);

      ec.ECEngine.connection.removeAllListeners("disconnected");
      await Promise.all([
         ec.ECEngine.start({ host: "127.0.0.1", port: server.port, passwordHash: PASSWORD_HASH, requestTimeoutMs: 1234 }),
         server.nextPeer().then((peer) => acceptAuthentication(peer)),
      ]);

      expect(ec.ECEngine.connection.requestTimeoutMs).to.equal(1234);
   });

   it("sets localCapabilities and sends EC_TAG_CAN_NOTIFY/EC_TAG_CAN_MULTI_SEARCH when requested", async () => {
      const [, authRequest] = await Promise.all([
         ec.ECEngine.start({
            host: "127.0.0.1",
            port: server.port,
            passwordHash: PASSWORD_HASH,
            notify: true,
            multiSearch: true,
         }),
         server.nextPeer().then((peer) => acceptAuthentication(peer)),
      ]);

      expect(ec.ECEngine.connection.localCapabilities.notify).to.equal(true);
      expect(ec.ECEngine.connection.localCapabilities.multiSearch).to.equal(true);
      expect(authRequest.has(ec.ECTagNames.EC_TAG_CAN_NOTIFY)).to.equal(true);
      expect(authRequest.has(ec.ECTagNames.EC_TAG_CAN_MULTI_SEARCH)).to.equal(true);
   });
});

async function refuseAuthentication(peer: FakeEcPeer, salt: bigint): Promise<void> {
   await peer.readPacket();
   peer.writePacket(new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_SALT).add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PASSWD_SALT, salt)));
   await peer.readPacket();
   peer.writePacket(
      new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_FAIL).add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "Invalid password.")),
   );
}

describe("ECEngine.start when the daemon rejects the credentials", () => {
   const PASSWORD_HASH = hexHash("d");
   const SALT = 0x0102_0304_0506_0708n;
   let server: FakeEcServer;

   beforeEach(async () => {
      server = await startFakeEcServer();
   });

   afterEach(async () => {
      await server.close();
   });

   it("rejects with an ECAuthenticationError and does not leave the socket open", async () => {
      const peerPromise = server.nextPeer();
      const outcome = ec.ECEngine.start({ host: "127.0.0.1", port: server.port, passwordHash: PASSWORD_HASH }).then(
         () => undefined,
         (error: unknown) => error,
      );
      const peer = await peerPromise;
      const serverSawClose = new Promise<void>((resolve) => {
         peer.socket.once("close", resolve);
      });

      await refuseAuthentication(peer, SALT);

      const error = await outcome;
      expect(error).to.be.instanceOf(ec.ECAuthenticationError);
      await serverSawClose;
   });
});

describe("armReconnect when the daemon rejects the credentials", () => {
   const PASSWORD_HASH = hexHash("e");
   const SALT = 0x1112_1314_1516_1718n;
   let server: FakeEcServer;
   let originalConsoleError: typeof console.error;

   beforeEach(async () => {
      server = await startFakeEcServer();
      originalConsoleError = console.error;
      console.error = (): void => undefined;
   });

   afterEach(async () => {
      console.error = originalConsoleError;
      await server.close();
   });

   it("gives up instead of retrying forever, and requests fail with the daemon's reason", async () => {
      const [connection, firstPeer] = await Promise.all([ec.ECConnection.connect("127.0.0.1", server.port), server.nextPeer()]);
      const authenticated = connection.authenticateWithHash(PASSWORD_HASH);
      await firstPeer.readPacket();
      firstPeer.writePacket(
         new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_SALT).add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PASSWD_SALT, SALT)),
      );
      await firstPeer.readPacket();
      firstPeer.writePacket(new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_OK));
      await authenticated;
      ec.armReconnect(connection, "127.0.0.1", server.port, PASSWORD_HASH, false, false, false, 20);

      const secondPeerPromise = server.nextPeer();
      firstPeer.socket.destroy();
      const secondPeer = await secondPeerPromise;
      await refuseAuthentication(secondPeer, SALT);

      // The next attempt, had there been one, would come 40 ms later.
      const outcome = await Promise.race([
         server.nextPeer().then(() => "retried"),
         new Promise<string>((resolve) => {
            setTimeout(() => {
               resolve("gave up");
            }, 300);
         }),
      ]);
      expect(outcome).to.equal("gave up");
      await expectRejection(connection.request(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP)), /Invalid password\./);
   });
});
