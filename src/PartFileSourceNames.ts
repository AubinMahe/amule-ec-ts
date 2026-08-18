import { debuglog } from "node:util";
import { ECConnection } from "./ECConnection.js";
import { ECTag } from "./ECTags.js";
import { ECTagNames } from "./ECTagNames.js";

const debug = debuglog("amule-ec:partfile-source-names");

/** One entry of DownloadFile.sourceNames - see DownloadFile's class doc for what an absent `name` or a `count` of 0n mean. */
export interface SourceName {
   readonly name: string | undefined;
   readonly count: bigint;
}

/** Decodes an EC_TAG_PARTFILE_SOURCE_NAMES container off `tag` - a single response's raw delta, see DownloadFile's class doc for the protocol this reflects. */
export function parseSourceNames(tag: ECTag): ReadonlyMap<bigint, SourceName> | undefined {
   const container = tag.findChild(ECTagNames.EC_TAG_PARTFILE_SOURCE_NAMES);
   if (!container) return undefined;
   const names = new Map<bigint, SourceName>();
   for (const entry of container.children) {
      const id = entry.intValue;
      if (id === undefined) continue;
      const count = entry.childInt(ECTagNames.EC_TAG_PARTFILE_SOURCE_NAMES_COUNTS) ?? 0n;
      const name = entry.findChild(ECTagNames.EC_TAG_PARTFILE_SOURCE_NAMES)?.stringValue;
      names.set(id, { name, count });
   }
   return names;
}

/**
 * Folds one response's source-name delta (see parseSourceNames()'s doc) into the running total
 * accumulated so far - a 0 count forgets the id, a present name (re)sets it, a bare count update
 * keeps whatever name `base` already had for that id (dropped silently if `base` never had one -
 * the protocol shouldn't produce that case, since an id's first appearance always carries a name).
 */
export function mergeSourceNames(
   base: ReadonlyMap<bigint, SourceName> | undefined,
   update: ReadonlyMap<bigint, SourceName> | undefined,
): ReadonlyMap<bigint, SourceName> | undefined {
   if (update === undefined) return base;
   const merged = new Map(base ?? []);
   for (const [id, entry] of update) {
      if (entry.count === 0n) {
         merged.delete(id);
      } else if (entry.name !== undefined) {
         merged.set(id, entry);
      } else {
         const existing = merged.get(id);
         if (existing) merged.set(id, { name: existing.name, count: entry.count });
      }
   }
   return merged;
}

/**
 * Per-connection, per-ecid accumulation of source names, hiding the EC protocol's stateful delta
 * encoding (see DownloadFile's class doc) from callers entirely. The daemon tracks "what has this
 * connection already been told" per file, shared across every request type that touches that file's
 * EC_TAG_PARTFILE encoding - confirmed against ExternalConn.cpp: Get_EC_Response_GetDownloadQueue and
 * Get_EC_Response_GetSharedFiles both pass the same per-connection CFileEncoderMap
 * (ExternalConn.cpp:3592-3593/3624-3625), and a partial file that's also shared reuses the very same
 * CPartFile_Encoder across both rather than getting a second one for the shares pass
 * (ExternalConn.cpp:355-364, "A partfile appears in both lists ... Leaving the new entries unmerged
 * would ... build a second encoder for the same ECID"). That state isn't reset by a fresh
 * EC_DETAIL_CMD request either: CPartFile_Encoder::ResetEncoder() (ExternalConn.cpp:3359-3363) resets
 * gap/req status but never touches m_sourcenameItemMap.
 *
 * So without this cache, a service reading `sourceNames` straight off one response would silently
 * miss any name whose one-time delta the daemon already spent on an *earlier* request on this same
 * connection - its own earlier fetch, another service's fetch (Downloads.fetch()/SharedFiles.fetch()/
 * Update.fetch() - Get_EC_Response_GetUpdate also takes the same m_FileEncoder, ExternalConn.cpp:3641
 * - all three end up encoding the very same object for a given ecid), or a push notification. Keyed
 * by connection instance (a WeakMap, so an entry never outlives the connection that produced it)
 * rather than by which class asked: every one of them feeds and reads the same cache through
 * resolveSourceNames() below, so whichever happens to reach the daemon first, the others still see it
 * on their own next call - no protocol awareness required from any of them.
 */
const byConnection = new WeakMap<ECConnection, Map<bigint, ReadonlyMap<bigint, SourceName>>>();

function cacheFor(connection: ECConnection): Map<bigint, ReadonlyMap<bigint, SourceName>> {
   let cache = byConnection.get(connection);
   if (!cache) {
      cache = new Map();
      byConnection.set(connection, cache);
   }
   return cache;
}

/**
 * Decodes `tag`'s source-names delta (if any) and folds it into everything `connection` has ever
 * been told about `ecid`, returning the accumulated total. Falls back to the bare per-tag delta, with
 * no accumulation, when `connection` or `ecid` is undefined (a removal notification carries no ecid;
 * tests decoding a single tag in isolation have no connection at all) - see mergeSourceNames()'s doc
 * for why that's still a safe reading on its own.
 */
export function resolveSourceNames(
   tag: ECTag,
   connection: ECConnection | undefined,
   ecid: bigint | undefined,
): ReadonlyMap<bigint, SourceName> | undefined {
   const delta = parseSourceNames(tag);
   if (connection === undefined || ecid === undefined) return delta;
   const cache = cacheFor(connection);
   if (delta !== undefined) {
      const merged = mergeSourceNames(cache.get(ecid), delta);
      if (merged !== undefined) cache.set(ecid, merged);
   }
   return cache.get(ecid);
}

/** Forgets everything accumulated for one file on one connection - call once it leaves the queue, so a later ecid reuse can't inherit a stale history. */
export function forgetSourceNames(connection: ECConnection, ecid: bigint): void {
   if (byConnection.get(connection)?.delete(ecid)) {
      debug("forgetSourceNames: ecid=%s", ecid);
   }
}
