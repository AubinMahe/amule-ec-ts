import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECFetchable } from "./ECFetchable.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECDetailLevel } from "./ECDetailLevel.js";
import { ECTag, ECUInt8Tag, ECHash16Tag, ECStringTag } from "./ECTags.js";
import type { ECDownloadPriority } from "./Downloads.js";
import { resolveSourceNames } from "./PartFileSourceNames.js";
import { resolveGaps, resolveRequestedRanges, resolvePartAvailability } from "./PartFileStatus.js";

const debug = debuglog("amule-ec:sharedfiles");

/**
 * A shared file's EC_TAG_KNOWNFILE_RATING scale - confirmed against the
 * GUI's own rating dropdown
 * (https://github.com/amule-org/amule/blob/master/src/muuli_wdr.cpp#L790-L798):
 * "Not rated", "Invalid / Corrupt / Fake", "Poor", "Fair", "Good", "Excellent".
 */
export enum FileRating {
   NOT_RATED = 0,
   INVALID = 1,
   POOR = 2,
   FAIR = 3,
   GOOD = 4,
   EXCELLENT = 5,
}

/**
 * One community rating/comment entry - `SFileRating`
 * (https://github.com/amule-org/amule/blob/master/src/KnownFile.h#L65-L77):
 * sourced either from a connected ed2k source's own comment (downloads
 * only) or from a Kad NOTES lookup kicked off by
 * `SharedFiles.searchKadNotes()` (any file type).
 */
export class FileComment {
   public constructor(
      public readonly userName: string,
      public readonly fileName: string,
      public readonly rating: FileRating,
      public readonly comment: string,
   ) {}
}

/**
 * Decodes an `EC_TAG_PARTFILE_COMMENTS` container child off `fileTag`
 * (a `SharedFile`/`DownloadFile`/`SearchResult`'s own tag) into
 * `FileComment` entries.
 *
 * Confirmed against `ECSpecialCoreTags.cpp`'s `CEC_SharedFile_Tag`/
 * `CEC_SearchFile_Tag` constructors: the container's children are a flat,
 * repeating group of 4 - userName/fileName/rating/comment - "evaluated by
 * index, not by name" (there is no way to tell entries apart by tag name,
 * all 4 children of one entry share the same `EC_TAG_PARTFILE_COMMENTS`
 * name as the container itself). Returns undefined if `fileTag` carries
 * no such container at all - see FileComment callers for what that means
 * on each of the three file types.
 */
export function parseFileComments(fileTag: ECTag): readonly FileComment[] | undefined {
   const container = fileTag.findChild(ECTagNames.EC_TAG_PARTFILE_COMMENTS);
   if (!container) return undefined;
   const comments: FileComment[] = [];
   for (let i = 0; i + 3 < container.children.length; i += 4) {
      const userName = container.children[i];
      const fileName = container.children[i + 1];
      const rating = container.children[i + 2];
      const comment = container.children[i + 3];
      comments.push(
         new FileComment(
            userName instanceof ECStringTag ? userName.value : "",
            fileName instanceof ECStringTag ? fileName.value : "",
            Number(rating?.intValue ?? 0n),
            comment instanceof ECStringTag ? comment.value : "",
         ),
      );
   }
   return comments;
}

/**
 * Decodes `EC_TAG_PARTFILE_KAD_COMMENT_SEARCHING` off `fileTag` -
 * undefined if absent (see parseFileComments' callers for what that
 * means on each of the three file types), otherwise whether a
 * `searchKadNotes()` lookup is currently in flight for this file.
 */
export function parseKadCommentSearching(fileTag: ECTag): boolean | undefined {
   const value = fileTag.childInt(ECTagNames.EC_TAG_PARTFILE_KAD_COMMENT_SEARCHING);
   return value === undefined ? undefined : value !== 0n;
}

