import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECFetchable } from "./ECFetchable.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECDetailLevel } from "./ECDetailLevel.js";
import { ECTag, ECUInt8Tag, ECUInt32Tag, ECHash16Tag, ECStringTag } from "./ECTags.js";
import { FileComment, parseFileComments, parseKadCommentSearching, MediaMetadata, parseMediaMetadata } from "./SharedFiles.js";
import { SourceName, mergeSourceNames, resolveSourceNames, forgetSourceNames } from "./PartFileSourceNames.js";

export type { SourceName } from "./PartFileSourceNames.js";

const debug = debuglog("amule-ec:downloads");

/**
 * A partfile's `EC_TAG_PARTFILE_STATUS` value - confirmed against
 * https://github.com/amule-org/amule/blob/master/src/Constants.h#L94-L104
 * (the `PS_*` #defines
 * `CPartFile::GetStatus()` returns, transmitted as-is by
 * `CEC_PartFile_Tag`, ECSpecialCoreTags.cpp:174).
 */
export enum ECPartFileStatus {
   PS_READY = 0,
   PS_EMPTY = 1,
   PS_WAITING_FOR_HASH = 2,
   PS_HASHING = 3,
   PS_ERROR = 4,
   PS_INSUFFICIENT = 5,
   PS_UNKNOWN = 6,
   PS_PAUSED = 7,
   PS_COMPLETING = 8,
   PS_COMPLETE = 9,
   PS_ALLOCATING = 10,
}

/**
 * The base (non-auto) priority a partfile's `EC_TAG_PARTFILE_PRIO` value
 * encodes - confirmed against
 * https://github.com/amule-org/amule/blob/master/src/Constants.h#L107-L118
 * (the `PR_*` #defines). The wire value itself is
 * `file->IsAutoDownPriority() ? file->GetDownPriority() + 10 : file->GetDownPriority()`
 * (ECSpecialCoreTags.cpp:189-191) - i.e. add 10 to flag "auto" - see
 * DownloadFile.priorityText, which mirrors DataToText.cpp's `PriorityToStr()`.
 */
export enum ECDownloadPriority {
   PR_LOW = 0,
   PR_NORMAL = 1,
   PR_HIGH = 2,
   PR_VERYHIGH = 3,
   PR_VERY_LOW = 4,
   PR_AUTO = 5,
   PR_POWERSHARE = 6,
}

/**
 * One EC_TAG_PARTFILE entry from an EC_OP_DLOAD_QUEUE reply or notification.
 *
 * Confirmed against
 * https://github.com/amule-org/amule/blob/master/src/ECSpecialCoreTags.cpp:
 * EC_TAG_PARTFILE's own data is the file's internal ECID
 * (`CEC_SharedFile_Tag : CECTag(name, file->ECID())`, line 225), not its
 * hash - the hash and the other properties used below (name, sizes, speed,
 * status, sources, prio) are all children, added by CEC_SharedFile_Tag/
 * CEC_PartFile_Tag. At EC_DETAIL_CMD (Downloads.fetch()'s level) every field
 * below is present. At EC_DETAIL_UPDATE though - the level a "dirty" push
 * notification for an already-known file uses (ECPartFileMsgSource::
 * GetNextPacket, ExternalConn.cpp:3165-3189) - `name`/`hash` are NOT: they're
 * added *after* the `detail_level == EC_DETAIL_UPDATE` early-return
 * (ECSpecialCoreTags.cpp:272-282), while status/sizes/speed/sources are
 * added *before* it and so are present. Only a brand new file's first push
 * uses EC_DETAIL_FULL and so carries name/hash too. This is exactly why
 * DownloadTracker exists below - a progress-only push can't identify which
 * file it's about without correlating its ECID against one seen earlier.
 *
 * A removal push notification uses a *different* shape again: confirmed
 * against ECPartFileMsgSource::GetNextPacket
 * (ExternalConn.cpp:3174-3179) - there, EC_TAG_PARTFILE's own data really
 * is the hash (`CECTag(EC_TAG_PARTFILE, filehash)`), with no children and
 * no ECID at all.
 *
 * `sourceNames` (a fellow download's peers reporting the same file under different filenames) has
 * its own, stricter partiality: EC_TAG_PARTFILE_SOURCE_NAMES is delta-encoded *per EC connection* -
 * confirmed against ExternalConn.cpp:3293-3349 (`CPartFile_Encoder::Encode`) and two reference
 * client decoders, amule-remote-gui.cpp:3026-3042 and webapi/Refresher.cpp:570-592. The daemon
 * assigns a stable id per distinct name and, on each response, sends only what changed since its
 * last response on this same connection: a new id carries its name; a bare count change on an
 * already-known id omits the name (SourceName.name is then undefined - not "no name", but "unknown
 * here, keep whatever you already had"); a count of 0n means "forget this id" (SourceName.count of
 * 0n never represents a real, currently-valid entry). Unlike the fields above, a fresh EC_DETAIL_CMD
 * request does *not* reset this tracking - CPartFile_Encoder::ResetEncoder() (ExternalConn.cpp:3359-
 * 3363) resets gap/req status but never touches m_sourcenameItemMap - so a fetch() result's
 * `sourceNames` is *not* guaranteed self-contained the way every other field is: a repeated fetch(),
 * or a fetch() on a connection another service (e.g. SharedFiles) has already polled this same file
 * on, can legitimately come back without a name the daemon already told this connection once. That
 * gap is closed automatically: `fromTag()`/`parseNotification()` fold every delta they see into a
 * per-connection cache (see PartFileSourceNames.ts's resolveSourceNames()) keyed by ecid, so
 * `sourceNames` always reflects everything this connection has ever been told, not just what the
 * current response happened to carry - the caller doesn't need to know any of this. The one thing
 * that cache can't do anything about is a name never having reached this connection *at all* yet
 * (nothing changed since the connection opened) - in that case there is nothing to accumulate until
 * an actual change occurs, from a fetch() or a push notification.
 */
