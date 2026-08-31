import * as ec from "../../../src/index.js";
import { PRIORITY_NAMES } from "../help.js";
import { printSharedFiles } from "../views/sharedFiles.js";

/**
 * Shared-file commands (verify/comment/kadnotes/sharedprio/shareddir), plus "show shared" - all
 * operate on ec.SharedFiles alone.
 */
export class SharedFilesController {
   public constructor(
      private readonly sharedFiles: ec.SharedFiles,
      private readonly tracker: ec.SharedFileTracker,
   ) {}

   public async show(): Promise<void> {
      await this.sharedFiles.fetch();
      this.tracker.seed(this.sharedFiles);
      printSharedFiles(this.sharedFiles.files);
   }

   public async reload(): Promise<void> {
      await this.sharedFiles.reload();
      console.log("Shared file list reload requested.");
   }

   public async verify(args: string[]): Promise<void> {
      const hash = args[0];
      if (!hash) {
         console.error("Usage: verify <hash>");
         return;
      }
      await this.sharedFiles.verifyLocalData(hash);
      console.log(`Verification requested: ${hash}.`);
   }

   public async comment(args: string[]): Promise<void> {
      const hash = args[0];
      const ratingText = args[1];
      const text = args.slice(2).join(" ");
      const rating = ratingText ? Number(ratingText) : NaN;
      if (!hash || !text || !Number.isInteger(rating) || rating < 0 || rating > 5) {
         console.error("Usage: comment <hash> <rating 0-5> <text>");
         return;
      }
      await this.sharedFiles.setComment(hash, text, rating);
      console.log(`Comment set: ${hash}.`);
   }

   /**
    * `refreshmedia` (no args) re-probes the whole share; `refreshmedia <hash>` re-probes one file.
    */
   public async refreshMedia(args: string[]): Promise<void> {
      const hash = args[0];
      if (!hash) {
         const queued = await this.sharedFiles.refreshAllMediaMetadata();
         console.log(`Media metadata refresh requested for the whole share: ${queued} probe(s) queued.`);
         return;
      }
      await this.sharedFiles.refreshMediaMetadata(hash);
      console.log(`Media metadata refresh requested: ${hash}.`);
   }

   public async kadNotes(args: string[]): Promise<void> {
      const hash = args[0];
      if (!hash) {
         console.error("Usage: kadnotes <hash>");
         return;
      }
      await this.sharedFiles.searchKadNotes(hash);
      console.log(`Kad notes search requested: ${hash}.`);
   }

   public async sharedPrio(args: string[]): Promise<void> {
      const hash = args[0];
      const name = args[1]?.toLowerCase();
      const priority = name ? PRIORITY_NAMES[name] : undefined;
      if (!hash || priority === undefined) {
         console.error(`Usage: sharedprio <hash> <${Object.keys(PRIORITY_NAMES).join("|")}>`);
         return;
      }
      await this.sharedFiles.setPriority(hash, priority);
      console.log(`Shared file priority set: ${hash} -> ${name}.`);
   }

   public async showSharedDirs(): Promise<void> {
      const dirs = await this.sharedFiles.getSharedDirs();
      if (dirs.length === 0) {
         console.log("No shared directories configured.");
         return;
      }
      for (const dir of dirs) {
         console.log(`${dir.path}${dir.recursive ? " (recursive)" : ""}`);
      }
   }

   /**
    * Reports any rejections from setSharedDirs() - see SharedFiles.setSharedDirs()'s doc on why
    * this isn't all-or-nothing.
    */
   private reportSharedDirRejections(rejections: readonly ec.SharedDirRejection[]): void {
      for (const rejection of rejections) {
         const reasonText = rejection.reason === ec.SharedDirRejectReason.UNREADABLE ? "unreadable" : "missing or not a directory";
         console.error(`Rejected: ${rejection.path} (${reasonText}).`);
      }
   }

   public async sharedDirAdd(args: string[]): Promise<void> {
      const path = args[0];
      const recursive = args[1]?.toLowerCase() === "recursive";
      if (!path) {
         console.error("Usage: shareddir add <path> [recursive]");
         return;
      }
      const dirs = (await this.sharedFiles.getSharedDirs()).filter((dir) => dir.path !== path);
      dirs.push(new ec.SharedDir(path, recursive));
      const rejections = await this.sharedFiles.setSharedDirs(dirs);
      this.reportSharedDirRejections(rejections);
      console.log(`Shared directory added: ${path}.`);
   }

   public async sharedDirRemove(args: string[]): Promise<void> {
      const path = args[0];
      if (!path) {
         console.error("Usage: shareddir remove <path>");
         return;
      }
      const dirs = (await this.sharedFiles.getSharedDirs()).filter((dir) => dir.path !== path);
      const rejections = await this.sharedFiles.setSharedDirs(dirs);
      this.reportSharedDirRejections(rejections);
      console.log(`Shared directory removed: ${path}.`);
   }

   public async sharedDirDispatch(args: string[]): Promise<void> {
      const sub = args[0]?.toLowerCase();
      if (sub === "add") {
         return this.sharedDirAdd(args.slice(1));
      }
      if (sub === "remove") {
         return this.sharedDirRemove(args.slice(1));
      }
      console.error("Usage: shareddir <add <path> [recursive]|remove <path>>");
   }
}