/**
 * A file's probed audio/video metadata - `EC_TAG_KNOWNFILE_MEDIA_*`
 * children, shared by downloads, shared files and search results (issues
 * #418/#430) - confirmed against `ECSpecialCoreTags.cpp`'s
 * `CEC_SharedFile_Tag`/`CEC_SearchFile_Tag` constructors: emitted only
 * once the file has been probed locally, so non-media/unprobed files
 * carry none of these tags at all.
 */
export class MediaMetadata {
   public constructor(
      /** Duration in seconds. */
      public readonly length: bigint | undefined,
      /** Bitrate in kbps. */
      public readonly bitrate: bigint | undefined,
      public readonly codec: string | undefined,
      public readonly artist: string | undefined,
      public readonly album: string | undefined,
      public readonly title: string | undefined,
   ) {}
}

/** Decodes `EC_TAG_KNOWNFILE_MEDIA_*` children off `fileTag` - undefined if none are present (see MediaMetadata's doc). */
export function parseMediaMetadata(fileTag: ECTag): MediaMetadata | undefined {
   const length = fileTag.childInt(ECTagNames.EC_TAG_KNOWNFILE_MEDIA_LENGTH);
   const bitrate = fileTag.childInt(ECTagNames.EC_TAG_KNOWNFILE_MEDIA_BITRATE);
   const codec = fileTag.childString(ECTagNames.EC_TAG_KNOWNFILE_MEDIA_CODEC);
   const artist = fileTag.childString(ECTagNames.EC_TAG_KNOWNFILE_MEDIA_ARTIST);
   const album = fileTag.childString(ECTagNames.EC_TAG_KNOWNFILE_MEDIA_ALBUM);
   const title = fileTag.childString(ECTagNames.EC_TAG_KNOWNFILE_MEDIA_TITLE);
   if (
      length === undefined &&
      bitrate === undefined &&
      codec === undefined &&
      artist === undefined &&
      album === undefined &&
      title === undefined
   ) {
      return undefined;
   }
   return new MediaMetadata(length, bitrate, codec, artist, album, title);
}

/**
 * One EC_TAG_KNOWNFILE entry from an EC_OP_SHARED_FILES reply or
 * notification.
 *
 * Confirmed against
 * https://github.com/amule-org/amule/blob/master/src/ECSpecialCoreTags.cpp#L223-L300
 * (CEC_SharedFile_Tag - the base class CEC_PartFile_Tag also builds on, see
 * DownloadFile's class doc for the parallel): own data is the file's
 * internal ECID, not its hash; name/hash/size are only added when
 * detail_level isn't EC_DETAIL_UPDATE, so - exactly like downloads - a
 * "dirty" progress push for an already-known shared file omits them.
 * SharedFileTracker exists for the same reason as DownloadTracker.
 *
 * A removal push notification (ECKnownFileMsgSource::GetNextPacket,
 * ExternalConn.cpp:3233-3258) uses the same bare-tag/own-data-is-the-hash
 * shape as a download removal - but confusingly its tag NAME is
 * EC_TAG_PARTFILE (`CECTag tag(EC_TAG_PARTFILE, filehash)`, line 3245),
 * not EC_TAG_KNOWNFILE like every add/update. parseNotification() checks
 * for both.
 *
 * A partial file that's also shared is still, on the daemon side, encoded by the very same
 * CPartFile_Encoder its download-queue entry uses (ExternalConn.cpp:355-364), so a response here can
 * legitimately carry that file's EC_TAG_PARTFILE_SOURCE_NAMES delta too - see DownloadFile's class
 * doc. SharedFile doesn't expose that data itself (it's a download's peers, not this file's own
 * upload activity), but fromTag() still folds it into the shared per-connection cache when a
 * connection is given, so Downloads sees it even when a SharedFiles poll is the one that happened to
 * reach the daemon first.
 */
