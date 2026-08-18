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
   path?: string;
}): ec.ECTag {
   const children: ec.ECTag[] = [
      new ec.ECHash16Tag(ec.ECTagNames.EC_TAG_PARTFILE_HASH, new Uint8Array(Buffer.from(fields.hash, "hex"))),
      new ec.ECStringTag(ec.ECTagNames.EC_TAG_PARTFILE_NAME, fields.name),
      new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PARTFILE_SIZE_FULL, fields.sizeFull ?? 0n),
      new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PARTFILE_SIZE_DONE, fields.sizeDone ?? 0n),
   ];
   if (fields.path !== undefined) {
      children.push(new ec.ECStringTag(ec.ECTagNames.EC_TAG_KNOWNFILE_PATH, fields.path));
   }
   return new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, fields.ecid, children);
}

/** A removal push notification's shape (see Downloads.ts's DownloadFile doc): own data IS the hash, no children. */
function downloadRemovalTag(hash: string): ec.ECTag {
   return new ec.ECHash16Tag(ec.ECTagNames.EC_TAG_PARTFILE, new Uint8Array(Buffer.from(hash, "hex")));
}

/** Builds a synthetic EC_TAG_PARTFILE_COMMENTS container, as parseFileComments() reads it - children evaluated by index, 4 per entry. */
function commentsTag(entries: readonly { userName: string; fileName: string; rating: number; comment: string }[]): ec.ECTag {
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

/** Builds a synthetic EC_TAG_PARTFILE tag - only the fields statusText/priorityText/partMetName read. */
function partFileTag(fields: {
   status?: number;
   prio?: number;
   stopped?: boolean;
   sourcesXfer?: number;
   comments?: ec.ECTag;
   kadCommentSearching?: boolean;
   partMetId?: number;
   sourceNames?: ec.ECTag;
}): ec.ECTag {
   const children: ec.ECTag[] = [];
   if (fields.status !== undefined) {
      children.push(new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_PARTFILE_STATUS, fields.status));
   }
   if (fields.prio !== undefined) {
      children.push(new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_PARTFILE_PRIO, fields.prio));
   }
   if (fields.stopped !== undefined) {
      children.push(new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_PARTFILE_STOPPED, fields.stopped ? 1 : 0));
   }
   if (fields.sourcesXfer !== undefined) {
      children.push(new ec.ECUInt8Tag(ec.ECTagNames.EC_TAG_PARTFILE_SOURCE_COUNT_XFER, fields.sourcesXfer));
   }
   if (fields.comments) children.push(fields.comments);
   if (fields.kadCommentSearching !== undefined) {
      children.push(new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PARTFILE_KAD_COMMENT_SEARCHING, fields.kadCommentSearching ? 1n : 0n));
   }
   if (fields.partMetId !== undefined) {
      children.push(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE_PARTMETID, fields.partMetId));
   }
   if (fields.sourceNames) children.push(fields.sourceNames);
   return new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, children);
}

describe("DownloadFile.statusText", () => {
   it("reports 'Hashing' while hashing, regardless of stopped/sources", () => {
      const file = ec.DownloadFile.fromTag(partFileTag({ status: ec.ECPartFileStatus.PS_HASHING }));
      expect(file.statusText).to.equal("Hashing");
   });

   it("reports 'Downloading' when a source is actively transferring", () => {
      const file = ec.DownloadFile.fromTag(partFileTag({ status: ec.ECPartFileStatus.PS_READY, sourcesXfer: 1 }));
      expect(file.statusText).to.equal("Downloading");
   });

   it("reports 'Waiting' when connected but no source is transferring", () => {
      const file = ec.DownloadFile.fromTag(partFileTag({ status: ec.ECPartFileStatus.PS_READY, sourcesXfer: 0 }));
      expect(file.statusText).to.equal("Waiting");
   });

   it("reports 'Stopped' when stopped and not yet complete", () => {
      const file = ec.DownloadFile.fromTag(partFileTag({ status: ec.ECPartFileStatus.PS_READY, stopped: true }));
      expect(file.statusText).to.equal("Stopped");
   });

   it("does not let 'stopped' override an already-complete status", () => {
      const file = ec.DownloadFile.fromTag(partFileTag({ status: ec.ECPartFileStatus.PS_COMPLETE, stopped: true }));
      expect(file.statusText).to.equal("Complete");
   });

   it("reports 'Unknown' when the status field is absent", () => {
      const file = ec.DownloadFile.fromTag(partFileTag({}));
      expect(file.statusText).to.equal("Unknown");
   });
});

