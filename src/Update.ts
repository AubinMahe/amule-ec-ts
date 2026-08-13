import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECDetailLevel } from "./ECDetailLevel.js";
import { ECTag, ECUInt8Tag, ECHash16Tag } from "./ECTags.js";
import { SharedFile } from "./SharedFiles.js";
import { DownloadFile } from "./Downloads.js";
import { ServerPriority } from "./Servers.js";

const debug = debuglog("amule-ec:update");

/**
 * Decodes a raw `EC_TAG_*_IP` uint32 into a dotted-quad string.
 *
 * These fields (`EC_TAG_CLIENT_USER_IP`/`_SERVER_IP`, `EC_TAG_SERVER_IP`,
 * `EC_TAG_FRIEND_IP`) carry the same "anti-host order" 32-bit integer as
 * `CServer`/`CUpDownClient`'s own `GetIP()` - confirmed against
 * `Uint32toStringIP` (https://github.com/amule-org/amule/blob/master/src/NetworkFunctions.h#L36-L39):
 * the least-significant byte is the first octet, unlike `ECIPv4Tag`'s
 * compound `EC_IPv4_t` encoding (used by `Servers.fetch()`'s own top-level
 * tag, which stores octets already in display order and needs no
 * conversion). Not the same convention Kad IPs use elsewhere in the C++
 * tree (`KadIPToString` is a plain big-endian read) - this helper is only
 * valid for ed2k server/client addresses.
 */
function ipFromUint32(value: bigint): string {
   const n = Number(value) >>> 0;
   return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff].join(".");
}

function ipFromTag(tag: ECTag, name: number): string | undefined {
   const value = tag.childInt(name);
   return value === undefined ? undefined : ipFromUint32(value);
}

/**
 * A client's `EC_TAG_CLIENT_FROM` value - where this source was learned
 * from. Confirmed against `ESourceFrom`
 * (https://github.com/amule-org/amule/blob/master/src/Constants.h#L123-L134).
 */
export enum ECClientSourceFrom {
   NONE = 0,
   LOCAL_SERVER = 1,
   REMOTE_SERVER = 2,
   KADEMLIA = 3,
   SOURCE_EXCHANGE = 4,
   PASSIVE = 5,
   LINK = 6,
   SOURCE_SEEDS = 7,
   SEARCH_RESULT = 8,
}

/**
 * A client's `EC_TAG_CLIENT_IDENT_STATE` value - secure-identification
 * status. Confirmed against `EIdentState`
 * (https://github.com/amule-org/amule/blob/master/src/ClientCredits.h#L51-L58).
 */
export enum ECIdentState {
   NOT_AVAILABLE = 0,
   ID_NEEDED = 1,
   IDENTIFIED = 2,
   ID_FAILED = 3,
   ID_BAD_GUY = 4,
}

/**
 * One `EC_TAG_CLIENT` entry from an `EC_OP_GET_UPDATE` reply.
 *
 * A richer, mergeable sibling of `UploadClient` (which models
 * `EC_OP_GET_ULOAD_QUEUE`'s reply): both wrap the same `CEC_UpDownClient_Tag`
 * C++ class, but `GET_UPDATE` uses its `valuemap`-diffing constructor
 * (confirmed against
 * https://github.com/amule-org/amule/blob/master/src/ECSpecialCoreTags.cpp#L343-L397), which may
 * omit any child whose value hasn't changed since this connection's last
 * poll - every field is genuinely optional here, with no placeholder
 * fallback text, so `mergedWith()` can tell "unchanged" from "actually
 * empty". Represents any client the daemon currently tracks (uploading to
 * it, downloading from it, or both) - broader than `UploadClient`'s
 * "currently uploading to me" scope, and does not carry `UploadClient`'s
 * `fileName` (this constructor never adds `EC_TAG_PARTFILE_NAME`).
 */