export class DownloadFile {
   public readonly hash: string | undefined;
   public readonly name: string | undefined;
   public readonly sizeFull: bigint | undefined;
   public readonly sizeDone: bigint | undefined;
   public readonly speed: bigint | undefined;
   public readonly sources: bigint | undefined;
   public readonly status: bigint | undefined;
   public readonly prio: bigint | undefined;
   /** True for a removal push notification (see class doc) - every other field is then unavailable. */
   public readonly removed: boolean;
   /** The file's internal ECID - present on every shape except a removal notification (see class doc). */
   public readonly ecid: bigint | undefined;
   /**
    * The number part of the "NNN.part.met" temp filename - `EC_TAG_PARTFILE_PARTMETID`
    * (`file->GetPartMetNumber()`, ECSpecialCoreTags.cpp:212). Not present on an
    * EC_DETAIL_UPDATE push (added after that early-return, same as hash/name).
    */
   public readonly partMetId: bigint | undefined;
   /** `EC_TAG_PARTFILE_STOPPED` (`file->IsStopped()`, ECSpecialCoreTags.cpp:175). */
   public readonly stopped: boolean;
   /** Sources currently transferring - `EC_TAG_PARTFILE_SOURCE_COUNT_XFER` (ECSpecialCoreTags.cpp:179),
    * used by statusText to tell "Downloading" from "Waiting".
    */
   public readonly sourcesXfer: bigint | undefined;
   /** Community ratings/comments (own source comments + Kad NOTES) - see FileComment/parseFileComments' doc. */
   public readonly comments: readonly FileComment[] | undefined;
   /** Whether a searchKadNotes() lookup is currently in flight for this file - EC_TAG_PARTFILE_KAD_COMMENT_SEARCHING. */
   public readonly kadCommentSearching: boolean | undefined;
   /**
    * The on-disk directory - `EC_TAG_KNOWNFILE_PATH`, confirmed against
    * amule-remote-gui.cpp's `DirectoryPath()` decode
    * (https://github.com/amule-org/amule/blob/master/src/amule-remote-gui.cpp#L2151-L2157): the Temp
    * dir while downloading, the destination dir once complete. Disambiguates
    * same-named files downloaded to different directories.
    */
   public readonly path: string | undefined;
   /** Probed audio/video metadata, if any - see MediaMetadata's doc. */
   public readonly media: MediaMetadata | undefined;
   /** Alternate filenames this download's sources have reported, id -> {name, count} - see class doc for the delta protocol this reflects and why DownloadTracker matters here. */
   public readonly sourceNames: ReadonlyMap<bigint, SourceName> | undefined;

