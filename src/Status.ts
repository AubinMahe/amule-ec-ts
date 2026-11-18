import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECFetchable } from "./ECFetchable.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECDetailLevel } from "./ECDetailLevel.js";
import { ECTag, ECUInt8Tag, ECIPv4Tag } from "./ECTags.js";

const debug = debuglog("amule-ec:status");

/**
 * IDs at/above this threshold are eD2k "High ID" (reachable directly); below it, "Low ID" (behind a firewall/NAT). Confirmed against https://github.com/amule-org/amule/blob/master/src/NetworkFunctions.h#L122.
 */
const HIGHEST_LOWID_ED2K_KAD = 16_777_216n;

/**
 * Live snapshot of the daemon's status, combining two distinct EC
 * exchanges:
 *  - EC_OP_STAT_REQ / EC_OP_STATS: transfer rates and network-wide counts.
 *    Confirmed against Get_EC_Response_StatRequest
 *    (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L839, EC_DETAIL_CMD
 *    case at line 871): the EC_TAG_STATS_* tags sit directly at the
 *    packet's top level (no wrapper tag, unlike EC_TAG_PARTFILE).
 *  - EC_OP_GET_CONNSTATE / EC_OP_MISC_DATA: connection state, current
 *    server, and ID. Confirmed against the EC_OP_GET_CONNSTATE case
 *    (ExternalConn.cpp:2364) and CEC_ConnState_Tag
 *    (ECSpecialCoreTags.cpp:140): a single EC_TAG_CONNSTATE tag whose own
 *    data is a bitmask (0x01 ED2K connected, 0x02 ED2K connecting, 0x04 Kad
 *    connected, 0x08 Kad firewalled, 0x10 Kad running), with EC_TAG_ED2K_ID
 *    and EC_TAG_SERVER (itself carrying EC_TAG_SERVER_NAME at EC_DETAIL_CMD,
 *    per CEC_Server_Tag's constructor at ECSpecialCoreTags.cpp:98) as
 *    children.
 *
 * fetch() issues both requests and merges them into this instance. The
 * connection-status-changed push notification (ECStatusMsgSource::
 * GetNextPacket, ExternalConn.cpp:3102) reuses the EC_OP_STATS opcode but
 * carries only an EC_TAG_CONNSTATE tag, built at EC_DETAIL_UPDATE - one
 * level below EC_DETAIL_CMD, so its EC_TAG_SERVER child (if any) stops at
 * ping/failed-count and never includes the server name (see
 * CEC_Server_Tag's switch, ECSpecialCoreTags.cpp:56-97). applyNotification()
 * only ever touches the connState-derived fields for that reason - it
 * leaves whatever fetch() last found for uploadSpeed/downloadSpeed/etc.
 * (and serverName) alone rather than blanking them out.
 */