export class ClientUpdate {
   public readonly ecid: bigint;
   public readonly name: string | undefined;
   public readonly hash: string | undefined;
   public readonly userIdHybrid: bigint | undefined;
   public readonly score: bigint | undefined;
   public readonly software: bigint | undefined;
   public readonly softwareVersion: string | undefined;
   public readonly userIp: string | undefined;
   public readonly userPort: bigint | undefined;
   public readonly country: string | undefined;
   public readonly sourceFrom: ECClientSourceFrom | undefined;
   public readonly serverIp: string | undefined;
   public readonly serverPort: bigint | undefined;
   public readonly serverName: string | undefined;
   public readonly uploadSpeed: bigint | undefined;
   /** Kilobytes/second - the one field on this class transmitted as a DOUBLE, not an integer (`EC_TAG_CLIENT_DOWN_SPEED`). */
   public readonly downloadSpeed: number | undefined;
   public readonly sessionUp: bigint | undefined;
   public readonly transferredDown: bigint | undefined;
   public readonly uploadTotal: bigint | undefined;
   public readonly downloadTotal: bigint | undefined;
   /** Raw `EUploadState` wire value (`Constants.h`'s `US_*`) - not decoded into a named enum here. */
   public readonly uploadState: bigint | undefined;
   /** Raw `EDownloadState` wire value (`Constants.h`'s `DS_*`) - not decoded into a named enum here. */
   public readonly downloadState: bigint | undefined;
   public readonly identState: ECIdentState | undefined;
   public readonly extProtocol: boolean | undefined;
   public readonly waitingPosition: bigint | undefined;
   /** `0xffff` means the remote queue is full rather than a literal rank - confirmed against `IsRemoteQueueFull()`'s use at the encoder (ECSpecialCoreTags.cpp:398-400). */
   public readonly remoteQueueRank: bigint | undefined;

   private constructor(fields: {
      ecid: bigint;
      name: string | undefined;
      hash: string | undefined;
      userIdHybrid: bigint | undefined;
      score: bigint | undefined;
      software: bigint | undefined;
      softwareVersion: string | undefined;
      userIp: string | undefined;
      userPort: bigint | undefined;
      country: string | undefined;
      sourceFrom: ECClientSourceFrom | undefined;
      serverIp: string | undefined;
      serverPort: bigint | undefined;
      serverName: string | undefined;
      uploadSpeed: bigint | undefined;
      downloadSpeed: number | undefined;
      sessionUp: bigint | undefined;
      transferredDown: bigint | undefined;
      uploadTotal: bigint | undefined;
      downloadTotal: bigint | undefined;
      uploadState: bigint | undefined;
      downloadState: bigint | undefined;
      identState: ECIdentState | undefined;
      extProtocol: boolean | undefined;
      waitingPosition: bigint | undefined;
      remoteQueueRank: bigint | undefined;
   }) {
      this.ecid = fields.ecid;
      this.name = fields.name;
      this.hash = fields.hash;
      this.userIdHybrid = fields.userIdHybrid;
      this.score = fields.score;
      this.software = fields.software;
      this.softwareVersion = fields.softwareVersion;
      this.userIp = fields.userIp;
      this.userPort = fields.userPort;
      this.country = fields.country;
      this.sourceFrom = fields.sourceFrom;
      this.serverIp = fields.serverIp;
      this.serverPort = fields.serverPort;
      this.serverName = fields.serverName;
      this.uploadSpeed = fields.uploadSpeed;
      this.downloadSpeed = fields.downloadSpeed;
      this.sessionUp = fields.sessionUp;
      this.transferredDown = fields.transferredDown;
      this.uploadTotal = fields.uploadTotal;
      this.downloadTotal = fields.downloadTotal;
      this.uploadState = fields.uploadState;
      this.downloadState = fields.downloadState;
      this.identState = fields.identState;
      this.extProtocol = fields.extProtocol;
      this.waitingPosition = fields.waitingPosition;
      this.remoteQueueRank = fields.remoteQueueRank;
   }

