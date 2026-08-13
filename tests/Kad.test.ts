import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection, expectRejection } from "./testUtils.js";

describe("Kad.start", () => {
   it("sends no request tags and succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const kad = new ec.Kad(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await kad.start();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_KAD_START);
      expect(fake.sent[0]?.tags).to.have.lengthOf(0);
   });

   it("throws the daemon's reason on EC_OP_FAILED", async () => {
      const fake = createFakeConnection();
      const kad = new ec.Kad(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "Kad is disabled in preferences."));
      fake.queueReply(failure);

      await expectRejection(kad.start(), /Kad is disabled in preferences/);
   });
});

describe("Kad.stop", () => {
   it("sends no request tags and always succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const kad = new ec.Kad(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await kad.stop();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_KAD_STOP);
      expect(fake.sent[0]?.tags).to.have.lengthOf(0);
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const kad = new ec.Kad(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(kad.stop(), /EC_OP_NOOP/);
   });
});

describe("Kad.updateNodesFromUrl", () => {
   it("sends the URL as a single EC_TAG_KADEMLIA_UPDATE_URL tag and always succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const kad = new ec.Kad(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await kad.updateNodesFromUrl("http://www.example.com/nodes.dat");

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_KAD_UPDATE_FROM_URL);
      const urlTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_KADEMLIA_UPDATE_URL);
      expect((urlTag as ec.ECStringTag).value).to.equal("http://www.example.com/nodes.dat");
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const kad = new ec.Kad(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(kad.updateNodesFromUrl("http://example.com/nodes.dat"), /EC_OP_NOOP/);
   });
});

describe("Kad.bootstrapFromIp", () => {
   it("packs the dotted-quad address as a low-byte-first uint32 and the port as uint16", async () => {
      const fake = createFakeConnection();
      const kad = new ec.Kad(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await kad.bootstrapFromIp("192.0.2.1", 4672);

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_KAD_BOOTSTRAP_FROM_IP);
      const ipTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_BOOTSTRAP_IP);
      expect(ipTag?.intValue).to.equal(0x010200c0n);
      const portTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_BOOTSTRAP_PORT);
      expect(portTag?.intValue).to.equal(4672n);
   });

   it("rejects a malformed IPv4 address before sending anything", async () => {
      const fake = createFakeConnection();
      const kad = new ec.Kad(fake.connection);

      await expectRejection(kad.bootstrapFromIp("not.an.ip", 4672), /Invalid IPv4 address/);
      expect(fake.sent).to.have.lengthOf(0);
   });

   it("throws the daemon's reason on EC_OP_FAILED", async () => {
      const fake = createFakeConnection();
      const kad = new ec.Kad(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "Kad is disabled in preferences."));
      fake.queueReply(failure);

      await expectRejection(kad.bootstrapFromIp("192.0.2.1", 4672), /Kad is disabled in preferences/);
   });
});

describe("Kad.connect", () => {
   it("sends no request tags and returns each EC_TAG_STRING status message", async () => {
      const fake = createFakeConnection();
      const kad = new ec.Kad(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_STRINGS);
      reply.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "Connecting to eD2k..."));
      reply.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "Connecting to Kad..."));
      fake.queueReply(reply);

      const messages = await kad.connect();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_CONNECT);
      expect(fake.sent[0]?.tags).to.have.lengthOf(0);
      expect(messages).to.deep.equal(["Connecting to eD2k...", "Connecting to Kad..."]);
   });

   it("throws the daemon's reason on EC_OP_FAILED", async () => {
      const fake = createFakeConnection();
      const kad = new ec.Kad(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "All networks are disabled."));
      fake.queueReply(failure);

      await expectRejection(kad.connect(), /All networks are disabled/);
   });
});

describe("Kad.disconnect", () => {
   it("returns each EC_TAG_STRING status message on EC_OP_STRINGS", async () => {
      const fake = createFakeConnection();
      const kad = new ec.Kad(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_STRINGS);
      reply.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "Disconnected from eD2k."));
      fake.queueReply(reply);

      const messages = await kad.disconnect();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_DISCONNECT);
      expect(messages).to.deep.equal(["Disconnected from eD2k."]);
   });

   it("returns an empty array on EC_OP_NOOP (nothing was connected)", async () => {
      const fake = createFakeConnection();
      const kad = new ec.Kad(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      const messages = await kad.disconnect();

      expect(messages).to.deep.equal([]);
   });

   it("throws a generic error on any other unexpected opcode", async () => {
      const fake = createFakeConnection();
      const kad = new ec.Kad(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(kad.disconnect(), /EC_OP_STRINGS/);
   });
});
