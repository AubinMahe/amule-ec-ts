import * as ec from "../../../src/index.js";
import { PRIORITY_NAMES } from "../help.js";
import { printDownloadFiles } from "../views/downloads.js";

/**
 * Download-queue commands (cancel/pause/resume/stop/priority/swap/setcat/addlink/clear) - all
 * operate on ec.Downloads alone.
 */
export class DownloadsController {
   public constructor(
      private readonly downloads: ec.Downloads,
      private readonly tracker: ec.DownloadTracker,
   ) {}

   public async show(): Promise<void> {
      await this.downloads.fetch();
      this.tracker.seed(this.downloads);
      printDownloadFiles(this.downloads.files);
   }

   /**
    * Works on a shared file too, not just a download - see Downloads.rename()'s doc.
    */
   public async rename(args: string[]): Promise<void> {
      const hash = args[0];
      const newName = args.slice(1).join(" ");
      if (!hash || !newName) {
         console.error("Usage: rename <hash> <new-name>");
         return;
      }
      await this.downloads.rename(hash, newName);
      console.log(`Renamed: ${hash} -> ${newName}.`);
   }

   public async cancel(args: string[]): Promise<void> {
      const hash = args[0];
      if (!hash) {
         console.error("Usage: cancel <hash>");
         return;
      }
      await this.downloads.cancel(hash);
      console.log(`Cancelled: ${hash}.`);
   }

   public async pause(args: string[]): Promise<void> {
      const hash = args[0];
      if (!hash) {
         console.error("Usage: pause <hash>");
         return;
      }
      await this.downloads.pause(hash);
      console.log(`Paused: ${hash}.`);
   }

   public async resume(args: string[]): Promise<void> {
      const hash = args[0];
      if (!hash) {
         console.error("Usage: resume <hash>");
         return;
      }
      await this.downloads.resume(hash);
      console.log(`Resumed: ${hash}.`);
   }

   public async stop(args: string[]): Promise<void> {
      const hash = args[0];
      if (!hash) {
         console.error("Usage: stop <hash>");
         return;
      }
      await this.downloads.stop(hash);
      console.log(`Stopped: ${hash}.`);
   }

   public async priority(args: string[]): Promise<void> {
      const hash = args[0];
      const name = args[1]?.toLowerCase();
      const priority = name ? PRIORITY_NAMES[name] : undefined;
      if (!hash || priority === undefined) {
         console.error(`Usage: priority <hash> <${Object.keys(PRIORITY_NAMES).join("|")}>`);
         return;
      }
      await this.downloads.prioritySet(hash, priority);
      console.log(`Priority set: ${hash} -> ${name}.`);
   }

   public async swap(args: string[]): Promise<void> {
      const mode = args[0]?.toLowerCase();
      const hash = args[1];
      if (!hash || (mode !== "this" && mode !== "auto" && mode !== "others")) {
         console.error("Usage: swap <this|auto|others> <hash>");
         return;
      }
      if (mode === "this") {
         await this.downloads.swapA4AFThis(hash);
      } else if (mode === "auto") {
         await this.downloads.swapA4AFThisAuto(hash);
      } else {
         await this.downloads.swapA4AFOthers(hash);
      }
      console.log(`A4AF swap (${mode}) requested: ${hash}.`);
   }

   public async setCategory(args: string[]): Promise<void> {
      const hash = args[0];
      const indexText = args[1];
      const index = indexText ? Number(indexText) : NaN;
      if (!hash || Number.isNaN(index)) {
         console.error("Usage: setcat <hash> <category-index>");
         return;
      }
      await this.downloads.setCategory(hash, index);
      console.log(`Category set: ${hash} -> ${index}.`);
   }

   public async addLink(args: string[]): Promise<void> {
      const link = args[0];
      if (!link) {
         console.error("Usage: addlink <ed2k-link>");
         return;
      }
      await this.downloads.addLink(link);
      console.log(`Link added: ${link}.`);
   }

   /**
    * Fetches the download queue, clears every completed entry, and reports how many.
    */
   public async clearCompleted(): Promise<void> {
      await this.downloads.fetch();
      const ecids = this.downloads.files
         .filter((file) => file.status === BigInt(ec.ECPartFileStatus.PS_COMPLETE))
         .map((file) => file.ecid)
         .filter((ecid): ecid is bigint => ecid !== undefined);
      await this.downloads.clearCompleted(ecids);
      console.log(`Cleared: ${ecids.length} completed download(s).`);
   }
}
