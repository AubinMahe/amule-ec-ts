import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection, expectRejection } from "./testUtils.js";

/** Packs uint32 values as a big-endian byte blob, matching EC_TAG_STATSGRAPH_DATA/_DATA_CONN's own data. */
function packUInt32BE(values: readonly number[]): Uint8Array {
   const buffer = Buffer.alloc(values.length * 4);
   values.forEach((value, i) => {
      buffer.writeUInt32BE(value, i * 4);
   });
   return new Uint8Array(buffer);
}

describe("StatsGraphs.fetch", () => {
   it("sends no request tags by default and succeeds with an empty options object", async () => {
      const fake = createFakeConnection();
      const statsGraphs = new ec.StatsGraphs(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_STATSGRAPHS);
      fake.queueReply(reply);

      await statsGraphs.fetch();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_STATSGRAPHS);
      expect(fake.sent[0]?.tags).to.have.lengthOf(0);
      expect(statsGraphs.points).to.have.lengthOf(0);
   });

   it("sends LAST (double)/SCALE/WIDTH (uint16) only when given", async () => {
      const fake = createFakeConnection();
      const statsGraphs = new ec.StatsGraphs(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_STATSGRAPHS));

      await statsGraphs.fetch({ last: 1735689600.5, scale: 1, width: 32 });

      const lastTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_STATSGRAPH_LAST);
      expect(lastTag).to.be.instanceOf(ec.ECDoubleTag);
      expect((lastTag as ec.ECDoubleTag).value).to.equal(1735689600.5);
      expect(fake.sent[0]?.find(ec.ECTagNames.EC_TAG_STATSGRAPH_SCALE)?.intValue).to.equal(1n);
      expect(fake.sent[0]?.find(ec.ECTagNames.EC_TAG_STATSGRAPH_WIDTH)?.intValue).to.equal(32n);
   });

   it("decodes EC_TAG_STATSGRAPH_DATA into points, and EC_TAG_STATSGRAPH_DATA_CONN's matching fields", async () => {
      const fake = createFakeConnection();
      const statsGraphs = new ec.StatsGraphs(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_STATSGRAPHS);
      reply.add(new ec.ECCustomTag(ec.ECTagNames.EC_TAG_STATSGRAPH_DATA, packUInt32BE([1024, 2048, 5, 10, 4096, 8192, 7, 20])));
      reply.add(new ec.ECCustomTag(ec.ECTagNames.EC_TAG_STATSGRAPH_DATA_CONN, packUInt32BE([2, 3, 4, 6])));
      fake.queueReply(reply);

      await statsGraphs.fetch();

      expect(statsGraphs.points).to.have.lengthOf(2);
      expect(statsGraphs.points[0]).to.deep.equal(new ec.StatsGraphPoint(1024n, 2048n, 5n, 10n, 2n, 3n));
      expect(statsGraphs.points[1]).to.deep.equal(new ec.StatsGraphPoint(4096n, 8192n, 7n, 20n, 4n, 6n));
   });

   it("leaves uploadingClients/downloadingClients undefined when EC_TAG_STATSGRAPH_DATA_CONN is absent", async () => {
      const fake = createFakeConnection();
      const statsGraphs = new ec.StatsGraphs(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_STATSGRAPHS);
      reply.add(new ec.ECCustomTag(ec.ECTagNames.EC_TAG_STATSGRAPH_DATA, packUInt32BE([1024, 2048, 5, 10])));
      fake.queueReply(reply);

      await statsGraphs.fetch();

      expect(statsGraphs.points).to.have.lengthOf(1);
      /* eslint-disable @typescript-eslint/no-unused-expressions -- chai's getter-style assertion */
      expect(statsGraphs.points[0]?.uploadingClients).to.be.undefined;
      expect(statsGraphs.points[0]?.downloadingClients).to.be.undefined;
      /* eslint-enable @typescript-eslint/no-unused-expressions */
   });

   it("decodes session totals (uint64 + double), the echoed LAST timestamp, and DEPTH", async () => {
      const fake = createFakeConnection();
      const statsGraphs = new ec.StatsGraphs(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_STATSGRAPHS);
      reply.add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_STATSGRAPH_SESSION_DL, 123456789n));
      reply.add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_STATSGRAPH_SESSION_UL, 987654321n));
      reply.add(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_STATSGRAPH_SESSION_KAD, 42n));
      reply.add(new ec.ECDoubleTag(ec.ECTagNames.EC_TAG_STATSGRAPH_SESSION_TIMESPAN, 3600.25));
      reply.add(new ec.ECDoubleTag(ec.ECTagNames.EC_TAG_STATSGRAPH_LAST, 1735689600.5));
      reply.add(new ec.ECUInt16Tag(ec.ECTagNames.EC_TAG_STATSGRAPH_DEPTH, 288));
      fake.queueReply(reply);

      await statsGraphs.fetch();

      expect(statsGraphs.sessionDownloaded).to.equal(123456789n);
      expect(statsGraphs.sessionUploaded).to.equal(987654321n);
      expect(statsGraphs.sessionKadNodes).to.equal(42n);
      expect(statsGraphs.sessionTimespan).to.equal(3600.25);
      expect(statsGraphs.last).to.equal(1735689600.5);
      expect(statsGraphs.depth).to.equal(288n);
   });

   it("leaves depth undefined when EC_TAG_STATSGRAPH_DEPTH is absent (older daemon)", async () => {
      const fake = createFakeConnection();
      const statsGraphs = new ec.StatsGraphs(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_STATSGRAPHS));

      await statsGraphs.fetch();

      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(statsGraphs.depth).to.be.undefined;
   });

   it("resolves with an empty points array (no throw) on EC_OP_FAILED - 'no points for graph' is routine", async () => {
      const fake = createFakeConnection();
      const statsGraphs = new ec.StatsGraphs(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "No points for graph."));
      fake.queueReply(failure);

      await statsGraphs.fetch({ last: 1735689600 });

      expect(statsGraphs.points).to.have.lengthOf(0);
   });

   it("throws on any other unexpected opcode", async () => {
      const fake = createFakeConnection();
      const statsGraphs = new ec.StatsGraphs(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await expectRejection(statsGraphs.fetch(), /EC_OP_STATSGRAPHS/);
   });
});
