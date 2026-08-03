import { expect } from "chai";
import * as ec from "../src/index.js";
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

describe("Log.addLine", () => {
   it("sends the text as EC_TAG_STRING with no EC_TAG_LOG_TO_STATUS by default", async () => {
      const fake = createFakeConnection();
      const log = new ec.Log(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await log.addLine("hello");

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_ADDLOGLINE);
      expect((fake.sent[0]?.find(ec.ECTagNames.EC_TAG_STRING) as ec.ECStringTag).value).to.equal(
         "hello",
      );
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(fake.sent[0]?.find(ec.ECTagNames.EC_TAG_LOG_TO_STATUS)).to.be.undefined;
   });

   it("adds a bare presence-only EC_TAG_LOG_TO_STATUS tag when toStatus is true", async () => {
      const fake = createFakeConnection();
      const log = new ec.Log(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await log.addLine("hello", true);

      expect(fake.sent[0]?.find(ec.ECTagNames.EC_TAG_LOG_TO_STATUS)).to.be.instanceOf(
         ec.ECCustomTag,
      );
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const log = new ec.Log(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(log.addLine("hello"), /EC_OP_NOOP/);
   });
});

describe("Log.fetchLast", () => {
   it("sends no request tags and returns the trimmed single line from an EC_OP_LOG reply", async () => {
      const fake = createFakeConnection();
      const log = new ec.Log(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_LOG);
      reply.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "  last line  "));
      fake.queueReply(reply);

      const last = await log.fetchLast();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_LAST_LOG_ENTRY);
      expect(fake.sent[0]?.tags).to.have.lengthOf(0);
      expect(last).to.equal("last line");
   });

   it("does not touch the cached .lines from a prior fetch()", async () => {
      const fake = createFakeConnection();
      const log = new ec.Log(fake.connection);
      const fetchReply = new ec.ECPacket(ec.ECOpcode.EC_OP_LOG);
      fetchReply.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "line one\nline two"));
      fake.queueReply(fetchReply);
      await log.fetch();

      const lastReply = new ec.ECPacket(ec.ECOpcode.EC_OP_LOG);
      lastReply.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "line two"));
      fake.queueReply(lastReply);
      await log.fetchLast();

      expect(log.lines).to.deep.equal(["line one", "line two"]);
   });

   it("returns undefined for an empty log", async () => {
      const fake = createFakeConnection();
      const log = new ec.Log(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_LOG);
      reply.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, ""));
      fake.queueReply(reply);

      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(await log.fetchLast()).to.be.undefined;
   });

   it("throws when the daemon replies with an unexpected opcode", async () => {
      const fake = createFakeConnection();
      const log = new ec.Log(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(log.fetchLast(), /EC_OP_LOG/);
   });
});

describe("DebugLog.fetch", () => {
   it("splits the single newline-separated EC_TAG_STRING into trimmed, non-empty lines", async () => {
      const fake = createFakeConnection();
      const log = new ec.DebugLog(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_DEBUGLOG);
      reply.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "debug one\ndebug two\n"));
      fake.queueReply(reply);

      await log.fetch();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_DEBUGLOG);
      expect(log.lines).to.deep.equal(["debug one", "debug two"]);
   });

   it("throws when the daemon replies with an unexpected opcode", async () => {
      const fake = createFakeConnection();
      const log = new ec.DebugLog(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(log.fetch(), /EC_OP_DEBUGLOG/);
   });
});

describe("DebugLog.reset", () => {
   it("sends EC_OP_RESET_DEBUGLOG with no tags and succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const log = new ec.DebugLog(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await log.reset();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_RESET_DEBUGLOG);
   });

   it("throws when the daemon replies with anything other than EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const log = new ec.DebugLog(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(log.reset(), /EC_OP_NOOP/);
   });
});

describe("DebugLog.addLine", () => {
   it("sends the text as EC_TAG_STRING and succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const log = new ec.DebugLog(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await log.addLine("debug hello");

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_ADDDEBUGLOGLINE);
      expect((fake.sent[0]?.find(ec.ECTagNames.EC_TAG_STRING) as ec.ECStringTag).value).to.equal(
         "debug hello",
      );
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const log = new ec.DebugLog(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(log.addLine("debug hello"), /EC_OP_NOOP/);
   });
});