   private constructor(fields: {
      hash: string | undefined;
      name: string | undefined;
      sizeFull: bigint | undefined;
      sizeDone: bigint | undefined;
      speed: bigint | undefined;
      sources: bigint | undefined;
      status: bigint | undefined;
      prio: bigint | undefined;
      removed: boolean;
      ecid: bigint | undefined;
      partMetId: bigint | undefined;
      stopped: boolean;
      sourcesXfer: bigint | undefined;
      comments: readonly FileComment[] | undefined;
      kadCommentSearching: boolean | undefined;
      path: string | undefined;
      media: MediaMetadata | undefined;
      sourceNames: ReadonlyMap<bigint, SourceName> | undefined;
   }) {
      this.hash = fields.hash;
      this.name = fields.name;
      this.sizeFull = fields.sizeFull;
      this.sizeDone = fields.sizeDone;
      this.speed = fields.speed;
      this.sources = fields.sources;
      this.status = fields.status;
      this.prio = fields.prio;
      this.removed = fields.removed;
      this.ecid = fields.ecid;
      this.partMetId = fields.partMetId;
      this.stopped = fields.stopped;
      this.sourcesXfer = fields.sourcesXfer;
      this.comments = fields.comments;
      this.kadCommentSearching = fields.kadCommentSearching;
      this.path = fields.path;
      this.media = fields.media;
      this.sourceNames = fields.sourceNames;
   }

   /**
    * `connection`, when given, lets `sourceNames` be resolved against that connection's running
    * accumulation instead of just this one tag's delta - see class doc and
    * PartFileSourceNames.ts's resolveSourceNames(). Omitted by direct/test callers that only care
    * about this one tag's own content.
    */
   public static fromTag(tag: ECTag, connection?: ECConnection): DownloadFile {
      const ownHashTag = tag instanceof ECHash16Tag ? tag : undefined;
      const childHashTag = tag.findChild(ECTagNames.EC_TAG_PARTFILE_HASH);
      const hashTag = childHashTag instanceof ECHash16Tag ? childHashTag : ownHashTag;
      const removed = tag.children.length === 0 && ownHashTag !== undefined;
      const ecid = removed ? undefined : tag.intValue;
      return new DownloadFile({
         hash: hashTag ? Buffer.from(hashTag.value).toString("hex") : undefined,
         name: tag.childString(ECTagNames.EC_TAG_PARTFILE_NAME),
         sizeFull: tag.childInt(ECTagNames.EC_TAG_PARTFILE_SIZE_FULL),
         sizeDone: tag.childInt(ECTagNames.EC_TAG_PARTFILE_SIZE_DONE),
         speed: tag.childInt(ECTagNames.EC_TAG_PARTFILE_SPEED),
         sources: tag.childInt(ECTagNames.EC_TAG_PARTFILE_SOURCE_COUNT),
         status: tag.childInt(ECTagNames.EC_TAG_PARTFILE_STATUS),
         prio: tag.childInt(ECTagNames.EC_TAG_PARTFILE_PRIO),
         removed,
         ecid,
         partMetId: tag.childInt(ECTagNames.EC_TAG_PARTFILE_PARTMETID),
         stopped: (tag.childInt(ECTagNames.EC_TAG_PARTFILE_STOPPED) ?? 0n) !== 0n,
         sourcesXfer: tag.childInt(ECTagNames.EC_TAG_PARTFILE_SOURCE_COUNT_XFER),
         comments: parseFileComments(tag),
         kadCommentSearching: parseKadCommentSearching(tag),
         path: tag.childString(ECTagNames.EC_TAG_KNOWNFILE_PATH),
         media: parseMediaMetadata(tag),
         sourceNames: resolveSourceNames(tag, connection, ecid),
      });
   }

   /** Fills in whatever `this` has that `update` doesn't (see class doc on why an update can be partial). */
   public mergedWith(update: DownloadFile): DownloadFile {
      return new DownloadFile({
         hash: update.hash ?? this.hash,
         name: update.name ?? this.name,
         sizeFull: update.sizeFull ?? this.sizeFull,
         sizeDone: update.sizeDone ?? this.sizeDone,
         speed: update.speed ?? this.speed,
         sources: update.sources ?? this.sources,
         status: update.status ?? this.status,
         prio: update.prio ?? this.prio,
         removed: update.removed,
         ecid: update.ecid ?? this.ecid,
         partMetId: update.partMetId ?? this.partMetId,
         stopped: update.stopped,
         sourcesXfer: update.sourcesXfer ?? this.sourcesXfer,
         comments: update.comments ?? this.comments,
         kadCommentSearching: update.kadCommentSearching ?? this.kadCommentSearching,
         path: update.path ?? this.path,
         media: update.media ?? this.media,
         sourceNames: mergeSourceNames(this.sourceNames, update.sourceNames),
      });
   }