   public static fromTag(tag: ECTag): ClientUpdate {
      const hashTag = tag.findChild(ECTagNames.EC_TAG_CLIENT_HASH);
      return new ClientUpdate({
         ecid: tag.intValue ?? 0n,
         name: tag.childString(ECTagNames.EC_TAG_CLIENT_NAME),
         hash: hashTag instanceof ECHash16Tag ? Buffer.from(hashTag.value).toString("hex") : undefined,
         userIdHybrid: tag.childInt(ECTagNames.EC_TAG_CLIENT_USER_ID),
         score: tag.childInt(ECTagNames.EC_TAG_CLIENT_SCORE),
         software: tag.childInt(ECTagNames.EC_TAG_CLIENT_SOFTWARE),
         softwareVersion: tag.childString(ECTagNames.EC_TAG_CLIENT_SOFT_VER_STR),
         userIp: ipFromTag(tag, ECTagNames.EC_TAG_CLIENT_USER_IP),
         userPort: tag.childInt(ECTagNames.EC_TAG_CLIENT_USER_PORT),
         country: tag.childString(ECTagNames.EC_TAG_CLIENT_COUNTRY),
         sourceFrom: numberOrUndefined(tag.childInt(ECTagNames.EC_TAG_CLIENT_FROM)),
         serverIp: ipFromTag(tag, ECTagNames.EC_TAG_CLIENT_SERVER_IP),
         serverPort: tag.childInt(ECTagNames.EC_TAG_CLIENT_SERVER_PORT),
         serverName: tag.childString(ECTagNames.EC_TAG_CLIENT_SERVER_NAME),
         uploadSpeed: tag.childInt(ECTagNames.EC_TAG_CLIENT_UP_SPEED),
         downloadSpeed: tag.childDouble(ECTagNames.EC_TAG_CLIENT_DOWN_SPEED),
         sessionUp: tag.childInt(ECTagNames.EC_TAG_CLIENT_UPLOAD_SESSION),
         transferredDown: tag.childInt(ECTagNames.EC_TAG_PARTFILE_SIZE_XFER),
         uploadTotal: tag.childInt(ECTagNames.EC_TAG_CLIENT_UPLOAD_TOTAL),
         downloadTotal: tag.childInt(ECTagNames.EC_TAG_CLIENT_DOWNLOAD_TOTAL),
         uploadState: tag.childInt(ECTagNames.EC_TAG_CLIENT_UPLOAD_STATE),
         downloadState: tag.childInt(ECTagNames.EC_TAG_CLIENT_DOWNLOAD_STATE),
         identState: numberOrUndefined(tag.childInt(ECTagNames.EC_TAG_CLIENT_IDENT_STATE)),
         extProtocol: boolOrUndefined(tag.childInt(ECTagNames.EC_TAG_CLIENT_EXT_PROTOCOL)),
         waitingPosition: tag.childInt(ECTagNames.EC_TAG_CLIENT_WAITING_POSITION),
         remoteQueueRank: tag.childInt(ECTagNames.EC_TAG_CLIENT_REMOTE_QUEUE_RANK),
      });
   }

   /** Fills in whatever `this` has that `update` doesn't (see class doc on why an update can be partial). */
   public mergedWith(update: ClientUpdate): ClientUpdate {
      return new ClientUpdate({
         ecid: update.ecid,
         name: update.name ?? this.name,
         hash: update.hash ?? this.hash,
         userIdHybrid: update.userIdHybrid ?? this.userIdHybrid,
         score: update.score ?? this.score,
         software: update.software ?? this.software,
         softwareVersion: update.softwareVersion ?? this.softwareVersion,
         userIp: update.userIp ?? this.userIp,
         userPort: update.userPort ?? this.userPort,
         country: update.country ?? this.country,
         sourceFrom: update.sourceFrom ?? this.sourceFrom,
         serverIp: update.serverIp ?? this.serverIp,
         serverPort: update.serverPort ?? this.serverPort,
         serverName: update.serverName ?? this.serverName,
         uploadSpeed: update.uploadSpeed ?? this.uploadSpeed,
         downloadSpeed: update.downloadSpeed ?? this.downloadSpeed,
         sessionUp: update.sessionUp ?? this.sessionUp,
         transferredDown: update.transferredDown ?? this.transferredDown,
         uploadTotal: update.uploadTotal ?? this.uploadTotal,
         downloadTotal: update.downloadTotal ?? this.downloadTotal,
         uploadState: update.uploadState ?? this.uploadState,
         downloadState: update.downloadState ?? this.downloadState,
         identState: update.identState ?? this.identState,
         extProtocol: update.extProtocol ?? this.extProtocol,
         waitingPosition: update.waitingPosition ?? this.waitingPosition,
         remoteQueueRank: update.remoteQueueRank ?? this.remoteQueueRank,
      });
   }
}

function numberOrUndefined(value: bigint | undefined): number | undefined {
   return value === undefined ? undefined : Number(value);
}

function boolOrUndefined(value: bigint | undefined): boolean | undefined {
   return value === undefined ? undefined : value !== 0n;
}

