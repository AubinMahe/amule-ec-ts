import { setTimeout } from "node:timers/promises";
import * as ec from "../../../src/index.js";
import { printKnownSearches, printSearchResults } from "../views/search.js";

const SEARCH_POLL_INTERVAL_MS = 250;

/**
 * search/search stop/search more, plus download (of search results) - owns the current search
 * session.
 */
export class SearchController {
   private currentSearch?: ec.SearchSession;

   public constructor(private readonly search: ec.Search) {}

   public async more(args: string[]): Promise<void> {
      const idText = args[0];
      const id = idText ? BigInt(idText) : this.currentSearch?.id;
      const reaskable = await this.search.requestMore(id);
      const suffix = id !== undefined ? `: search ${id}` : "";
      let reaskableText = "unknown (daemon predates this)";
      if (reaskable !== undefined) {
         reaskableText = reaskable ? "yes" : "no";
      }
      console.log(`More results requested${suffix}. Still reaskable: ${reaskableText}.`);
   }

   /**
    * Starts a search, polls it to completion, then prints the results - mirrors amulecmd's own
    * search/progress/results/download command sequence.
    */
   public async start(args: string[]): Promise<void> {
      if (args.length === 1 && args[0]?.toLowerCase() === "stop") {
         if (!this.currentSearch) {
            console.log("No active search.");
            return;
         }
         await this.currentSearch.stop();
         console.log("Search stopped.");
         return;
      }
      if (args[0]?.toLowerCase() === "more") {
         return this.more(args.slice(1));
      }
      if (args.length === 0) {
         console.error("Usage: search <keywords>  |  search stop  |  search more [id]");
         return;
      }
      const keywords = args.join(" ");
      const session = await this.search.start({ keywords });
      this.currentSearch = session;
      let progress: ec.ECSearchProgress;
      do {
         await setTimeout(SEARCH_POLL_INTERVAL_MS);
         progress = await session.progress();
      } while (progress.state === ec.ECSearchLifecycleState.RUNNING);
      await session.fetch();
      printSearchResults(session.results);
   }

   public async showKnown(): Promise<void> {
      const searches = await this.search.list();
      printKnownSearches(searches);
   }

   /**
    * Downloads one or more of the last search's results, identified by hash - see
    * Search.download()'s doc.
    */
   public async download(hashes: string[]): Promise<void> {
      if (hashes.length === 0) {
         console.error("Usage: download <hash> [<hash> ...]");
         return;
      }
      await this.search.download(hashes);
      console.log(`Download requested: ${hashes.length} file(s).`);
   }
}