   /** The temp filename this download is stored under, e.g. "012.part.met" - see partMetId's doc. */
   public get partMetName(): string | undefined {
      if (this.partMetId === undefined) return undefined;
      return `${this.partMetId.toString().padStart(3, "0")}.part.met`;
   }

   /**
    * Human-readable priority, mirroring DataToText.cpp's `PriorityToStr()`
    * (https://github.com/amule-org/amule/blob/master/src/DataToText.cpp#L31-L62) - see `prio`'s
    * class doc for the "+10 means auto" wire encoding this decodes.
    */
   public get priorityText(): string {
      if (this.prio === undefined) return "Unknown";
      const raw = Number(this.prio);
      const isAuto = raw >= 10;
      const base: ECDownloadPriority = isAuto ? raw - 10 : raw;
      if (isAuto) {
         switch (base) {
            case ECDownloadPriority.PR_LOW:
               return "Auto [Lo]";
            case ECDownloadPriority.PR_NORMAL:
               return "Auto [No]";
            case ECDownloadPriority.PR_HIGH:
               return "Auto [Hi]";
         }
      } else {
         switch (base) {
            case ECDownloadPriority.PR_VERY_LOW:
               return "Very low";
            case ECDownloadPriority.PR_LOW:
               return "Low";
            case ECDownloadPriority.PR_NORMAL:
               return "Normal";
            case ECDownloadPriority.PR_HIGH:
               return "High";
            case ECDownloadPriority.PR_VERYHIGH:
               return "Very High";
            case ECDownloadPriority.PR_POWERSHARE:
               return "Release";
         }
      }
      return "Unknown";
   }

   /**
    * Human-readable status, mirroring `CPartFile::getPartfileStatus()`
    * (https://github.com/amule-org/amule/blob/master/src/PartFile.cpp#L4353-L4389): hashing/allocating
    * take priority over the status switch, "Downloading" vs "Waiting" is
    * decided by whether any source is currently transferring (not merely
    * connected), and a stopped file reads "Stopped" unless already complete.
    */
   public get statusText(): string {
      if (this.status === undefined) return "Unknown";
      const status: ECPartFileStatus = Number(this.status);
      if (status === ECPartFileStatus.PS_HASHING || status === ECPartFileStatus.PS_WAITING_FOR_HASH) {
         return "Hashing";
      }
      if (status === ECPartFileStatus.PS_ALLOCATING) {
         return "Allocating";
      }
      let text: string;
      switch (status) {
         case ECPartFileStatus.PS_COMPLETING:
            text = "Completing";
            break;
         case ECPartFileStatus.PS_COMPLETE:
            text = "Complete";
            break;
         case ECPartFileStatus.PS_PAUSED:
            text = "Paused";
            break;
         case ECPartFileStatus.PS_ERROR:
            text = "Erroneous";
            break;
         case ECPartFileStatus.PS_INSUFFICIENT:
            text = "Insufficient disk space";
            break;
         default:
            text = (this.sourcesXfer ?? 0n) > 0n ? "Downloading" : "Waiting";
      }
      if (this.stopped && status !== ECPartFileStatus.PS_COMPLETE) {
         text = "Stopped";
      }
      return text;
   }
}

/** The download queue, as returned by EC_OP_GET_DLOAD_QUEUE / EC_OP_DLOAD_QUEUE. */
export class Downloads implements ECFetchable {
   public files: readonly DownloadFile[] = [];

   public constructor(public readonly connection: ECConnection) {}