export class SharedFile {
   public readonly hash: string | undefined;
   public readonly name: string | undefined;
   public readonly sizeFull: bigint | undefined;
   public readonly uploadedTotal: bigint | undefined;
   public readonly uploadSpeed: bigint | undefined;
   public readonly uploadingCount: bigint | undefined;
   public readonly requestsTotal: bigint | undefined;
   public readonly prio: bigint | undefined;
   /** True for a removal push notification (see class doc) - every other field is then unavailable. */
   public readonly removed: boolean;
   /** The file's internal ECID - present on every shape except a removal notification (see class doc). */
   public readonly ecid: bigint | undefined;
   /** Community ratings/comments (own source comments + Kad NOTES) - see FileComment/parseFileComments' doc. */
   public readonly comments: readonly FileComment[] | undefined;
   /** Whether a searchKadNotes() lookup is currently in flight for this file - EC_TAG_PARTFILE_KAD_COMMENT_SEARCHING. */
   public readonly kadCommentSearching: boolean | undefined;
   /**
    * The shared directory this file lives in - `EC_TAG_KNOWNFILE_PATH`,
    * confirmed against amule-remote-gui.cpp's `DirectoryPath()` decode
    * (https://github.com/amule-org/amule/blob/master/src/amule-remote-gui.cpp#L2151-L2157).
    * Disambiguates same-named files shared from different directories.
    */
   public readonly path: string | undefined;
   /** "Verify Local Data" hash-check progress - the part currently being hashed (1-based), 0 while idle/done. */
   public readonly hashedPartCount: bigint | undefined;
   /** Unix timestamp (seconds) of the last time this file was uploaded from. */
   public readonly lastUpload: bigint | undefined;
   /** Unix timestamp (seconds) of when this file started being shared. */
   public readonly sharedSince: bigint | undefined;
   /** Probed audio/video metadata, if any - see MediaMetadata's doc. */
   public readonly media: MediaMetadata | undefined;

   private constructor(fields: {
      hash: string | undefined;
      name: string | undefined;
      sizeFull: bigint | undefined;
      uploadedTotal: bigint | undefined;
      uploadSpeed: bigint | undefined;
      uploadingCount: bigint | undefined;
      requestsTotal: bigint | undefined;
      prio: bigint | undefined;
      removed: boolean;
      ecid: bigint | undefined;
      comments: readonly FileComment[] | undefined;
      kadCommentSearching: boolean | undefined;
      path: string | undefined;
      hashedPartCount: bigint | undefined;
      lastUpload: bigint | undefined;
      sharedSince: bigint | undefined;
      media: MediaMetadata | undefined;
   }) {
      this.hash = fields.hash;
      this.name = fields.name;
      this.sizeFull = fields.sizeFull;
      this.uploadedTotal = fields.uploadedTotal;
      this.uploadSpeed = fields.uploadSpeed;
      this.uploadingCount = fields.uploadingCount;
      this.requestsTotal = fields.requestsTotal;
      this.prio = fields.prio;
      this.removed = fields.removed;
      this.ecid = fields.ecid;
      this.comments = fields.comments;
      this.kadCommentSearching = fields.kadCommentSearching;
      this.path = fields.path;
      this.hashedPartCount = fields.hashedPartCount;
      this.lastUpload = fields.lastUpload;
      this.sharedSince = fields.sharedSince;
      this.media = fields.media;
   }