/**
 * One `EC_TAG_SERVER` entry from an `EC_OP_GET_UPDATE` reply.
 *
 * A richer, mergeable sibling of `ServerInfo` (which models
 * `EC_OP_GET_SERVER_LIST`'s reply): both wrap `CEC_Server_Tag`, but
 * `GET_UPDATE` uses the `valuemap`-diffing constructor
 * (https://github.com/amule-org/amule/blob/master/src/ECSpecialCoreTags.cpp#L115-L136), which has
 * a different own-tag-value (the server's ECID, not an `EC_IPv4_t`) and
 * carries `ip`/`port` as ordinary optional children instead - so this is a
 * distinct class rather than an extension of `ServerInfo`, keyed by ECID
 * instead of `ip:port`.
 */
export class ServerUpdate {
   public readonly ecid: bigint;
   public readonly name: string | undefined;
   public readonly description: string | undefined;
   public readonly version: string | undefined;
   public readonly ip: string | undefined;
   public readonly port: bigint | undefined;
   public readonly ping: bigint | undefined;
   public readonly priority: ServerPriority | undefined;
   public readonly failedCount: bigint | undefined;
   public readonly isStatic: boolean | undefined;
   public readonly users: bigint | undefined;
   public readonly usersMax: bigint | undefined;
   public readonly files: bigint | undefined;
   public readonly country: string | undefined;

   private constructor(fields: {
      ecid: bigint;
      name: string | undefined;
      description: string | undefined;
      version: string | undefined;
      ip: string | undefined;
      port: bigint | undefined;
      ping: bigint | undefined;
      priority: ServerPriority | undefined;
      failedCount: bigint | undefined;
      isStatic: boolean | undefined;
      users: bigint | undefined;
      usersMax: bigint | undefined;
      files: bigint | undefined;
      country: string | undefined;
   }) {
      this.ecid = fields.ecid;
      this.name = fields.name;
      this.description = fields.description;
      this.version = fields.version;
      this.ip = fields.ip;
      this.port = fields.port;
      this.ping = fields.ping;
      this.priority = fields.priority;
      this.failedCount = fields.failedCount;
      this.isStatic = fields.isStatic;
      this.users = fields.users;
      this.usersMax = fields.usersMax;
      this.files = fields.files;
      this.country = fields.country;
   }

   public static fromTag(tag: ECTag): ServerUpdate {
      return new ServerUpdate({
         ecid: tag.intValue ?? 0n,
         name: tag.childString(ECTagNames.EC_TAG_SERVER_NAME),
         description: tag.childString(ECTagNames.EC_TAG_SERVER_DESC),
         version: tag.childString(ECTagNames.EC_TAG_SERVER_VERSION),
         ip: ipFromTag(tag, ECTagNames.EC_TAG_SERVER_IP),
         port: tag.childInt(ECTagNames.EC_TAG_SERVER_PORT),
         ping: tag.childInt(ECTagNames.EC_TAG_SERVER_PING),
         priority: numberOrUndefined(tag.childInt(ECTagNames.EC_TAG_SERVER_PRIO)),
         failedCount: tag.childInt(ECTagNames.EC_TAG_SERVER_FAILED),
         isStatic: boolOrUndefined(tag.childInt(ECTagNames.EC_TAG_SERVER_STATIC)),
         users: tag.childInt(ECTagNames.EC_TAG_SERVER_USERS),
         usersMax: tag.childInt(ECTagNames.EC_TAG_SERVER_USERS_MAX),
         files: tag.childInt(ECTagNames.EC_TAG_SERVER_FILES),
         country: tag.childString(ECTagNames.EC_TAG_SERVER_COUNTRY),
      });
   }

   /** Fills in whatever `this` has that `update` doesn't (see class doc on why an update can be partial). */
   public mergedWith(update: ServerUpdate): ServerUpdate {
      return new ServerUpdate({
         ecid: update.ecid,
         name: update.name ?? this.name,
         description: update.description ?? this.description,
         version: update.version ?? this.version,
         ip: update.ip ?? this.ip,
         port: update.port ?? this.port,
         ping: update.ping ?? this.ping,
         priority: update.priority ?? this.priority,
         failedCount: update.failedCount ?? this.failedCount,
         isStatic: update.isStatic ?? this.isStatic,
         users: update.users ?? this.users,
         usersMax: update.usersMax ?? this.usersMax,
         files: update.files ?? this.files,
         country: update.country ?? this.country,
      });
   }
}

