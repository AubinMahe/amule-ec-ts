import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection, expectRejection, hexHash } from "./testUtils.js";

/** Builds a synthetic EC_TAG_PARTFILE_COMMENTS container, as parseFileComments() reads it - children evaluated by index, 4 per entry. */
function commentsTag(
   entries: readonly { userName: string; fileName: string; rating: number; comment: string }[],
): ec.ECTag {
   const children: ec.ECTag[] = [];
   for (const entry of entries) {
      children.push(
         new ec.ECStringTag(ec.ECTagNames.EC_TAG_PARTFILE_COMMENTS, entry.userName),
         new ec.ECStringTag(ec.ECTagNames.EC_TAG_PARTFILE_COMMENTS, entry.fileName),
         new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PARTFILE_COMMENTS, BigInt(entry.rating)),
         new ec.ECStringTag(ec.ECTagNames.EC_TAG_PARTFILE_COMMENTS, entry.comment),
      );
   }
   return new ec.ECCustomTag(ec.ECTagNames.EC_TAG_PARTFILE_COMMENTS, new Uint8Array(), children);
}

function searchResultTag(fields: {
   ecid: number;
   hash: string;
   name: string;
   sources?: bigint;
   comments?: ec.ECTag;
   kadCommentSearching?: boolean;
}): ec.ECTag {
   const children: ec.ECTag[] = [
      new ec.ECHash16Tag(
         ec.ECTagNames.EC_TAG_PARTFILE_HASH,
         new Uint8Array(Buffer.from(fields.hash, "hex")),
      ),
      new ec.ECStringTag(ec.ECTagNames.EC_TAG_PARTFILE_NAME, fields.name),
      new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PARTFILE_SOURCE_COUNT, fields.sources ?? 0n),
   ];
   if (fields.comments) children.push(fields.comments);
   if (fields.kadCommentSearching !== undefined) {
      children.push(
         new ec.ECUInt64Tag(
            ec.ECTagNames.EC_TAG_PARTFILE_KAD_COMMENT_SEARCHING,
            fields.kadCommentSearching ? 1n : 0n,
         ),
      );
   }
   return new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_SEARCHFILE, fields.ecid, children);
}

describe("Search.start", () => {
   it("sends a composite EC_TAG_SEARCH_TYPE tag with the keywords/fileType as children, defaulting to GLOBAL", async () => {
      const fake = createFakeConnection();
      const search = new ec.Search(fake.connection);
      const success = new ec.ECPacket(ec.ECOpcode.EC_OP_STRINGS);
      success.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "Search in progress."));
      fake.queueReply(success);

      const session = await search.start({ keywords: "Astérix", fileType: "Video" });

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_SEARCH_START);
      const searchTag = fake.sent[0]?.tags[0];
      expect(searchTag?.intValue).to.equal(BigInt(ec.ECSearchType.GLOBAL));
      const nameChild = searchTag?.findChild(ec.ECTagNames.EC_TAG_SEARCH_NAME);
      const fileTypeChild = searchTag?.findChild(ec.ECTagNames.EC_TAG_SEARCH_FILE_TYPE);
      expect((nameChild as ec.ECStringTag).value).to.equal("Astérix");
      expect((fileTypeChild as ec.ECStringTag).value).to.equal("Video");
      expect(session).to.be.instanceOf(ec.SearchSession);
   });

   it("sends the requested EC_SEARCH_TYPE when provided (e.g. KAD)", async () => {
      const fake = createFakeConnection();
      const search = new ec.Search(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_STRINGS));

      await search.start({ keywords: "cars", type: ec.ECSearchType.KAD });

      const searchTag = fake.sent[0]?.tags[0];
      expect(searchTag?.intValue).to.equal(BigInt(ec.ECSearchType.KAD));
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

   it("returns a SearchSession with id=undefined when the reply carries no EC_TAG_SEARCH_ID (legacy/no multi-search)", async () => {
      const fake = createFakeConnection();
      const search = new ec.Search(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_STRINGS));

      const session = await search.start({ keywords: "cars" });

      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(session.id).to.be.undefined;
   });

   it("returns a SearchSession with the daemon-allocated id when the reply carries EC_TAG_SEARCH_ID (multi-search granted)", async () => {
      const fake = createFakeConnection();
      const search = new ec.Search(fake.connection);
      const success = new ec.ECPacket(ec.ECOpcode.EC_OP_STRINGS);
      success.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_SEARCH_ID, 42));
      fake.queueReply(success);

      const session = await search.start({ keywords: "cars" });

      expect(session.id).to.equal(42n);
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

