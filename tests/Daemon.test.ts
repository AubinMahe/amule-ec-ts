import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection } from "./testUtils.js";

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
