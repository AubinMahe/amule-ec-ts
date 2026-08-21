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

/** RLE-encodes raw bytes exactly like RLE_Data::Encode() (RLE.cpp:191-212): a run of 2+ equal bytes (max 255) is written twice then a count byte, anything else is a single literal. */
function rleEncode(data: Uint8Array): Uint8Array {
   const buffer = Buffer.from(data);
   const out: number[] = [];
   let i = 0;
   while (i < buffer.length) {
      const value = buffer.readUInt8(i);
      let runEnd = i + 1;
      while (runEnd < buffer.length && buffer.readUInt8(runEnd) === value && runEnd - i < 0xff) runEnd++;
      const runLen = runEnd - i;
      if (runLen > 1) {
         out.push(value, value, runLen);
      } else {
         out.push(value);
      }
      i = runEnd;
   }
   return Uint8Array.from(out);
}

/** Column-major-encodes a flat uint64 list exactly like RLE_Data::Encode(const ArrayOfUInts64&) (RLE.cpp:245-266). */
function uint64sToColumnMajorBytes(values: readonly bigint[]): Uint8Array {
   const size = values.length;
   const bytes = new Uint8Array(size * 8);
   for (let i = 0; i < size; i++) {
      let v = values.at(i) ?? 0n;
      for (let j = 0; j < 8; j++) {
         bytes[i + j * size] = Number(v & 0xffn);
         v >>= 8n;
      }
   }
   return bytes;
}

/** XORs two same-length byte buffers, treating a shorter `previous` as zero-padded. */
function xorBytes(absolute: Uint8Array, previous: Uint8Array): Uint8Array {
   const absoluteBuf = Buffer.from(absolute);
   const previousBuf = Buffer.from(previous);
   const out: number[] = [];
   for (let i = 0; i < absoluteBuf.length; i++) {
      const previousByte = i < previousBuf.length ? previousBuf.readUInt8(i) : 0;
      out.push(absoluteBuf.readUInt8(i) ^ previousByte);
   }
   return Uint8Array.from(out);
}

/** Builds an EC_TAG_PARTFILE_GAP_STATUS/_REQ_STATUS tag by RLE-encoding `ranges` as a diff against `previousAbsolute` - pass undefined to simulate a just-reset encoder (see PartFileStatus.ts's class doc). */
function byteRangeStatusTag(
   tagName: ec.ECTagNames,
   ranges: readonly { start: bigint; end: bigint }[],
   previousAbsolute?: readonly bigint[],
): ec.ECTag {
   const values = ranges.flatMap((r) => [r.start, r.end]);
   const absolute = uint64sToColumnMajorBytes(values);
   const previous = previousAbsolute ? uint64sToColumnMajorBytes(previousAbsolute) : new Uint8Array(0);
   return new ec.ECCustomTag(tagName, rleEncode(xorBytes(absolute, previous)));
}

/** Builds an EC_TAG_PARTFILE_PART_STATUS tag by RLE-encoding `counts` (each truncated to a byte) as a diff against `previousAbsolute`. */
function partStatusTag(counts: readonly number[], previousAbsolute?: readonly number[]): ec.ECTag {
   const absolute = Uint8Array.from(counts.map((c) => Math.min(c, 0xff)));
   const previous = previousAbsolute ? Uint8Array.from(previousAbsolute.map((c) => Math.min(c, 0xff))) : new Uint8Array(0);
   return new ec.ECCustomTag(ec.ECTagNames.EC_TAG_PARTFILE_PART_STATUS, rleEncode(xorBytes(absolute, previous)));
}

describe("DownloadFile.sourceNames", () => {
   it("decodes full entries (id -> name/count) from a single response", () => {
      const file = ec.DownloadFile.fromTag(
         partFileTag({
            sourceNames: sourceNamesTag([
               { id: 1, name: "Movie.mkv", count: 7 },
               { id: 2, name: "movie.avi", count: 2 },
            ]),
         }),
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
      initial.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [sourceNamesTag([{ id: 1, name: "Movie.mkv", count: 7 }])]));
      tracker.apply(initial);

      const countOnly = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      countOnly.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [sourceNamesTag([{ id: 1, count: 3 }])]));
      const merged = tracker.apply(countOnly);

      expect(merged?.sourceNames?.get(1n)).to.deep.equal({ name: "Movie.mkv", count: 3n });
   });

   it("forgets an id once a later push reports its count as 0", () => {
      const tracker = new ec.DownloadTracker();
      const initial = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      initial.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [sourceNamesTag([{ id: 1, name: "Movie.mkv", count: 7 }])]));
      tracker.apply(initial);

      const removal = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      removal.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [sourceNamesTag([{ id: 1, count: 0 }])]));
      const merged = tracker.apply(removal);

      expect(merged?.sourceNames?.has(1n)).to.equal(false);
   });

   it("leaves the accumulated map untouched when a later push has no source-names container at all", () => {
      const tracker = new ec.DownloadTracker();
      const initial = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      initial.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [sourceNamesTag([{ id: 1, name: "Movie.mkv", count: 7 }])]));
      tracker.apply(initial);

      const unrelated = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      unrelated.add(
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [new ec.ECUInt64Tag(ec.ECTagNames.EC_TAG_PARTFILE_SIZE_DONE, 20n)]),
      );
      const merged = tracker.apply(unrelated);

      expect(merged?.sourceNames?.get(1n)).to.deep.equal({ name: "Movie.mkv", count: 7n });
   });
});

