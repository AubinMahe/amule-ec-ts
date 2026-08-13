import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection, expectRejection } from "./testUtils.js";

describe("StatsTree.fetch", () => {
   it("sends EC_TAG_STATTREE_CAPPING (default 0) and parses the root node", async () => {
      const fake = createFakeConnection();
      const statsTree = new ec.StatsTree(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_STATSTREE);
      reply.add(
         new ec.ECStringTag(ec.ECTagNames.EC_TAG_STATTREE_NODE, "Statistics", [
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_STATTREE_NODEID, 1),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_STAT_NODE_KEY, "statistics"),
         ]),
      );
      fake.queueReply(reply);

      await statsTree.fetch();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_STATSTREE);
      const cappingTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_STATTREE_CAPPING);
      expect(cappingTag?.intValue).to.equal(0n);
      expect(statsTree.root?.label).to.equal("Statistics");
      expect(statsTree.root?.nodeId).to.equal(1n);
      expect(statsTree.root?.key).to.equal("statistics");
   });

   it("sends a custom EC_TAG_STATTREE_CAPPING when given", async () => {
      const fake = createFakeConnection();
      const statsTree = new ec.StatsTree(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_STATSTREE));

      await statsTree.fetch(25);

      const cappingTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_STATTREE_CAPPING);
      expect(cappingTag?.intValue).to.equal(25n);
   });

   it("leaves root undefined when the reply carries no EC_TAG_STATTREE_NODE", async () => {
      const fake = createFakeConnection();
      const statsTree = new ec.StatsTree(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_STATSTREE));

      await statsTree.fetch();

      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(statsTree.root).to.be.undefined;
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const statsTree = new ec.StatsTree(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(statsTree.fetch(), /EC_OP_STATSTREE/);
   });

   it("parses nested child nodes recursively", async () => {
      const fake = createFakeConnection();
      const statsTree = new ec.StatsTree(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_STATSTREE);
      reply.add(
         new ec.ECStringTag(ec.ECTagNames.EC_TAG_STATTREE_NODE, "Statistics", [
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_STATTREE_NODEID, 1),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_STATTREE_NODE, "Transfer", [
               new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_STATTREE_NODEID, 2),
               new ec.ECStringTag(ec.ECTagNames.EC_TAG_STAT_NODE_KEY, "transfer"),
            ]),
         ]),
      );
      fake.queueReply(reply);

      await statsTree.fetch();

      expect(statsTree.root?.children).to.have.lengthOf(1);
      expect(statsTree.root?.children[0]?.label).to.equal("Transfer");
      expect(statsTree.root?.children[0]?.key).to.equal("transfer");
   });

   it("findByKey searches this node and its descendants depth-first", async () => {
      const fake = createFakeConnection();
      const statsTree = new ec.StatsTree(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_STATSTREE);
      reply.add(
         new ec.ECStringTag(ec.ECTagNames.EC_TAG_STATTREE_NODE, "Statistics", [
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_STAT_NODE_KEY, "statistics"),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_STATTREE_NODE, "Uploads", [
               new ec.ECStringTag(ec.ECTagNames.EC_TAG_STAT_NODE_KEY, "uploads"),
            ]),
         ]),
      );
      fake.queueReply(reply);
      await statsTree.fetch();

      expect(statsTree.root?.findByKey("uploads")?.label).to.equal("Uploads");
      expect(statsTree.root?.findByKey("statistics")?.label).to.equal("Statistics");
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(statsTree.root?.findByKey("nope")).to.be.undefined;
   });

   it("parses a plain integer value with no EC_TAG_STAT_VALUE_TYPE as type=undefined", async () => {
      const fake = createFakeConnection();
      const statsTree = new ec.StatsTree(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_STATSTREE);
      reply.add(
         new ec.ECStringTag(ec.ECTagNames.EC_TAG_STATTREE_NODE, "Total connections", [
            new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_STAT_NODE_VALUE, 42),
         ]),
      );
      fake.queueReply(reply);

      await statsTree.fetch();

      expect(statsTree.root?.values).to.have.lengthOf(1);
      expect(statsTree.root?.values[0]).to.deep.include({
         type: undefined,
         intValue: 42n,
      });
   });

   it("decodes a typed BYTES value alongside its EC_TAG_STAT_VALUE_TYPE sibling", async () => {
      const fake = createFakeConnection();
      const statsTree = new ec.StatsTree(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_STATSTREE);
      reply.add(
         new ec.ECStringTag(ec.ECTagNames.EC_TAG_STATTREE_NODE, "Sent", [
            new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_STAT_NODE_VALUE, 123456n, [
               new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_STAT_VALUE_TYPE, ec.ECStatValueType.BYTES),
            ]),
         ]),
      );
      fake.queueReply(reply);

      await statsTree.fetch();

      expect(statsTree.root?.values[0]).to.deep.include({
         type: ec.ECStatValueType.BYTES,
         intValue: 123456n,
      });
   });

   it("decodes a nested companion value (session/all-time pair)", async () => {
      const fake = createFakeConnection();
      const statsTree = new ec.StatsTree(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_STATSTREE);
      reply.add(
         new ec.ECStringTag(ec.ECTagNames.EC_TAG_STATTREE_NODE, "Uploaded", [
            new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_STAT_NODE_VALUE, 100n, [
               new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_STAT_VALUE_TYPE, ec.ECStatValueType.BYTES),
               new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_STAT_NODE_VALUE, 5000n, [
                  new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_STAT_VALUE_TYPE, ec.ECStatValueType.BYTES),
               ]),
            ]),
         ]),
      );
      fake.queueReply(reply);

      await statsTree.fetch();

      const value = statsTree.root?.values[0];
      expect(value?.intValue).to.equal(100n);
      expect(value?.companion?.intValue).to.equal(5000n);
   });

   it("decodes a locale-independent enumToken sentinel and a ratio/ratioTotal pair", async () => {
      const fake = createFakeConnection();
      const statsTree = new ec.StatsTree(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_STATSTREE);
      reply.add(
         new ec.ECStringTag(ec.ECTagNames.EC_TAG_STATTREE_NODE, "Ratio", [
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_STAT_NODE_VALUE, "Not available", [
               new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_STAT_VALUE_TYPE, ec.ECStatValueType.STRING),
               new ec.ECStringTag(ec.ECTagNames.EC_TAG_STAT_VALUE_ENUM, "not_available"),
            ]),
            new ec.ECDoubleTag(ec.ECTagNames.EC_TAG_STAT_NODE_RATIO, 1.5),
            new ec.ECDoubleTag(ec.ECTagNames.EC_TAG_STAT_NODE_RATIO_TOTAL, 2.5),
         ]),
      );
      fake.queueReply(reply);

      await statsTree.fetch();

      expect(statsTree.root?.values[0]).to.deep.include({
         stringValue: "Not available",
         enumToken: "not_available",
      });
      expect(statsTree.root?.ratio).to.equal(1.5);
      expect(statsTree.root?.ratioTotal).to.equal(2.5);
   });

   it("parses two sibling values (CStatTreeItemTotalClients' shape)", async () => {
      const fake = createFakeConnection();
      const statsTree = new ec.StatsTree(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_STATSTREE);
      reply.add(
         new ec.ECStringTag(ec.ECTagNames.EC_TAG_STATTREE_NODE, "Total clients", [
            new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_STAT_NODE_VALUE, 10n),
            new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_STAT_NODE_VALUE, 7n),
         ]),
      );
      fake.queueReply(reply);

      await statsTree.fetch();

      expect(statsTree.root?.values).to.have.lengthOf(2);
      expect(statsTree.root?.values.map((v) => v.intValue)).to.deep.equal([10n, 7n]);
   });
});
