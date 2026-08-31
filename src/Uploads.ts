import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECFetchable } from "./ECFetchable.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECDetailLevel } from "./ECDetailLevel.js";
import { ECTag, ECUInt8Tag, ECUInt32Tag, ECHash16Tag } from "./ECTags.js";

const debug = debuglog("amule-ec:uploads");

function boolOrUndefined(value: bigint | undefined): boolean | undefined {
   return value === undefined ? undefined : value !== 0n;
}

/**
 * A client's `EC_TAG_CLIENT_SOFTWARE` value - the ed2k protocol's client-software identifier.
 * Confirmed against `EClientSoftware`
 * (https://github.com/amule-org/amule/blob/master/src/include/protocol/ed2k/ClientSoftware.h).
 */
export enum ECClientSoftware {
   SO_EMULE = 0,
   SO_CDONKEY = 1,
   SO_LXMULE = 2,
   SO_AMULE = 3,
   SO_SHAREAZA = 4,
   SO_EMULEPLUS = 5,
   SO_HYDRANODE = 6,
   SO_NEW2_MLDONKEY = 0x0a,
   SO_LPHANT = 0x14,
   SO_NEW2_SHAREAZA = 0x28,
   SO_EDONKEYHYBRID = 0x32,
   SO_EDONKEY = 0x33,
   SO_MLDONKEY = 0x34,
   SO_OLDEMULE = 0x35,
   SO_UNKNOWN = 0x36,
   SO_NEW_SHAREAZA = 0x44,
   SO_NEW_MLDONKEY = 0x98,
   SO_COMPAT_UNK = 0xff,
}

/**
 * One EC_TAG_CLIENT entry from an EC_OP_ULOAD_QUEUE reply.
 *
 * Confirmed against
 * https://github.com/amule-org/amule/blob/master/src/ECSpecialCoreTags.cpp#L327-L397
 * (CEC_UpDownClient_Tag): EC_TAG_CLIENT's own data is the client's internal
 * ECID (`CECTag(EC_TAG_CLIENT, client->ECID())`), not its user hash - the
 * hash and the other properties used below are children, added
 * unconditionally before the `detail_level == EC_DETAIL_UPDATE`
 * early-return, so they are all present at the EC_DETAIL_CMD level
 * requested by Uploads.fetch(). The uploaded file's name (EC_TAG_PARTFILE_NAME)
 * is only added when the client actually has an upload file assigned
 * (`client->GetUploadFile()`); it is left undefined otherwise.
 */
export class UploadClient {
   public readonly hash: string;
   public readonly name: string;
   public readonly software: bigint | undefined;
   /**
    * Version-only string the daemon composes itself (e.g. "v0.50a", never the software name -
    * see `softwareText` for that) - EC_TAG_CLIENT_SOFT_VER_STR, the same source
    * ClientUpdate.softwareVersion (Update.ts) reads for EC_OP_GET_UPDATE.
    */
   public readonly softwareVersion: string | undefined;
   public readonly speedUp: bigint | undefined;
   public readonly sessionUp: bigint | undefined;
   public readonly totalUp: bigint | undefined;
   public readonly uploadState: bigint | undefined;
   public readonly fileName: string | undefined;
   /**
    * The client's internal ECID - EC_TAG_CLIENT's own data (see class doc).
    */
   public readonly ecid: bigint | undefined;
   /**
    * The uploaded file's own internal ECID - EC_TAG_CLIENT_UPLOAD_FILE's own data, `0n` when the
    * client has no upload file assigned (`client->GetUploadFile()` is null). Confirmed against
    * `ECSpecialCoreTags.cpp:435-439`: unlike `hash` (the client's user hash), the file itself is
    * only ever identified here by ECID, not by hash - correlate against `SharedFile.ecid`
    * (`SharedFiles.files`) to resolve the hash needed by `SharedFiles.searchKadNotes()`.
    */
   public readonly uploadFileEcid: bigint | undefined;
   /**
    * Whether this client holds the upload slot reserved for a friend - `EC_TAG_CLIENT_FRIEND_SLOT`
    * (`client->GetFriendSlot()`), distinct from friends-list membership
    * (`EC_TAG_CLIENT_IS_FRIEND`, decoded as `ClientUpdate.isFriend` in `Update.ts`, not exposed
    * here). Confirmed against `CEC_UpDownClient_Tag` in `ECSpecialCoreTags.cpp`: added
    * unconditionally, alongside every other field read below, so it's present at the same
    * `EC_DETAIL_CMD` level `Uploads.fetch()` already requests.
    */
   public readonly friendSlot: boolean | undefined;