   /**
    * `connection`, when given, lets this file's EC_TAG_PARTFILE_SOURCE_NAMES/_GAP_STATUS/_REQ_STATUS/
    * _PART_STATUS deltas (if any) be folded into the shared per-connection caches Downloads reads
    * from - see class doc. Purely a side effect: SharedFile itself never exposes any of that data.
    * `resetsEncoder` - see DownloadFile.fromTag()'s doc - is true for SharedFiles.fetch() (the daemon
    * resets before encoding at EC_DETAIL_CMD), false otherwise.
    */
   public static fromTag(tag: ECTag, connection?: ECConnection, resetsEncoder = false): SharedFile {
      const ownHashTag = tag instanceof ECHash16Tag ? tag : undefined;
      const childHashTag = tag.findChild(ECTagNames.EC_TAG_PARTFILE_HASH);
      const hashTag = childHashTag instanceof ECHash16Tag ? childHashTag : ownHashTag;
      const removed = tag.children.length === 0 && ownHashTag !== undefined;
      const ecid = removed ? undefined : tag.intValue;
      resolveSourceNames(tag, connection, ecid);
      resolveGaps(tag, connection, ecid, resetsEncoder);
      resolveRequestedRanges(tag, connection, ecid, resetsEncoder);
      resolvePartAvailability(tag, connection, ecid, resetsEncoder);
      return new SharedFile({
         hash: hashTag ? Buffer.from(hashTag.value).toString("hex") : undefined,
         name: tag.childString(ECTagNames.EC_TAG_PARTFILE_NAME),
         sizeFull: tag.childInt(ECTagNames.EC_TAG_PARTFILE_SIZE_FULL),
         uploadedTotal: tag.childInt(ECTagNames.EC_TAG_KNOWNFILE_XFERRED_ALL),
         uploadSpeed: tag.childInt(ECTagNames.EC_TAG_KNOWNFILE_UPLOAD_SPEED),
         uploadingCount: tag.childInt(ECTagNames.EC_TAG_KNOWNFILE_UPLOADING_COUNT),
         requestsTotal: tag.childInt(ECTagNames.EC_TAG_KNOWNFILE_REQ_COUNT_ALL),
         prio: tag.childInt(ECTagNames.EC_TAG_KNOWNFILE_PRIO),
         removed,
         ecid,
         comments: parseFileComments(tag),
         kadCommentSearching: parseKadCommentSearching(tag),
         path: tag.childString(ECTagNames.EC_TAG_KNOWNFILE_PATH),
         hashedPartCount: tag.childInt(ECTagNames.EC_TAG_KNOWNFILE_HASHED_PART_COUNT),
         lastUpload: tag.childInt(ECTagNames.EC_TAG_KNOWNFILE_LAST_UPLOAD),
         sharedSince: tag.childInt(ECTagNames.EC_TAG_KNOWNFILE_SHARED_SINCE),
         media: parseMediaMetadata(tag),
      });
   }

   /** Fills in whatever `this` has that `update` doesn't (see class doc on why an update can be partial). */
   public mergedWith(update: SharedFile): SharedFile {
      return new SharedFile({
         hash: update.hash ?? this.hash,
         name: update.name ?? this.name,
         sizeFull: update.sizeFull ?? this.sizeFull,
         uploadedTotal: update.uploadedTotal ?? this.uploadedTotal,
         uploadSpeed: update.uploadSpeed ?? this.uploadSpeed,
         uploadingCount: update.uploadingCount ?? this.uploadingCount,
         requestsTotal: update.requestsTotal ?? this.requestsTotal,
         prio: update.prio ?? this.prio,
         removed: update.removed,
         ecid: update.ecid ?? this.ecid,
         comments: update.comments ?? this.comments,
         kadCommentSearching: update.kadCommentSearching ?? this.kadCommentSearching,
         path: update.path ?? this.path,
         hashedPartCount: update.hashedPartCount ?? this.hashedPartCount,
         lastUpload: update.lastUpload ?? this.lastUpload,
         sharedSince: update.sharedSince ?? this.sharedSince,
         media: update.media ?? this.media,
      });
   }
}

/**
 * A shared directory root, as returned by EC_OP_GET_SHARED_DIRS or sent to
 * EC_OP_SET_SHARED_DIRS - a path plus whether its entire subtree is shared
 * ("recursive") rather than just its top level. See SharedFiles.getSharedDirs()'s
 * doc for why only these two intent lists travel over EC.
 */
