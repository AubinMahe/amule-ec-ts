import { expect } from "chai";
import * as ec from "../../src/index.js";
import { createFakeConnection, expectRejection } from "./testUtils.js";

describe("Log.fetch", () => {
   it("splits the single newline-separated EC_TAG_STRING into trimmed, non-empty lines", async () => {
      const fake = createFakeConnection();
      const log = new ec.Log(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_LOG);
      reply.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "  line one  \n\nline two\n"));
      fake.queueReply(reply);

      await log.fetch();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_LOG);
      expect(fake.sent[0]?.tags).to.have.lengthOf(0);
      expect(log.lines).to.deep.equal(["line one", "line two"]);
   });

   it("throws when the daemon replies with an unexpected opcode", async () => {
      const fake = createFakeConnection();
      const log = new ec.Log(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(log.fetch(), /EC_OP_LOG/);
   });
});

describe("Log.reset", () => {
   it("sends EC_OP_RESET_LOG with no tags and succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const log = new ec.Log(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await log.reset();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_RESET_LOG);
   });

   it("throws when the daemon replies with anything other than EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const log = new ec.Log(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(log.reset(), /EC_OP_NOOP/);
   });
});
