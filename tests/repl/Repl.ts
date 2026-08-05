import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

import * as ec from "../../src/index.js";
import { HELP } from "./help.js";
import { NotificationActivity } from "./notificationActivity.js";
import { DownloadsController } from "./controllers/downloads.js";
import { CategoriesController } from "./controllers/categories.js";
import { SearchController } from "./controllers/search.js";
import { NetworkController } from "./controllers/network.js";
import { ServersController } from "./controllers/servers.js";
import { UploadsController } from "./controllers/uploads.js";
import { SharedFilesController } from "./controllers/sharedFiles.js";
import { DaemonController } from "./controllers/daemon.js";
import { IPFilterController } from "./controllers/ipFilter.js";
import { FriendsController } from "./controllers/friends.js";
import { LogController, DebugLogController, ServerLogController } from "./controllers/logs.js";
import { ChatController } from "./controllers/chat.js";
import { StatusController } from "./controllers/status.js";
import { StatsGraphsController } from "./controllers/statsGraphs.js";
import { UpdateController } from "./controllers/update.js";
import { StatsTreeController } from "./controllers/statsTree.js";
import { PreferencesController } from "./controllers/preferences.js";

/**
 * A connected, authenticated EC session driving the interactive REPL -
 * owns the connection and delegates every command to a thin, per-feature
 * controller (`./controllers/*`), so this class stays a router rather than
 * a second copy of the library's own logic. Shared state a single feature
 * doesn't own outright (the notification trackers, the activity tally)
 * stays here since applyNotification() and more than one controller touch
 * it.
 */
export class Repl {
   private readonly downloadTracker   = new ec.DownloadTracker();
   private readonly sharedFileTracker = new ec.SharedFileTracker();
   private readonly activity          = new NotificationActivity();

   private readonly downloadsController    : DownloadsController;
   private readonly categoriesController   : CategoriesController;
   private readonly searchController       : SearchController;
   private readonly networkController      : NetworkController;
   private readonly serversController      : ServersController;
   private readonly uploadsController      : UploadsController;
   private readonly sharedFilesController  : SharedFilesController;
   private readonly daemonController       : DaemonController;
   private readonly ipFilterController     : IPFilterController;
   private readonly friendsController      : FriendsController;
   private readonly logController          : LogController;
   private readonly debugLogController     : DebugLogController;
   private readonly serverLogController    : ServerLogController;
   private readonly chatController         : ChatController;
   private readonly statusController       : StatusController;
   private readonly statsGraphsController  : StatsGraphsController;
   private readonly updateController       : UpdateController;
   private readonly statsTreeController    : StatsTreeController;
   private readonly preferencesController  : PreferencesController;

   public constructor(private readonly connection: ec.ECConnection) {
      const servers = new ec.Servers(connection);
      this.downloadsController   = new DownloadsController(new ec.Downloads(connection), this.downloadTracker);
      this.categoriesController  = new CategoriesController(new ec.Categories(connection));
      this.searchController      = new SearchController(new ec.Search(connection));
      this.networkController     = new NetworkController(new ec.Kad(connection), servers);
      this.serversController     = new ServersController(servers);
      this.uploadsController     = new UploadsController(new ec.Uploads(connection));
      this.sharedFilesController = new SharedFilesController(new ec.SharedFiles(connection), this.sharedFileTracker);
      this.daemonController      = new DaemonController(new ec.Daemon(connection));
      this.ipFilterController    = new IPFilterController(new ec.IPFilter(connection));
      this.friendsController     = new FriendsController(new ec.Friends(connection));
      this.logController         = new LogController(new ec.Log(connection));
      this.debugLogController    = new DebugLogController(new ec.DebugLog(connection));
      this.serverLogController   = new ServerLogController(new ec.ServerLog(connection));
      this.chatController        = new ChatController(new ec.Chat(connection));
      this.statusController      = new StatusController(new ec.Status(connection));
      this.statsGraphsController = new StatsGraphsController(new ec.StatsGraphs(connection));
      this.updateController      = new UpdateController(new ec.Update(connection));
      this.statsTreeController   = new StatsTreeController(new ec.StatsTree(connection));
      this.preferencesController = new PreferencesController(new ec.Preferences(connection));
      this.connection.onNotification((packet) => {this.applyNotification(packet)});
   }

   /** Functional: applies the notification to the relevant tracker. Returns nothing - see NotificationActivity for the presentation side. */
   private applyNotification(packet: ec.ECPacket): void {
      if (this.downloadTracker.apply(packet)) {
         this.activity.noteDownloadUpdate();
         return;
      }

      if (this.sharedFileTracker.apply(packet)) {
         this.activity.noteSharedFileUpdate();
         return;
      }

      if (this.statusController.applyNotification(packet)) {
         this.activity.noteStatusChange();
         return;
      }

      if (this.connection.localCapabilities.notify) {
         console.log(
            `[ec] unhandled notification opcode 0x${packet.opcode.toString(16)}`,
         );
      }
   }

