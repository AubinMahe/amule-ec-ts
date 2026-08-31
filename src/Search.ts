import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECPacket } from "./ECPacket.js";
import { ECOpcode } from "./ECOpcode.js";
import { ECTagNames } from "./ECTagNames.js";
import { ECTag, ECUInt32Tag, ECUInt64Tag, ECStringTag, ECHash16Tag, ECCustomTag } from "./ECTags.js";
import { FileComment, parseFileComments, parseKadCommentSearching, MediaMetadata, parseMediaMetadata } from "./SharedFiles.js";

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
   /**
    * A "View Files" browse tab, not a real search - `EC_OP_SEARCH_LIST` entries of this kind carry
    * a `KnownSearch.browsePeerEcid`.
    */
   BROWSE = 0x04,
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
   /**
    * EC_SEARCH_TYPE for this search - defaults to GLOBAL (ed2k) if omitted.
    */
   type?: ECSearchType;
   /**
    * ED2KFTSTR_* value (e.g. "Video", "Audio", "Arc", ...) - see FileTags.h:129-135. Empty/omitted
    * = no filter.
    */
   fileType?: string;
   extension?: string;
   availability?: number;
   minSize?: bigint;
   maxSize?: bigint;
}

export interface ECSearchProgress {
   state: ECSearchLifecycleState;
   /**
    * EC_SEARCH_TYPE this search was started with - decoded from EC_TAG_SEARCH_LIFECYCLE_KIND,
    * present on every reply regardless of multi-search.
    */
   kind: ECSearchType;
   percent: number;
   resultCount: number;
}

/**
 * One EC_TAG_SEARCH_ID entry from an EC_OP_SEARCH_LIST reply -
 * Search.list()'s doc.
 *
 * Confirmed against Get_EC_Response_Search_List
 * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L2498-L2518): own data is
 * the search ID; children are EC_TAG_SEARCH_NAME (the query string),
 * EC_TAG_SEARCH_LIFECYCLE_KIND and EC_TAG_SEARCH_LIFECYCLE_STATE - the
 * same two enums ECSearchProgress.kind/state already use, reused here
 * unchanged. Unlike EC_OP_SEARCH_PROGRESS, there is no result count or
 * percent here by design (ExternalConn.cpp:2481-2496) - fetch progress
 * for a specific ID from SearchSession/EC_OP_SEARCH_PROGRESS instead.
 * `EC_TAG_CLIENT` is an additional child, present only when `kind` is
 * `ECSearchType.BROWSE` - the peer being browsed, decoded into
 * `browsePeerEcid`. Without it a browse tab can't be identified as one at
 * all (`CSearchListCtrl::IsBrowse`).
 */
export class KnownSearch {
   public constructor(
      public readonly id: bigint,
      public readonly name: string,
      public readonly kind: ECSearchType,
      public readonly state: ECSearchLifecycleState,
      public readonly browsePeerEcid: bigint | undefined,
   ) {}
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
   /**
    * Community ratings/comments (Kad NOTES) - see FileComment/parseFileComments' doc.
    */
   public readonly comments: readonly FileComment[];
   /**
    * Whether a searchKadNotes() lookup is currently in flight for this result -
    * EC_TAG_PARTFILE_KAD_COMMENT_SEARCHING.
    */
   public readonly kadCommentSearching: boolean;
   /**
    * Probed audio/video metadata, if any - see MediaMetadata's doc.
    */
   public readonly media: MediaMetadata | undefined;
   /**
    * The parent result's ECID, if this is a grouped child (same hash/size,
    * different filename) rather than a top-level result - `EC_TAG_SEARCH_PARENT`,
    * only present on children and only when `SearchSession.fetch()`'s request
    * opted into grouping (see its doc). Pass this result's own `ecid` back to
    * `Search.download()`'s `ecid` selector to download it under its own name
    * instead of the parent's.
    */
   public readonly parent: bigint | undefined;