   /**
    * Interprets a server-pushed notification packet (see ECConnection's
    * "notification" event) as a single download update/removal, or
    * undefined if this packet isn't about the download queue.
    *
    * Confirmed against ECPartFileMsgSource::GetNextPacket
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3165-L3189): a download
    * notification is an EC_OP_DLOAD_QUEUE packet carrying exactly one
    * EC_TAG_PARTFILE tag - same opcode/tag name as Downloads.fetch()'s
    * reply, just unsolicited and for a single file. See DownloadFile's
    * class doc for why the result may be missing hash/name - use
    * DownloadTracker to resolve those against previously seen files.
    *
    * Static - doesn't need its *own* connection, a notification is parsed from a packet the
    * connection already handed us, not fetched. `connection` is still accepted, purely so
    * `sourceNames` can be resolved against that connection's running accumulation like fromTag()'s -
    * pass the same ECConnection the notification came from (typically DownloadTracker.apply()'s).
    */
   public static parseNotification(packet: ECPacket, connection?: ECConnection): DownloadFile | undefined {
      if (packet.opcode !== ECOpcode.EC_OP_DLOAD_QUEUE) return undefined;
      const tag = packet.find(ECTagNames.EC_TAG_PARTFILE);
      if (!tag) return undefined;
      const file = DownloadFile.fromTag(tag, connection);
      debug("parseNotification: ecid=%s, removed=%s", file.ecid, file.removed);
      return file;
   }