export class Status implements ECFetchable {
   public uploadSpeed: bigint | undefined;
   public downloadSpeed: bigint | undefined;
   public uploadSpeedLimit: bigint | undefined;
   public downloadSpeedLimit: bigint | undefined;
   public uploadQueueLength: bigint | undefined;
   public totalSourceCount: bigint | undefined;
   public ed2kUsers: bigint | undefined;
   public kadUsers: bigint | undefined;
   public ed2kFiles: bigint | undefined;
   public kadFiles: bigint | undefined;
   public kadNodes: bigint | undefined;
   public ed2kConnected: boolean | undefined;
   public ed2kConnecting: boolean | undefined;
   public kadConnected: boolean | undefined;
   public kadFirewalled: boolean | undefined;
   public kadRunning: boolean | undefined;
   /**
    * The eD2k ID assigned by the connected server, if any (see class doc).
    */
   public ed2kId: bigint | undefined;
   /**
    * Unix timestamp (seconds) of when the current eD2k connection was established - only sent
    * while actually connected.
    */
   public ed2kConnectedSince: bigint | undefined;
   /**
    * Unix timestamp (seconds) of when Kad became connected - only sent while actually connected.
    */
   public kadConnectedSince: bigint | undefined;
   /**
    * True = Low ID (firewalled/NAT'd), false = High ID. Undefined when not connected to a server.
    */
   public hasLowId: boolean | undefined;
   /**
    * Name of the currently connected eD2k server, when available (see class doc).
    */
   public serverName: string | undefined;
   /**
    * IP address of the currently connected eD2k server, when available
    * (see class doc). EC_TAG_SERVER's own data is an EC_IPv4_t (IP +
    * port), not a wrapper around EC_TAG_SERVER_IP/EC_TAG_SERVER_PORT
    * children - confirmed against CEC_Server_Tag's status-report
    * constructor,
    * https://github.com/amule-org/amule/blob/master/src/ECSpecialCoreTags.cpp#L50
    * (`CECTag(EC_TAG_SERVER, EC_IPv4_t(server->GetIP(), server->GetPort()))`);
    * the separate IP/PORT child tags are only used by the other
    * CEC_Server_Tag constructor (preferences editing), not this one.
    */
   public serverIp: string | undefined;
   /**
    * Port of the currently connected eD2k server, alongside serverIp (see its doc).
    */
   public serverPort: number | undefined;
   /**
    * Free disk space (bytes) on the Temp/Incoming directories -
    * EC_TAG_STATS_TEMP_FREE_SPACE/EC_TAG_STATS_INCOMING_FREE_SPACE. Only
    * sent at EC_DETAIL_FULL, which fetch()'s stats request now uses.
    */
   public tempFreeSpace: bigint | undefined;
   public incomingFreeSpace: bigint | undefined;
   /**
    * CPU time in milliseconds consumed by the daemon process -
    * EC_TAG_STATS_CPU_MILLISECONDS. Added in aMule 3.3.0 (#2311).
    */
   public cpuMilliseconds: bigint | undefined;
   /**
    * Resident memory (RSS) in bytes used by the daemon process -
    * EC_TAG_STATS_RESIDENT_MEMORY_BYTES. Added in aMule 3.3.0 (#2311).
    */
   public residentMemoryBytes: bigint | undefined;
   /**
    * Number of active connections - EC_TAG_STATS_ACTIVE_CONNECTIONS.
    */
   public activeConnections: bigint | undefined;
   /**
    * Daemon uptime in seconds - EC_TAG_STATS_UPTIME_SECONDS.
    */
   public uptimeSeconds: bigint | undefined;
   /**
    * Session upload total in bytes - EC_TAG_STATS_SESSION_SENT_BYTES.
    */
   public sessionSentBytes: bigint | undefined;
   /**
    * Session download total in bytes - EC_TAG_STATS_SESSION_RECEIVED_BYTES.
    */
   public sessionReceivedBytes: bigint | undefined;
   /**
    * Lifetime upload total in bytes - EC_TAG_STATS_TOTAL_SENT_BYTES.
    */
   public totalSentBytes: bigint | undefined;
   /**
    * Lifetime download total in bytes - EC_TAG_STATS_TOTAL_RECEIVED_BYTES.
    */
   public totalReceivedBytes: bigint | undefined;
   /**
    * Upload protocol overhead rate in bytes/s - EC_TAG_STATS_UP_OVERHEAD.
    */
   public upOverhead: bigint | undefined;
   /**
    * Download protocol overhead rate in bytes/s - EC_TAG_STATS_DOWN_OVERHEAD.
    */
   public downOverhead: bigint | undefined;
   /**
    * Currently banned peer count - EC_TAG_STATS_BANNED_COUNT.
    */
   public bannedCount: bigint | undefined;
   /**
    * Number of locally shared files - EC_TAG_STATS_SHARED_FILE_COUNT.
    */
   public sharedFileCount: bigint | undefined;
   /**
    * Configured network enablement in preferences (bit 0 = ED2K, bit 1 = Kad) -
    * EC_TAG_NETWORKS_ENABLED.
    */
   public networksEnabled: { ed2k: boolean; kad: boolean } | undefined;

   public constructor(public readonly connection: ECConnection) {}