   /** Verbs that take a variable argument list, dispatched by lookup rather than a long if-chain (keeps runCommand()'s complexity down). */
   private readonly verbHandlers: Record<string, (args: string[]) => Promise<void>> = {
      search: (args) => this.searchController.start(args),
      connect: (args) => this.networkController.connect(args),
      download: (args) => this.searchController.download(args),
      cancel: (args) => this.downloadsController.cancel(args),
      pause: (args) => this.downloadsController.pause(args),
      resume: (args) => this.downloadsController.resume(args),
      stop: (args) => this.downloadsController.stop(args),
      priority: (args) => this.downloadsController.priority(args),
      addlink: (args) => this.downloadsController.addLink(args),
      swap: (args) => this.downloadsController.swap(args),
      setcat: (args) => this.downloadsController.setCategory(args),
      category: (args) => this.categoriesController.dispatch(args),
      disconnect: () => this.networkController.disconnect(),
      kad: (args) => this.networkController.kadCommand(args),
      server: (args) => this.serversController.dispatch(args),
      shutdown: () => this.daemonController.shutdown(),
      checkversion: () => this.daemonController.checkVersion(),
      swapclient: (args) => this.uploadsController.swapClient(args),
      verify: (args) => this.sharedFilesController.verify(args),
      ipfilter: (args) => this.ipFilterController.dispatch(args),
      prefs: (args) => this.preferencesController.dispatch(args),
      addlog: (args) => this.logController.addLine(args),
      adddebuglog: (args) => this.debugLogController.addLine(args),
      friend: (args) => this.friendsController.dispatch(args),
      comment: (args) => this.sharedFilesController.comment(args),
      kadnotes: (args) => this.sharedFilesController.kadNotes(args),
      sharedprio: (args) => this.sharedFilesController.sharedPrio(args),
      shareddir: (args) => this.sharedFilesController.sharedDirDispatch(args),
   };

   private async runCommand(command: string[]): Promise<void> {
      const verb = command[0]?.toLowerCase();
      const handler = verb ? this.verbHandlers[verb] : undefined;
      if (handler) {
         await handler(command.slice(1));
         return;
      }

      if (verb === "show" && command[1]?.toLowerCase() === "prefs" && command[2]) {
         await this.preferencesController.showSection(command[2].toLowerCase());
         return;
      }

      if (verb === "show" && command[1]?.toLowerCase() === "statstree") {
         await this.statsTreeController.show(command[2]);
         return;
      }

      const joined = command.join(" ").toLowerCase();

      switch (joined) {
         case "help":
            console.log(HELP);
            break;

         case "info":
            console.log("Negotiated capabilities:");
            console.log(
               `  large tag count : ${this.connection.remoteCapabilities.largeTagCount}`,
            );
            console.log(
               `  partial update  : ${this.connection.remoteCapabilities.partialUpdate}`,
            );
            break;

         case "show dl":
            await this.downloadsController.show();
            break;

         case "show ul":
            await this.uploadsController.show();
            break;

         case "show shared":
            await this.sharedFilesController.show();
            break;

         case "show shareddirs":
            await this.sharedFilesController.showSharedDirs();
            break;

         case "show categories":
            await this.preferencesController.showCategories();
            break;

         case "show update":
            await this.updateController.show();
            break;

         case "clear completed":
            await this.downloadsController.clearCompleted();
            break;

         case "show servers":
            await this.serversController.show();
            break;

         case "show searches":
            await this.searchController.showKnown();
            break;

         case "show log":
            await this.logController.show();
            break;

         case "reset log":
            await this.logController.reset();
            break;

         case "show log last":
            await this.logController.showLast();
            break;

         case "show debug log":
            await this.debugLogController.show();
            break;

         case "reset debug log":
            await this.debugLogController.reset();
            break;

         case "show chat":
            await this.chatController.show();
            break;

         case "show server log":
            await this.serverLogController.show();
            break;

         case "reset server log":
            await this.serverLogController.reset();
            break;

         case "status":
            await this.statusController.show();
            break;

         case "show statsgraphs":
            await this.statsGraphsController.show();
            break;

         default:
            console.error(`Unknown command: "${command.join(" ")}"`);
            console.error(HELP);
      }
   }

   public async run(): Promise<void> {
      const rl = readline.createInterface({ input: stdin, output: stdout });
      /**
       * Reused across every iteration - each .next() freshly checks the
       * stream's current state (buffered line vs. genuinely ended), unlike
       * a one-shot `rl.once("close", ...)` promise raced against
       * `rl.question()`: that promise resolves once and stays resolved,
       * so once stdin's EOF fires it wins every future race immediately -
       * even while lines that arrived before EOF are still queued waiting
       * to be processed (piped/scripted input hits this constantly: all
       * lines and EOF land in the same event-loop tick, so the very first
       * command after the stream closes gets silently dropped instead of
       * run). Confirmed live: piping several REPL commands with no delay
       * between them only ever ran the first one.
       */
      const lines = rl[Symbol.asyncIterator]();
      console.log(HELP);
      for (;;) {
         const indicator = this.activity.consume();
         if (indicator) console.log(indicator);
         stdout.write("> ");
         const next = await lines.next();
         if (next.done) break;
         const command = next.value.trim();
         if (command === "") continue;
         if (command.toLowerCase() === "quit" || command.toLowerCase() === "exit")
            break;
         try {
            await this.runCommand(command.split(/\s+/).filter(Boolean));
         } catch (error) {
            console.error("Error:", error instanceof Error ? error.message : error);
         }
      }
      rl.close();
   }

   public terminate(): void {
      this.connection.close();
   }
}
