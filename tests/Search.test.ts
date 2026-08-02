import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection, expectRejection, hexHash } from "./testUtils.js";

function searchResultTag(fields: { ecid: number; hash: string; name: string; sources?: bigint }): ec.ECTag {
   return new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_SEARCHFILE, fields.ecid, [
      new ec.ECHash16Tag(
         ec.ECTagNames.EC_TAG_PARTFILE_HASH,
         new Uint8Array(Buffer.from(fields.hash, "hex")),
      ),
      new ec.ECStringTag(ec.ECTagNames.EC_TAG_PARTFILE_NAME, fields.name),
      new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PARTFILE_SOURCE_COUNT, fields.sources ?? 0n),
   ]);
}

describe("Search.start", () => {
   it("sends a composite EC_TAG_SEARCH_TYPE tag with the keywords/fileType as children", async () => {
      const fake = createFakeConnection();
      const search = new ec.Search(fake.connection);
      const success = new ec.ECPacket(ec.ECOpcode.EC_OP_STRINGS);
      success.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "Search in progress."));
      fake.queueReply(success);

      await search.start({ keywords: "Astérix", fileType: "Video" });

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_SEARCH_START);
      const searchTag = fake.sent[0]?.tags[0];
      expect(searchTag?.intValue).to.equal(BigInt(ec.ECSearchType.GLOBAL));
      const nameChild = searchTag?.findChild(ec.ECTagNames.EC_TAG_SEARCH_NAME);
      const fileTypeChild = searchTag?.findChild(ec.ECTagNames.EC_TAG_SEARCH_FILE_TYPE);
      expect((nameChild as ec.ECStringTag).value).to.equal("Astérix");
      expect((fileTypeChild as ec.ECStringTag).value).to.equal("Video");
   });

   it("omits SEARCH_FILE_TYPE's sibling optional fields when not provided", async () => {
      const fake = createFakeConnection();
      const search = new ec.Search(fake.connection);
      const success = new ec.ECPacket(ec.ECOpcode.EC_OP_STRINGS);
      fake.queueReply(success);

      await search.start({ keywords: "cars" });

      const searchTag = fake.sent[0]?.tags[0];
      expect(searchTag?.children).to.have.lengthOf(2);
   });

   it("throws the daemon's reason on EC_OP_FAILED (e.g. a web search)", async () => {
      const fake = createFakeConnection();
      const search = new ec.Search(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "WebSearch from remote interface makes no sense."));
      fake.queueReply(failure);

      await expectRejection(search.start({ keywords: "x" }), /WebSearch/);
   });

   it("throws on any other unexpected opcode", async () => {
      const fake = createFakeConnection();
      const search = new ec.Search(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await expectRejection(search.start({ keywords: "x" }), /EC_OP_STRINGS/);
   });
});

describe("Search.stop", () => {
   it("sends EC_OP_SEARCH_STOP with no tags and succeeds on EC_OP_MISC_DATA", async () => {
      const fake = createFakeConnection();
      const search = new ec.Search(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_MISC_DATA));

      await search.stop();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_SEARCH_STOP);
      expect(fake.sent[0]?.tags).to.have.lengthOf(0);
   });

   it("throws when the daemon replies with anything other than EC_OP_MISC_DATA", async () => {
      const fake = createFakeConnection();
      const search = new ec.Search(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(search.stop(), /EC_OP_MISC_DATA/);
   });
});

describe("Search.progress", () => {
   it("reads lifecycle state/percent/result count from the reply", async () => {
      const fake = createFakeConnection();
      const search = new ec.Search(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SEARCH_PROGRESS);
      reply.add(new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_SEARCH_LIFECYCLE_STATE, ec.ECSearchLifecycleState.RUNNING));
      reply.add(new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_SEARCH_LIFECYCLE_PERCENT, 42));
      reply.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_SEARCH_RESULT_COUNT, 3));
      fake.queueReply(reply);

      const progress = await search.progress();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_SEARCH_PROGRESS);
      expect(progress).to.deep.equal({
         state: ec.ECSearchLifecycleState.RUNNING,
         percent: 42,
         resultCount: 3,
      });
   });

   it("defaults every field to 0 when the reply carries none of them", async () => {
      const fake = createFakeConnection();
      const search = new ec.Search(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_SEARCH_PROGRESS));

      const progress = await search.progress();

      expect(progress).to.deep.equal({ state: 0, percent: 0, resultCount: 0 });
   });

   it("throws when the daemon replies with an unexpected opcode", async () => {
      const fake = createFakeConnection();
      const search = new ec.Search(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(search.progress(), /EC_OP_SEARCH_PROGRESS/);
   });
});

describe("Search.fetch", () => {
   it("requests with no detail-level tag (defaults to FULL) and parses each EC_TAG_SEARCHFILE reply tag", async () => {
      const fake = createFakeConnection();
      const search = new ec.Search(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SEARCH_RESULTS);
      reply.add(searchResultTag({ ecid: 1, hash: hexHash("a"), name: "Cars.avi", sources: 5n }));
      fake.queueReply(reply);

      await search.fetch();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_SEARCH_RESULTS);
      expect(fake.sent[0]?.tags).to.have.lengthOf(0);
      expect(search.results).to.have.lengthOf(1);
      expect(search.results[0]?.name).to.equal("Cars.avi");
      expect(search.results[0]?.sources).to.equal(5n);
   });

   it("throws when the daemon replies with an unexpected opcode", async () => {
      const fake = createFakeConnection();
      const search = new ec.Search(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(search.fetch(), /EC_OP_SEARCH_RESULTS/);
   });
});

describe("Search.download", () => {
   it("sends one EC_TAG_PARTFILE hash tag per result, each with an EC_TAG_PARTFILE_CAT=0 child", async () => {
      const fake = createFakeConnection();
      const search = new ec.Search(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_STRINGS));

      await search.download([hexHash("a"), hexHash("b")]);

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_DOWNLOAD_SEARCH_RESULT);
      expect(fake.sent[0]?.tags).to.have.lengthOf(2);
      const [first, second] = fake.sent[0]?.tags ?? [];
      expect(Buffer.from((first as ec.ECHash16Tag).value).toString("hex")).to.equal(hexHash("a"));
      expect(Buffer.from((second as ec.ECHash16Tag).value).toString("hex")).to.equal(hexHash("b"));
      const catTag = first?.findChild(ec.ECTagNames.EC_TAG_PARTFILE_CAT);
      expect(catTag?.intValue).to.equal(0n);
   });

   it("throws when the daemon replies with an unexpected opcode", async () => {
      const fake = createFakeConnection();
      const search = new ec.Search(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(search.download([hexHash("a")]), /EC_OP_STRINGS/);
   });
});
