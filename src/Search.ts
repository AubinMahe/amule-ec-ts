import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import {
   ECTag,
   ECUInt32Tag,
   ECUInt64Tag,
   ECStringTag,
   ECHash16Tag,
} from "./ECTags.js";

const debug = debuglog("amule-ec:search");

/**
 * EC_SEARCH_TYPE values a search request selects - confirmed against
 * https://github.com/amule-org/amule/blob/master/src/libs/ec/cpp/ECCodes.h#L561-L566.
 */
export enum ECSearchType {
   LOCAL = 0x00,
   GLOBAL = 0x01,
   KAD = 0x02,
   WEB = 0x03,
}

/**
 * CSearchList::SearchLifecycleState - confirmed against
 * https://github.com/amule-org/amule/blob/master/src/SearchList.h#L139-L144.
 */
export enum ECSearchLifecycleState {
   IDLE = 0,
   RUNNING = 1,
   FINISHED = 2,
}

export interface ECSearchParams {
   keywords: string;
   /** ED2KFTSTR_* value (e.g. "Video", "Audio", "Arc", ...) - see FileTags.h:129-135. Empty/omitted = no filter. */
   fileType?: string;
   extension?: string;
   availability?: number;
   minSize?: bigint;
   maxSize?: bigint;
}

export interface ECSearchProgress {
   state: ECSearchLifecycleState;
   percent: number;
   resultCount: number;
}

/**
 * One EC_TAG_SEARCHFILE entry from an EC_OP_SEARCH_RESULTS reply.
 *
 * Confirmed against
 * https://github.com/amule-org/amule/blob/master/src/libs/ec/cpp/ECSpecialTags.h#L538-L576
 * and ECSpecialCoreTags.cpp:443-497 (CEC_SearchFile_Tag): own data is the
 * result's internal ECID; hash/name/size are children present at
 * EC_DETAIL_FULL, the level Search.fetch() requests (by omission - see its doc).
 */
export class SearchResult {

   public readonly ecid: bigint;
   public readonly hash: string;
   public readonly name: string;
   public readonly sizeFull: bigint;
   public readonly sources: bigint;

   public constructor(tag: ECTag) {
      this.ecid = tag.intValue ?? 0n;
      const hashTag = tag.findChild(ECTagNames.EC_TAG_PARTFILE_HASH);
      this.hash =
         hashTag instanceof ECHash16Tag
            ? Buffer.from(hashTag.value).toString("hex")
            : "";
      this.name = tag.childString(ECTagNames.EC_TAG_PARTFILE_NAME) ?? "";
      this.sizeFull = tag.childInt(ECTagNames.EC_TAG_PARTFILE_SIZE_FULL) ?? 0n;
      this.sources =
         tag.childInt(ECTagNames.EC_TAG_PARTFILE_SOURCE_COUNT) ?? 0n;
   }
}

/**
 * The single (legacy, non-multi-search) search session an EC connection
 * offers - start/stop/poll/fetch/download, mirroring amulecmd's own
 * "search"/"progress"/"results"/"download" commands (TextClient.cpp:658-745).
 * aMule also supports a newer opt-in multi-search protocol
 * (EC_TAG_CAN_MULTI_SEARCH) for running several concurrent searches; this
 * client doesn't advertise it, so the daemon runs the single-session legacy
 * path throughout (ExternalConn.cpp:2660-2793).
 */
export class Search {

   public results: readonly SearchResult[] = [];

   public constructor(public readonly connection: ECConnection) {}