   public constructor(tag: ECTag) {
      this.ecid = tag.intValue ?? 0n;
      const hashTag = tag.findChild(ECTagNames.EC_TAG_PARTFILE_HASH);
      this.hash = hashTag instanceof ECHash16Tag ? Buffer.from(hashTag.value).toString("hex") : "";
      this.name = tag.childString(ECTagNames.EC_TAG_PARTFILE_NAME) ?? "";
      this.sizeFull = tag.childInt(ECTagNames.EC_TAG_PARTFILE_SIZE_FULL) ?? 0n;
      this.sources = tag.childInt(ECTagNames.EC_TAG_PARTFILE_SOURCE_COUNT) ?? 0n;
      this.comments = parseFileComments(tag) ?? [];
      this.kadCommentSearching = parseKadCommentSearching(tag) ?? false;
      this.media = parseMediaMetadata(tag);
      this.parent = tag.childInt(ECTagNames.EC_TAG_SEARCH_PARENT);
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
 *
 * For a multi-tab search UI: no client-side correlation token
 * (EC_TAG_SEARCH_REF, which the reference GUI echoes back for its own
 * optimistic tabs - see Friends.browseSharedFiles()'s doc, which reuses
 * the same reply shape) is needed or wrapped here. That tag exists to
 * solve a problem specific to amuleGUI's event-driven architecture,
 * where a request can return control to the event loop before its reply
 * arrives, leaving "which pending tab does this reply belong to"
 * genuinely ambiguous without one. In an async/await client, each
 * `Search.start()` call's own `await` already ties it to its own result
 * - `Promise.all([search.start(a), search.start(b)])` is correctly
 * paired by ECConnection's FIFO receive()-matching (see
 * ECConnection.dispatchPacket()'s doc) without any protocol help. The
 * only real limit on "multiple tabs" is the one above: as many
 * independent Kad tabs as wanted, but only one live ed2k tab per
 * connection at a time.
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
         throw new Error(`Expected EC_OP_MISC_DATA, received opcode 0x${reply.opcode.toString(16)}.`);
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
         throw new Error(`Expected EC_OP_SEARCH_PROGRESS, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      if (reply.has(ECTagNames.EC_TAG_SEARCH_EXPIRED)) {
         throw new Error(`Search ${this.id} has expired (evicted from the daemon's search ring, or unknown).`);
      }
      const stateTag = reply.find(ECTagNames.EC_TAG_SEARCH_LIFECYCLE_STATE);
      const kindTag = reply.find(ECTagNames.EC_TAG_SEARCH_LIFECYCLE_KIND);
      const percentTag = reply.find(ECTagNames.EC_TAG_SEARCH_LIFECYCLE_PERCENT);
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
    *
    * Always sends an empty `EC_TAG_SEARCH_PARENT` flag (issue #431) to opt
    * into result grouping: without it, same-hash/same-size-but-different-
    * filename children are omitted entirely (parents-only), which is what
    * amulecmd/amuleweb still get since they never send this flag. With it,
    * children are flattened into `results` alongside their parent, each
    * carrying its own `SearchResult.parent` - strictly more information,
    * nothing lost for a caller that ignores `parent`.
    */
   public async fetch(): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_SEARCH_RESULTS);
      this.addIdTag(request);
      request.add(new ECCustomTag(ECTagNames.EC_TAG_SEARCH_PARENT, new Uint8Array()));
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_SEARCH_RESULTS) {
         throw new Error(`Expected EC_OP_SEARCH_RESULTS, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      if (reply.has(ECTagNames.EC_TAG_SEARCH_EXPIRED)) {
         throw new Error(`Search ${this.id} has expired (evicted from the daemon's search ring, or unknown).`);
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
      const searchTag = new ECUInt32Tag(ECTagNames.EC_TAG_SEARCH_TYPE, params.type ?? ECSearchType.GLOBAL, [
         new ECStringTag(ECTagNames.EC_TAG_SEARCH_NAME, params.keywords),
         new ECStringTag(ECTagNames.EC_TAG_SEARCH_FILE_TYPE, params.fileType ?? ""),
         ...(params.extension ? [new ECStringTag(ECTagNames.EC_TAG_SEARCH_EXTENSION, params.extension)] : []),
         ...(params.availability ? [new ECUInt32Tag(ECTagNames.EC_TAG_SEARCH_AVAILABILITY, params.availability)] : []),
         ...(params.minSize ? [new ECUInt64Tag(ECTagNames.EC_TAG_SEARCH_MIN_SIZE, params.minSize)] : []),
         ...(params.maxSize ? [new ECUInt64Tag(ECTagNames.EC_TAG_SEARCH_MAX_SIZE, params.maxSize)] : []),
      ]);
      const request = new ECPacket(ECOpcode.EC_OP_SEARCH_START);
      request.add(searchTag);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode === ECOpcode.EC_OP_FAILED) {
         const reasonTag = reply.find(ECTagNames.EC_TAG_STRING);
         const reason = reasonTag instanceof ECStringTag ? reasonTag.value : "Failed to start search.";
         throw new Error(reason);
      }
      if (reply.opcode !== ECOpcode.EC_OP_STRINGS) {
         throw new Error(`Expected EC_OP_STRINGS, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      const idTag = reply.find(ECTagNames.EC_TAG_SEARCH_ID);
      const id = idTag?.intValue;
      debug("start: keywords=%s, fileType=%s, id=%s", params.keywords, params.fileType, id);
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
    *
    * Each entry is either a plain hash string (downloads the parent - the
    * first result matching that hash, unchanged default behavior) or
    * `{ hash, ecid }` to instead download one specific grouped child under
    * its own name (issue #431) - pass a `SearchResult.ecid` from a grouped
    * child (`SearchResult.parent !== undefined`) fetched with grouping on,
    * see `SearchSession.fetch()`'s doc. `ecid` rides as an EC_TAG_SEARCHFILE
    * child alongside the same hash; a daemon that doesn't understand it just
    * falls back to the parent.
    */
   public async download(hashes: readonly (string | { hash: string; ecid: bigint })[]): Promise<void> {
      const request = new ECPacket(ECOpcode.EC_OP_DOWNLOAD_SEARCH_RESULT);
      for (const entry of hashes) {
         const hash = typeof entry === "string" ? entry : entry.hash;
         const children = [new ECUInt32Tag(ECTagNames.EC_TAG_PARTFILE_CAT, 0)];
         if (typeof entry !== "string") {
            children.push(new ECUInt32Tag(ECTagNames.EC_TAG_SEARCHFILE, Number(entry.ecid)));
         }
         request.add(new ECHash16Tag(ECTagNames.EC_TAG_PARTFILE, new Uint8Array(Buffer.from(hash, "hex")), children));
      }
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_STRINGS) {
         throw new Error(`Expected EC_OP_STRINGS, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      debug("download: %d hash(es) requested", hashes.length);
   }

   /**
    * Re-asks already-queried Kad peers for a wider result frontier on one
    * running search - EC_OP_SEARCH_REQUEST_MORE.
    *
    * Confirmed against Get_EC_Response_Search_Request_More: Kad-only - silently does nothing for a
    * local/global (ed2k) search, and is capped at a handful of reasks per search server-side, past
    * which it's also a silent no-op. `searchId` mirrors SearchSession.stop()'s optional
    * EC_TAG_SEARCH_ID (omit for "the current/most-recent search" when multi-search is active).
    * Always replies EC_OP_MISC_DATA, carrying EC_TAG_SEARCH_MORE_REASKABLE (whether a *later* press
    * could still widen this search - not whether this press just did) - emitted on every path,
    * including an unknown/expired search id, which reads as not-reaskable rather than being
    * distinguished from it. Returned as `undefined`, not `false`, when the tag itself is absent: a
    * daemon predating it hasn't told you "exhausted", only "unknown" - don't collapse the two.
    */
   public async requestMore(searchId?: bigint): Promise<boolean | undefined> {
      const request = new ECPacket(ECOpcode.EC_OP_SEARCH_REQUEST_MORE);
      if (searchId !== undefined) {
         request.add(new ECUInt32Tag(ECTagNames.EC_TAG_SEARCH_ID, Number(searchId)));
      }
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_MISC_DATA) {
         throw new Error(`Expected EC_OP_MISC_DATA, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      const reaskableTag = reply.find(ECTagNames.EC_TAG_SEARCH_MORE_REASKABLE);
      const reaskable = reaskableTag === undefined ? undefined : reaskableTag.intValue !== 0n;
      debug("requestMore: searchId=%s, reaskable=%s", searchId, reaskable);
      return reaskable;
   }

   /**
    * Lists every search the daemon currently holds - EC_OP_SEARCH_LIST.
    *
    * Confirmed against Get_EC_Response_Search_List
    * (https://github.com/amule-org/amule/blob/master/src/ExternalConn.cpp#L2498-L2518): this is
    * daemon-wide, not scoped to this connection - it includes searches
    * started by any EC client or the local GUI, restored from disk, etc.
    * "View Files" browse tabs are included too, as entries with
    * `kind === ECSearchType.BROWSE` and `browsePeerEcid` set (PR #914) -
    * see KnownSearch's doc. Parameterless request. A legacy (non-multi-search) connection gets
    * back an empty list, not an error (ExternalConn.cpp:3478-3479).
    *
    * Guarded on `connection.remoteCapabilities.searchList`, like
    * SharedFiles.getSharedDirs()/setSharedDirs() - EC_TAG_CAN_SEARCH_LIST
    * is a version-compat probe, not a real opt-in (see
    * ECCapabilities.searchList's doc): a daemon predating EC_OP_SEARCH_LIST
    * has no case for it in its opcode switch and asserts on receiving it.
    */
   public async list(): Promise<readonly KnownSearch[]> {
      if (!this.connection.remoteCapabilities.searchList) {
         throw new Error(
            "The daemon did not confirm EC_TAG_CAN_SEARCH_LIST during authentication - " +
               "it likely predates EC_OP_SEARCH_LIST and may not handle it safely.",
         );
      }
      const request = new ECPacket(ECOpcode.EC_OP_SEARCH_LIST);
      await this.connection.send(request);
      const reply = await this.connection.receive();
      if (reply.opcode !== ECOpcode.EC_OP_SEARCH_LIST) {
         throw new Error(`Expected EC_OP_SEARCH_LIST, received opcode 0x${reply.opcode.toString(16)}.`);
      }
      const searches = reply.tags
         .filter((tag) => {
            const name: ECTagNames = tag.name;
            return name === ECTagNames.EC_TAG_SEARCH_ID;
         })
         .map((tag) => {
            return new KnownSearch(
               tag.intValue ?? 0n,
               tag.childString(ECTagNames.EC_TAG_SEARCH_NAME) ?? "",
               Number(tag.childInt(ECTagNames.EC_TAG_SEARCH_LIFECYCLE_KIND) ?? 0n),
               Number(tag.childInt(ECTagNames.EC_TAG_SEARCH_LIFECYCLE_STATE) ?? 0n),
               tag.childInt(ECTagNames.EC_TAG_CLIENT),
            );
         });
      debug("list: %d search(es)", searches.length);
      return searches;
   }
}
