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
 */
export class AlternateNamesCache {
   private content = new Map<string, CacheEntry>();
   private loaded = false;
   private writeChain: Promise<void> = Promise.resolve();

   public constructor(private readonly path: string) {}

   private async load(): Promise<void> {
      if (this.loaded) return;
      try {
         const file = JSON.parse(await fs.readFile(this.path, "utf8")) as CacheFile;
         this.content = new Map(Object.entries(file));
      } catch (error) {
         if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
         this.content = new Map();
      }
      this.loaded = true;
   }

   private async persist(): Promise<void> {
      await fs.mkdir(nodePath.dirname(this.path), { recursive: true });
      const file: CacheFile = Object.fromEntries(this.content);
      await fs.writeFile(this.path, JSON.stringify(file, null, 3), "utf8");
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
         if (changed) await this.persist();
         debug("init: %d entrie(s) after purge", this.content.size);
      });
   }

   /**
    * Merges `altNames` into whatever is already known for `name` (deduplicated, `name` itself
    * excluded) and persists - a no-op, including no write, if `altNames` is empty or leaves the
    * entry unchanged.
    */
   public async add(name: string, altNames: readonly string[]): Promise<void> {
      if (altNames.length === 0) return;
      await this.mutate(async () => {
         await this.load();
         const existing = new Set(this.content.get(name)?.names ?? []);
         const before = existing.size;
         for (const altName of altNames) {
            if (altName !== name) existing.add(altName);
         }
         if (existing.size === before && this.content.has(name)) return;
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
         if (!this.content.delete(name)) return;
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
