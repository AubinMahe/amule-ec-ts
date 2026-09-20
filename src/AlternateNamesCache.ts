import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { debuglog } from "node:util";

const debug = debuglog("amule-ec:alt-names-cache");

/**
 * One cache entry: the alternate names known for a file, and when they were last touched -
 * purgeOlderThan() (see init()) ages entries out by this timestamp.
 */
interface CacheEntry {
   names: string[];
   lastUpdated: string;
}

type CacheFile = Record<string, CacheEntry>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
   return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether `value` is a well-formed `CacheEntry` - used to drop just the entries a corrupted or
 * hand-edited file gets wrong, rather than discarding the whole file over one bad entry.
 */
function isValidEntry(value: unknown): value is CacheEntry {
   if (!isPlainRecord(value)) {
      return false;
   }
   const { names, lastUpdated } = value;
   return (
      Array.isArray(names) &&
      names.every((name) => typeof name === "string") &&
      typeof lastUpdated === "string" &&
      !Number.isNaN(Date.parse(lastUpdated))
   );
}

/**
 * Persists, across amuled restarts and past a download's own lifetime, the alternate filenames
 * observed for it - see Downloads.ts's `DownloadFile.sourceNames` doc for why that data only
 * exists while a file is still tracked as an active download in amule's queue: once complete and
 * out of the download queue, the daemon has nothing left to report, and a fresh
 * Downloads.fetch()/notification can never recover what was already known. Population policy
 * (when to call add(), the progress threshold worth persisting) lives with the caller - see
 * ECEngineStartOptions.altNamesCachePath and Downloads.ts's cacheAltNamesIfEligible(); this class
 * only owns the on-disk file and its read/merge/write mechanics, so it's equally usable for names
 * that never went through the EC protocol at all (a caller-side rename of an already-completed
 * file, for instance).
 *
 * Every mutation is serialized on `writeChain` - concurrent add()/remove() calls (e.g. several
 * files crossing the population threshold within the same Downloads.fetch() batch) would otherwise
 * race on the same JSON file, each read-modify-write cycle risking clobbering another's update. A
 * rejected write doesn't wedge the chain: `run` is what the caller of THIS call awaits,
 * `writeChain` is bookkeeping only and always resolved, so the next queued mutation still runs.
 *
 * The names stored here come from remote ed2k/Kad peers, by way of `Downloads.ts`, so they are
 * bounded on the way in rather than trusted: `maxEntries`/`maxNamesPerEntry`/`maxNameLength` (all
 * constructor parameters, defaulting to `DEFAULT_MAX_ENTRIES`/`DEFAULT_MAX_NAMES_PER_ENTRY`/
 * `DEFAULT_MAX_NAME_LENGTH`) cap how large the cache can grow from that input alone. A name longer
 * than `maxNameLength` is dropped outright (nothing legitimate should ever hit the default, the
 * common filesystem filename length limit); a call that would add more distinct names to one entry
 * than `maxNamesPerEntry` allows keeps the ones already known and stops there; and a call that
 * would add a new entry past `maxEntries` evicts the least-recently-updated existing entries first,
 * the same "age decides what goes" policy `init()`'s own purge already uses.
 */
export class AlternateNamesCache {
   /**
    * Default for `maxEntries`.
    */
   public static readonly DEFAULT_MAX_ENTRIES = 10_000;

   /**
    * Default for `maxNamesPerEntry` - matches `MAX_FILENAMES` in the upstream C++ checkout's
    * `src/kademlia/kademlia/Entry.cpp`, the same cap on a Kad entry's own accumulated filename
    * variants, sized (per that file's own comment) to stay comfortably above what an honest
    * publisher set produces for one hash while bounding the unbounded RSS growth an uncapped list
    * caused in practice.
    */
   public static readonly DEFAULT_MAX_NAMES_PER_ENTRY = 100;