/**
 * One `EC_TAG_FRIEND` entry from an `EC_OP_GET_UPDATE` reply - the only
 * way to list the daemon's known friends over EC (there is no dedicated
 * `GET_FRIEND_LIST` opcode; `Friends.ts` only covers the `add`/`remove`/
 * `slot` mutations). Confirmed against `CEC_Friend_Tag`
 * (https://github.com/amule-org/amule/blob/master/src/ECSpecialCoreTags.cpp#L568-L577).
 * `linkedClientEcid` is `0n` when this friend isn't currently connected
 * (`linkedClient.IsLinked() ? linkedClient.ECID() : 0`), never `undefined`
 * for that reason - `undefined` here means genuinely omitted (unchanged
 * since the last poll), not "offline".
 */
export class FriendInfo {
   public readonly ecid: bigint;
   public readonly name: string | undefined;
   public readonly hash: string | undefined;
   public readonly ip: string | undefined;
   public readonly port: bigint | undefined;
   public readonly linkedClientEcid: bigint | undefined;

   private constructor(fields: {
      ecid: bigint;
      name: string | undefined;
      hash: string | undefined;
      ip: string | undefined;
      port: bigint | undefined;
      linkedClientEcid: bigint | undefined;
   }) {
      this.ecid = fields.ecid;
      this.name = fields.name;
      this.hash = fields.hash;
      this.ip = fields.ip;
      this.port = fields.port;
      this.linkedClientEcid = fields.linkedClientEcid;
   }

   public static fromTag(tag: ECTag): FriendInfo {
      const hashTag = tag.findChild(ECTagNames.EC_TAG_FRIEND_HASH);
      return new FriendInfo({
         ecid: tag.intValue ?? 0n,
         name: tag.childString(ECTagNames.EC_TAG_FRIEND_NAME),
         hash: hashTag instanceof ECHash16Tag ? Buffer.from(hashTag.value).toString("hex") : undefined,
         ip: ipFromTag(tag, ECTagNames.EC_TAG_FRIEND_IP),
         port: tag.childInt(ECTagNames.EC_TAG_FRIEND_PORT),
         linkedClientEcid: tag.childInt(ECTagNames.EC_TAG_FRIEND_CLIENT),
      });
   }

   /** Fills in whatever `this` has that `update` doesn't (see class doc on why an update can be partial). */
   public mergedWith(update: FriendInfo): FriendInfo {
      return new FriendInfo({
         ecid: update.ecid,
         name: update.name ?? this.name,
         hash: update.hash ?? this.hash,
         ip: update.ip ?? this.ip,
         port: update.port ?? this.port,
         linkedClientEcid: update.linkedClientEcid ?? this.linkedClientEcid,
      });
   }
}

/**
 * The combined incremental-update feed used by amuleGUI -
 * `EC_OP_GET_UPDATE`. One poll refreshes four independent groups at once
 * (shared files, downloads, clients, servers) plus the friend list - the
 * protocol has no way to request a subset, unlike `Preferences`'
 * section-selectable `GET_PREFERENCES`.
 *
 * Two protocol quirks to know before using this class:
 *  - The request MUST carry `EC_TAG_DETAIL_LEVEL = EC_DETAIL_INC_UPDATE`.
 *    Anything else (including omitting the tag, which defaults to
 *    `EC_DETAIL_FULL`) makes the daemon's `EC_OP_GET_UPDATE` case leave its
 *    response unset, which then falls into `ExternalConn.cpp`'s generic
 *    "invalid opcode" handler - the same `wxFAIL` + `EC_OP_FAILED` path an
 *    actually-unknown opcode gets
 *    (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3466-L3474,4047-4054).
 *    `fetch()` always sends it - this is called out because it is easy to
 *    get wrong by analogy with every other `GET_*` opcode, where omitting
 *    the detail level just means "give me the default".
 *  - Like `GET_PREFERENCES`, the reply's own opcode is `EC_OP_SHARED_FILES`,
 *    not `EC_OP_GET_UPDATE`
 *    (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L1792-L1798) - the same
 *    opcode `Get_EC_Response_GetSharedFiles` uses for `GET_SHARED_FILES`
 *    itself. Since EC has no request/reply correlation ID, only the fact
 *    that this is a synchronous reply to the request just sent identifies
 *    it.
 *
 * This class only works once `EC_TAG_CAN_PARTIAL_UPDATE` has been
 * negotiated (`connection.remoteCapabilities.partialUpdate`) - `fetch()`
 * throws synchronously otherwise, the same guard shape
 * `SharedFiles.getSharedDirs()` uses for its own capability. This
 * library never advertises anything else, so an older daemon (pre-#727)
 * would fall back to alive-marker/absence-implies-deletion semantics this
 * class does not implement - there would be no reliable way to tell "no
 * change" from "just deleted" for an unmodified file without it.
 *
 * Every entry in every group may be partial - the daemon skips any field
 * unchanged since this connection's own last `EC_OP_GET_UPDATE` poll, not
 * merely since the object was created - so `fetch()` merges into the
 * previous snapshot (via each entry type's own `mergedWith()`) rather than
 * replacing it outright. Call `fetch()` repeatedly on one instance to
 * build up a live mirror; a fresh `Update` starts with empty groups and
 * only sees whatever the first poll happens to include.
 */