export class SharedDir {
   public constructor(
      public readonly path: string,
      public readonly recursive: boolean,
   ) {}
}

/**
 * The reason SharedFiles.setSharedDirs() rejected one of the given paths -
 * `EC_TAG_SHAREDDIR_ERROR`'s value, confirmed against
 * Get_EC_Response_SetSharedDirs
 * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L1425-L1454).
 */
export enum SharedDirRejectReason {
   MISSING_OR_NOT_A_DIRECTORY = 1,
   UNREADABLE = 2,
}

/** One rejected path from SharedFiles.setSharedDirs()'s reply - see SharedDirRejectReason's doc. */
export class SharedDirRejection {
   public constructor(
      public readonly path: string,
      public readonly reason: SharedDirRejectReason,
   ) {}
}

/** The shared file list, as returned by EC_OP_GET_SHARED_FILES / EC_OP_SHARED_FILES. */
export class SharedFiles implements ECFetchable {
   public files: readonly SharedFile[] = [];

   public constructor(public readonly connection: ECConnection) {}

   /**
    * Interprets a server-pushed notification packet (see ECConnection's
    * "notification" event) as a single shared-file update/removal, or
    * undefined if this packet isn't about the shared file list.
    *
    * Confirmed against ECKnownFileMsgSource::GetNextPacket
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3233-L3258): checks for
    * either EC_TAG_KNOWNFILE (add/update) or EC_TAG_PARTFILE (removal - see
    * class doc) as the top-level tag name.
    *
    * Static - doesn't need its *own* connection, a notification is parsed from a packet the
    * connection already handed us, not fetched. `connection` is still accepted, purely so a partial
    * file's source-names delta can be folded into the shared cache like fromTag()'s - pass the same
    * ECConnection the notification came from.
    */
   public static parseNotification(packet: ECPacket, connection?: ECConnection): SharedFile | undefined {
      if (packet.opcode !== ECOpcode.EC_OP_SHARED_FILES) return undefined;
      const tag = packet.find(ECTagNames.EC_TAG_KNOWNFILE) ?? packet.find(ECTagNames.EC_TAG_PARTFILE);
      if (!tag) return undefined;
      const file = SharedFile.fromTag(tag, connection);
      debug("parseNotification: ecid=%s, removed=%s", file.ecid, file.removed);
      return file;
   }

