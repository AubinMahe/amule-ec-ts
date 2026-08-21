import { expect } from "chai";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as ec from "../src/index.js";

describe("AlternateNamesCache", () => {
   let dir: string;
   let file: string;

   beforeEach(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), "amule-ec-alt-names-"));
      // Nested under `dir` rather than directly in it - also exercises persist()'s
      // mkdir(recursive).
      file = path.join(dir, "sub", "names.json");
   });

   afterEach(async () => {
      await fs.rm(dir, { recursive: true, force: true });
   });

   it("get() reads empty before anything is loaded/added", () => {
      const cache = new ec.AlternateNamesCache(file);
      expect(cache.get("Movie.mkv")).to.deep.equal([]);
   });

   it("add() merges and dedups, excluding the name itself", async () => {
      const cache = new ec.AlternateNamesCache(file);
      await cache.add("Movie.mkv", ["Movie.avi", "Movie.mkv", "Movie.avi", "Movie.release.mkv"]);
      expect(
         cache
            .get("Movie.mkv")
            .slice()
            .sort((a, b) => a.localeCompare(b)),
      ).to.deep.equal(["Movie.avi", "Movie.release.mkv"]);
   });

   it("add() with an empty list is a no-op - no file is created", async () => {
      const cache = new ec.AlternateNamesCache(file);
      await cache.add("Movie.mkv", []);
      const exists = await fs.access(file).then(
         () => true,
         () => false,
      );
      expect(exists).to.equal(false);
   });

   it("persists across instances pointing at the same path", async () => {
      const first = new ec.AlternateNamesCache(file);
      await first.add("Movie.mkv", ["Movie.avi"]);

      const second = new ec.AlternateNamesCache(file);
      await second.init(Number.MAX_SAFE_INTEGER); // load without purging - see init()'s doc
      expect(second.get("Movie.mkv")).to.deep.equal(["Movie.avi"]);
   });

   it("remove() drops the entry; a no-op, no throw, if the name isn't cached", async () => {
      const cache = new ec.AlternateNamesCache(file);
      await cache.add("Movie.mkv", ["Movie.avi"]);
      await cache.remove("Movie.mkv");
      expect(cache.get("Movie.mkv")).to.deep.equal([]);

      await cache.remove("Never.mkv");
   });

   it("init() on a file that doesn't exist yet starts empty, not an error", async () => {
      const cache = new ec.AlternateNamesCache(file);
      await cache.init(1_000);
      expect(cache.get("Anything.mkv")).to.deep.equal([]);
   });

   it("init() purges entries not touched within maxAgeMs, keeps the rest", async () => {
      const old = new Date(Date.now() - 100_000).toISOString();
      const recent = new Date().toISOString();
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(
         file,
         JSON.stringify({
            "Old.mkv": { names: ["old-alt.mkv"], lastUpdated: old },
            "Recent.mkv": { names: ["recent-alt.mkv"], lastUpdated: recent },
         }),
         "utf8",
      );

      const cache = new ec.AlternateNamesCache(file);
      await cache.init(50_000); // 50s max age: "old" (100s ago) is purged, "recent" survives

      expect(cache.get("Old.mkv")).to.deep.equal([]);
      expect(cache.get("Recent.mkv")).to.deep.equal(["recent-alt.mkv"]);
   });

   it("flush() waits for a fire-and-forget add() issued just before it", async () => {
      const cache = new ec.AlternateNamesCache(file);
      // Not awaited - mirrors Downloads.ts's cacheAltNamesIfEligible(), a fire-and-forget populate.
      void cache.add("Movie.mkv", ["Movie.avi"]);
      await cache.flush();
      expect(cache.get("Movie.mkv")).to.deep.equal(["Movie.avi"]);
   });

   it("serializes concurrent add() calls onto the same file without losing data", async () => {
      const cache = new ec.AlternateNamesCache(file);
      await Promise.all([
         cache.add("Movie.mkv", ["Alt1.mkv"]),
         cache.add("Movie.mkv", ["Alt2.mkv"]),
         cache.add("OtherFile.mkv", ["OtherAlt.mkv"]),
      ]);
      expect(
         cache
            .get("Movie.mkv")
            .slice()
            .sort((a, b) => a.localeCompare(b)),
      ).to.deep.equal(["Alt1.mkv", "Alt2.mkv"]);
      expect(cache.get("OtherFile.mkv")).to.deep.equal(["OtherAlt.mkv"]);

      // A fresh instance reloading from disk sees the same result - proves it was actually
      // persisted.
      const reloaded = new ec.AlternateNamesCache(file);
      await reloaded.init(Number.MAX_SAFE_INTEGER);
      expect(
         reloaded
            .get("Movie.mkv")
            .slice()
            .sort((a, b) => a.localeCompare(b)),
      ).to.deep.equal(["Alt1.mkv", "Alt2.mkv"]);
   });
});