describe("SearchSession.stop", () => {
   it("sends EC_OP_SEARCH_STOP with no tags when id is undefined and succeeds on EC_OP_MISC_DATA", async () => {
      const fake = createFakeConnection();
      const session = new ec.SearchSession(fake.connection, undefined);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_MISC_DATA));

      await session.stop();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_SEARCH_STOP);
      expect(fake.sent[0]?.tags).to.have.lengthOf(0);
   });

   it("sends EC_TAG_SEARCH_ID when this session has an id", async () => {
      const fake = createFakeConnection();
      const session = new ec.SearchSession(fake.connection, 7n);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_MISC_DATA));

      await session.stop();

      const idTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SEARCH_ID);
      expect(idTag?.intValue).to.equal(7n);
   });

   it("sends EC_TAG_SEARCH_CLOSE when close=true", async () => {
      const fake = createFakeConnection();
      const session = new ec.SearchSession(fake.connection, 7n);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_MISC_DATA));

      await session.stop(true);

      expect(fake.sent[0]?.has(ec.ECTagNames.EC_TAG_SEARCH_CLOSE)).to.equal(true);
   });

   it("omits EC_TAG_SEARCH_CLOSE by default", async () => {
      const fake = createFakeConnection();
      const session = new ec.SearchSession(fake.connection, 7n);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_MISC_DATA));

      await session.stop();

      expect(fake.sent[0]?.has(ec.ECTagNames.EC_TAG_SEARCH_CLOSE)).to.equal(false);
   });

   it("throws when the daemon replies with anything other than EC_OP_MISC_DATA", async () => {
      const fake = createFakeConnection();
      const session = new ec.SearchSession(fake.connection, undefined);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(session.stop(), /EC_OP_MISC_DATA/);
   });
});

describe("SearchSession.progress", () => {
   it("reads lifecycle state/kind/percent/result count from the reply", async () => {
      const fake = createFakeConnection();
      const session = new ec.SearchSession(fake.connection, undefined);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SEARCH_PROGRESS);
      reply.add(new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_SEARCH_LIFECYCLE_STATE, ec.ECSearchLifecycleState.RUNNING));
      reply.add(new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_SEARCH_LIFECYCLE_KIND, ec.ECSearchType.KAD));
      reply.add(new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_SEARCH_LIFECYCLE_PERCENT, 42));
      reply.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_SEARCH_RESULT_COUNT, 3));
      fake.queueReply(reply);

      const progress = await session.progress();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_SEARCH_PROGRESS);
      expect(progress).to.deep.equal({
         state: ec.ECSearchLifecycleState.RUNNING,
         kind: ec.ECSearchType.KAD,
         percent: 42,
         resultCount: 3,
      });
   });

   it("sends EC_TAG_SEARCH_ID when this session has an id", async () => {
      const fake = createFakeConnection();
      const session = new ec.SearchSession(fake.connection, 7n);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_SEARCH_PROGRESS));

      await session.progress();

      const idTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SEARCH_ID);
      expect(idTag?.intValue).to.equal(7n);
   });

   it("defaults every field to 0 when the reply carries none of them", async () => {
      const fake = createFakeConnection();
      const session = new ec.SearchSession(fake.connection, undefined);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_SEARCH_PROGRESS));

      const progress = await session.progress();

      expect(progress).to.deep.equal({ state: 0, kind: 0, percent: 0, resultCount: 0 });
   });

   it("throws when the reply carries EC_TAG_SEARCH_EXPIRED", async () => {
      const fake = createFakeConnection();
      const session = new ec.SearchSession(fake.connection, 7n);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SEARCH_PROGRESS);
      reply.add(new ec.ECCustomTag(ec.ECTagNames.EC_TAG_SEARCH_EXPIRED, new Uint8Array()));
      fake.queueReply(reply);

      await expectRejection(session.progress(), /expired/);
   });

   it("throws when the daemon replies with an unexpected opcode", async () => {
      const fake = createFakeConnection();
      const session = new ec.SearchSession(fake.connection, undefined);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(session.progress(), /EC_OP_SEARCH_PROGRESS/);
   });
});

