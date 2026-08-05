import * as ec from "../../../src/index.js";
import { formatSize } from "../format.js";
import { printFileComments } from "./downloads.js";

export function printSearchResult(result: ec.SearchResult): void {
   console.log(`${result.name}  [${result.hash}]`);
   console.log(
      `  size: ${formatSize(result.sizeFull)}  sources: ${result.sources}`,
   );
   printFileComments(result.comments, result.kadCommentSearching);
}

export function printSearchResults(results: readonly ec.SearchResult[]): void {
   if (results.length === 0) {
      console.log("No results.");
      return;
   }

   console.log(`${results.length} result(s):\n`);

   for (const result of results) {
      printSearchResult(result);
   }
}

export function printKnownSearches(searches: readonly ec.KnownSearch[]): void {
   if (searches.length === 0) {
      console.log("No searches known to the daemon.");
      return;
   }
   for (const search of searches) {
      console.log(
         `${search.id}: "${search.name}"  kind: ${ec.ECSearchType[search.kind]}` +
            `  state: ${ec.ECSearchLifecycleState[search.state]}`,
      );
   }
}
