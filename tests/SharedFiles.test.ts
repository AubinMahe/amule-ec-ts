import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection, expectRejection, hexHash } from "./testUtils.js";

/** Builds a synthetic EC_TAG_KNOWNFILE tag, as SharedFile.fromTag() reads it. */
function sharedFileTag(fields: { ecid: number; hash: string; name: string }): ec.ECTag {
   return new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_KNOWNFILE, fields.ecid, [
      new ec.ECHash16Tag(
         ec.ECTagNames.EC_TAG_PARTFILE_HASH,
         new Uint8Array(Buffer.from(fields.hash, "hex")),
      ),
      new ec.ECStringTag(ec.ECTagNames.EC_TAG_PARTFILE_NAME, fields.name),
   ]);
}

/** A removal push notification's shape: own data IS the hash, tag name is EC_TAG_PARTFILE (see SharedFile's class doc). */
function sharedFileRemovalTag(hash: string): ec.ECTag {
   return new ec.ECHash16Tag(
      ec.ECTagNames.EC_TAG_PARTFILE,
      new Uint8Array(Buffer.from(hash, "hex")),
   );
}

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
});
