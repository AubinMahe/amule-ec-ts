import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection, expectRejection } from "./testUtils.js";

describe("Daemon.shutdown", () => {
   it("sends EC_OP_SHUTDOWN with no tags and resolves without waiting for a reply", async () => {
      const fake = createFakeConnection();
      const daemon = new ec.Daemon(fake.connection);
      // Deliberately no fake.queueReply(): if shutdown() ever called
      // receive(), FakeConnection would throw "no queued reply", failing
      // this test - the point is that it must not call receive() at all,
      // mirroring amulecmd's own fire-and-forget dispatch for this opcode.

      await daemon.shutdown();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_SHUTDOWN);
      expect(fake.sent[0]?.tags).to.have.lengthOf(0);
   });
});

describe("Daemon.checkVersion", () => {
   it("sends EC_OP_VERSION_CHECK with no tags and succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const daemon = new ec.Daemon(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await daemon.checkVersion();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_VERSION_CHECK);
      expect(fake.sent[0]?.tags).to.have.lengthOf(0);
   });

   it("throws the daemon's reason on EC_OP_FAILED (e.g. throttled or compiled out)", async () => {
      const fake = createFakeConnection();
      const daemon = new ec.Daemon(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(
         new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "Version check throttled; try again shortly."),
      );
      fake.queueReply(failure);

      await expectRejection(daemon.checkVersion(), /throttled/);
   });
});