describe("DownloadFile.priorityText", () => {
   it("reports a plain priority level", () => {
      const file = ec.DownloadFile.fromTag(partFileTag({ prio: ec.ECDownloadPriority.PR_HIGH }));
      expect(file.priorityText).to.equal("High");
   });

   it("reports the auto-priority form (wire value +10) distinctly from the plain one", () => {
      const file = ec.DownloadFile.fromTag(partFileTag({ prio: ec.ECDownloadPriority.PR_HIGH + 10 }));
      expect(file.priorityText).to.equal("Auto [Hi]");
   });

   it("reports 'Unknown' when the prio field is absent", () => {
      const file = ec.DownloadFile.fromTag(partFileTag({}));
      expect(file.priorityText).to.equal("Unknown");
   });
});

describe("DownloadFile.partMetName", () => {
   it("zero-pads partMetId to 3 digits and appends the .part.met suffix", () => {
      const file = ec.DownloadFile.fromTag(partFileTag({ partMetId: 12 }));
      expect(file.partMetName).to.equal("012.part.met");
   });

   it("is undefined when partMetId is absent", () => {
      const file = ec.DownloadFile.fromTag(partFileTag({}));
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(file.partMetName).to.be.undefined;
   });
});

describe("DownloadFile comments/kadCommentSearching", () => {
   it("decodes comments and kadCommentSearching when present", () => {
      const file = ec.DownloadFile.fromTag(
         partFileTag({
            comments: commentsTag([{ userName: "Alice", fileName: "one.avi", rating: ec.FileRating.GOOD, comment: "Nice" }]),
            kadCommentSearching: true,
         }),
      );

      expect(file.kadCommentSearching).to.equal(true);
      expect(file.comments).to.have.lengthOf(1);
      expect(file.comments?.[0]).to.deep.equal(new ec.FileComment("Alice", "one.avi", ec.FileRating.GOOD, "Nice"));
   });

   it("leaves both undefined when absent", () => {
      const file = ec.DownloadFile.fromTag(partFileTag({}));

      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(file.comments).to.be.undefined;
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(file.kadCommentSearching).to.be.undefined;
   });
});

/** Builds an EC_TAG_PARTFILE_SOURCE_NAMES container, as parseSourceNames() reads it (see Downloads.ts's doc). */
function sourceNamesTag(entries: readonly { id: number; name?: string; count: number }[]): ec.ECTag {
   const children = entries.map((entry) => {
      const entryChildren: ec.ECTag[] = [];
      if (entry.name !== undefined) {
         entryChildren.push(new ec.ECStringTag(ec.ECTagNames.EC_TAG_PARTFILE_SOURCE_NAMES, entry.name));
      }
      entryChildren.push(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE_SOURCE_NAMES_COUNTS, entry.count));
      return new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE_SOURCE_NAMES, entry.id, entryChildren);
   });
   return new ec.ECCustomTag(ec.ECTagNames.EC_TAG_PARTFILE_SOURCE_NAMES, new Uint8Array(), children);
}

describe("DownloadFile.sourceNames", () => {
   it("decodes full entries (id -> name/count) from a single response", () => {
      const file = ec.DownloadFile.fromTag(
         partFileTag({ sourceNames: sourceNamesTag([{ id: 1, name: "Movie.mkv", count: 7 }, { id: 2, name: "movie.avi", count: 2 }]) }),
      );

      expect(file.sourceNames?.size).to.equal(2);
      expect(file.sourceNames?.get(1n)).to.deep.equal({ name: "Movie.mkv", count: 7n });
      expect(file.sourceNames?.get(2n)).to.deep.equal({ name: "movie.avi", count: 2n });
   });

   it("is undefined when the container is absent", () => {
      const file = ec.DownloadFile.fromTag(partFileTag({}));
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(file.sourceNames).to.be.undefined;
   });

   it("decodes a bare count update (no nested name child) as name: undefined", () => {
      const file = ec.DownloadFile.fromTag(partFileTag({ sourceNames: sourceNamesTag([{ id: 1, count: 9 }]) }));
      expect(file.sourceNames?.get(1n)).to.deep.equal({ name: undefined, count: 9n });
   });
});