   public async fetch(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_GET_DLOAD_QUEUE);
      request.add(new ECUInt8Tag(ECTagNames.EC_TAG_DETAIL_LEVEL, ECDetailLevel.EC_DETAIL_CMD));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_DLOAD_QUEUE) {
         throw new Error(`Expected EC_OP_DLOAD_QUEUE, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      this.files = reply.tags
         .filter((tag) => {
            const name: ECTagNames = tag.name;
            return name === ECTagNames.EC_TAG_PARTFILE;
         })
         .map((tag) => DownloadFile.fromTag(tag, this.connection));
      debug("fetch: %d file(s)", this.files.length);
   }

   /**
    * Cancels (deletes) a partial download, identified by its MD4 hash -
    * EC_OP_PARTFILE_DELETE.
    *
    * Confirmed against Get_EC_Response_PartFile_Cmd
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L1405-L1477, dispatched
    * for EC_OP_PARTFILE_DELETE at ExternalConn.cpp:2456-2466): the request
    * carries the target as an EC_TAG_PARTFILE tag whose own data is the
    * file's MD4 hash - same tag name/shape TextClient.cpp's own "cancel"
    * command builds (TextClient.cpp:515-516). Replies EC_OP_FAILED (with an
    * EC_TAG_STRING reason, e.g. "FileHash not found: ...") if the hash
    * doesn't match a download in progress, EC_OP_NOOP otherwise.
    */
   public async cancel(hash: string): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_PARTFILE_DELETE);
      request.add(new ECHash16Tag(ECTagNames.EC_TAG_PARTFILE, new Uint8Array(Buffer.from(hash, "hex"))));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason = reasonTag instanceof ECStringTag ? reasonTag.value : `Failed to cancel ${hash}.`;
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("cancel: hash=%s", hash);
   }

   /**
    * Renames a file identified by its MD4 hash - EC_OP_RENAME_FILE. Despite
    * living on Downloads, this isn't partfile-specific: it's one unified
    * rename shared with shared/complete files too.
    *
    * Confirmed against the EC_OP_RENAME_FILE case in
    * ExternalConn::ProcessRequest2
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3285-L3311):
    * the request carries the target as an EC_TAG_KNOWNFILE tag (own data:
    * MD4 hash) and the new name as an EC_TAG_PARTFILE_NAME string tag -
    * hence "KNOWNFILE" rather than "PARTFILE": the daemon looks the hash up
    * in the download queue first and falls back to the known/shared files
    * list ("search first in downloadqueue - it might be in known files as
    * well"), then renames through CKnownFile - the common base class both
    * a CPartFile and a shared file are, so the same request works on
    * either without the caller needing to know which one it's hitting. No
    * amulecmd equivalent exists (grep of TextClient.cpp found no "rename"
    * command at all) - this one is GUI-only upstream. Replies EC_OP_FAILED
    * (with an EC_TAG_STRING reason: "File not found.", "Invalid file
    * name.", or "Unable to rename file.") on error, EC_OP_NOOP on success.
    */
   public async rename(hash: string, newName: string): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_RENAME_FILE);
      request.add(new ECHash16Tag(ECTagNames.EC_TAG_KNOWNFILE, new Uint8Array(Buffer.from(hash, "hex"))));
      request.add(new ECStringTag(ECTagNames.EC_TAG_PARTFILE_NAME, newName));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason = reasonTag instanceof ECStringTag ? reasonTag.value : `Failed to rename ${hash}.`;
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("rename: hash=%s, newName=%s", hash, newName);
   }

   /**
    * Sends a single-hash partfile command (pause/resume/stop), identified
    * by its MD4 hash - shared by pause()/resume()/stop(), which all wrap
    * Get_EC_Response_PartFile_Cmd the same way cancel() does.
    *
    * Confirmed against Get_EC_Response_PartFile_Cmd
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L1659-L1728,
    * PAUSE/RESUME/STOP cases): the request carries a single EC_TAG_PARTFILE
    * tag whose own data is the file's MD4 hash - same shape cancel()
    * already builds, no child tag needed for any of these three opcodes.
    * Replies EC_OP_FAILED (with an EC_TAG_STRING reason, e.g. "FileHash not
    * found: ...") if the hash doesn't match a download in progress,
    * EC_OP_NOOP otherwise.
    */
   private async sendPartFileCommand(opcode: ECOpcode, hash: string, failureMessage: string): Promise<void> {
      const request = new ECPacket(opcode);
      request.add(new ECHash16Tag(ECTagNames.EC_TAG_PARTFILE, new Uint8Array(Buffer.from(hash, "hex"))));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason = reasonTag instanceof ECStringTag ? reasonTag.value : failureMessage;
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
   }

   /** Pauses a download, identified by its MD4 hash - EC_OP_PARTFILE_PAUSE. See sendPartFileCommand()'s doc. */
   public async pause(hash: string): Promise<void> {
      await this.sendPartFileCommand(ECOpcode.EC_OP_PARTFILE_PAUSE, hash, `Failed to pause ${hash}.`);
      debug("pause: hash=%s", hash);
   }

   /** Resumes a paused download, identified by its MD4 hash - EC_OP_PARTFILE_RESUME. See sendPartFileCommand()'s doc. */
   public async resume(hash: string): Promise<void> {
      await this.sendPartFileCommand(ECOpcode.EC_OP_PARTFILE_RESUME, hash, `Failed to resume ${hash}.`);
      debug("resume: hash=%s", hash);
   }

   /** Stops a download, identified by its MD4 hash - EC_OP_PARTFILE_STOP. See sendPartFileCommand()'s doc. */
   public async stop(hash: string): Promise<void> {
      await this.sendPartFileCommand(ECOpcode.EC_OP_PARTFILE_STOP, hash, `Failed to stop ${hash}.`);
      debug("stop: hash=%s", hash);
   }

   /**
    * Swaps this file's sources to another "also available for" (A4AF) file
    * sharing the same content - EC_OP_PARTFILE_SWAP_A4AF_THIS.
    *
    * Confirmed against Get_EC_Response_PartFile_Cmd's
    * EC_OP_PARTFILE_SWAP_A4AF_THIS case
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L1915-L1917,
    * `CoreNotify_PartFile_Swap_A4AF(pfile)`): same request/reply shape as
    * pause()/resume()/stop() - a single EC_TAG_PARTFILE hash tag, no
    * children. GUI-only upstream (no amulecmd equivalent).
    */
   public async swapA4AFThis(hash: string): Promise<void> {
      await this.sendPartFileCommand(ECOpcode.EC_OP_PARTFILE_SWAP_A4AF_THIS, hash, `Failed to swap A4AF for ${hash}.`);
      debug("swapA4AFThis: hash=%s", hash);
   }

   /**
    * Same as swapA4AFThis(), but also toggles the file's "auto swap" flag -
    * EC_OP_PARTFILE_SWAP_A4AF_THIS_AUTO
    * (`CoreNotify_PartFile_Swap_A4AF_Auto(pfile)`,
    * https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L1918-L1920).
    * Same request/reply shape as swapA4AFThis().
    */
   public async swapA4AFThisAuto(hash: string): Promise<void> {
      await this.sendPartFileCommand(ECOpcode.EC_OP_PARTFILE_SWAP_A4AF_THIS_AUTO, hash, `Failed to swap A4AF (auto) for ${hash}.`);
      debug("swapA4AFThisAuto: hash=%s", hash);
   }

   /**
    * Swaps this file's sources to its other A4AF files (the reverse
    * direction of swapA4AFThis()) - EC_OP_PARTFILE_SWAP_A4AF_OTHERS
    * (`CoreNotify_PartFile_Swap_A4AF_Others(pfile)`,
    * https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L1921-L1923).
    * Same request/reply shape as swapA4AFThis().
    */
   public async swapA4AFOthers(hash: string): Promise<void> {
      await this.sendPartFileCommand(ECOpcode.EC_OP_PARTFILE_SWAP_A4AF_OTHERS, hash, `Failed to swap A4AF (others) for ${hash}.`);
      debug("swapA4AFOthers: hash=%s", hash);
   }

   /**
    * Assigns a download to a category, identified by its MD4 hash -
    * EC_OP_PARTFILE_SET_CAT.
    *
    * Confirmed against Get_EC_Response_PartFile_Cmd's EC_OP_PARTFILE_SET_CAT
    * case (`pfile->SetCategory(hashtag.GetFirstTagSafe()->GetInt())`,
    * https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L1950-L1951)
    * and TextClient.cpp's own use of the same child tag
    * (https://github.com/amule-org/amule/blob/master/src/TextClient.cpp#L737-L738): the request's
    * EC_TAG_PARTFILE tag (own data: MD4 hash) carries one EC_TAG_PARTFILE_CAT
    * child (uint32) - the target category's index, 0 meaning "no category".
    * Replies EC_OP_FAILED/EC_OP_NOOP exactly like pause()/resume()/stop().
    */
   public async setCategory(hash: string, categoryIndex: number): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_PARTFILE_SET_CAT);
      request.add(
         new ECHash16Tag(ECTagNames.EC_TAG_PARTFILE, new Uint8Array(Buffer.from(hash, "hex")), [
            new ECUInt32Tag(ECTagNames.EC_TAG_PARTFILE_CAT, categoryIndex),
         ]),
      );
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason = reasonTag instanceof ECStringTag ? reasonTag.value : `Failed to set category for ${hash}.`;
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("setCategory: hash=%s, categoryIndex=%d", hash, categoryIndex);
   }

   /**
    * Sets a download's priority, identified by its MD4 hash -
    * EC_OP_PARTFILE_PRIO_SET.
    *
    * Confirmed against Get_EC_Response_PartFile_Cmd's EC_OP_PARTFILE_PRIO_SET
    * case (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L1701-L1708)
    * and TextClient.cpp's own priority commands
    * (https://github.com/amule-org/amule/blob/master/src/TextClient.cpp#L511-L539): the request's
    * EC_TAG_PARTFILE tag (own data: MD4 hash) carries one EC_TAG_PARTFILE_PRIO
    * child (uint8). Unlike DownloadFile.prio (see its class doc: the daemon
    * adds 10 to flag "auto" on the *read* side), this is the raw
    * ECDownloadPriority value - PR_AUTO is sent as 5, not 15; the daemon
    * itself special-cases PR_AUTO to call SetAutoDownPriority() rather than
    * SetDownPriority(). Replies EC_OP_FAILED/EC_OP_NOOP exactly like
    * pause()/resume()/stop().
    */
   public async prioritySet(hash: string, priority: ECDownloadPriority): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_PARTFILE_PRIO_SET);
      request.add(
         new ECHash16Tag(ECTagNames.EC_TAG_PARTFILE, new Uint8Array(Buffer.from(hash, "hex")), [
            new ECUInt8Tag(ECTagNames.EC_TAG_PARTFILE_PRIO, priority),
         ]),
      );
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason = reasonTag instanceof ECStringTag ? reasonTag.value : `Failed to set priority for ${hash}.`;
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("prioritySet: hash=%s, priority=%s", hash, ECDownloadPriority[priority]);
   }

   /**
    * Starts a download from an ed2k link - EC_OP_ADD_LINK.
    *
    * Confirmed against the EC_OP_ADD_LINK case in ExternalConn::ProcessRequest2
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L2730-L2763) and
    * TextClient.cpp's own "add" command (https://github.com/amule-org/amule/blob/master/src/TextClient.cpp#L578-L590):
    * the request carries the link as a single EC_TAG_STRING tag. The daemon
    * accepts a batch of links per request (aggregating results across them),
    * but amulecmd itself only ever sends one per call - this wrapper does
    * the same, matching cancel()/rename()'s singular style. Replies
    * EC_OP_FAILED (with an EC_TAG_STRING reason, e.g. "Invalid link or
    * already on list.") if the link was rejected, EC_OP_NOOP otherwise.
    */
   public async addLink(link: string): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_ADD_LINK);
      request.add(new ECStringTag(ECTagNames.EC_TAG_STRING, link));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason = reasonTag instanceof ECStringTag ? reasonTag.value : `Failed to add link ${link}.`;
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("addLink: link=%s", link);
   }

   /**
    * Clears the given completed downloads from the daemon's completed list,
    * by ECID - EC_OP_CLEAR_COMPLETED.
    *
    * Confirmed against the EC_OP_CLEAR_COMPLETED case in ExternalConn::ProcessRequest2
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L2939-L2949) and
    * CDownloadQueue::ClearCompleted (https://github.com/amule-org/amule/blob/master/src/DownloadQueue.cpp#L863-L878):
    * the request carries zero or more EC_TAG_ECID tags (uint32); each ECID
    * that matches a completed download is cleared, everything else is a
    * no-op - an empty list clears nothing, it is NOT a "clear all"
    * wildcard. No amulecmd equivalent exists (GUI-only upstream). Always
    * replies EC_OP_NOOP - there is no failure case to check.
    */
   public async clearCompleted(ecids: readonly bigint[]): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_CLEAR_COMPLETED);
      for (const ecid of ecids) {
         request.add(new ECUInt32Tag(ECTagNames.EC_TAG_ECID, Number(ecid)));
      }
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("clearCompleted: %d ecid(s)", ecids.length);
   }
}

/**
 * Keeps a live view of the download queue in sync with push notifications,
 * so a progress-only update (see DownloadFile's class doc) can still be
 * shown against the file it belongs to instead of "(unknown name)".
 *
 * Call seed() with a fresh Downloads.fetch() result whenever you have one
 * (it fully replaces the tracked set - the safe, always-correct baseline);
 * feed every notification packet through apply() in between to stay live.
 *
 * `connection`, when given, is only used to forget a file's accumulated `sourceNames` once it leaves
 * the queue (see PartFileSourceNames.ts's forgetSourceNames()) - pass the same ECConnection the
 * Downloads instance fed to seed() is built on. `sourceNames` itself doesn't depend on this: it's
 * already resolved-and-accumulated on each DownloadFile by the time seed()/apply() see it (see
 * DownloadFile's class doc), as long as that same connection was passed through to fetch()/the
 * notification's connection in the first place.
 */
export class DownloadTracker {
   private readonly filesByEcid = new Map<bigint, DownloadFile>();

   public constructor(private readonly connection?: ECConnection) {}

   public get files(): readonly DownloadFile[] {
      return [...this.filesByEcid.values()];
   }

   public seed(downloads: Downloads): void {
      const previousEcids = new Set(this.filesByEcid.keys());
      this.filesByEcid.clear();
      for (const file of downloads.files) {
         if (file.ecid === undefined) continue;
         this.filesByEcid.set(file.ecid, file);
         previousEcids.delete(file.ecid);
      }
      if (this.connection) {
         for (const droppedEcid of previousEcids) forgetSourceNames(this.connection, droppedEcid);
      }
   }

   /**
    * Applies a notification packet to the tracked set, returning the
    * resulting DownloadFile (merged with whatever was already known about
    * that file, if anything) if the packet was about a download, undefined
    * otherwise.
    *
    * A removal carries no ECID (see DownloadFile's class doc), so it's
    * matched by hash instead.
    */
   public apply(packet: ECPacket): DownloadFile | undefined {
      const update = Downloads.parseNotification(packet, this.connection);
      if (!update) return undefined;
      if (update.removed) {
         for (const [ecid, file] of this.filesByEcid) {
            if (file.hash === update.hash) {
               this.filesByEcid.delete(ecid);
               if (this.connection) forgetSourceNames(this.connection, ecid);
               break;
            }
         }
         return update;
      }
      if (update.ecid === undefined) return update;
      const merged = this.filesByEcid.get(update.ecid)?.mergedWith(update) ?? update;
      this.filesByEcid.set(update.ecid, merged);
      return merged;
   }
}