   /**
    * Sends EC_OP_STAT_REQ and EC_OP_GET_CONNSTATE and merges both into this snapshot.
    */
   public async fetch(): Promise<void> {
      const statsRequest = new ECPacket(ECOpcode.EC_OP_STAT_REQ);
      // EC_DETAIL_FULL, not _CMD: the free-space tags below are only added
      // at EC_DETAIL_FULL/EC_DETAIL_INC_UPDATE server-side (falls through to
      // the same UL/DL-speed-etc. block _CMD/_WEB use on their own - see
      // Get_EC_Response_StatRequest, ExternalConn.cpp), so _CMD alone would
      // never carry them.
      statsRequest.add(new ECUInt8Tag(ECTagNames.EC_TAG_DETAIL_LEVEL, ECDetailLevel.EC_DETAIL_FULL));
      const statsReply = await this.connection.request(statsRequest);
      if (statsReply.opcode !== ECOpcode.EC_OP_STATS) {
         throw new Error(`Expected EC_OP_STATS, received opcode 0x${statsReply.opcode.toString(16)}.`);
      }
      const connStateRequest = new ECPacket(ECOpcode.EC_OP_GET_CONNSTATE);
      connStateRequest.add(new ECUInt8Tag(ECTagNames.EC_TAG_DETAIL_LEVEL, ECDetailLevel.EC_DETAIL_CMD));
      const connStateReply = await this.connection.request(connStateRequest);
      if (connStateReply.opcode !== ECOpcode.EC_OP_MISC_DATA) {
         throw new Error(`Expected EC_OP_MISC_DATA, received opcode 0x${connStateReply.opcode.toString(16)}.`);
      }
      this.applySnapshot(statsReply, connStateReply.find(ECTagNames.EC_TAG_CONNSTATE));
      debug(
         "fetch: ed2kConnected=%s, kadConnected=%s, downloadSpeed=%s",
         this.ed2kConnected,
         this.kadConnected,
         this.downloadSpeed,
      );
   }

   /**
    * Interprets a server-pushed notification packet (see ECConnection's
    * "notification" event) as a connection-status change, merging it into
    * this snapshot in place - returns whether the packet was one (most
    * EC_OP_STATS traffic is a fetch() reply, not this - see class doc).
    */
   public applyNotification(packet: ECPacket): boolean {
      if (packet.opcode !== ECOpcode.EC_OP_STATS) {
         return false;
      }
      const connStateTag = packet.find(ECTagNames.EC_TAG_CONNSTATE);
      if (!connStateTag) {
         return false;
      }
      this.applySnapshot(undefined, connStateTag);
      debug("applyNotification: ed2kConnected=%s, kadConnected=%s", this.ed2kConnected, this.kadConnected);
      return true;
   }

