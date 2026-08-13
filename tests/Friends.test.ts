import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection, expectRejection, hexHash } from "./testUtils.js";

describe("Friends.addByEcid", () => {
   it("sends a bare EC_TAG_FRIEND_ADD with an EC_TAG_CLIENT child and succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const friends = new ec.Friends(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await friends.addByEcid(7n);

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_FRIEND);
      const addTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_FRIEND_ADD);
      expect(addTag).to.be.instanceOf(ec.ECCustomTag);
      const clientTag = addTag?.findChild(ec.ECTagNames.EC_TAG_CLIENT);
      expect(clientTag?.intValue).to.equal(7n);
   });

   it("throws the daemon's reason on EC_OP_FAILED (e.g. the ECID isn't a connected client)", async () => {
      const fake = createFakeConnection();
      const friends = new ec.Friends(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "OOPS! OpCode processing error!"));
      fake.queueReply(failure);

      await expectRejection(friends.addByEcid(7n), /OOPS/);
   });

   it("throws a generic error on any other unexpected opcode", async () => {
      const fake = createFakeConnection();
      const friends = new ec.Friends(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_STRINGS));

      await expectRejection(friends.addByEcid(7n), /EC_OP_NOOP/);
   });
});

describe("Friends.addByHash", () => {
   it("sends hash/ip/port/name as EC_TAG_FRIEND_ADD's children, IP packed low-byte-first", async () => {
      const fake = createFakeConnection();
      const friends = new ec.Friends(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await friends.addByHash(hexHash("a"), "192.0.2.1", 4662, "Alice");

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_FRIEND);
      const addTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_FRIEND_ADD);
      const hashTag = addTag?.findChild(ec.ECTagNames.EC_TAG_FRIEND_HASH);
      expect(Buffer.from((hashTag as ec.ECHash16Tag).value).toString("hex")).to.equal(hexHash("a"));
      const ipTag = addTag?.findChild(ec.ECTagNames.EC_TAG_FRIEND_IP);
      expect(ipTag?.intValue).to.equal(0x010200c0n);
      const portTag = addTag?.findChild(ec.ECTagNames.EC_TAG_FRIEND_PORT);
      expect(portTag).to.be.instanceOf(ec.ECUInt32Tag);
      expect(portTag?.intValue).to.equal(4662n);
      const nameTag = addTag?.findChild(ec.ECTagNames.EC_TAG_FRIEND_NAME);
      expect((nameTag as ec.ECStringTag).value).to.equal("Alice");
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const friends = new ec.Friends(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(friends.addByHash(hexHash("a"), "192.0.2.1", 4662, "Alice"), /EC_OP_NOOP/);
   });
});

describe("Friends.remove", () => {
   it("sends a bare EC_TAG_FRIEND_REMOVE with an EC_TAG_FRIEND child and succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const friends = new ec.Friends(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await friends.remove(7n);

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_FRIEND);
      const removeTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_FRIEND_REMOVE);
      expect(removeTag).to.be.instanceOf(ec.ECCustomTag);
      expect(removeTag?.findChild(ec.ECTagNames.EC_TAG_FRIEND)?.intValue).to.equal(7n);
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const friends = new ec.Friends(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(friends.remove(7n), /EC_OP_NOOP/);
   });
});

describe("Friends.setFriendSlot", () => {
   it("sends the flag as EC_TAG_FRIEND_FRIENDSLOT's own data with an EC_TAG_FRIEND child", async () => {
      const fake = createFakeConnection();
      const friends = new ec.Friends(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await friends.setFriendSlot(7n, true);

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_FRIEND);
      const slotTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_FRIEND_FRIENDSLOT);
      expect(slotTag?.intValue).to.equal(1n);
      expect(slotTag?.findChild(ec.ECTagNames.EC_TAG_FRIEND)?.intValue).to.equal(7n);
   });

   it("sends 0 when disabling", async () => {
      const fake = createFakeConnection();
      const friends = new ec.Friends(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await friends.setFriendSlot(7n, false);

      const slotTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_FRIEND_FRIENDSLOT);
      expect(slotTag?.intValue).to.equal(0n);
   });

   it("throws the daemon's reason on EC_OP_FAILED (e.g. the ECID isn't a known friend)", async () => {
      const fake = createFakeConnection();
      const friends = new ec.Friends(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "OOPS! OpCode processing error!"));
      fake.queueReply(failure);

      await expectRejection(friends.setFriendSlot(7n, true), /OOPS/);
   });

   it("throws a generic error on any other unexpected opcode", async () => {
      const fake = createFakeConnection();
      const friends = new ec.Friends(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_STRINGS));

      await expectRejection(friends.setFriendSlot(7n, true), /EC_OP_NOOP/);
   });
});

describe("Friends.browseSharedFiles", () => {
   it("throws when the daemon never confirmed EC_TAG_CAN_MULTI_SEARCH, without sending anything", async () => {
      const fake = createFakeConnection();
      const friends = new ec.Friends(fake.connection);

      await expectRejection(friends.browseSharedFiles(7n), /EC_TAG_CAN_MULTI_SEARCH/);
      expect(fake.sent).to.have.lengthOf(0);
   });

   it("sends a bare EC_TAG_FRIEND_SHARED with an EC_TAG_CLIENT child and returns a SearchSession on EC_OP_STRINGS", async () => {
      const fake = createFakeConnection();
      fake.connection.remoteCapabilities.multiSearch = true;
      const friends = new ec.Friends(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_STRINGS);
      reply.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_SEARCH_ID, 42));
      fake.queueReply(reply);

      const session = await friends.browseSharedFiles(7n);

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_FRIEND);
      const sharedTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_FRIEND_SHARED);
      expect(sharedTag).to.be.instanceOf(ec.ECCustomTag);
      expect(sharedTag?.findChild(ec.ECTagNames.EC_TAG_CLIENT)?.intValue).to.equal(7n);
      expect(session).to.be.instanceOf(ec.SearchSession);
      expect(session.id).to.equal(42n);
   });

   it("throws the daemon's reason on EC_OP_FAILED (e.g. the client disconnected first)", async () => {
      const fake = createFakeConnection();
      fake.connection.remoteCapabilities.multiSearch = true;
      const friends = new ec.Friends(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "Client not found."));
      fake.queueReply(failure);

      await expectRejection(friends.browseSharedFiles(7n), /Client not found/);
   });

   it("throws when the daemon replies with an unexpected opcode", async () => {
      const fake = createFakeConnection();
      fake.connection.remoteCapabilities.multiSearch = true;
      const friends = new ec.Friends(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await expectRejection(friends.browseSharedFiles(7n), /EC_OP_STRINGS/);
   });

   it("throws when EC_OP_STRINGS carries no EC_TAG_SEARCH_ID", async () => {
      const fake = createFakeConnection();
      fake.connection.remoteCapabilities.multiSearch = true;
      const friends = new ec.Friends(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_STRINGS));

      await expectRejection(friends.browseSharedFiles(7n), /EC_TAG_SEARCH_ID/);
   });
});
