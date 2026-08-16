import * as ec from "../../../src/index.js";
import { formatPercent, formatSize, formatSpeed } from "../format.js";

/** Shared by printDownloadFile/printSharedFile/printSearchResult - prints the Kad-notes-searching flag and each community comment, if any. */
export function printFileComments(comments: readonly ec.FileComment[] | undefined, kadCommentSearching: boolean | undefined): void {
   if (kadCommentSearching) {
      console.log("  Kad notes search in progress...");
   }
   for (const comment of comments ?? []) {
      console.log(`  [${ec.FileRating[comment.rating]}] ${comment.userName}: ${comment.comment}`);
   }
}

export function printDownloadFile(file: ec.DownloadFile): void {
   if (file.removed) {
      console.log(`(removed)  [${file.hash ?? "unknown hash"}]`);
      return;
   }

   console.log(`${file.name ?? "(unknown name)"}  [${file.hash ?? "unknown hash"}]`);
   console.log(
      `  ${formatPercent(file.sizeDone, file.sizeFull)}  ${formatSize(file.sizeDone)} / ${formatSize(file.sizeFull)}` +
         `  @ ${formatSpeed(file.speed)}  sources: ${file.sources ?? "?"}  prio: ${file.prio ?? "?"}  status: ${file.status ?? "?"}`,
   );
   if (file.partMetName) {
      console.log(`  temp file: ${file.partMetName}`);
   }
   printFileComments(file.comments, file.kadCommentSearching);
}

export function printDownloadFiles(files: readonly ec.DownloadFile[]): void {
   if (files.length === 0) {
      console.log("No active downloads.");
      return;
   }

   console.log(`${files.length} download(s):\n`);

   for (const file of files) {
      printDownloadFile(file);
   }
}
