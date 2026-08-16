import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection, expectRejection } from "./testUtils.js";

describe("Update.fetch", () => {
   it("throws when the daemon never confirmed EC_TAG_CAN_PARTIAL_UPDATE, without sending anything", async () => {
      const fake = createFakeConnection();
      const update = new ec.Update(fake.connection);

      await expectRejection(update.fetch(), /EC_TAG_CAN_PARTIAL_UPDATE/);
      expect(fake.sent).to.have.lengthOf(0);
   });

   it("sends EC_OP_GET_UPDATE with EC_TAG_DETAIL_LEVEL=EC_DETAIL_INC_UPDATE", async () => {
      const fake = createFakeConnection();
      fake.connection.remoteCapabilities.partialUpdate = true;
      const update = new ec.Update(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES));

      await update.fetch();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_UPDATE);
      const detailTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_DETAIL_LEVEL);
      expect(detailTag?.intValue).to.equal(BigInt(ec.ECDetailLevel.EC_DETAIL_INC_UPDATE));
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      fake.connection.remoteCapabilities.partialUpdate = true;
      const update = new ec.Update(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(update.fetch(), /EC_OP_SHARED_FILES/);
   });

   it("parses top-level EC_TAG_KNOWNFILE/EC_TAG_PARTFILE into sharedFiles/downloads", async () => {
      const fake = createFakeConnection();
      fake.connection.remoteCapabilities.partialUpdate = true;
      const update = new ec.Update(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      reply.add(
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_KNOWNFILE, 1, [
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_PARTFILE_NAME, "shared.iso"),
         ]),
      );
      reply.add(
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 2, [
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_PARTFILE_NAME, "download.iso"),
         ]),
      );
      fake.queueReply(reply);

      await update.fetch();

      expect(update.sharedFiles).to.have.lengthOf(1);
      expect(update.sharedFiles[0]?.name).to.equal("shared.iso");
      expect(update.downloads).to.have.lengthOf(1);
      expect(update.downloads[0]?.name).to.equal("download.iso");
   });

   it("EC_TAG_FILE_REMOVED drops the ECID from both sharedFiles and downloads", async () => {
      const fake = createFakeConnection();
      fake.connection.remoteCapabilities.partialUpdate = true;
      const update = new ec.Update(fake.connection);
      const firstReply = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      firstReply.add(
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_KNOWNFILE, 1, [
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_PARTFILE_NAME, "shared.iso"),
         ]),
      );
      fake.queueReply(firstReply);
      await update.fetch();
      expect(update.sharedFiles).to.have.lengthOf(1);

      const secondReply = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      secondReply.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_FILE_REMOVED, 1));
      fake.queueReply(secondReply);
      await update.fetch();

      expect(update.sharedFiles).to.have.lengthOf(0);
   });

   it("parses the EC_TAG_CLIENT container's children into clients, decoding the anti-host-order user IP", async () => {
      const fake = createFakeConnection();
      fake.connection.remoteCapabilities.partialUpdate = true;
      const update = new ec.Update(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      reply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_CLIENT, new Uint8Array(), [
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CLIENT, 42, [
               new ec.ECStringTag(ec.ECTagNames.EC_TAG_CLIENT_NAME, "peer1"),
               // packIPv4ToUint32 uses the same "anti-host order" (LSB = first
               // octet) as this field's wire encoding - see ipFromUint32's doc.
               new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CLIENT_USER_IP, ec.packIPv4ToUint32("192.0.2.1")),
               new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_CLIENT_EXT_PROTOCOL, 1),
            ]),
         ]),
      );
      fake.queueReply(reply);

      await update.fetch();

      expect(update.clients).to.have.lengthOf(1);
      expect(update.clients[0]).to.deep.include({
         ecid: 42n,
         name: "peer1",
         userIp: "192.0.2.1",
         extProtocol: true,
      });
   });

   it("parses the EC_TAG_SERVER container's children into servers, keyed by ECID", async () => {
      const fake = createFakeConnection();
      fake.connection.remoteCapabilities.partialUpdate = true;
      const update = new ec.Update(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      reply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_SERVER, new Uint8Array(), [
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_SERVER, 7, [
               new ec.ECStringTag(ec.ECTagNames.EC_TAG_SERVER_NAME, "eMule Security"),
               new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_SERVER_IP, ec.packIPv4ToUint32("192.0.2.1")),
               new ec.ECUInt16Tag(ec.ECTagNames.EC_TAG_SERVER_PORT, 4661),
            ]),
         ]),
      );
      fake.queueReply(reply);

      await update.fetch();

      expect(update.servers).to.have.lengthOf(1);
      expect(update.servers[0]).to.deep.include({
         ecid: 7n,
         name: "eMule Security",
         ip: "192.0.2.1",
         port: 4661n,
      });
   });

   it("parses the EC_TAG_FRIEND container's children into friends", async () => {
      const fake = createFakeConnection();
      fake.connection.remoteCapabilities.partialUpdate = true;
      const update = new ec.Update(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      reply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_FRIEND, new Uint8Array(), [
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_FRIEND, 5, [
               new ec.ECStringTag(ec.ECTagNames.EC_TAG_FRIEND_NAME, "Alice"),
               new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_FRIEND_CLIENT, 0),
            ]),
         ]),
      );
      fake.queueReply(reply);

      await update.fetch();

      expect(update.friends).to.have.lengthOf(1);
      expect(update.friends[0]).to.deep.include({
         ecid: 5n,
         name: "Alice",
         linkedClientEcid: 0n,
      });
   });

   it("merges a later partial poll onto the previous snapshot instead of discarding unmentioned fields", async () => {
      const fake = createFakeConnection();
      fake.connection.remoteCapabilities.partialUpdate = true;
      const update = new ec.Update(fake.connection);

      const firstReply = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      firstReply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_CLIENT, new Uint8Array(), [
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CLIENT, 42, [
               new ec.ECStringTag(ec.ECTagNames.EC_TAG_CLIENT_NAME, "peer1"),
               new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CLIENT_UP_SPEED, 100),
            ]),
         ]),
      );
      fake.queueReply(firstReply);
      await update.fetch();

      // Second poll only reports the changed field (upSpeed) - name is
      // unchanged since last cycle and so is omitted by the daemon.
      const secondReply = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      secondReply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_CLIENT, new Uint8Array(), [
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CLIENT, 42, [new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_CLIENT_UP_SPEED, 200)]),
         ]),
      );
      fake.queueReply(secondReply);
      await update.fetch();

      expect(update.clients).to.have.lengthOf(1);
      expect(update.clients[0]?.name).to.equal("peer1");
      expect(update.clients[0]?.uploadSpeed).to.equal(200n);
   });

   it("merges a later partial poll onto the previous server snapshot instead of discarding unmentioned fields", async () => {
      const fake = createFakeConnection();
      fake.connection.remoteCapabilities.partialUpdate = true;
      const update = new ec.Update(fake.connection);

      const firstReply = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      firstReply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_SERVER, new Uint8Array(), [
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_SERVER, 7, [
               new ec.ECStringTag(ec.ECTagNames.EC_TAG_SERVER_NAME, "eMule Security"),
               new ec.ECUInt16Tag(ec.ECTagNames.EC_TAG_SERVER_PORT, 4661),
            ]),
         ]),
      );
      fake.queueReply(firstReply);
      await update.fetch();

      // Second poll only reports the changed field (port) - name is
      // unchanged since last cycle and so is omitted by the daemon.
      const secondReply = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      secondReply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_SERVER, new Uint8Array(), [
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_SERVER, 7, [new ec.ECUInt16Tag(ec.ECTagNames.EC_TAG_SERVER_PORT, 4662)]),
         ]),
      );
      fake.queueReply(secondReply);
      await update.fetch();

      expect(update.servers).to.have.lengthOf(1);
      expect(update.servers[0]?.name).to.equal("eMule Security");
      expect(update.servers[0]?.port).to.equal(4662n);
   });

   it("merges a later partial poll onto the previous friend snapshot instead of discarding unmentioned fields", async () => {
      const fake = createFakeConnection();
      fake.connection.remoteCapabilities.partialUpdate = true;
      const update = new ec.Update(fake.connection);

      const firstReply = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      firstReply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_FRIEND, new Uint8Array(), [
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_FRIEND, 5, [
               new ec.ECStringTag(ec.ECTagNames.EC_TAG_FRIEND_NAME, "Alice"),
               new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_FRIEND_CLIENT, 0),
            ]),
         ]),
      );
      fake.queueReply(firstReply);
      await update.fetch();

      // Second poll only reports the changed field (linkedClientEcid, Alice
      // just came online) - name is unchanged since last cycle and so is
      // omitted by the daemon.
      const secondReply = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      secondReply.add(
         new ec.ECCustomTag(ec.ECTagNames.EC_TAG_FRIEND, new Uint8Array(), [
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_FRIEND, 5, [new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_FRIEND_CLIENT, 99)]),
         ]),
      );
      fake.queueReply(secondReply);
      await update.fetch();

      expect(update.friends).to.have.lengthOf(1);
      expect(update.friends[0]?.name).to.equal("Alice");
      expect(update.friends[0]?.linkedClientEcid).to.equal(99n);
   });
});
