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

   it("rejects anything but an http: or https: URL, without sending a request", async () => {
      const fake = createFakeConnection();
      const kad = new ec.Kad(fake.connection);

      for (const url of [
         "file:///etc/passwd",
         "ftp://example.com/nodes.dat",
         "javascript:alert(1)",
         "not a url",
         "//example.com/x",
      ]) {
         await expectRejection(kad.updateNodesFromUrl(url), /Invalid URL/);
      }

      expect(fake.sent).to.have.lengthOf(0);
   });

   it("accepts an https: URL", async () => {
      const fake = createFakeConnection();
      const kad = new ec.Kad(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await kad.updateNodesFromUrl("https://example.com/nodes.dat");

      expect(fake.sent).to.have.lengthOf(1);
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

describe("Kad.getLookups", () => {
   it("throws when remoteCapabilities.kadLookups is false", async () => {
      const fake = createFakeConnection();
      const kad = new ec.Kad(fake.connection);

      await expectRejection(kad.getLookups(), /EC_OP_GET_KAD_LOOKUPS/);
   });

   it("sends EC_OP_GET_KAD_LOOKUPS and decodes Kad lookup reports", async () => {
      const fake = createFakeConnection();
      fake.connection.remoteCapabilities.kadLookups = true;
      const kad = new ec.Kad(fake.connection);

      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_GET_KAD_LOOKUPS);
      const lookupTag = new ec.ECCustomTag(ec.ECTagNames.EC_TAG_KAD_LOOKUP, new Uint8Array(), [
         new ec.ECStringTag(ec.ECTagNames.EC_TAG_KAD_LOOKUP_TARGET, "target-hash"),
         new ec.ECStringTag(ec.ECTagNames.EC_TAG_KAD_LOOKUP_KEYWORD, "debian"),
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_KAD_LOOKUP_TYPE, ec.KadLookupType.Keyword),
         new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_KAD_LOOKUP_ACTIVE, 1),
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_KAD_LOOKUP_OVERDUE, 0),
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_KAD_LOOKUP_OMITTED_PEERS, 2),
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_KAD_LOOKUP_EVICTED_REFERRALS, 1),
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_KAD_LOOKUP_PEER, new Uint8Array(), [
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_KAD_LOOKUP_PEER_IP, 0x7f000001),
            new ec.ECUInt16Tag(ec.ECTagNames.EC_TAG_KAD_LOOKUP_PEER_PORT, 4672),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_KAD_LOOKUP_PEER_ID, new Uint8Array(16)),
            new ec.ECCustomTag(ec.ECTagNames.EC_TAG_KAD_LOOKUP_PEER_DISTANCE, new Uint8Array(16)),
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_KAD_LOOKUP_PEER_VERSION, 2),
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_KAD_LOOKUP_PEER_REQUESTS, 1),
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_KAD_LOOKUP_PEER_REPLIES, 1),
            new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_KAD_LOOKUP_PEER_RTT, 45n),
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_KAD_LOOKUP_PEER_ITEM_REQUESTS, 0),
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_KAD_LOOKUP_PEER_ITEM_REPLIES, 0),
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_KAD_LOOKUP_PEER_RESULTS, 5),
            new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_KAD_LOOKUP_PEER_PENDING, 0),
         ]),
      ]);
      reply.add(lookupTag);
      fake.queueReply(reply);

      const reports = await kad.getLookups();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_KAD_LOOKUPS);
      expect(reports).to.have.lengthOf(1);
      expect(reports[0]?.target).to.equal("target-hash");
      expect(reports[0]?.keyword).to.equal("debian");
      expect(reports[0]?.type).to.equal(ec.KadLookupType.Keyword);
      expect(reports[0]?.active).to.equal(true);
      expect(reports[0]?.peers).to.have.lengthOf(1);
      expect(reports[0]?.peers[0]?.ip).to.equal("127.0.0.1");
      expect(reports[0]?.peers[0]?.port).to.equal(4672);
      expect(reports[0]?.peers[0]?.results).to.equal(5);
   });
});
