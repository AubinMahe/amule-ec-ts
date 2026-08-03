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
   ECCustomTag,
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
   /** EC_SEARCH_TYPE for this search - defaults to GLOBAL (ed2k) if omitted. */
   type?: ECSearchType;
   /** ED2KFTSTR_* value (e.g. "Video", "Audio", "Arc", ...) - see FileTags.h:129-135. Empty/omitted = no filter. */
   fileType?: string;
   extension?: string;
   availability?: number;
   minSize?: bigint;
   maxSize?: bigint;
}

export interface ECSearchProgress {
   state: ECSearchLifecycleState;
   /** EC_SEARCH_TYPE this search was started with - decoded from EC_TAG_SEARCH_LIFECYCLE_KIND, present on every reply regardless of multi-search. */
   kind: ECSearchType;
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
 * EC_DETAIL_FULL, the level SearchSession.fetch() requests (by omission -
 * see its doc). Unaffected by multi-search - the reply's own tag shape is
 * identical whether or not the search is addressed by EC_TAG_SEARCH_ID.
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
 * One running/finished search - stop/poll/fetch, addressed by search ID.
 *
 * Returned by Search.start(). `id` is the daemon-allocated
 * EC_TAG_SEARCH_ID, or `undefined` if this connection never negotiated
 * EC_TAG_CAN_MULTI_SEARCH (localCapabilities.multiSearch) or the daemon
 * didn't grant one - in that case every request below omits
 * EC_TAG_SEARCH_ID and implicitly addresses the daemon's single legacy
 * sentinel bucket, exactly like the pre-multi-search API this class
 * replaces (ExternalConn.cpp:2660-2793).
 *
 * With a real `id`, this search coexists with others the same connection
 * has started: ed2k (local/global) searches share one in-flight slot (a
 * new one finalizes the previous), but a Kad search never disturbs an
 * in-flight ed2k search - see Search.start()'s doc. The daemon also keeps
 * only the last 20 EC-started searches (LRU ring, kMaxEcSearches) -
 * progress()/fetch() throw once this search's ID has been evicted or was
 * never known, signaled by EC_TAG_SEARCH_EXPIRED.
 */
export class SearchSession {

   public results: readonly SearchResult[] = [];

   public constructor(
      public readonly connection: ECConnection,
      public readonly id: bigint | undefined,
   ) {}

   private addIdTag(request: ECPacket): void {
      if (this.id !== undefined) {
         request.add(new ECUInt32Tag(ECTagNames.EC_TAG_SEARCH_ID, Number(this.id)));
      }
   }

   /**
    * Stops this search - EC_OP_SEARCH_STOP.
    *
    * Confirmed against Get_EC_Response_Search_Stop (ExternalConn.cpp:2688-2715):
    * `close=false` (default) halts activity but keeps the results, same as
    * a GUI's "Stop" button; `close=true` also frees the results and drops
    * this ID from the daemon's LRU ring (EC_TAG_SEARCH_CLOSE, presence-only),
    * same as closing a GUI's search tab. Always replies EC_OP_MISC_DATA,
    * no tags either way - no failure case, whether or not this ID is still
    * known to the daemon.
    */
   public async stop(close = false): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_SEARCH_STOP);
      this.addIdTag(request);
      if (close) {
         request.add(new ECCustomTag(ECTagNames.EC_TAG_SEARCH_CLOSE, new Uint8Array()));
      }
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_MISC_DATA) {
         throw new Error(
            `Expected EC_OP_MISC_DATA, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
      debug("stop: id=%s, close=%s", this.id, close);
   }

   /**
    * Polls this search's lifecycle - EC_OP_SEARCH_PROGRESS.
    *
    * Confirmed against ExternalConn.cpp:3524-3575 (AppendSearchProgress):
    * reads the "3.1+" unambiguous EC_TAG_SEARCH_LIFECYCLE_STATE/_KIND/
    * _PERCENT tags rather than the older EC_TAG_SEARCH_STATUS sentinel
    * amulecmd itself decodes (0/0xfffe/0xffff overload, multi-search only) -
    * the comment at ExternalConn.cpp:3576-3578 recommends modern consumers
    * skip that decode entirely. Throws if the daemon no longer knows this
    * ID (EC_TAG_SEARCH_EXPIRED - evicted from the LRU ring, or never known).
    */
   public async progress(): Promise<ECSearchProgress> {
      const request = new ECPacket(ECOpcode.EC_OP_SEARCH_PROGRESS);
      this.addIdTag(request);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_SEARCH_PROGRESS) {
         throw new Error(
            `Expected EC_OP_SEARCH_PROGRESS, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
      if (reply.has(ECTagNames.EC_TAG_SEARCH_EXPIRED)) {
         throw new Error(
            `Search ${this.id} has expired (evicted from the daemon's search ring, or unknown).`,
         );
      }
      const stateTag = reply.find(ECTagNames.EC_TAG_SEARCH_LIFECYCLE_STATE);
      const kindTag = reply.find(ECTagNames.EC_TAG_SEARCH_LIFECYCLE_KIND);
      const percentTag = reply.find(
         ECTagNames.EC_TAG_SEARCH_LIFECYCLE_PERCENT,
      );
      const countTag = reply.find(ECTagNames.EC_TAG_SEARCH_RESULT_COUNT);
      const progress: ECSearchProgress = {
         state: Number(stateTag?.intValue ?? 0n),
         kind: Number(kindTag?.intValue ?? 0n),
         percent: Number(percentTag?.intValue ?? 0n),
         resultCount: Number(countTag?.intValue ?? 0n),
      };
      debug(
         "progress: id=%s, state=%s, kind=%s, percent=%d, resultCount=%d",
         this.id,
         ECSearchLifecycleState[progress.state],
         ECSearchType[progress.kind],
         progress.percent,
         progress.resultCount,
      );
      return progress;
   }

   /**
    * Fetches this search's results so far - EC_OP_SEARCH_RESULTS.
    *
    * Confirmed against Get_EC_Response_Search_Results (ExternalConn.cpp:3482-3524)
    * and CECPacket's constructor (ECPacket.h:44-52, "since EC_DETAIL_FULL is
    * default - no point transmit it"): sending no EC_TAG_DETAIL_LEVEL tag at
    * all defaults to EC_DETAIL_FULL - the same level amulecmd's own
    * "results" command uses (TextClient.cpp:706). Throws if the daemon no
    * longer knows this ID - see progress()'s doc.
    */
   public async fetch(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_SEARCH_RESULTS);
      this.addIdTag(request);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_SEARCH_RESULTS) {
         throw new Error(
            `Expected EC_OP_SEARCH_RESULTS, received opcode 0x${reply.opcode.toString(16)}.`,
         );
      }
      if (reply.has(ECTagNames.EC_TAG_SEARCH_EXPIRED)) {
         throw new Error(
            `Search ${this.id} has expired (evicted from the daemon's search ring, or unknown).`,
         );
      }
      this.results = reply.tags
         .filter((tag) => {
            const name: ECTagNames = tag.name;
            return name === ECTagNames.EC_TAG_SEARCHFILE;
         })
         .map((tag) => new SearchResult(tag));
      debug("fetch: id=%s, %d result(s)", this.id, this.results.length);
   }
}