describe("source-names per-connection cache (PartFileSourceNames.ts)", () => {
   it("Downloads.fetch() keeps a previously-seen name across a later fetch() with no fresh delta", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);

      const first = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      first.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [sourceNamesTag([{ id: 1, name: "Movie.mkv", count: 7 }])]));
      fake.queueReply(first);
      await downloads.fetch();
      expect(downloads.files[0]?.sourceNames?.get(1n)).to.deep.equal({ name: "Movie.mkv", count: 7n });

      // The daemon has nothing new to report for this file on this connection - real behavior for a
      // repeated fetch(), or one issued after another service already polled it (see class doc).
      const second = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      second.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, []));
      fake.queueReply(second);
      await downloads.fetch();

      expect(downloads.files[0]?.sourceNames?.get(1n)).to.deep.equal({ name: "Movie.mkv", count: 7n });
   });

   it("does not leak one connection's accumulated names onto a different connection", async () => {
      const fakeA = createFakeConnection();
      const fakeB = createFakeConnection();
      const downloadsA = new ec.Downloads(fakeA.connection);
      const downloadsB = new ec.Downloads(fakeB.connection);

      const replyA = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      replyA.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [sourceNamesTag([{ id: 1, name: "Movie.mkv", count: 7 }])]));
      fakeA.queueReply(replyA);
      await downloadsA.fetch();

      const replyB = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      replyB.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, []));
      fakeB.queueReply(replyB);
      await downloadsB.fetch();

      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(downloadsB.files[0]?.sourceNames).to.be.undefined;
   });

   it("SharedFiles.fetch()'s delta reaches Downloads.fetch() on the same connection", async () => {
      const fake = createFakeConnection();
      const sharedFiles = new ec.SharedFiles(fake.connection);
      const downloads = new ec.Downloads(fake.connection);

      // A partial-but-shared file: SharedFiles' own request happens to be the one that reaches the
      // daemon while this name's delta is still pending (see SharedFile's class doc).
      const sharedReply = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      sharedReply.add(
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_KNOWNFILE, 1, [sourceNamesTag([{ id: 1, name: "Movie.mkv", count: 7 }])]),
      );
      fake.queueReply(sharedReply);
      await sharedFiles.fetch();
      expect(sharedFiles.files).to.have.lengthOf(1);

      // Downloads.fetch() right after: the daemon has nothing new for THIS request (SharedFiles
      // already consumed the one-time delta), yet the name still shows up.
      const downloadReply = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      downloadReply.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, []));
      fake.queueReply(downloadReply);
      await downloads.fetch();

      expect(downloads.files[0]?.sourceNames?.get(1n)).to.deep.equal({ name: "Movie.mkv", count: 7n });
   });

   it("Update.fetch()'s delta reaches Downloads.fetch() on the same connection", async () => {
      const fake = createFakeConnection();
      fake.connection.remoteCapabilities.partialUpdate = true;
      const update = new ec.Update(fake.connection);
      const downloads = new ec.Downloads(fake.connection);

      // Update.fetch() polls far more often than a user-triggered Downloads.fetch() in a real app,
      // so it's typically the one that happens to reach the daemon while a name's delta is pending.
      const updateReply = new ec.ECPacket(ec.ECOpcode.EC_OP_SHARED_FILES);
      updateReply.add(
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [sourceNamesTag([{ id: 1, name: "Movie.mkv", count: 7 }])]),
      );
      fake.queueReply(updateReply);
      await update.fetch();

      const downloadReply = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      downloadReply.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, []));
      fake.queueReply(downloadReply);
      await downloads.fetch();

      expect(downloads.files[0]?.sourceNames?.get(1n)).to.deep.equal({ name: "Movie.mkv", count: 7n });
   });

   it("DownloadTracker.seed() forgets a dropped file's names, so a later ecid reuse starts clean", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      const tracker = new ec.DownloadTracker(fake.connection);

      const first = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      first.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [sourceNamesTag([{ id: 1, name: "Movie.mkv", count: 7 }])]));
      fake.queueReply(first);
      await downloads.fetch();
      tracker.seed(downloads);
      expect(tracker.files[0]?.sourceNames?.get(1n)).to.deep.equal({ name: "Movie.mkv", count: 7n });

      // The file completes/is cancelled: it's gone from the next fetch() entirely.
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE));
      await downloads.fetch();
      tracker.seed(downloads);
      expect(tracker.files).to.have.lengthOf(0);

      // The daemon later recycles ecid 1 for an unrelated new download, nothing new to report yet.
      const reused = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      reused.add(new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, []));
      fake.queueReply(reused);
      await downloads.fetch();
      tracker.seed(downloads);

      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- chai's getter-style assertion
      expect(tracker.files[0]?.sourceNames).to.be.undefined;
   });
});

