import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection, expectRejection } from "./testUtils.js";

describe("IPFilter.reload", () => {
   it("sends EC_OP_IPFILTER_RELOAD with no tags and succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const ipFilter = new ec.IPFilter(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await ipFilter.reload();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_IPFILTER_RELOAD);
      expect(fake.sent[0]?.tags).to.have.lengthOf(0);
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const ipFilter = new ec.IPFilter(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(ipFilter.reload(), /EC_OP_NOOP/);
   });
});

describe("IPFilter.updateFromUrl", () => {
   it("sends the URL as a single EC_TAG_STRING tag and succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const ipFilter = new ec.IPFilter(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await ipFilter.updateFromUrl("http://example.com/ipfilter.dat");

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_IPFILTER_UPDATE);
      const urlTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_STRING);
      expect((urlTag as ec.ECStringTag).value).to.equal("http://example.com/ipfilter.dat");
   });

   it("defaults to an empty string (daemon falls back to its configured URL) when omitted", async () => {
      const fake = createFakeConnection();
      const ipFilter = new ec.IPFilter(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await ipFilter.updateFromUrl();

      const urlTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_STRING);
      expect((urlTag as ec.ECStringTag).value).to.equal("");
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const ipFilter = new ec.IPFilter(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(ipFilter.updateFromUrl(), /EC_OP_NOOP/);
   });
});