   /**
    * Fills in whatever of `statsPacket`/`connStateTag` is present, leaving
    * the rest of this snapshot untouched - see class doc on why
    * applyNotification() only ever supplies connStateTag.
    */
   private applySnapshot(statsPacket: ECPacket | undefined, connStateTag: ECTag | undefined): void {
      if (statsPacket) {
         this.uploadSpeed = statsPacket.find(ECTagNames.EC_TAG_STATS_UL_SPEED)?.intValue;
         this.downloadSpeed = statsPacket.find(ECTagNames.EC_TAG_STATS_DL_SPEED)?.intValue;
         this.uploadSpeedLimit = statsPacket.find(ECTagNames.EC_TAG_STATS_UL_SPEED_LIMIT)?.intValue;
         this.downloadSpeedLimit = statsPacket.find(ECTagNames.EC_TAG_STATS_DL_SPEED_LIMIT)?.intValue;
         this.uploadQueueLength = statsPacket.find(ECTagNames.EC_TAG_STATS_UL_QUEUE_LEN)?.intValue;
         this.totalSourceCount = statsPacket.find(ECTagNames.EC_TAG_STATS_TOTAL_SRC_COUNT)?.intValue;
         this.ed2kUsers = statsPacket.find(ECTagNames.EC_TAG_STATS_ED2K_USERS)?.intValue;
         this.kadUsers = statsPacket.find(ECTagNames.EC_TAG_STATS_KAD_USERS)?.intValue;
         this.ed2kFiles = statsPacket.find(ECTagNames.EC_TAG_STATS_ED2K_FILES)?.intValue;
         this.kadFiles = statsPacket.find(ECTagNames.EC_TAG_STATS_KAD_FILES)?.intValue;
         this.kadNodes = statsPacket.find(ECTagNames.EC_TAG_STATS_KAD_NODES)?.intValue;
         this.tempFreeSpace = statsPacket.find(ECTagNames.EC_TAG_STATS_TEMP_FREE_SPACE)?.intValue;
         this.incomingFreeSpace = statsPacket.find(ECTagNames.EC_TAG_STATS_INCOMING_FREE_SPACE)?.intValue;
         this.cpuMilliseconds = statsPacket.find(ECTagNames.EC_TAG_STATS_CPU_MILLISECONDS)?.intValue;
         this.residentMemoryBytes = statsPacket.find(ECTagNames.EC_TAG_STATS_RESIDENT_MEMORY_BYTES)?.intValue;
         this.activeConnections = statsPacket.find(ECTagNames.EC_TAG_STATS_ACTIVE_CONNECTIONS)?.intValue;
         this.uptimeSeconds = statsPacket.find(ECTagNames.EC_TAG_STATS_UPTIME_SECONDS)?.intValue;
         this.sessionSentBytes = statsPacket.find(ECTagNames.EC_TAG_STATS_SESSION_SENT_BYTES)?.intValue;
         this.sessionReceivedBytes = statsPacket.find(ECTagNames.EC_TAG_STATS_SESSION_RECEIVED_BYTES)?.intValue;
         this.totalSentBytes = statsPacket.find(ECTagNames.EC_TAG_STATS_TOTAL_SENT_BYTES)?.intValue;
         this.totalReceivedBytes = statsPacket.find(ECTagNames.EC_TAG_STATS_TOTAL_RECEIVED_BYTES)?.intValue;
         this.upOverhead = statsPacket.find(ECTagNames.EC_TAG_STATS_UP_OVERHEAD)?.intValue;
         this.downOverhead = statsPacket.find(ECTagNames.EC_TAG_STATS_DOWN_OVERHEAD)?.intValue;
         this.bannedCount = statsPacket.find(ECTagNames.EC_TAG_STATS_BANNED_COUNT)?.intValue;
         this.sharedFileCount = statsPacket.find(ECTagNames.EC_TAG_STATS_SHARED_FILE_COUNT)?.intValue;
      }
      if (!connStateTag) {
         return;
      }
      const bitmask = connStateTag.intValue ?? 0n;
      this.ed2kConnected = (bitmask & 0x01n) !== 0n;
      this.ed2kConnecting = (bitmask & 0x02n) !== 0n;
      this.kadConnected = (bitmask & 0x04n) !== 0n;
      this.kadFirewalled = (bitmask & 0x08n) !== 0n;
      this.kadRunning = (bitmask & 0x10n) !== 0n;
      const networksTag = connStateTag.findChild(ECTagNames.EC_TAG_NETWORKS_ENABLED);
      if (networksTag?.intValue !== undefined) {
         const nMask = networksTag.intValue;
         this.networksEnabled = {
            ed2k: (nMask & 0x01n) !== 0n,
            kad: (nMask & 0x02n) !== 0n,
         };
      }
      this.ed2kId = connStateTag.findChild(ECTagNames.EC_TAG_ED2K_ID)?.intValue;
      this.hasLowId = this.ed2kId !== undefined ? this.ed2kId < HIGHEST_LOWID_ED2K_KAD : undefined;
      this.ed2kConnectedSince = connStateTag.findChild(ECTagNames.EC_TAG_ED2K_CONNECTED_SINCE)?.intValue;
      this.kadConnectedSince = connStateTag.findChild(ECTagNames.EC_TAG_KAD_CONNECTED_SINCE)?.intValue;
      const serverTag = connStateTag.findChild(ECTagNames.EC_TAG_SERVER);
      if (serverTag) {
         this.serverName = serverTag.childString(ECTagNames.EC_TAG_SERVER_NAME);
         this.serverIp = serverTag instanceof ECIPv4Tag ? serverTag.address.join(".") : undefined;
         this.serverPort = serverTag instanceof ECIPv4Tag ? serverTag.port : undefined;
      }
   }
}