   /**
    * Starts a global ed2k search - EC_OP_SEARCH_START.
    *
    * Confirmed against Get_EC_Response_Search (ExternalConn.cpp:1953-2036)
    * and CEC_Search_Tag's constructor (ECSpecialTags.cpp:64-86): the request
    * carries one composite tag whose own data is the EC_SEARCH_TYPE and
    * whose children are SEARCH_NAME (keywords) and SEARCH_FILE_TYPE (always
    * present, possibly empty), with SEARCH_EXTENSION/AVAILABILITY/MIN_SIZE/
    * MAX_SIZE each omitted when zero/empty. Success replies EC_OP_STRINGS
    * with a status message tag; failure (e.g. a web search, which the core
    * rejects) replies EC_OP_FAILED with an EC_TAG_STRING reason.
    */
   public async start(params: ECSearchParams): Promise<void> {
      const searchTag = new ECUInt32Tag(
         ECTagNames.EC_TAG_SEARCH_TYPE,
         ECSearchType.GLOBAL,
         [
            new ECStringTag(ECTagNames.EC_TAG_SEARCH_NAME, params.keywords),
            new ECStringTag(
               ECTagNames.EC_TAG_SEARCH_FILE_TYPE,
               params.fileType ?? "",
            ),
            ...(params.extension
               ? [
                    new ECStringTag(
                       ECTagNames.EC_TAG_SEARCH_EXTENSION,
                       params.extension,
                    ),
                 ]
               : []),
            ...(params.availability
               ? [
                    new ECUInt32Tag(
                       ECTagNames.EC_TAG_SEARCH_AVAILABILITY,
                       params.availability,
                    ),
                 ]
               : []),
            ...(params.minSize
               ? [
                    new ECUInt64Tag(
                       ECTagNames.EC_TAG_SEARCH_MIN_SIZE,
                       params.minSize,
                    ),
                 ]
               : []),
            ...(params.maxSize
               ? [
                    new ECUInt64Tag(
                       ECTagNames.EC_TAG_SEARCH_MAX_SIZE,
                       params.maxSize,
                    ),
                 ]
               : []),
         ],
      );
      const request = new ECPacket(ECOpcode.EC_OP_SEARCH_START);
      request.add(searchTag);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason =
            reasonTag instanceof ECStringTag
               ? reasonTag.value
               : "Failed to start search.";
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_STRINGS) {
         throw new Error(
            `Expected EC_OP_STRINGS, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
      debug("start: keywords=%s, fileType=%s", params.keywords, params.fileType);
   }

   /**
    * Stops the running search - EC_OP_SEARCH_STOP.
    *
    * Confirmed against Get_EC_Response_Search_Stop (ExternalConn.cpp:1931-1951):
    * the legacy (non-multi) path calls CSearchList::StopSearch()
    * unconditionally and always replies EC_OP_MISC_DATA - no failure case,
    * no request tags needed.
    */
   public async stop(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_SEARCH_STOP);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_MISC_DATA) {
         throw new Error(
            `Expected EC_OP_MISC_DATA, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
      debug("stop: search stopped");
   }

   /**
    * Polls the running/last search's lifecycle - EC_OP_SEARCH_PROGRESS.
    *
    * Confirmed against ExternalConn.cpp:2702-2792 (legacy, non-multi
    * branch): reads the "3.1+" unambiguous EC_TAG_SEARCH_LIFECYCLE_STATE/
    * _PERCENT tags rather than the older EC_TAG_SEARCH_STATUS sentinel
    * amulecmd itself decodes (0/0xfffe/0xffff overload, multi-search only) -
    * the comment at ExternalConn.cpp:2780-2782 recommends modern consumers
    * skip that decode entirely.
    */
   public async progress(): Promise<ECSearchProgress> {
      const request = new ECPacket(ECOpcode.EC_OP_SEARCH_PROGRESS);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_SEARCH_PROGRESS) {
         throw new Error(
            `Expected EC_OP_SEARCH_PROGRESS, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
      const stateTag = reply.find(ECTagNames.EC_TAG_SEARCH_LIFECYCLE_STATE);
      const percentTag = reply.find(
         ECTagNames.EC_TAG_SEARCH_LIFECYCLE_PERCENT,
      );
      const countTag = reply.find(ECTagNames.EC_TAG_SEARCH_RESULT_COUNT);
      const progress: ECSearchProgress = {
         state: Number(stateTag?.intValue ?? 0n),
         percent: Number(percentTag?.intValue ?? 0n),
         resultCount: Number(countTag?.intValue ?? 0n),
      };
      debug(
         "progress: state=%s, percent=%d, resultCount=%d",
         ECSearchLifecycleState[progress.state],
         progress.percent,
         progress.resultCount,
      );
      return progress;
   }

   /**
    * Fetches the running/last search's results so far - EC_OP_SEARCH_RESULTS.
    *
    * Confirmed against Get_EC_Response_Search_Results (ExternalConn.cpp:1773-1849)
    * and CECPacket's constructor (ECPacket.h:44-52, "since EC_DETAIL_FULL is
    * default - no point transmit it"): sending no EC_TAG_DETAIL_LEVEL tag at
    * all defaults to EC_DETAIL_FULL - the same level amulecmd's own
    * "results" command uses (TextClient.cpp:706).
    */
   public async fetch(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_SEARCH_RESULTS);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_SEARCH_RESULTS) {
         throw new Error(
            `Expected EC_OP_SEARCH_RESULTS, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
      this.results = reply.tags
         .filter((tag) => {
            const name: ECTagNames = tag.name;
            return name === ECTagNames.EC_TAG_SEARCHFILE;
         })
         .map((tag) => new SearchResult(tag));
      debug("fetch: %d result(s)", this.results.length);
   }

   /**
    * Requests a download of one or more search results, by hash -
    * EC_OP_DOWNLOAD_SEARCH_RESULT.
    *
    * Confirmed against Get_EC_Response_Search_Results_Download
    * (ExternalConn.cpp:1905-1929) and amulecmd's own "download" command
    * (TextClient.cpp:727-744): one EC_TAG_PARTFILE tag per result (own data:
    * MD4 hash), with an EC_TAG_PARTFILE_CAT child. Always replies EC_OP_STRINGS
    * unconditionally, with no tags - there is no failure case to check.
    */
   public async download(hashes: readonly string[]): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_DOWNLOAD_SEARCH_RESULT);
      for (const hash of hashes) {
         request.add(
            new ECHash16Tag(
               ECTagNames.EC_TAG_PARTFILE,
               new Uint8Array(Buffer.from(hash, "hex")),
               [new ECUInt32Tag(ECTagNames.EC_TAG_PARTFILE_CAT, 0)],
            ),
         );
      }
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_STRINGS) {
         throw new Error(
            `Expected EC_OP_STRINGS, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
      debug("download: %d hash(es) requested", hashes.length);
   }
}
