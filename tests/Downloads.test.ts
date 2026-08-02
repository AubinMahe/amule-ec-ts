import { expect } from "chai";
import * as ec from "../src/index.js";
import { createFakeConnection, expectRejection, hexHash } from "./testUtils.js";

/**
 * Builds a synthetic EC_TAG_PARTFILE tag as fetch()/parseNotification() see
 * it: own data is the ECID, hash/name/sizes are children. Mirrors
 * ECSpecialCoreTags.cpp's CEC_PartFile_Tag at full detail (see Downloads.ts's
 * class doc) - not a removal shape (see downloadRemovalTag() below for that).
 */
function downloadEntryTag(fields: {
   ecid: number;
   hash: string;
   name: string;
   sizeFull?: bigint;
   sizeDone?: bigint;
}): ec.ECTag {
   return new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, fields.ecid, [
      new ec.ECHash16Tag(
         ec.ECTagNames.EC_TAG_PARTFILE_HASH,
         new Uint8Array(Buffer.from(fields.hash, "hex")),
      ),
      new ec.ECStringTag(ec.ECTagNames.EC_TAG_PARTFILE_NAME, fields.name),
      new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PARTFILE_SIZE_FULL, fields.sizeFull ?? 0n),
      new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PARTFILE_SIZE_DONE, fields.sizeDone ?? 0n),
   ]);
}

/** A removal push notification's shape (see Downloads.ts's DownloadFile doc): own data IS the hash, no children. */
function downloadRemovalTag(hash: string): ec.ECTag {
   return new ec.ECHash16Tag(
      ec.ECTagNames.EC_TAG_PARTFILE,
      new Uint8Array(Buffer.from(hash, "hex")),
   );
}

/** Builds a synthetic EC_TAG_PARTFILE tag - only the fields statusText/priorityText read. */
function partFileTag(fields: {
   status?: number;
   prio?: number;
   stopped?: boolean;
   sourcesXfer?: number;
}): ec.ECTag {
   const children: ec.ECTag[] = [];
   if (fields.status !== undefined) {
      children.push(new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_PARTFILE_STATUS, fields.status));
   }
   if (fields.prio !== undefined) {
      children.push(new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_PARTFILE_PRIO, fields.prio));
   }
   if (fields.stopped !== undefined) {
      children.push(
         new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_PARTFILE_STOPPED, fields.stopped ? 1 : 0),
      );
   }
   if (fields.sourcesXfer !== undefined) {
      children.push(
         new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_PARTFILE_SOURCE_COUNT_XFER, fields.sourcesXfer),
      );
   }
   return new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, children);
}

describe("DownloadFile.statusText", () => {
   it("reports 'Hashing' while hashing, regardless of stopped/sources", () => {
      const file = ec.DownloadFile.fromTag(
         partFileTag({ status: ec.ECPartFileStatus.PS_HASHING }),
      );
      expect(file.statusText).to.equal("Hashing");
   });

   it("reports 'Downloading' when a source is actively transferring", () => {
      const file = ec.DownloadFile.fromTag(
         partFileTag({ status: ec.ECPartFileStatus.PS_READY, sourcesXfer: 1 }),
      );
      expect(file.statusText).to.equal("Downloading");
   });

   it("reports 'Waiting' when connected but no source is transferring", () => {
      const file = ec.DownloadFile.fromTag(
         partFileTag({ status: ec.ECPartFileStatus.PS_READY, sourcesXfer: 0 }),
      );
      expect(file.statusText).to.equal("Waiting");
   });

   it("reports 'Stopped' when stopped and not yet complete", () => {
      const file = ec.DownloadFile.fromTag(
         partFileTag({ status: ec.ECPartFileStatus.PS_READY, stopped: true }),
      );
      expect(file.statusText).to.equal("Stopped");
   });

   it("does not let 'stopped' override an already-complete status", () => {
      const file = ec.DownloadFile.fromTag(
         partFileTag({ status: ec.ECPartFileStatus.PS_COMPLETE, stopped: true }),
      );
      expect(file.statusText).to.equal("Complete");
   });

   it("reports 'Unknown' when the status field is absent", () => {
      const file = ec.DownloadFile.fromTag(partFileTag({}));
      expect(file.statusText).to.equal("Unknown");
   });
});

describe("DownloadFile.priorityText", () => {
   it("reports a plain priority level", () => {
      const file = ec.DownloadFile.fromTag(
         partFileTag({ prio: ec.ECDownloadPriority.PR_HIGH }),
      );
      expect(file.priorityText).to.equal("High");
   });

   it("reports the auto-priority form (wire value +10) distinctly from the plain one", () => {
      const file = ec.DownloadFile.fromTag(
         partFileTag({ prio: ec.ECDownloadPriority.PR_HIGH + 10 }),
      );
      expect(file.priorityText).to.equal("Auto [Hi]");
   });

   it("reports 'Unknown' when the prio field is absent", () => {
      const file = ec.DownloadFile.fromTag(partFileTag({}));
      expect(file.priorityText).to.equal("Unknown");
   });
});