   public constructor(tag: ECTag) {
      const hashTag = tag.findChild(ECTagNames.EC_TAG_CLIENT_HASH);
      this.hash = hashTag instanceof ECHash16Tag ? Buffer.from(hashTag.value).toString("hex") : "(unknown hash)";
      this.name = tag.childString(ECTagNames.EC_TAG_CLIENT_NAME) ?? "(unknown name)";
      this.software = tag.childInt(ECTagNames.EC_TAG_CLIENT_SOFTWARE);
      this.softwareVersion = tag.childString(ECTagNames.EC_TAG_CLIENT_SOFT_VER_STR);
      this.speedUp = tag.childInt(ECTagNames.EC_TAG_CLIENT_UP_SPEED);
      this.sessionUp = tag.childInt(ECTagNames.EC_TAG_CLIENT_UPLOAD_SESSION);
      this.totalUp = tag.childInt(ECTagNames.EC_TAG_CLIENT_UPLOAD_TOTAL);
      this.uploadState = tag.childInt(ECTagNames.EC_TAG_CLIENT_UPLOAD_STATE);
      this.fileName = tag.childString(ECTagNames.EC_TAG_PARTFILE_NAME);
      this.ecid = tag.intValue;
      this.uploadFileEcid = tag.childInt(ECTagNames.EC_TAG_CLIENT_UPLOAD_FILE);
      this.friendSlot = boolOrUndefined(tag.childInt(ECTagNames.EC_TAG_CLIENT_FRIEND_SLOT));
   }

   /**
    * Human-readable software name, mirroring `GetSoftName()`
    * (https://github.com/amule-org/amule/blob/master/src/DataToText.cpp#L104-L142). Unlike
    * `softwareVersion` (the version-only EC_TAG_CLIENT_SOFT_VER_STR string, e.g. "v0.50a"), the
    * daemon never sends this name as text over EC - only the raw `software` code - so it is
    * decoded client-side from `ECClientSoftware`.
    */
   public get softwareText(): string {
      if (this.software === undefined) {
         return "Unknown";
      }
      const software: ECClientSoftware = Number(this.software);
      switch (software) {
         case ECClientSoftware.SO_OLDEMULE:
         case ECClientSoftware.SO_EMULE:
            return "eMule";
         case ECClientSoftware.SO_CDONKEY:
            return "cDonkey";
         case ECClientSoftware.SO_LXMULE:
            return "(l/x)Mule";
         case ECClientSoftware.SO_AMULE:
            return "aMule";
         case ECClientSoftware.SO_SHAREAZA:
         case ECClientSoftware.SO_NEW_SHAREAZA:
         case ECClientSoftware.SO_NEW2_SHAREAZA:
            return "Shareaza";
         case ECClientSoftware.SO_EMULEPLUS:
            return "eMule+";
         case ECClientSoftware.SO_HYDRANODE:
            return "HydraNode";
         case ECClientSoftware.SO_MLDONKEY:
            return "Old MLDonkey";
         case ECClientSoftware.SO_NEW_MLDONKEY:
         case ECClientSoftware.SO_NEW2_MLDONKEY:
            return "New MLDonkey";
         case ECClientSoftware.SO_LPHANT:
            return "lphant";
         case ECClientSoftware.SO_EDONKEYHYBRID:
            return "eDonkeyHybrid";
         case ECClientSoftware.SO_EDONKEY:
            return "eDonkey";
         case ECClientSoftware.SO_UNKNOWN:
            return "Unknown";
         case ECClientSoftware.SO_COMPAT_UNK:
            return "eMule Compatible";
         default:
            return "";
      }
   }
}

/**
 * The upload queue, as returned by EC_OP_GET_ULOAD_QUEUE / EC_OP_ULOAD_QUEUE.
 */
export class Uploads implements ECFetchable {
   public clients: readonly UploadClient[] = [];

   public constructor(public readonly connection: ECConnection) {}

   public async fetch(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_GET_ULOAD_QUEUE);
      request.add(new ECUInt8Tag(ECTagNames.EC_TAG_DETAIL_LEVEL, ECDetailLevel.EC_DETAIL_CMD));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_ULOAD_QUEUE) {
         throw new Error(`Expected EC_OP_ULOAD_QUEUE, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      this.clients = reply.tags
         .filter((tag) => {
            const name: ECTagNames = tag.name;
            return name === ECTagNames.EC_TAG_CLIENT;
         })
         .map((tag) => new UploadClient(tag));
      debug("fetch: %d client(s)", this.clients.length);
   }

   /**
    * Moves an uploading client to another of the daemon's downloads -
    * EC_OP_CLIENT_SWAP_TO_ANOTHER_FILE.
    *
    * Confirmed against ExternalConn.cpp's EC_OP_CLIENT_SWAP_TO_ANOTHER_FILE
    * case (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3324-L3333): the
    * request carries two top-level tags, EC_TAG_CLIENT (the client's ECID,
    * plain uint32 - same tag name UploadClient.ecid reads, but as its own
    * data here rather than a child) and EC_TAG_PARTFILE (the target
    * download's MD4 hash, own data - same shape Downloads' PARTFILE_*
    * commands use). Silently no-ops if either doesn't resolve; always
    * replies EC_OP_NOOP.
    */
   public async swapClientToAnotherFile(clientEcid: bigint, fileHash: string): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_CLIENT_SWAP_TO_ANOTHER_FILE);
      request.add(new ECUInt32Tag(ECTagNames.EC_TAG_CLIENT, Number(clientEcid)));
      request.add(new ECHash16Tag(ECTagNames.EC_TAG_PARTFILE, new Uint8Array(Buffer.from(fileHash, "hex"))));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_NOOP) {
         throw new Error(`Expected EC_OP_NOOP, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("swapClientToAnotherFile: clientEcid=%s, fileHash=%s", clientEcid, fileHash);
   }
}