/**
 * Starts searches on an EC connection and requests downloads of their
 * results - EC_OP_SEARCH_START / EC_OP_DOWNLOAD_SEARCH_RESULT, mirroring
 * amulecmd's own "search"/"download" commands (TextClient.cpp:658-745).
 *
 * start() returns a SearchSession, addressed by the daemon-allocated
 * search ID when this connection has negotiated EC_TAG_CAN_MULTI_SEARCH
 * (localCapabilities.multiSearch, set before authenticating) - see
 * SearchSession's doc for what that unlocks and its legacy fallback.
 * download() stays here rather than on SearchSession: it addresses
 * results purely by hash, with no search-ID awareness on the wire
 * (Get_EC_Response_Search_Results_Download).
 */
export class Search {

   public constructor(public readonly connection: ECConnection) {}

   /**
    * Starts a search - EC_OP_SEARCH_START.
    *
    * Confirmed against Get_EC_Response_Search (ExternalConn.cpp:2747-2840)
    * and CEC_Search_Tag's constructor (ECSpecialTags.cpp:64-86): the request
    * carries one composite tag whose own data is the EC_SEARCH_TYPE and
    * whose children are SEARCH_NAME (keywords) and SEARCH_FILE_TYPE (always
    * present, possibly empty), with SEARCH_EXTENSION/AVAILABILITY/MIN_SIZE/
    * MAX_SIZE each omitted when zero/empty. Success replies EC_OP_STRINGS
    * with a status message tag; failure (e.g. a web search, which the core
    * rejects) replies EC_OP_FAILED with an EC_TAG_STRING reason.
    *
    * When multi-search is active, starting a new ed2k (local/global) search
    * first finalizes any of this connection's in-flight ed2k searches -
    * they share one slot - but never disturbs an in-flight Kad search,
    * which self-allocates its own ID and runs independently. The returned
    * SearchSession's `id` is only set if the daemon actually granted one
    * (EC_TAG_SEARCH_ID present in the reply) - see SearchSession's doc for
    * the legacy fallback.
    */
   public async start(params: ECSearchParams): Promise<SearchSession> {
      const searchTag = new ECUInt32Tag(
         ECTagNames.EC_TAG_SEARCH_TYPE,
         params.type ?? ECSearchType.GLOBAL,
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
      const idTag = reply.find(ECTagNames.EC_TAG_SEARCH_ID);
      const id = idTag?.intValue;
      debug(
         "start: keywords=%s, fileType=%s, id=%s",
         params.keywords,
         params.fileType,
         id,
      );
      return new SearchSession(this.connection, id);
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
