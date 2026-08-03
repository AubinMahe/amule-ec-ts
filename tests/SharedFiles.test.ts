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

/** Builds a synthetic EC_TAG_KNOWNFILE tag, as SharedFile.fromTag() reads it. */
function sharedFileTag(fields: {
   ecid: number;
   hash: string;
   name: string;
   comments?: ec.ECTag;
   kadCommentSearching?: boolean;
}): ec.ECTag {
   const children: ec.ECTag[] = [
      new ec.ECHash16Tag(
         ec.ECTagNames.EC_TAG_PARTFILE_HASH,
         new Uint8Array(Buffer.from(fields.hash, "hex")),
      ),
      new ec.ECStringTag(ec.ECTagNames.EC_TAG_PARTFILE_NAME, fields.name),
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
   return new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_KNOWNFILE, fields.ecid, children);
}

/** A removal push notification's shape: own data IS the hash, tag name is EC_TAG_PARTFILE (see SharedFile's class doc). */
function sharedFileRemovalTag(hash: string): ec.ECTag {
   return new ec.ECHash16Tag(
      ec.ECTagNames.EC_TAG_PARTFILE,
      new Uint8Array(Buffer.from(hash, "hex")),
   );
}

describe("parseFileComments", () => {
   it("decodes each 4-tag entry (userName/fileName/rating/comment) by index", () => {
      const tag = sharedFileTag({
         ecid: 1,
         hash: hexHash("a"),
         name: "one.avi",
         comments: commentsTag([
            { userName: "Alice", fileName: "one.avi", rating: ec.FileRating.EXCELLENT, comment: "Great!" },
            { userName: "Bob", fileName: "one (copy).avi", rating: ec.FileRating.POOR, comment: "Meh." },
         ]),
      });

      const comments = ec.parseFileComments(tag);

      expect(comments).to.have.lengthOf(2);
      expect(comments?.[0]).to.deep.equal(
         new ec.FileComment("Alice", "one.avi", ec.FileRating.EXCELLENT, "Great!"),
      );
      expect(comments?.[1]).to.deep.equal(
         new ec.FileComment("Bob", "one (copy).avi", ec.FileRating.POOR, "Meh."),
      );
   });

   it("returns undefined when the file tag carries no EC_TAG_PARTFILE_COMMENTS container", () => {
      const tag = sharedFileTag({ ecid: 1, hash: hexHash("a"), name: "one.avi" });

      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(ec.parseFileComments(tag)).to.be.undefined;
   });

   it("returns an empty array for a present-but-empty container", () => {
      const tag = sharedFileTag({ ecid: 1, hash: hexHash("a"), name: "one.avi", comments: commentsTag([]) });

      expect(ec.parseFileComments(tag)).to.deep.equal([]);
   });
});

describe("parseKadCommentSearching", () => {
   it("decodes true/false when present", () => {
      const running = sharedFileTag({ ecid: 1, hash: hexHash("a"), name: "one.avi", kadCommentSearching: true });
      const idle = sharedFileTag({ ecid: 1, hash: hexHash("a"), name: "one.avi", kadCommentSearching: false });

      expect(ec.parseKadCommentSearching(running)).to.equal(true);
      expect(ec.parseKadCommentSearching(idle)).to.equal(false);
   });

   it("returns undefined when absent", () => {
      const tag = sharedFileTag({ ecid: 1, hash: hexHash("a"), name: "one.avi" });

      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(ec.parseKadCommentSearching(tag)).to.be.undefined;
   });
});

describe("SharedFiles.fetch", () => {
   it("requests EC_DETAIL_CMD and parses each EC_TAG_KNOWNFILE reply tag", async () => {
      const fake = createFakeConnection();
      const sharedFiles = new ec.SharedFiles(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      reply.add(sharedFileTag({ ecid: 1, hash: hexHash("a"), name: "one.avi" }));
      fake.queueReply(reply);

      await sharedFiles.fetch();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_SHARED_FILES);
      expect(sharedFiles.files).to.have.lengthOf(1);
      expect(sharedFiles.files[0]?.name).to.equal("one.avi");
   });

   it("throws when the daemon replies with an unexpected opcode", async () => {
      const fake = createFakeConnection();
      const sharedFiles = new ec.SharedFiles(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(sharedFiles.fetch(), /EC_OP_SHARED_FILES/);
   });

   it("decodes comments/kadCommentSearching onto each file", async () => {
      const fake = createFakeConnection();
      const sharedFiles = new ec.SharedFiles(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      reply.add(
         sharedFileTag({
            ecid: 1,
            hash: hexHash("a"),
            name: "one.avi",
            comments: commentsTag([
               { userName: "Alice", fileName: "one.avi", rating: ec.FileRating.GOOD, comment: "Nice" },
            ]),
            kadCommentSearching: true,
         }),
      );
      fake.queueReply(reply);

      await sharedFiles.fetch();

      expect(sharedFiles.files[0]?.kadCommentSearching).to.equal(true);
      expect(sharedFiles.files[0]?.comments).to.have.lengthOf(1);
      expect(sharedFiles.files[0]?.comments?.[0]?.userName).to.equal("Alice");
   });
});

describe("SharedFiles.reload", () => {
   it("sends EC_OP_SHAREDFILES_RELOAD with no tags and succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const sharedFiles = new ec.SharedFiles(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await sharedFiles.reload();

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_SHAREDFILES_RELOAD);
      expect(fake.sent[0]?.tags).to.have.lengthOf(0);
   });

   it("throws when the daemon replies with anything other than EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const sharedFiles = new ec.SharedFiles(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(sharedFiles.reload(), /EC_OP_NOOP/);
   });
});