export class Update {
   private readonly sharedFilesByEcid = new Map<bigint, SharedFile>();
   private readonly downloadsByEcid = new Map<bigint, DownloadFile>();
   private readonly clientsByEcid = new Map<bigint, ClientUpdate>();
   private readonly serversByEcid = new Map<bigint, ServerUpdate>();
   private readonly friendsByEcid = new Map<bigint, FriendInfo>();

   public get sharedFiles(): readonly SharedFile[] {
      return [...this.sharedFilesByEcid.values()];
   }

   public get downloads(): readonly DownloadFile[] {
      return [...this.downloadsByEcid.values()];
   }

   public get clients(): readonly ClientUpdate[] {
      return [...this.clientsByEcid.values()];
   }

   public get servers(): readonly ServerUpdate[] {
      return [...this.serversByEcid.values()];
   }

   public get friends(): readonly FriendInfo[] {
      return [...this.friendsByEcid.values()];
   }

   public constructor(public readonly connection: ECConnection) {}

   public async fetch(): Promise<void> {
      if (!this.connection.remoteCapabilities.partialUpdate) {
         throw new Error("Daemon did not confirm EC_TAG_CAN_PARTIAL_UPDATE; Update.fetch() requires it.");
      }
      const request = new ECPacket(ECOpcode.EC_OP_GET_UPDATE);
      request.add(new ECUInt8Tag(ECTagNames.EC_TAG_DETAIL_LEVEL, ECDetailLevel.EC_DETAIL_INC_UPDATE));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_SHARED_FILES) {
         throw new Error(`Expected EC_OP_SHARED_FILES, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      for (const tag of reply.tags) {
         this.applyTopLevelTag(tag);
      }
      debug(
         "fetch: %d shared file(s), %d download(s), %d client(s), %d server(s), %d friend(s)",
         this.sharedFilesByEcid.size,
         this.downloadsByEcid.size,
         this.clientsByEcid.size,
         this.serversByEcid.size,
         this.friendsByEcid.size,
      );
   }

   private applyTopLevelTag(tag: ECTag): void {
      const name: ECTagNames = tag.name;
      switch (name) {
         case ECTagNames.EC_TAG_KNOWNFILE:
            this.mergeInto(this.sharedFilesByEcid, SharedFile.fromTag(tag));
            break;
         case ECTagNames.EC_TAG_PARTFILE:
            this.mergeInto(this.downloadsByEcid, DownloadFile.fromTag(tag));
            break;
         case ECTagNames.EC_TAG_FILE_REMOVED: {
            const ecid = tag.intValue;
            if (ecid !== undefined) {
               this.sharedFilesByEcid.delete(ecid);
               this.downloadsByEcid.delete(ecid);
            }
            break;
         }
         case ECTagNames.EC_TAG_CLIENT:
            for (const child of tag.children) {
               this.mergeInto(this.clientsByEcid, ClientUpdate.fromTag(child));
            }
            break;
         case ECTagNames.EC_TAG_SERVER:
            for (const child of tag.children) {
               this.mergeInto(this.serversByEcid, ServerUpdate.fromTag(child));
            }
            break;
         case ECTagNames.EC_TAG_FRIEND:
            for (const child of tag.children) {
               this.mergeInto(this.friendsByEcid, FriendInfo.fromTag(child));
            }
            break;
         default:
            break;
      }
   }

   private mergeInto<T extends { ecid: bigint | undefined; mergedWith(update: T): T }>(map: Map<bigint, T>, update: T): void {
      if (update.ecid === undefined) return;
      const merged = map.get(update.ecid)?.mergedWith(update) ?? update;
      map.set(update.ecid, merged);
   }
}