   public async fetch(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_GET_SHARED_FILES);
      request.add(new ECUInt8Tag(ECTagNames.EC_TAG_DETAIL_LEVEL, ECDetailLevel.EC_DETAIL_CMD));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_SHARED_FILES) {
         throw new Error(`Expected EC_OP_SHARED_FILES, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      this.files = reply.tags
         .filter((tag) => {
            const name: ECTagNames = tag.name;
            return name === ECTagNames.EC_TAG_KNOWNFILE;
         })
         .map((tag) => SharedFile.fromTag(tag, this.connection, true));
      debug("fetch: %d file(s)", this.files.length);
   }

   /**
    * Reloads the shared file list from disk - EC_OP_SHAREDFILES_RELOAD.
    *
    * Confirmed against ExternalConn.cpp:2468-2471: the request carries no
    * tags (`theApp->sharedfiles->Reload()`), the reply is unconditionally
    * EC_OP_NOOP - there is no EC_OP_FAILED case, unlike cancel()/rename() in
    * Downloads.ts.
    */
   public async reload(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_SHAREDFILES_RELOAD);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("reload: shared file list reloaded");
   }

   /**
    * Sets a shared file's upload priority, by hash - EC_OP_SHARED_SET_PRIO.
    *
    * Confirmed against Get_EC_Response_Set_SharedFile_Prio
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L2843-L2865) and
    * amule-remote-gui.cpp's SetFilePrio()
    * (https://github.com/amule-org/amule/blob/master/src/amule-remote-gui.cpp#L1964-L1974):
    * the request's EC_TAG_PARTFILE tag (own data: MD4 hash) carries one
    * EC_TAG_PARTFILE_PRIO child (uint8) - the exact same tag names and
    * wire shape as Downloads.prioritySet(), including PR_AUTO being sent
    * as-is (5), not +10. Always replies EC_OP_NOOP - the daemon silently
    * skips any hash that isn't a currently shared file, no EC_OP_FAILED
    * case exists (unlike Downloads.prioritySet()).
    */
   public async setPriority(hash: string, priority: ECDownloadPriority): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_SHARED_SET_PRIO);
      request.add(
         new ECHash16Tag(ECTagNames.EC_TAG_PARTFILE, new Uint8Array(Buffer.from(hash, "hex")), [
            new ECUInt8Tag(ECTagNames.EC_TAG_PARTFILE_PRIO, priority),
         ]),
      );
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("setPriority: hash=%s, priority=%d", hash, priority);
   }

   /**
    * Sets a comment/rating on one of *this daemon's own* shared files, by
    * hash - EC_OP_SHARED_FILE_SET_COMMENT.
    *
    * Confirmed against ExternalConn.cpp's EC_OP_SHARED_FILE_SET_COMMENT
    * case (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3335-L3345)
    * and amule-remote-gui.cpp's SetFileCommentRating()
    * (https://github.com/amule-org/amule/blob/master/src/amule-remote-gui.cpp#L1786-L1793):
    * the request carries EC_TAG_KNOWNFILE (hash), EC_TAG_KNOWNFILE_COMMENT
    * (string) and EC_TAG_KNOWNFILE_RATING (uint8, see FileRating). Unlike
    * rename()/searchKadNotes(), the daemon looks this hash up in
    * `sharedfiles` only - no downloadqueue/searchlist fallback. Always
    * replies EC_OP_NOOP, silently no-op if the hash isn't a known shared
    * file.
    *
    * Still write-only: confirmed against `CKnownFile::GetFileComment()`/
    * `UserRating()` (`KnownFile.h:191-196`) that the value set here is
    * never referenced anywhere in the EC layer - it doesn't appear in
    * `SharedFile.comments` (that's Kad NOTES + connected-source comments
    * only, see `FileComment`'s doc) or anywhere else. There is no way to
    * read it back over EC, live-tested 2026-08-03.
    */
   public async setComment(hash: string, comment: string, rating: FileRating): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_SHARED_FILE_SET_COMMENT);
      request.add(new ECHash16Tag(ECTagNames.EC_TAG_KNOWNFILE, new Uint8Array(Buffer.from(hash, "hex"))));
      request.add(new ECStringTag(ECTagNames.EC_TAG_KNOWNFILE_COMMENT, comment));
      request.add(new ECUInt8Tag(ECTagNames.EC_TAG_KNOWNFILE_RATING, rating));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("setComment: hash=%s, rating=%s", hash, FileRating[rating]);
   }

   /**
    * Kicks off an async Kad lookup for a file's community notes/comments,
    * by hash - EC_OP_SHARED_FILE_SEARCH_KAD_NOTES.
    *
    * Confirmed against ExternalConn.cpp's EC_OP_SHARED_FILE_SEARCH_KAD_NOTES
    * case (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3356-L3385):
    * the request carries a single EC_TAG_KNOWNFILE (hash) tag; the daemon
    * resolves it against the download queue, then the shared file list,
    * then the current search results (`downloadqueue` → `sharedfiles` →
    * `searchlist`) - unlike setComment(), not shared-files-only. Always
    * replies EC_OP_NOOP - this is fire-and-forget, the retrieved notes
    * aren't carried back over this request. `kadCommentSearching` on the
    * relevant SharedFile/DownloadFile/SearchResult flips true while the
    * lookup is in flight, then false once it settles, with any results
    * appearing in that file's `comments` on the next fetch()/poll.
    */
   public async searchKadNotes(hash: string): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_SHARED_FILE_SEARCH_KAD_NOTES);
      request.add(new ECHash16Tag(ECTagNames.EC_TAG_KNOWNFILE, new Uint8Array(Buffer.from(hash, "hex"))));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("searchKadNotes: hash=%s", hash);
   }

   /**
    * Verifies a shared file's local data against its known hash (a full
    * re-hash/integrity check), by hash - EC_OP_VERIFY_LOCAL_DATA.
    *
    * Confirmed against ExternalConn.cpp's EC_OP_VERIFY_LOCAL_DATA case
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3347-L3354): the
    * request carries a single EC_TAG_KNOWNFILE (hash) tag; the daemon
    * resolves it against `sharedfiles` only - not the download queue like
    * searchKadNotes(), same shared-files-only scope as setComment(). Fire
    * and forget: the verification result isn't carried back over this
    * request. Always replies EC_OP_NOOP, silently no-op if the hash isn't
    * a known shared file.
    */
   public async verifyLocalData(hash: string): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_VERIFY_LOCAL_DATA);
      request.add(new ECHash16Tag(ECTagNames.EC_TAG_KNOWNFILE, new Uint8Array(Buffer.from(hash, "hex"))));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("verifyLocalData: hash=%s", hash);
   }

   /**
    * Requests the daemon's shared-directory configuration -
    * EC_OP_GET_SHARED_DIRS.
    *
    * Confirmed against Get_EC_Response_GetSharedDirs
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L1405-L1418): the reply
    * carries one EC_TAG_SHAREDDIR per configured root (its own data: the
    * path), with an EC_TAG_SHAREDDIR_RECURSIVE child on the roots whose
    * entire subtree is shared. Only these two *intent* lists travel - the
    * daemon's runtime union of explicit+expanded-recursive roots is a
    * derived artifact it regenerates itself, never sent. No request tag
    * needed.
    *
    * Guarded on `connection.remoteCapabilities.sharedDirsConfig`, unlike
    * every other method in this library - live-tested 2026-08-04 against a
    * daemon predating this opcode (aMule 2.3.3): sending EC_OP_GET_SHARED_DIRS
    * unconditionally made it log "opcode reçu invalide: 0x5d" and hit a
    * wxASSERT in ProcessRequest2 (it survived, but see RemoteConnect.cpp's
    * own comment on EC_TAG_CAN_SEARCH_LIST for the same class of daemon:
    * "logs ... and trips an assert"). Throws immediately instead of risking
    * that.
    */
   public async getSharedDirs(): Promise<readonly SharedDir[]> {
      if (!this.connection.remoteCapabilities.sharedDirsConfig) {
         throw new Error(
            "The daemon did not confirm EC_TAG_CAN_SHAREDDIRS_CONFIG during authentication - " +
               "it likely predates EC_OP_GET_SHARED_DIRS and may not handle it safely.",
         );
      }
      const request = new ECPacket(ECOpcode.EC_OP_GET_SHARED_DIRS);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_GET_SHARED_DIRS) {
         throw new Error(`Expected EC_OP_GET_SHARED_DIRS, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      const dirs = reply.tags
         .filter((tag) => {
            const name: ECTagNames = tag.name;
            return name === ECTagNames.EC_TAG_SHAREDDIR;
         })
         .map((tag) => {
            const path = tag instanceof ECStringTag ? tag.value : "";
            const recursive = (tag.childInt(ECTagNames.EC_TAG_SHAREDDIR_RECURSIVE) ?? 0n) !== 0n;
            return new SharedDir(path, recursive);
         });
      debug("getSharedDirs: %d dir(s)", dirs.length);
      return dirs;
   }

   /**
    * Replaces the daemon's shared-directory configuration - EC_OP_SET_SHARED_DIRS.
    *
    * Confirmed against Get_EC_Response_SetSharedDirs
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L1420-L1479): unlike
    * every other opcode in this library, the reply is neither EC_OP_NOOP
    * nor EC_OP_FAILED - it echoes EC_OP_SET_SHARED_DIRS itself, carrying
    * zero or more EC_TAG_SHAREDDIR_REJECTED tags (own data: the rejected
    * path, with an EC_TAG_SHAREDDIR_ERROR child - see SharedDirRejectReason)
    * for whichever entries didn't validate. This is not all-or-nothing:
    * every path that DID validate is applied regardless of the others -
    * the returned array is purely informational, listing what was
    * rejected and why, empty if every path was accepted.
    *
    * Guarded on `connection.remoteCapabilities.sharedDirsConfig` - see
    * getSharedDirs()'s doc for why (live-tested 2026-08-04): unlike a plain
    * read, sending this unsupported would also risk actually mutating the
    * daemon's shared-directory config on a build with partial/differing
    * support, not just tripping an assert.
    */
   public async setSharedDirs(dirs: readonly SharedDir[]): Promise<readonly SharedDirRejection[]> {
      if (!this.connection.remoteCapabilities.sharedDirsConfig) {
         throw new Error(
            "The daemon did not confirm EC_TAG_CAN_SHAREDDIRS_CONFIG during authentication - " +
               "it likely predates EC_OP_SET_SHARED_DIRS and may not handle it safely.",
         );
      }
      const request = new ECPacket(ECOpcode.EC_OP_SET_SHARED_DIRS);
      for (const dir of dirs) {
         request.add(
            new ECStringTag(
               ECTagNames.EC_TAG_SHAREDDIR,
               dir.path,
               dir.recursive ? [new ECUInt8Tag(ECTagNames.EC_TAG_SHAREDDIR_RECURSIVE, 1)] : [],
            ),
         );
      }
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_SET_SHARED_DIRS) {
         throw new Error(`Expected EC_OP_SET_SHARED_DIRS, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      const rejections = reply.tags
         .filter((tag) => {
            const name: ECTagNames = tag.name;
            return name === ECTagNames.EC_TAG_SHAREDDIR_REJECTED;
         })
         .map((tag) => {
            const path = tag instanceof ECStringTag ? tag.value : "";
            const reason: SharedDirRejectReason = Number(tag.childInt(ECTagNames.EC_TAG_SHAREDDIR_ERROR) ?? 0n);
            return new SharedDirRejection(path, reason);
         });
      debug("setSharedDirs: %d dir(s), %d rejected", dirs.length, rejections.length);
      return rejections;
   }
}

/**
 * Keeps a live view of the shared file list in sync with push
 * notifications, so a progress-only update (see SharedFile's class doc)
 * can still be shown against the file it belongs to instead of
 * "(unknown name)". Mirrors DownloadTracker - see its class doc.
 *
 * `connection`, when given, is only forwarded to parseNotification() so a partial-shared file's
 * source-names delta still reaches DownloadTracker's cache from here too (see SharedFile's class
 * doc) - pass the same ECConnection the SharedFiles instance fed to seed() is built on.
 */
export class SharedFileTracker {
   private readonly filesByEcid = new Map<bigint, SharedFile>();

   public constructor(private readonly connection?: ECConnection) {}

   public get files(): readonly SharedFile[] {
      return [...this.filesByEcid.values()];
   }

   public seed(sharedFiles: SharedFiles): void {
      this.filesByEcid.clear();
      for (const file of sharedFiles.files) {
         if (file.ecid !== undefined) this.filesByEcid.set(file.ecid, file);
      }
   }

   public apply(packet: ECPacket): SharedFile | undefined {
      const update = SharedFiles.parseNotification(packet, this.connection);
      if (!update) return undefined;
      if (update.removed) {
         for (const [ecid, file] of this.filesByEcid) {
            if (file.hash === update.hash) {
               this.filesByEcid.delete(ecid);
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