describe("DownloadTracker source names accumulation", () => {
   it("keeps a fully-known entry from a fetch() reply", () => {
      const tracker = new ec.DownloadTracker();
      const packet = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      packet.add(
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [
            new ec.ECHash16Tag(ec.ECTagNames.EC_TAG_PARTFILE_HASH, new Uint8Array(Buffer.from(hexHash("a"), "hex"))),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_PARTFILE_NAME, "one.avi"),
            sourceNamesTag([{ id: 1, name: "Movie.mkv", count: 7 }]),
         ]),
      );

      const file = tracker.apply(packet);

      expect(file?.sourceNames?.get(1n)).to.deep.equal({ name: "Movie.mkv", count: 7n });
   });

   it("updates the count without losing the name when a later push omits it", () => {
      const tracker = new ec.DownloadTracker();
      const initial = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      initial.add(
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [sourceNamesTag([{ id: 1, name: "Movie.mkv", count: 7 }])]),
      );
      tracker.apply(initial);

      const countOnly = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      countOnly.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [sourceNamesTag([{ id: 1, count: 3 }])]));
      const merged = tracker.apply(countOnly);

      expect(merged?.sourceNames?.get(1n)).to.deep.equal({ name: "Movie.mkv", count: 3n });
   });

   it("forgets an id once a later push reports its count as 0", () => {
      const tracker = new ec.DownloadTracker();
      const initial = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      initial.add(
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [sourceNamesTag([{ id: 1, name: "Movie.mkv", count: 7 }])]),
      );
      tracker.apply(initial);

      const removal = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      removal.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [sourceNamesTag([{ id: 1, count: 0 }])]));
      const merged = tracker.apply(removal);

      expect(merged?.sourceNames?.has(1n)).to.equal(false);
   });

   it("leaves the accumulated map untouched when a later push has no source-names container at all", () => {
      const tracker = new ec.DownloadTracker();
      const initial = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      initial.add(
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [sourceNamesTag([{ id: 1, name: "Movie.mkv", count: 7 }])]),
      );
      tracker.apply(initial);

      const unrelated = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      unrelated.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PARTFILE_SIZE_DONE, 20n)]));
      const merged = tracker.apply(unrelated);

      expect(merged?.sourceNames?.get(1n)).to.deep.equal({ name: "Movie.mkv", count: 7n });
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
      expect(fake.sent[0]?.find(ec.ECTagNames.EC_TAG_DETAIL_LEVEL)?.intValue).to.equal(BigInt(ec.ECDetailLevel.EC_DETAIL_CMD));
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

   it("decodes EC_TAG_KNOWNFILE_PATH onto path, undefined when absent", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      reply.add(downloadEntryTag({ ecid: 1, hash: hexHash("a"), name: "one.avi", path: "/home/user/Temp" }));
      reply.add(downloadEntryTag({ ecid: 2, hash: hexHash("b"), name: "two.avi" }));
      fake.queueReply(reply);

      await downloads.fetch();

      expect(downloads.files[0]?.path).to.equal("/home/user/Temp");
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(downloads.files[1]?.path).to.be.undefined;
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

describe("Downloads.pause/resume/stop/swapA4AF*", () => {
   const cases: {
      method: "pause" | "resume" | "stop" | "swapA4AFThis" | "swapA4AFThisAuto" | "swapA4AFOthers";
      opcode: ec.ECOpcode;
   }[] = [
      { method: "pause", opcode: ec.ECOpcode.EC_OP_PARTFILE_PAUSE },
      { method: "resume", opcode: ec.ECOpcode.EC_OP_PARTFILE_RESUME },
      { method: "stop", opcode: ec.ECOpcode.EC_OP_PARTFILE_STOP },
      { method: "swapA4AFThis", opcode: ec.ECOpcode.EC_OP_PARTFILE_SWAP_A4AF_THIS },
      { method: "swapA4AFThisAuto", opcode: ec.ECOpcode.EC_OP_PARTFILE_SWAP_A4AF_THIS_AUTO },
      { method: "swapA4AFOthers", opcode: ec.ECOpcode.EC_OP_PARTFILE_SWAP_A4AF_OTHERS },
   ];

   for (const { method, opcode } of cases) {
      describe(`Downloads.${method}`, () => {
         it("sends the hash as an EC_TAG_PARTFILE tag and succeeds on EC_OP_NOOP", async () => {
            const fake = createFakeConnection();
            const downloads = new ec.Downloads(fake.connection);
            fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

            await downloads[method](hexHash("a"));

            expect(fake.sent[0]?.opcode).to.equal(opcode);
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

            await expectRejection(downloads[method](hexHash("a")), /FileHash not found/);
         });
      });
   }
});

describe("Downloads.prioritySet", () => {
   it("sends the hash as EC_TAG_PARTFILE with an EC_TAG_PARTFILE_PRIO child", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await downloads.prioritySet(hexHash("a"), ec.ECDownloadPriority.PR_HIGH);

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_PARTFILE_PRIO_SET);
      const hashTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_PARTFILE);
      expect(Buffer.from((hashTag as ec.ECHash16Tag).value).toString("hex")).to.equal(hexHash("a"));
      const prioTag = hashTag?.findChild(ec.ECTagNames.EC_TAG_PARTFILE_PRIO);
      expect(prioTag?.intValue).to.equal(BigInt(ec.ECDownloadPriority.PR_HIGH));
   });

   it("sends PR_AUTO as-is (5), not the +10 read-side encoding", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await downloads.prioritySet(hexHash("a"), ec.ECDownloadPriority.PR_AUTO);

      const hashTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_PARTFILE);
      const prioTag = hashTag?.findChild(ec.ECTagNames.EC_TAG_PARTFILE_PRIO);
      expect(prioTag?.intValue).to.equal(BigInt(ec.ECDownloadPriority.PR_AUTO));
   });

   it("throws the daemon's reason on EC_OP_FAILED", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "FileHash not found: deadbeef"));
      fake.queueReply(failure);

      await expectRejection(downloads.prioritySet(hexHash("a"), ec.ECDownloadPriority.PR_HIGH), /FileHash not found/);
   });
});