describe("Downloads.fetch", () => {
   it("requests EC_DETAIL_CMD and parses each EC_TAG_PARTFILE reply tag into a DownloadFile", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      reply.add(downloadEntryTag({ ecid: 1, hash: hexHash("a"), name: "one.avi" }));
      reply.add(downloadEntryTag({ ecid: 2, hash: hexHash("b"), name: "two.avi" }));
      fake.queueReply(reply);

      await downloads.fetch();

      expect(fake.sent).to.have.lengthOf(1);
      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_GET_DLOAD_QUEUE);
      expect(fake.sent[0]?.find(ec.ECTagNames.EC_TAG_DETAIL_LEVEL)?.intValue).to.equal(
         BigInt(ec.ECDetailLevel.EC_DETAIL_CMD),
      );
      expect(downloads.files).to.have.lengthOf(2);
      expect(downloads.files[0]?.name).to.equal("one.avi");
      expect(downloads.files[1]?.name).to.equal("two.avi");
   });

   it("throws when the daemon replies with an unexpected opcode", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(downloads.fetch(), /EC_OP_DLOAD_QUEUE/);
   });
});

describe("Downloads.cancel", () => {
   it("sends the hash as an EC_TAG_PARTFILE tag and succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await downloads.cancel(hexHash("a"));

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_PARTFILE_DELETE);
      const hashTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_PARTFILE);
      expect(hashTag).to.be.instanceOf(ec.ECHash16Tag);
      expect(Buffer.from((hashTag as ec.ECHash16Tag).value).toString("hex")).to.equal(hexHash("a"));
   });

   it("throws the daemon's reason on EC_OP_FAILED", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "FileHash not found: deadbeef"));
      fake.queueReply(failure);

      await expectRejection(downloads.cancel(hexHash("a")), /FileHash not found/);
   });

   it("throws a generic error on any other unexpected opcode", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_STRINGS));

      await expectRejection(downloads.cancel(hexHash("a")), /EC_OP_NOOP/);
   });
});

describe("Downloads.rename", () => {
   it("sends the hash as EC_TAG_KNOWNFILE and the new name as EC_TAG_PARTFILE_NAME", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await downloads.rename(hexHash("a"), "New Name.avi");

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_RENAME_FILE);
      const hashTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_KNOWNFILE);
      expect(Buffer.from((hashTag as ec.ECHash16Tag).value).toString("hex")).to.equal(hexHash("a"));
      const nameTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_PARTFILE_NAME);
      expect((nameTag as ec.ECStringTag).value).to.equal("New Name.avi");
   });

   it("throws the daemon's reason on EC_OP_FAILED", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "Invalid file name."));
      fake.queueReply(failure);

      await expectRejection(downloads.rename(hexHash("a"), "???"), /Invalid file name/);
   });
});

describe("Downloads.parseNotification", () => {
   it("parses an EC_OP_DLOAD_QUEUE packet carrying one EC_TAG_PARTFILE tag", () => {
      const packet = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      packet.add(downloadEntryTag({ ecid: 1, hash: hexHash("a"), name: "one.avi" }));

      const file = ec.Downloads.parseNotification(packet);

      expect(file?.name).to.equal("one.avi");
   });

   it("returns undefined for any other opcode", () => {
      const packet = new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(ec.Downloads.parseNotification(packet)).to.be.undefined;
   });
});

describe("DownloadTracker", () => {
   it("seed() populates the tracker from a Downloads instance's files, keyed by ecid", () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      const tracker = new ec.DownloadTracker();
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      reply.add(downloadEntryTag({ ecid: 1, hash: hexHash("a"), name: "one.avi" }));
      fake.queueReply(reply);

      return downloads.fetch().then(() => {
         tracker.seed(downloads);
         expect(tracker.files).to.have.lengthOf(1);
         expect(tracker.files[0]?.name).to.equal("one.avi");
      });
   });

   it("apply() merges a partial update into the previously-seeded file rather than replacing it", () => {
      const tracker = new ec.DownloadTracker();
      const initial = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      initial.add(downloadEntryTag({ ecid: 1, hash: hexHash("a"), name: "one.avi", sizeDone: 10n }));
      tracker.apply(initial);

      const update = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      update.add(
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [
            new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PARTFILE_SIZE_DONE, 20n),
         ]),
      );
      const merged = tracker.apply(update);

      expect(merged?.name).to.equal("one.avi");
      expect(merged?.sizeDone).to.equal(20n);
      expect(tracker.files).to.have.lengthOf(1);
   });

   it("apply() removes the tracked file that matches a removal notification's hash", () => {
      const tracker = new ec.DownloadTracker();
      const initial = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      initial.add(downloadEntryTag({ ecid: 1, hash: hexHash("a"), name: "one.avi" }));
      tracker.apply(initial);
      expect(tracker.files).to.have.lengthOf(1);

      const removal = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      removal.add(downloadRemovalTag(hexHash("a")));
      tracker.apply(removal);

      expect(tracker.files).to.have.lengthOf(0);
   });

   it("apply() returns undefined for a packet that isn't about the download queue", () => {
      const tracker = new ec.DownloadTracker();
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(tracker.apply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP))).to.be.undefined;
   });
});