describe("gap/req/part status per-connection cache (PartFileStatus.ts)", () => {
   it("decodes gaps/requestedRanges/partAvailability from a single Downloads.fetch() response", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);

      const reply = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      reply.add(
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [
            byteRangeStatusTag(ec.ECTagNames.EC_TAG_PARTFILE_GAP_STATUS, [{ start: 0n, end: 100n }]),
            byteRangeStatusTag(ec.ECTagNames.EC_TAG_PARTFILE_REQ_STATUS, [{ start: 500n, end: 600n }]),
            partStatusTag([3, 7, 0, 255]),
         ]),
      );
      fake.queueReply(reply);
      await downloads.fetch();

      expect(downloads.files[0]?.gaps).to.deep.equal([{ start: 0n, end: 100n }]);
      expect(downloads.files[0]?.requestedRanges).to.deep.equal([{ start: 500n, end: 600n }]);
      expect(downloads.files[0]?.partAvailability).to.deep.equal([3, 7, 0, 255]);
   });

   it("Downloads.fetch() (resetsEncoder) replaces stale gaps rather than XOR-ing onto them", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);

      const first = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      first.add(
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [
            byteRangeStatusTag(ec.ECTagNames.EC_TAG_PARTFILE_GAP_STATUS, [{ start: 0n, end: 100n }]),
         ]),
      );
      fake.queueReply(first);
      await downloads.fetch();
      expect(downloads.files[0]?.gaps).to.deep.equal([{ start: 0n, end: 100n }]);

      // The daemon resets its encoder before every EC_DETAIL_CMD encode (see class doc), so this
      // second response's bytes are the new absolute value, not a diff against the first response.
      const second = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      second.add(
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [
            byteRangeStatusTag(ec.ECTagNames.EC_TAG_PARTFILE_GAP_STATUS, [{ start: 200n, end: 300n }]),
         ]),
      );
      fake.queueReply(second);
      await downloads.fetch();

      expect(downloads.files[0]?.gaps).to.deep.equal([{ start: 200n, end: 300n }]);
   });

   it("accumulates a true incremental diff when resetsEncoder is false (the Update.fetch() path)", () => {
      const fake = createFakeConnection();

      const initialGaps = [
         { start: 0n, end: 100n },
         { start: 500n, end: 600n },
      ];
      const first = ec.DownloadFile.fromTag(
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [
            byteRangeStatusTag(ec.ECTagNames.EC_TAG_PARTFILE_GAP_STATUS, initialGaps),
         ]),
         fake.connection,
         false,
      );
      expect(first.gaps).to.deep.equal(initialGaps);

      // A later push reports only what changed - the first gap closed, the second grew - as a true
      // XOR diff against the previously-decoded absolute value.
      const updatedGaps = [{ start: 500n, end: 700n }];
      const second = ec.DownloadFile.fromTag(
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [
            byteRangeStatusTag(
               ec.ECTagNames.EC_TAG_PARTFILE_GAP_STATUS,
               updatedGaps,
               initialGaps.flatMap((r) => [r.start, r.end]),
            ),
         ]),
         fake.connection,
         false,
      );

      expect(second.gaps).to.deep.equal(updatedGaps);
   });

   it("DownloadTracker.seed() forgets a dropped file's gap state too, so a later ecid reuse via an incremental (non-reset) update starts clean", async () => {
      const fake = createFakeConnection();
      const downloads = new ec.Downloads(fake.connection);
      const tracker = new ec.DownloadTracker(fake.connection);

      const first = new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE);
      first.add(
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [
            byteRangeStatusTag(ec.ECTagNames.EC_TAG_PARTFILE_GAP_STATUS, [{ start: 0n, end: 100n }]),
         ]),
      );
      fake.queueReply(first);
      await downloads.fetch();
      tracker.seed(downloads);
      expect(tracker.files[0]?.gaps).to.deep.equal([{ start: 0n, end: 100n }]);

      // The file completes/is cancelled: it's gone from the next fetch() entirely.
      fake.queueReply(new ec.ECPacket(ec.ECOpcode.EC_OP_DLOAD_QUEUE));
      await downloads.fetch();
      tracker.seed(downloads);

      // The daemon recycles ecid 1 for an unrelated new download. This time it's observed through
      // a non-reset (Update.fetch()-style) path that only ever sends deltas - if the old file's
      // gap state hadn't been forgotten, this bare single-byte gap would get XORed onto it instead
      // of being read as the absolute (and tiny) value it actually is.
      const reused = ec.DownloadFile.fromTag(
         new ec.ECUInt32Tag(ec.ECTagNames.EC_TAG_PARTFILE, 1, [
            byteRangeStatusTag(ec.ECTagNames.EC_TAG_PARTFILE_GAP_STATUS, [{ start: 1n, end: 2n }]),
         ]),
         fake.connection,
         false,
      );

      expect(reused.gaps).to.deep.equal([{ start: 1n, end: 2n }]);
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