describe("SharedFiles.setComment", () => {
   it("sends hash/comment/rating as EC_TAG_KNOWNFILE/_COMMENT/_RATING and succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const sharedFiles = new ec.SharedFiles(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await sharedFiles.setComment(hexHash("a"), "Great file", ec.FileRating.EXCELLENT);

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_SHARED_FILE_SET_COMMENT);
      const hashTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_KNOWNFILE);
      expect(Buffer.from((hashTag as ec.ECHash16Tag).value).toString("hex")).to.equal(hexHash("a"));
      const commentTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_KNOWNFILE_COMMENT);
      expect((commentTag as ec.ECStringTag).value).to.equal("Great file");
      const ratingTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_KNOWNFILE_RATING);
      expect(ratingTag?.intValue).to.equal(BigInt(ec.FileRating.EXCELLENT));
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const sharedFiles = new ec.SharedFiles(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(
         sharedFiles.setComment(hexHash("a"), "x", ec.FileRating.NOT_RATED),
         /EC_OP_NOOP/,
      );
   });
});

describe("SharedFiles.searchKadNotes", () => {
   it("sends the hash as a single EC_TAG_KNOWNFILE tag and succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const sharedFiles = new ec.SharedFiles(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await sharedFiles.searchKadNotes(hexHash("a"));

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_SHARED_FILE_SEARCH_KAD_NOTES);
      const hashTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_KNOWNFILE);
      expect(Buffer.from((hashTag as ec.ECHash16Tag).value).toString("hex")).to.equal(hexHash("a"));
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const sharedFiles = new ec.SharedFiles(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(sharedFiles.searchKadNotes(hexHash("a")), /EC_OP_NOOP/);
   });
});

describe("SharedFiles.parseNotification", () => {
   it("parses an EC_OP_SHARED_FILES packet carrying one EC_TAG_KNOWNFILE tag", () => {
      const packet = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      packet.add(sharedFileTag({ ecid: 1, hash: hexHash("a"), name: "one.avi" }));

      expect(ec.SharedFiles.parseNotification(packet)?.name).to.equal("one.avi");
   });

   it("also recognizes a removal notification's EC_TAG_PARTFILE shape", () => {
      const packet = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      packet.add(sharedFileRemovalTag(hexHash("a")));

      const file = ec.SharedFiles.parseNotification(packet);
      expect(file?.removed).to.equal(true);
      expect(file?.hash).to.equal(hexHash("a"));
   });

   it("returns undefined for any other opcode", () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(ec.SharedFiles.parseNotification(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP))).to.be.undefined;
   });
});

describe("SharedFileTracker", () => {
   it("apply() tracks a new file and removes it on a matching removal notification", () => {
      const tracker = new ec.SharedFileTracker();
      const add = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      add.add(sharedFileTag({ ecid: 1, hash: hexHash("a"), name: "one.avi" }));
      tracker.apply(add);
      expect(tracker.files).to.have.lengthOf(1);

      const remove = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      remove.add(sharedFileRemovalTag(hexHash("a")));
      tracker.apply(remove);

      expect(tracker.files).to.have.lengthOf(0);
   });

   it("seed() replaces the tracked set from a SharedFiles instance's files", async () => {
      const fake = createFakeConnection();
      const sharedFiles = new ec.SharedFiles(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      reply.add(sharedFileTag({ ecid: 1, hash: hexHash("a"), name: "one.avi" }));
      fake.queueReply(reply);
      await sharedFiles.fetch();

      const tracker = new ec.SharedFileTracker();
      tracker.seed(sharedFiles);

      expect(tracker.files).to.have.lengthOf(1);
      expect(tracker.files[0]?.name).to.equal("one.avi");
   });

   it("apply() keeps previously known comments/kadCommentSearching when a later push omits them", () => {
      const tracker = new ec.SharedFileTracker();
      const withComments = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      withComments.add(
         sharedFileTag({
            ecid: 1,
            hash: hexHash("a"),
            name: "one.avi",
            comments: commentsTag([
               { userName: "Alice", fileName: "one.avi", rating: ec.FileRating.GOOD, comment: "Nice" },
            ]),
            kadCommentSearching: true,
         }),
      );
      tracker.apply(withComments);

      const dirtyPush = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      dirtyPush.add(sharedFileTag({ ecid: 1, hash: hexHash("a"), name: "one.avi" }));
      tracker.apply(dirtyPush);

      expect(tracker.files[0]?.kadCommentSearching).to.equal(true);
      expect(tracker.files[0]?.comments).to.have.lengthOf(1);
   });
});
