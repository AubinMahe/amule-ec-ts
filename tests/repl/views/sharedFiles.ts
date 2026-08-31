import * as ec from "../../../src/index.js";
import { formatSize, formatSpeed } from "../format.js";
import { printFileComments } from "./downloads.js";

export function printSharedFile(file: ec.SharedFile): void {
   if (file.removed) {
      console.log(`(removed)  [${file.hash ?? "unknown hash"}]`);
      return;
   }

   console.log(`${file.name ?? "(unknown name)"}  [${file.hash ?? "unknown hash"}]`);
   console.log(
      `  size: ${formatSize(file.sizeFull)}  uploaded: ${formatSize(file.uploadedTotal)}` +
         `  @ ${formatSpeed(file.uploadSpeed)}  uploading to: ${file.uploadingCount}` +
         `  requests: ${file.requestsTotal}  prio: ${file.prio}`,
   );
   if (file.path) {
      console.log(`  path: ${file.path}`);
   }
   printFileComments(file.comments, file.kadCommentSearching);
}

export function printSharedFiles(files: readonly ec.SharedFile[]): void {
   if (files.length === 0) {
      console.log("No shared files.");
      return;
   }

   console.log(`${files.length} shared file(s):\n`);

   for (const file of files) {
      printSharedFile(file);
   }
}