describe("SearchSession.fetch", () => {
   it("requests with no detail-level tag (defaults to FULL) and parses each EC_TAG_SEARCHFILE reply tag", async () => {
      const fake = createFakeConnection();
      const session = new ec.SearchSession(fake.connection, undefined);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SEARCH_RESULTS);
      reply.add(searchResultTag({ ecid: 1, hash: hexHash("a"), name: "Cars.avi", sources: 5n }));
      fake.queueReply(reply);

      await session.fetch();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_SEARCH_RESULTS);
      expect(fake.sent[0]?.tags).to.have.lengthOf(0);
      expect(session.results).to.have.lengthOf(1);
      expect(session.results[0]?.name).to.equal("Cars.avi");
      expect(session.results[0]?.sources).to.equal(5n);
   });

   it("sends EC_TAG_SEARCH_ID when this session has an id", async () => {
      const fake = createFakeConnection();
      const session = new ec.SearchSession(fake.connection, 7n);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_SEARCH_RESULTS));

      await session.fetch();

      const idTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_SEARCH_ID);
      expect(idTag?.intValue).to.equal(7n);
   });

   it("decodes comments/kadCommentSearching when present, defaulting to []/false when absent", async () => {
      const fake = createFakeConnection();
      const session = new ec.SearchSession(fake.connection, undefined);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SEARCH_RESULTS);
      reply.add(
         searchResultTag({
            ecid: 1,
            hash: hexHash("a"),
            name: "Cars.avi",
            comments: commentsTag([
               { userName: "Alice", fileName: "Cars.avi", rating: ec.FileRating.EXCELLENT, comment: "Great" },
            ]),
            kadCommentSearching: true,
         }),
      );
      reply.add(searchResultTag({ ecid: 2, hash: hexHash("b"), name: "Trucks.avi" }));
      fake.queueReply(reply);

      await session.fetch();

      expect(session.results[0]?.kadCommentSearching).to.equal(true);
      expect(session.results[0]?.comments).to.deep.equal([
         new ec.FileComment("Alice", "Cars.avi", ec.FileRating.EXCELLENT, "Great"),
      ]);
      expect(session.results[1]?.kadCommentSearching).to.equal(false);
      expect(session.results[1]?.comments).to.deep.equal([]);
   });

   it("throws when the reply carries EC_TAG_SEARCH_EXPIRED", async () => {
      const fake = createFakeConnection();
      const session = new ec.SearchSession(fake.connection, 7n);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SEARCH_RESULTS);
      reply.add(new ec.ECCustomTag(ec.ECTagNames.EC_TAG_SEARCH_EXPIRED, new Uint8Array()));
      fake.queueReply(reply);

      await expectRejection(session.fetch(), /expired/);
   });

   it("throws when the daemon replies with an unexpected opcode", async () => {
      const fake = createFakeConnection();
      const session = new ec.SearchSession(fake.connection, undefined);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(session.fetch(), /EC_OP_SEARCH_RESULTS/);
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
