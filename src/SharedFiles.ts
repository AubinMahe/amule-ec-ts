import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECFetchable } from "./ECFetchable.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECDetailLevel } from "./ECDetailLevel.js";
import { ECTag, ECUInt8Tag, ECHash16Tag } from "./ECTags.js";

const debug = debuglog("amule-ec:sharedfiles");

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
   }

   public static fromTag(tag: ECTag): SharedFile {
      const ownHashTag = tag instanceof ECHash16Tag ? tag : undefined;
      const childHashTag = tag.findChild(ECTagNames.EC_TAG_PARTFILE_HASH);
      const hashTag =
         childHashTag instanceof ECHash16Tag ? childHashTag : ownHashTag;
      const removed = tag.children.length === 0 && ownHashTag !== undefined;
      return new SharedFile({
         hash: hashTag ? Buffer.from(hashTag.value).toString("hex") : undefined,
         name: tag.childString(ECTagNames.EC_TAG_PARTFILE_NAME),
         sizeFull: tag.childInt(ECTagNames.EC_TAG_PARTFILE_SIZE_FULL),
         uploadedTotal: tag.childInt(ECTagNames.EC_TAG_KNOWNFILE_XFERRED_ALL),
         uploadSpeed: tag.childInt(ECTagNames.EC_TAG_KNOWNFILE_UPLOAD_SPEED),
         uploadingCount: tag.childInt(
            ECTagNames.EC_TAG_KNOWNFILE_UPLOADING_COUNT,
         ),
         requestsTotal: tag.childInt(ECTagNames.EC_TAG_KNOWNFILE_REQ_COUNT_ALL),
         prio: tag.childInt(ECTagNames.EC_TAG_KNOWNFILE_PRIO),
         removed,
         ecid: removed ? undefined : tag.intValue,
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
      });
   }
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
    * Static, and doesn't touch `connection` - a notification is parsed
    * from a packet the connection already handed us, not fetched.
    */
   public static parseNotification(packet: ECPacket): SharedFile | undefined {
      if (packet.opcode !== ECOpcode.EC_OP_SHARED_FILES) return undefined;
      const tag =
         packet.find(ECTagNames.EC_TAG_KNOWNFILE) ??
         packet.find(ECTagNames.EC_TAG_PARTFILE);
      if (!tag) return undefined;
      const file = SharedFile.fromTag(tag);
      debug("parseNotification: ecid=%s, removed=%s", file.ecid, file.removed);
      return file;
   }

   public async fetch(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_GET_SHARED_FILES);
      request.add(
         new ECUInt8Tag(
            ECTagNames.EC_TAG_DETAIL_LEVEL,
            ECDetailLevel.EC_DETAIL_CMD,
         ),
      );
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_SHARED_FILES) {
         throw new Error(
            `Expected EC_OP_SHARED_FILES, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
      this.files = reply.tags
         .filter((tag) => {
            const name: ECTagNames = tag.name;
            return name === ECTagNames.EC_TAG_KNOWNFILE;
         })
         .map((tag) => SharedFile.fromTag(tag));
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
         throw new Error(
            `Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
      debug("reload: shared file list reloaded");
   }
}

/**
 * Keeps a live view of the shared file list in sync with push
 * notifications, so a progress-only update (see SharedFile's class doc)
 * can still be shown against the file it belongs to instead of
 * "(unknown name)". Mirrors DownloadTracker - see its class doc.
 */
export class SharedFileTracker {

   private readonly filesByEcid = new Map<bigint, SharedFile>();

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
      const update = SharedFiles.parseNotification(packet);
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
      const merged =
         this.filesByEcid.get(update.ecid)?.mergedWith(update) ?? update;
      this.filesByEcid.set(update.ecid, merged);
      return merged;
   }
}
