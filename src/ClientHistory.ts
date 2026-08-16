import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECFetchable } from "./ECFetchable.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECTag, ECHash16Tag } from "./ECTags.js";
import { ipFromTag } from "./Update.js";

const debug = debuglog("amule-ec:clienthistory");

/**
 * One `EC_TAG_CLIENT` entry from an `EC_OP_CLIENT_HISTORY` reply - a peer
 * this daemon has ever exchanged data with, from its persisted credit
 * store, not the currently-connected client list (`Uploads`/`Update`).
 *
 * Confirmed against `Get_EC_Response_ClientHistory`
 * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L1844-L1909): own data
 * is the peer's user hash (`CMD4Hash`, unlike `Uploads`/`Update`'s
 * `EC_TAG_CLIENT`, whose own data is the ECID - a credit record outlives
 * any one connection, so it can't be keyed by a session-scoped ECID).
 * `uploadTotal`/`downloadTotal`/`lastSeen` are always present; every other
 * field is part of a separate metadata trailer only present for a peer
 * seen since that trailer was introduced - older credit records carry
 * none of it, decoded as all-`undefined` here rather than a discriminated
 * shape, since the daemon itself has no cheaper way to signal "no
 * metadata" than the fields' own absence.
 */
export class ClientHistoryEntry {
   /** The peer's ed2k user hash, hex - `EC_TAG_CLIENT`'s own data (see class doc). */
   public readonly hash: string;
   public readonly uploadTotal: bigint | undefined;
   public readonly downloadTotal: bigint | undefined;
   /** Unix timestamp (seconds) of the last time this daemon saw this peer. */
   public readonly lastSeen: bigint | undefined;
   /** Unix timestamp (seconds) of the first time this daemon ever saw this peer - metadata trailer only. */
   public readonly firstSeen: bigint | undefined;
   /** How many times this daemon has seen this peer since - metadata trailer only. */
   public readonly sessions: bigint | undefined;
   /** Last known nickname - metadata trailer only. */
   public readonly name: string | undefined;
   /** Last known address - metadata trailer only. */
   public readonly userIp: string | undefined;
   public readonly userPort: bigint | undefined;
   public readonly kadPort: bigint | undefined;
   /** Raw `EC_TAG_CLIENT_SOFTWARE` code - see `ECClientSoftware` (Uploads.ts) - metadata trailer only. */
   public readonly software: bigint | undefined;
   public readonly softwareVersion: string | undefined;
   /** Raw `EC_TAG_CLIENT_FROM` value - see `ECClientSourceFrom` (Update.ts) - metadata trailer only. */
   public readonly sourceFrom: bigint | undefined;
   public readonly obfuscationStatus: bigint | undefined;
   /** ISO country code, present only when the daemon has GeoIP enabled - metadata trailer only. */
   public readonly country: string | undefined;

   public constructor(tag: ECTag) {
      const hashTag = tag instanceof ECHash16Tag ? tag : undefined;
      this.hash = hashTag ? Buffer.from(hashTag.value).toString("hex") : "";
      this.uploadTotal = tag.childInt(ECTagNames.EC_TAG_CLIENT_UPLOAD_TOTAL);
      this.downloadTotal = tag.childInt(ECTagNames.EC_TAG_CLIENT_DOWNLOAD_TOTAL);
      this.lastSeen = tag.childInt(ECTagNames.EC_TAG_CLIENT_LAST_SEEN);
      this.firstSeen = tag.childInt(ECTagNames.EC_TAG_CLIENT_FIRST_SEEN);
      this.sessions = tag.childInt(ECTagNames.EC_TAG_CLIENT_SESSIONS);
      this.name = tag.childString(ECTagNames.EC_TAG_CLIENT_NAME);
      this.userIp = ipFromTag(tag, ECTagNames.EC_TAG_CLIENT_USER_IP);
      this.userPort = tag.childInt(ECTagNames.EC_TAG_CLIENT_USER_PORT);
      this.kadPort = tag.childInt(ECTagNames.EC_TAG_CLIENT_KAD_PORT);
      this.software = tag.childInt(ECTagNames.EC_TAG_CLIENT_SOFTWARE);
      this.softwareVersion = tag.childString(ECTagNames.EC_TAG_CLIENT_SOFT_VER_STR);
      this.sourceFrom = tag.childInt(ECTagNames.EC_TAG_CLIENT_FROM);
      this.obfuscationStatus = tag.childInt(ECTagNames.EC_TAG_CLIENT_OBFUSCATION_STATUS);
      this.country = tag.childString(ECTagNames.EC_TAG_CLIENT_COUNTRY);
   }
}

/**
 * The daemon's known-clients history (credit store) - `EC_OP_GET_CLIENT_HISTORY`/
 * `EC_OP_CLIENT_HISTORY`. Guarded on `connection.remoteCapabilities.clientHistory`,
 * same "version-compat probe, not a real opt-in" shape as
 * `SharedFiles.getSharedDirs()`/`Search.list()` - see `ECCapabilities.clientHistory`'s
 * doc: a daemon predating this opcode has no case for it and asserts on
 * receiving it.
 */
export class ClientHistory implements ECFetchable {
   public entries: readonly ClientHistoryEntry[] = [];

   public constructor(public readonly connection: ECConnection) {}

   /** Sends EC_OP_GET_CLIENT_HISTORY (no request tags) and replaces `entries` with the whole store. */
   public async fetch(): Promise<void> {
      if (!this.connection.remoteCapabilities.clientHistory) {
         throw new Error(
            "The daemon did not confirm EC_TAG_CAN_CLIENT_HISTORY during authentication - " +
               "it likely predates EC_OP_GET_CLIENT_HISTORY and may not handle it safely.",
         );
      }
      const request = new ECPacket(ECOpcode.EC_OP_GET_CLIENT_HISTORY);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_CLIENT_HISTORY) {
         throw new Error(`Expected EC_OP_CLIENT_HISTORY, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      this.entries = reply.tags
         .filter((tag) => {
            const name: ECTagNames = tag.name;
            return name === ECTagNames.EC_TAG_CLIENT;
         })
         .map((tag) => new ClientHistoryEntry(tag));
      debug("fetch: %d entrie(s)", this.entries.length);
   }
}