   /**
    * Default for `maxNameLength` - the common filesystem filename length limit (most filesystems
    * cap an individual filename at 255 bytes or UTF-16 code units), so no real filename should
    * ever hit it.
    */
   public static readonly DEFAULT_MAX_NAME_LENGTH = 255;

   private content = new Map<string, CacheEntry>();
   private loaded = false;
   private writeChain: Promise<void> = Promise.resolve();

   public constructor(
      private readonly path: string,
      private readonly maxEntries: number = AlternateNamesCache.DEFAULT_MAX_ENTRIES,
      private readonly maxNamesPerEntry: number = AlternateNamesCache.DEFAULT_MAX_NAMES_PER_ENTRY,
      private readonly maxNameLength: number = AlternateNamesCache.DEFAULT_MAX_NAME_LENGTH,
   ) {}

   /**
    * Loads the on-disk file into `this.content`, tolerating everything a hostile or truncated
    * file could do instead of throwing: a missing file reads as empty; a file that fails to parse
    * as JSON, or whose top level isn't a plain object, is treated as empty too, after a best-effort
    * copy is kept at `${path}.corrupt` (overwriting any previous one there) so nothing is silently
    * lost - if even that copy fails (a read-only directory, say), loading still proceeds as empty
    * rather than failing `ECEngine.start()` over it; and each entry is validated on its own
    * (`isValidEntry()`), a malformed one is dropped without discarding the rest of the file.
    */
   private async load(): Promise<void> {
      if (this.loaded) {
         return;
      }
      let raw: string;
      try {
         raw = await fs.readFile(this.path, "utf8");
      } catch (error) {
         if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
         }
         this.content = new Map();
         this.loaded = true;
         return;
      }
      let parsed: unknown;
      try {
         parsed = JSON.parse(raw);
      } catch {
         parsed = undefined;
      }
      if (!isPlainRecord(parsed)) {
         debug("load: %s is not a valid cache file, treating it as empty", this.path);
         await this.backUpCorruptFile();
         this.content = new Map();
         this.loaded = true;
         return;
      }
      const content = new Map<string, CacheEntry>();
      for (const [name, entry] of Object.entries(parsed)) {
         if (isValidEntry(entry)) {
            content.set(name, entry);
         } else {
            debug("load: dropping malformed entry %s", name);
         }
      }
      this.content = content;
      this.loaded = true;
   }

   /**
    * Renames the existing (unparseable, or not a plain object) file to `${path}.corrupt` - best
    * effort, since the point is to avoid losing data, not to add a new way for init() to fail.
    */
   private async backUpCorruptFile(): Promise<void> {
      try {
         await fs.rename(this.path, `${this.path}.corrupt`);
      } catch (error) {
         debug("load: could not back up the corrupt file: %s", (error as Error).message);
      }
   }

   /**
    * Writes the whole cache to a temporary file in the same directory, mode `0o600` (the file
    * lists filenames, so it is created private), then renames it over `path` - atomic on the same
    * filesystem, so a process killed mid-write leaves either the old file or the new one, never a
    * truncated one.
    */
   private async persist(): Promise<void> {
      const dir = nodePath.dirname(this.path);
      await fs.mkdir(dir, { recursive: true });
      const tmpPath = nodePath.join(dir, `.${nodePath.basename(this.path)}.${process.pid}.${Date.now()}.tmp`);
      const file: CacheFile = Object.fromEntries(this.content);
      await fs.writeFile(tmpPath, JSON.stringify(file, null, 3), { encoding: "utf8", mode: 0o600 });
      await fs.rename(tmpPath, this.path);
   }

   private mutate<T>(action: () => Promise<T>): Promise<T> {
      const run = this.writeChain.then(action);
      this.writeChain = run.then(
         () => undefined,
         () => undefined,
      );
      return run;
   }

   /**
    * Evicts the least-recently-updated entries, oldest first, until `this.content` has room for
    * one more - called from add() right before inserting a genuinely new key (updating an
    * existing one never grows `this.content`, so never needs this).
    */
   private evictOldestUntilRoomFor(oneMore: number): void {
      while (this.content.size + oneMore > this.maxEntries) {
         let oldestName: string | undefined;
         let oldestTime = Infinity;
         for (const [name, entry] of this.content) {
            const time = Date.parse(entry.lastUpdated);
            if (time < oldestTime) {
               oldestTime = time;
               oldestName = name;
            }
         }
         if (oldestName === undefined) {
            return;
         }
         this.content.delete(oldestName);
         debug("evictOldestUntilRoomFor: dropped %s to stay within maxEntries=%d", oldestName, this.maxEntries);
      }
   }

   /**
    * Loads the on-disk cache (if any - a missing file reads as empty, not an error) and purges
    * every entry not touched within `maxAgeMs`. Call once, before any add()/get()/remove() - see
    * ECEngine.start()'s use of this.
    */
   public async init(maxAgeMs: number): Promise<void> {
      await this.mutate(async () => {
         await this.load();
         const cutoff = Date.now() - maxAgeMs;
         let changed = false;
         for (const [name, entry] of this.content) {
            if (Date.parse(entry.lastUpdated) < cutoff) {
               this.content.delete(name);
               changed = true;
            }
         }
         if (changed) {
            await this.persist();
         }
         debug("init: %d entrie(s) after purge", this.content.size);
      });
   }

   /**
    * Merges `altNames` into whatever is already known for `name` (deduplicated, `name` itself
    * excluded) and persists - a no-op, including no write, if `altNames` is empty or leaves the
    * entry unchanged. `name` itself past `maxNameLength` is refused outright (there is no
    * reasonable entry to store it under); each candidate in `altNames` past `maxNameLength` is
    * dropped; once the entry already holds `maxNamesPerEntry` names, further distinct ones from
    * this call are dropped too, keeping the ones already known.
    */
   public async add(name: string, altNames: readonly string[]): Promise<void> {
      if (altNames.length === 0 || name.length > this.maxNameLength) {
         return;
      }
      await this.mutate(async () => {
         await this.load();
         const isNewEntry = !this.content.has(name);
         const existing = new Set(this.content.get(name)?.names ?? []);
         const before = existing.size;
         for (const altName of altNames) {
            if (existing.size >= this.maxNamesPerEntry) {
               break;
            }
            if (altName !== name && altName.length <= this.maxNameLength) {
               existing.add(altName);
            }
         }
         if (existing.size === before && !isNewEntry) {
            return;
         }
         if (isNewEntry) {
            this.evictOldestUntilRoomFor(1);
         }
         this.content.set(name, { names: [...existing], lastUpdated: new Date().toISOString() });
         await this.persist();
         debug("add: name=%s, +%d altName(s), total=%d", name, altNames.length, existing.size);
      });
   }

   /**
    * The alternate names known for `name`, empty if none. Synchronous, reading whatever
    * init()/add()/remove() last loaded into memory - safe to call once init() has resolved (the
    * ordering ECEngine.start()/ECEngine.altNamesCache already guarantee for its own instance).
    */
   public get(name: string): readonly string[] {
      return this.content.get(name)?.names ?? [];
   }

   /**
    * Drops `name`'s entry entirely - call once its file is moved out or deleted. A no-op,
    * including no write, if `name` isn't cached.
    */
   public async remove(name: string): Promise<void> {
      await this.mutate(async () => {
         await this.load();
         if (!this.content.delete(name)) {
            return;
         }
         await this.persist();
         debug("remove: name=%s", name);
      });
   }

   /**
    * Resolves once every add()/remove()/init() call issued before this one has settled on disk -
    * add()/remove() queue their write on `writeChain` synchronously (before their own returned
    * promise is even awaited), so this reliably waits for a fire-and-forget populate too, e.g.
    * Downloads.ts's cacheAltNamesIfEligible() from a caller (or a test) that never held onto that
    * specific call's promise.
    */
   public async flush(): Promise<void> {
      await this.writeChain;
   }
}