describe("Downloads.setCategory", () => {
   it("sends the hash as EC_TAG_PARTFILE with an EC_TAG_PARTFILE_CAT child", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await downloads.setCategory(hexHash("a"), 2);

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_PARTFILE_SET_CAT);
      const hashTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_PARTFILE);
      expect(Buffer.from((hashTag as ec.ECHash16Tag).value).toString("hex")).to.equal(hexHash("a"));
      const catTag = hashTag?.findChild(ec.ECTagNames.EC_TAG_PARTFILE_CAT);
      expect(catTag?.intValue).to.equal(2n);
   });

   it("throws the daemon's reason on EC_OP_FAILED", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "FileHash not found: deadbeef"));
      fake.queueReply(failure);

      await expectRejection(downloads.setCategory(hexHash("a"), 2), /FileHash not found/);
   });
});

describe("Downloads.addLink", () => {
   it("sends the link as a single EC_TAG_STRING tag and succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await downloads.addLink("ed2k://|file|foo.avi|123|" + hexHash("a") + "|/");

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_ADD_LINK);
      const linkTag = fake.sent[0]?.find(ec.ECTagNames.EC_TAG_STRING);
      expect((linkTag as ec.ECStringTag).value).to.equal("ed2k://|file|foo.avi|123|" + hexHash("a") + "|/");
   });

   it("throws the daemon's reason on EC_OP_FAILED", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      const failure = new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED);
      failure.add(new ec.ECStringTag(ec.ECTagNames.EC_TAG_STRING, "Invalid link or already on list."));
      fake.queueReply(failure);

      await expectRejection(downloads.addLink("not-a-link"), /Invalid link/);
   });
});

describe("Downloads.clearCompleted", () => {
   it("sends one EC_TAG_ECID tag per ecid and always succeeds on EC_OP_NOOP", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await downloads.clearCompleted([1n, 2n, 3n]);

      expect(fake.sent[0]?.opcode).to.equal(ec.ECOpcode.EC_OP_CLEAR_COMPLETED);
      const ecidTags = fake.sent[0]?.tags.filter((tag) => {
         const name: ec.ECTagNames = tag.name;
         return name === ec.ECTagNames.EC_TAG_ECID;
      });
      expect(ecidTags?.map((tag) => tag.intValue)).to.deep.equal([1n, 2n, 3n]);
   });

   it("sends no tags at all for an empty list", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP));

      await downloads.clearCompleted([]);

      expect(fake.sent[0]?.tags).to.have.lengthOf(0);
   });

   it("throws a generic error on any unexpected opcode", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_FAILED));

      await expectRejection(downloads.clearCompleted([1n]), /EC_OP_NOOP/);
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
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PARTFILE_SIZE_DONE, 20n)]),
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

   it("apply() keeps previously known comments/kadCommentSearching when a later push omits them", () => {
      const tracker = new ec.DownloadTracker();
      const withComments = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      withComments.add(
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [
            new ec.ECHash16Tag(ec.ECTagNames.EC_TAG_PARTFILE_HASH, new Uint8Array(Buffer.from(hexHash("a"), "hex"))),
            new ec.ECStringTag(ec.ECTagNames.EC_TAG_PARTFILE_NAME, "one.avi"),
            commentsTag([{ userName: "Alice", fileName: "one.avi", rating: ec.FileRating.GOOD, comment: "Nice" }]),
            new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PARTFILE_KAD_COMMENT_SEARCHING, 1n),
         ]),
      );
      tracker.apply(withComments);

      const dirtyPush = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      dirtyPush.add(
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PARTFILE_SIZE_DONE, 20n)]),
      );
      tracker.apply(dirtyPush);

      expect(tracker.files[0]?.kadCommentSearching).to.equal(true);
      expect(tracker.files[0]?.comments).to.have.lengthOf(1);
   });

   it("apply() returns undefined for a packet that isn't about the download queue", () => {
      const tracker = new ec.DownloadTracker();
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(tracker.apply(new ec.ECPacket(ec.ECOpcode.EC_OP_NOOP))).to.be.undefined;
   });
});
