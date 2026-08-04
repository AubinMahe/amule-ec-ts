import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECUInt16Tag, ECDoubleTag, ECCustomTag } from "./ECTags.js";

const debug = debuglog("amule-ec:statsgraphs");

/** Decodes a big-endian uint32 array from a raw byte blob (EC_TAG_STATSGRAPH_DATA/_DATA_CONN's own data). */
function readUInt32ArrayBE(bytes: Uint8Array): readonly bigint[] {
   const buffer = Buffer.from(bytes);
   const count = Math.floor(buffer.length / 4);
   const values: bigint[] = [];
   for (let i = 0; i < count; i++) {
      values.push(BigInt(buffer.readUInt32BE(i * 4)));
   }
   return values;
}

/**
 * One sample of the daemon's transfer-history graph - one entry of
 * EC_TAG_STATSGRAPH_DATA (and, if present, the matching entry of
 * EC_TAG_STATSGRAPH_DATA_CONN).
 *
 * Confirmed against CStatistics::GetHistoryForGui()
 * (https://github.com/amule-org/amule/blob/master/src/Statistics.cpp#L557-L641): `downloadSpeed`/
 * `uploadSpeed` are bytes/sec (not the internal kB/s the daemon tracks
 * internally - already multiplied by 1024 server-side). `uploadingClients`/
 * `downloadingClients` come from the newer, optional _DATA_CONN blob - a
 * daemon predating it (or a reply that simply omits it) leaves both
 * undefined, never a real 0.
 */
export class StatsGraphPoint {
   public constructor(
      public readonly downloadSpeed: bigint,
      public readonly uploadSpeed: bigint,
      public readonly connections: bigint,
      public readonly kadNodes: bigint,
      public readonly uploadingClients: bigint | undefined,
      public readonly downloadingClients: bigint | undefined,
   ) {}
}

/**
 * The daemon's transfer-history graph - EC_OP_GET_STATSGRAPHS/EC_OP_STATSGRAPHS.
 *
 * Confirmed against GetStatsGraphs() (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L3007-L3072)
 * and CStatistics::GetHistoryForGui(): each call is a *delta* poll, not a
 * one-shot dump - pass the `last` timestamp echoed back on the previous
 * call to `fetch()` (via `this.last`) so the daemon only returns points
 * newer than that. amule-remote-gui.cpp/WebServer.cpp both poll with
 * `scale=1`; `width` caps how many points come back per call.
 */
export class StatsGraphs {

   public points: readonly StatsGraphPoint[] = [];
   /** Total bytes downloaded/uploaded this session, as of the last point in `points`. */
   public sessionDownloaded: bigint | undefined;
   public sessionUploaded: bigint | undefined;
   public sessionKadNodes: bigint | undefined;
   /** Session length in seconds, as of the last point in `points`. */
   public sessionTimespan: number | undefined;
   /** Newest point's timestamp - feed this into the next fetch()'s `last` argument to poll incrementally. */
   public last: number | undefined;

   public constructor(public readonly connection: ECConnection) {}

   /**
    * Confirmed against GetStatsGraphs(): the request carries up to three
    * optional tags - EC_TAG_STATSGRAPH_LAST (double, lower-bound
    * timestamp), EC_TAG_STATSGRAPH_SCALE (uint16, seconds/point),
    * EC_TAG_STATSGRAPH_WIDTH (uint16, max points). No EC_TAG_DETAIL_LEVEL
    * tag is sent - EC_DETAIL_FULL is EC_OP_GET_STATSGRAPHS's required
    * level and also this library's (and the C++ CECPacket's) wire
    * default when the tag is omitted entirely
    * (https://github.com/amule-org/amule/blob/master/src/libs/ec/cpp/ECPacket.h#L44-L52); any other level is
    * rejected by the daemon.
    *
    * Replies EC_OP_STATSGRAPHS carrying EC_TAG_STATSGRAPH_DATA (required)
    * and EC_TAG_STATSGRAPH_DATA_CONN (optional, newer daemons only) as raw
    * big-endian uint32 array blobs, plus scalar session totals - see
    * StatsGraphPoint's doc for the exact per-point layout. Replies
    * EC_OP_FAILED ("No points for graph.") when there is nothing newer
    * than `last` - confirmed as an expected, routine condition (not an
    * error) by every reference client (amule-remote-gui.cpp/WebServer.cpp
    * both treat any non-EC_OP_STATSGRAPHS reply as "nothing new" and
    * return silently) - `fetch()` mirrors that: `points` is simply left
    * empty, nothing is thrown.
    */
   public async fetch(options: { last?: number; scale?: number; width?: number } = {}): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_GET_STATSGRAPHS);
      if (options.last !== undefined) {
         request.add(new ECDoubleTag(ECTagNames.EC_TAG_STATSGRAPH_LAST, options.last));
      }
      if (options.scale !== undefined) {
         request.add(new ECUInt16Tag(ECTagNames.EC_TAG_STATSGRAPH_SCALE, options.scale));
      }
      if (options.width !== undefined) {
         request.add(new ECUInt16Tag(ECTagNames.EC_TAG_STATSGRAPH_WIDTH, options.width));
      }
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         this.points = [];
         debug("fetch: no points for graph");
         return;
      }
      if (reply.opcode !== ECOpcode.EC_OP_STATSGRAPHS) {
         throw new Error(
            `Expected EC_OP_STATSGRAPHS, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
      const dataTag = reply.find(ECTagNames.EC_TAG_STATSGRAPH_DATA);
      const data = dataTag instanceof ECCustomTag ? readUInt32ArrayBE(dataTag.value) : [];
      const connTag = reply.find(ECTagNames.EC_TAG_STATSGRAPH_DATA_CONN);
      const connData = connTag instanceof ECCustomTag ? readUInt32ArrayBE(connTag.value) : undefined;
      const numPoints = Math.floor(data.length / 4);
      const points: StatsGraphPoint[] = [];
      for (let i = 0; i < numPoints; i++) {
         points.push(
            new StatsGraphPoint(
               data[i * 4] ?? 0n,
               data[i * 4 + 1] ?? 0n,
               data[i * 4 + 2] ?? 0n,
               data[i * 4 + 3] ?? 0n,
               connData?.[i * 2],
               connData?.[i * 2 + 1],
            ),
         );
      }
      this.points = points;
      this.sessionDownloaded = reply.find(ECTagNames.EC_TAG_STATSGRAPH_SESSION_DL)?.intValue;
      this.sessionUploaded = reply.find(ECTagNames.EC_TAG_STATSGRAPH_SESSION_UL)?.intValue;
      this.sessionKadNodes = reply.find(ECTagNames.EC_TAG_STATSGRAPH_SESSION_KAD)?.intValue;
      this.sessionTimespan = reply.find(ECTagNames.EC_TAG_STATSGRAPH_SESSION_TIMESPAN)?.doubleValue;
      this.last = reply.find(ECTagNames.EC_TAG_STATSGRAPH_LAST)?.doubleValue;
      debug("fetch: %d point(s)", points.length);
   }
}
