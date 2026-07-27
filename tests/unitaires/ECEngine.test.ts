import { expect } from "chai";
import * as ec from "../../src/index.js";
import { startFakeEcServer, computeSaltedHash, type FakeEcServer, type FakeEcPeer } from "./fakeEcServer.js";
import { hexHash } from "./testUtils.js";

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
      peer.writePacket(new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_SALT).add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PASSWD_SALT, SALT)));
      const authPasswd = await peer.readPacket();
      const hashTag = authPasswd.find(ec.ECTagNames.EC_TAG_PASSWD_HASH) as ec.ECHash16Tag;
      expect(Buffer.from(hashTag.value)).to.deep.equal(Buffer.from(computeSaltedHash(PASSWORD_HASH, SALT)));
      peer.writePacket(new ec.ECPacket(ec.ECOpcode.EC_OP_AUTH_OK));
   }

   it("reconnects and re-authenticates automatically once the connection drops", async function () {
      this.timeout(5_000);
      const [connection, firstPeer] = await Promise.all([
         ec.ECConnection.connect("127.0.0.1", server.port),
         server.nextPeer(),
      ]);
      await Promise.all([connection.authenticateWithHash(PASSWORD_HASH), acceptAuthentication(firstPeer)]);

      ec.armReconnect(connection, "127.0.0.1", server.port, PASSWORD_HASH, false);

      const secondPeerPromise = server.nextPeer();
      firstPeer.socket.destroy();
      const secondPeer = await secondPeerPromise;
      await acceptAuthentication(secondPeer);
      // The client's own authenticateWithHash()/armReconnect() continuation runs a beat
      // after the server-side write above (real loopback I/O) - give it room to settle
      // before disarming, below, or the re-arm could land after removeAllListeners().
      await new Promise<void>((resolve) => { setTimeout(resolve, 100); });

      // Proves the reconnected socket is genuinely wired for both directions, not just re-authenticated.
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
