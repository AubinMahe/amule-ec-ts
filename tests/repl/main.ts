import * as readline from "node:readline/promises";
import { setTimeout } from "node:timers/promises";
import { stdin, stdout } from "node:process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import * as ec from "../../src/index.js";

const HOST = "localhost";

const SEARCH_POLL_INTERVAL_MS = 250;

const PRIORITY_NAMES: Record<string, ec.ECDownloadPriority> = {
   low: ec.ECDownloadPriority.PR_LOW,
   normal: ec.ECDownloadPriority.PR_NORMAL,
   high: ec.ECDownloadPriority.PR_HIGH,
   veryhigh: ec.ECDownloadPriority.PR_VERYHIGH,
   verylow: ec.ECDownloadPriority.PR_VERY_LOW,
   auto: ec.ECDownloadPriority.PR_AUTO,
   powershare: ec.ECDownloadPriority.PR_POWERSHARE,
};

const SERVER_PRIORITY_NAMES: Record<string, ec.ServerPriority> = {
   normal: ec.ServerPriority.SRV_PR_NORMAL,
   high: ec.ServerPriority.SRV_PR_HIGH,
   low: ec.ServerPriority.SRV_PR_LOW,
};

/** One row per command: keyword(s)/arguments, then a short description - see HELP below. */
const HELP_ENTRIES: readonly (readonly [command: string, description: string])[] = [
   ["help", "show this help"],
   ["info", "negotiated capabilities"],
   ["status", "connection state and transfer stats"],
   ["show statsgraphs", "transfer-history graph points since the last call"],
   ["show dl", "download queue"],
   ["show ul", "upload queue"],
   ["show shared", "shared files"],
   ["show servers", "known server list"],
   ["show log", "daemon log"],
   ["reset log", "clear the daemon log"],
   ["show log last", "the daemon log's single latest line"],
   ["addlog <text>", "append a line to the daemon log"],
   ["show debug log", "daemon debug log"],
   ["reset debug log", "clear the daemon debug log"],
   ["adddebuglog <text>", "append a line to the daemon debug log"],
   ["connect <ip:port>", "connect to a specific server"],
   ["connect", "connect to ed2k/Kad per the daemon's preferences"],
   ["disconnect", "disconnect from ed2k/Kad"],
   ["search <keywords>", "start a search"],
   ["search stop", "stop the running search"],
   ["search more [id]", "re-ask Kad peers for more results (current search if id omitted)"],
   ["show searches", "list every search the daemon currently holds"],
   ["download <hash>...", "download one or more search results"],
   ["cancel <hash>", "cancel a download"],
   ["pause <hash>", "pause a download"],
   ["resume <hash>", "resume a paused download"],
   ["stop <hash>", "stop a download"],
   [
      `priority <hash> <${Object.keys(PRIORITY_NAMES).join("|")}>`,
      "set a download's priority",
   ],
   ["addlink <ed2k-link>", "start a download from a link"],
   ["swap <this|auto|others> <hash>", "swap A4AF sources for a download"],
   ["setcat <hash> <category-index>", "assign a download to a category"],
   ["category create <title> <path> [comment] [color] [prio]", "create a download category"],
   [
      "category update <index> <title> <path> [comment] [color] [prio]",
      "update a download category",
   ],
   ["category delete <index>", "delete a download category"],
   ["clear completed", "clear completed downloads"],
   ["kad start", "start the Kademlia network"],
   ["kad stop", "stop the Kademlia network"],
   ["kad bootstrap <ip> <port>", "bootstrap Kad from a known node"],
   ["kad update <url>", "update Kad's nodes.dat from a URL"],
   ["server disconnect", "disconnect from the current ed2k server"],
   [
      `server priority <ecid> [static|nostatic] [${Object.keys(SERVER_PRIORITY_NAMES).join("|")}]`,
      "set a known server's static flag and/or priority",
   ],
   ["server remove <ip:port>", "remove a server from the known list"],
   ["server add <ip:port> [name]", "add a server to the known list"],
   ["server update <url>", "update the known server list from a server.met URL"],
   ["show server log", "daemon's ed2k-connection log"],
   ["reset server log", "clear the ed2k-connection log"],
   [
      `sharedprio <hash> <${Object.keys(PRIORITY_NAMES).join("|")}>`,
      "set a shared file's upload priority",
   ],
   ["show shareddirs", "list the daemon's shared directories"],
   ["shareddir add <path> [recursive]", "add a shared directory"],
   ["shareddir remove <path>", "remove a shared directory"],
   ["shutdown", "tell the daemon to terminate"],
   ["checkversion", "trigger an on-demand check for a new aMule release"],
   ["swapclient <client-ecid> <hash>", "move an uploading client to another download"],
   ["verify <hash>", "verify a shared file's local data against its hash"],
   ["ipfilter reload", "reload the IP filter from its local file"],
   ["ipfilter update [url]", "update the IP filter from a URL (or the configured default)"],
   ["show prefs messagefilter", "message filter preferences"],
   ["prefs messagefilter <on|off>", "enable/disable the message filter (preserves other fields)"],
   ["show prefs connections", "connection preferences"],
   [
      "prefs connections reconnect <on|off>",
      "toggle ed2k auto-reconnect (preserves other fields)",
   ],
   ["show prefs coretweaks", "core tweaks preferences"],
   [
      "prefs coretweaks verbose <on|off>",
      "toggle core verbose logging (preserves other fields)",
   ],
   ["show categories", "list download categories"],
   ["friend add <ecid>", "add a connected client as a friend"],
   ["friend add <hash> <ip> <port> <name>", "add a friend not currently connected"],
   ["friend remove <ecid>", "remove a friend"],
   ["friend slot <ecid> <on|off>", "reserve/clear a friend's upload slot"],
   ["comment <hash> <rating 0-5> <text>", "set a shared file's comment/rating"],
   ["kadnotes <hash>", "search Kad for a file's community notes"],
   ["show chat", "drain buffered incoming chat messages"],
   ["quit / exit / Ctrl-D", "leave the REPL"],
];

const HELP_COMMAND_WIDTH = Math.max(...HELP_ENTRIES.map(([command]) => command.length));

const HELP =
   "Commands:\n" +
   HELP_ENTRIES.map(
      ([command, description]) => `  ${command.padEnd(HELP_COMMAND_WIDTH)}  ${description}`,
   ).join("\n") +
   "\n";

interface ExternalConnectSettings {
   port: number;
   passwordHash: string;
}

/**
 * Reads the local amuled's own ~/.aMule/amule.conf [ExternalConnect]
 * section - this REPL's only filesystem dependency, kept local to the tool
 * itself (the library has none, see ECEngine's doc: it takes host/port/
 * passwordHash directly and has no opinion on where they come from).
 */
function readExternalConnectSettings(): ExternalConnectSettings {
   const path = join(homedir(), ".aMule", "amule.conf");
   const lines = readFileSync(path, "utf8").split(/\r?\n/);
   let inSection = false;
   let port = 4712;
   let passwordHash: string | undefined;
   for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.startsWith("[")) {
         inSection = line === "[ExternalConnect]";
         continue;
      }
      if (!inSection) continue;
      const portMatch = /^ECPort=(\d+)$/.exec(line);
      if (portMatch?.[1]) {
         port = Number(portMatch[1]);
         continue;
      }
      const passwordMatch = /^ECPassword=([0-9a-fA-F]{32})$/.exec(line);
      if (passwordMatch?.[1]) {
         passwordHash = passwordMatch[1].toLowerCase();
      }
   }
   if (!passwordHash) {
      throw new Error(
         `No ECPassword found in [ExternalConnect] section of ${path}.`,
      );
   }
   return { port, passwordHash };
}

function formatSize(bytes: bigint | undefined): string {
   if (bytes === undefined) return "?";

   const units = ["B", "KB", "MB", "GB", "TB"];
   let value = Number(bytes);
   let unitIndex = 0;

   while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
   }

   return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatSpeed(bytesPerSecond: bigint | undefined): string {
   if (bytesPerSecond === undefined) return "?";
   return `${formatSize(bytesPerSecond)}/s`;
}

function formatPercent(
   done: bigint | undefined,
   full: bigint | undefined,
): string {
   if (done === undefined || full === undefined || full === 0n) return "  ?%";
   const percent = (Number(done) / Number(full)) * 100;
   return `${percent.toFixed(1).padStart(5, " ")}%`;
}

/** Shared by printDownloadFile/printSharedFile/printSearchResult - prints the Kad-notes-searching flag and each community comment, if any. */
function printFileComments(
   comments: readonly ec.FileComment[] | undefined,
   kadCommentSearching: boolean | undefined,
): void {
   if (kadCommentSearching) {
      console.log("  Kad notes search in progress...");
   }
   for (const comment of comments ?? []) {
      console.log(
         `  [${ec.FileRating[comment.rating]}] ${comment.userName}: ${comment.comment}`,
      );
   }
}

function printDownloadFile(file: ec.DownloadFile): void {
   if (file.removed) {
      console.log(`(removed)  [${file.hash ?? "unknown hash"}]`);
      return;
   }

   console.log(
      `${file.name ?? "(unknown name)"}  [${file.hash ?? "unknown hash"}]`,
   );
   console.log(
      `  ${formatPercent(file.sizeDone, file.sizeFull)}  ${formatSize(file.sizeDone)} / ${formatSize(file.sizeFull)}` +
         `  @ ${formatSpeed(file.speed)}  sources: ${file.sources ?? "?"}  prio: ${file.prio ?? "?"}  status: ${file.status ?? "?"}`,
   );
   printFileComments(file.comments, file.kadCommentSearching);
}

function printDownloadFiles(files: readonly ec.DownloadFile[]): void {
   if (files.length === 0) {
      console.log("No active downloads.");
      return;
   }

   console.log(`${files.length} download(s):\n`);

   for (const file of files) {
      printDownloadFile(file);
   }
}

function printUploadClient(client: ec.UploadClient): void {
   console.log(`${client.name}  [${client.hash}]`);
   console.log(
      `  file: ${client.fileName ?? "(none)"}` +
         `  @ ${formatSpeed(client.speedUp)}  session: ${formatSpeed(client.sessionUp)}` +
         `  total: ${client.totalUp ?? "?"}  software: ${client.software ?? "?"}  state: ${client.uploadState ?? "?"}`,
   );
}

function printUploadClients(clients: readonly ec.UploadClient[]): void {
   if (clients.length === 0) {
      console.log("No active uploads.");
      return;
   }

   console.log(`${clients.length} upload(s):\n`);

   for (const client of clients) {
      printUploadClient(client);
   }
}

function printSharedFile(file: ec.SharedFile): void {
   if (file.removed) {
      console.log(`(removed)  [${file.hash ?? "unknown hash"}]`);
      return;
   }

   console.log(
      `${file.name ?? "(unknown name)"}  [${file.hash ?? "unknown hash"}]`,
   );
   console.log(
      `  size: ${formatSize(file.sizeFull)}  uploaded: ${formatSize(file.uploadedTotal)}` +
         `  @ ${formatSpeed(file.uploadSpeed)}  uploading to: ${file.uploadingCount ?? "?"}` +
         `  requests: ${file.requestsTotal ?? "?"}  prio: ${file.prio ?? "?"}`,
   );
   printFileComments(file.comments, file.kadCommentSearching);
}

function printSharedFiles(files: readonly ec.SharedFile[]): void {
   if (files.length === 0) {
      console.log("No shared files.");
      return;
   }

   console.log(`${files.length} shared file(s):\n`);

   for (const file of files) {
      printSharedFile(file);
   }
}

function printMessageFilterPrefs(prefs: ec.MessageFilterPrefs): void {
   console.log(`enabled: ${prefs.enabled}`);
   console.log(
      `  filterAll: ${prefs.filterAll}  friendsOnly: ${prefs.friendsOnly}  secureOnly: ${prefs.secureOnly}`,
   );
   console.log(`  byKeyword: ${prefs.byKeyword}  keywords: "${prefs.keywords}"`);
   console.log(
      `  showInLog: ${prefs.showInLog}  filterComments: ${prefs.filterComments}  commentKeywords: "${prefs.commentKeywords}"`,
   );
}

function printConnectionsPrefs(prefs: ec.ConnectionsPrefs): void {
   console.log(
      `graph caps: ul ${prefs.maxGraphUploadRate} / dl ${prefs.maxGraphDownloadRate}  actual caps: ul ${prefs.maxUpload} / dl ${prefs.maxDownload}`,
   );
   console.log(
      `  slotAllocation: ${prefs.slotAllocation}  tcpPort: ${prefs.tcpPort}  udpPort: ${prefs.udpPort}  udpDisabled: ${prefs.udpDisabled}`,
   );
   console.log(
      `  maxSourcesPerFile: ${prefs.maxSourcesPerFile}  maxConnections: ${prefs.maxConnections}`,
   );
   console.log(
      `  autoConnect: ${prefs.autoConnect}  reconnect: ${prefs.reconnect}  networkEd2k: ${prefs.networkEd2k}  networkKademlia: ${prefs.networkKademlia}`,
   );
   console.log(
      `  bindAddress: "${prefs.bindAddress}"  bindInterface: "${prefs.bindInterface}"`,
   );
   console.log(
      `  proxy: enabled=${prefs.proxy.enabled} type=${ec.ECProxyType[prefs.proxy.type]} host=${prefs.proxy.host} port=${prefs.proxy.port}`,
   );
   console.log(`  upnpEnabled: ${prefs.upnpEnabled}  upnpTcpPort: ${prefs.upnpTcpPort}`);
}

function printCoreTweaksPrefs(prefs: ec.CoreTweaksPrefs): void {
   console.log(
      `maxConnPerFive: ${prefs.maxConnPerFive}  verbose: ${prefs.verbose}`,
   );
   console.log(
      `  fileBufferSize: ${prefs.fileBufferSize}B  uploadQueueSize: ${prefs.uploadQueueSize}`,
   );
   console.log(
      `  serverKeepAliveTimeoutMs: ${prefs.serverKeepAliveTimeoutMs}  kadMaxSourceSearches: ${prefs.kadMaxSourceSearches}`,
   );
   console.log(
      `  kadSourceReaskMs: ${prefs.kadSourceReaskMs}  sourceReaskMs: ${prefs.sourceReaskMs}`,
   );
}

function printCategories(categories: readonly ec.Category[]): void {
   if (categories.length === 0) {
      console.log("No categories beyond the built-in default (\"All\").");
      return;
   }

   console.log(`${categories.length} categor(y/ies):\n`);

   for (const category of categories) {
      console.log(`[${category.index}] ${category.title}  (${category.path})`);
      console.log(
         `  comment: "${category.comment}"  color: ${category.color}  prio: ${category.prio}`,
      );
   }
}

function printServer(server: ec.ServerInfo): void {
   console.log(`${server.name ?? "(unknown name)"}  [${server.ipPort}]`);
   console.log(
      `  ping: ${server.ping ?? "?"}ms  users: ${server.users ?? "?"}/${server.usersMax ?? "?"}  files: ${server.files ?? "?"}`,
   );
}

function printServers(servers: readonly ec.ServerInfo[]): void {
   if (servers.length === 0) {
      console.log("No known servers.");
      return;
   }

   console.log(`${servers.length} server(s):\n`);

   for (const server of servers) {
      printServer(server);
   }
}

function printSearchResult(result: ec.SearchResult): void {
   console.log(`${result.name}  [${result.hash}]`);
   console.log(
      `  size: ${formatSize(result.sizeFull)}  sources: ${result.sources}`,
   );
   printFileComments(result.comments, result.kadCommentSearching);
}

function printSearchResults(results: readonly ec.SearchResult[]): void {
   if (results.length === 0) {
      console.log("No results.");
      return;
   }

   console.log(`${results.length} result(s):\n`);

   for (const result of results) {
      printSearchResult(result);
   }
}

function printKnownSearches(searches: readonly ec.KnownSearch[]): void {
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

function printLog(lines: readonly string[]): void {
   if (lines.length === 0) {
      console.log("Log is empty.");
      return;
   }

   for (const line of lines) {
      console.log(line);
   }
}

function printChatMessages(messages: readonly ec.ChatMessage[]): void {
   if (messages.length === 0) {
      console.log("No new chat messages.");
      return;
   }

   for (const message of messages) {
      console.log(`[${message.senderId}] ${message.text}`);
   }
}

function formatIdLabel(status: ec.Status): string {
   if (status.hasLowId === undefined) return "";
   return status.hasLowId ? " (Low ID)" : " (High ID)";
}

function formatEd2kState(status: ec.Status): string {
   if (status.ed2kConnected) {
      const server = status.serverName ? ` - ${status.serverName}` : "";
      return `connected${server}${formatIdLabel(status)}`;
   }
   return status.ed2kConnecting ? "connecting" : "disconnected";
}

function formatKadState(status: ec.Status): string {
   if (status.kadConnected) return "connected";
   if (!status.kadRunning) return "off";
   return status.kadFirewalled ? "firewalled" : "running";
}

function printStatus(status: ec.Status): void {
   if (status.ed2kConnected !== undefined || status.kadConnected !== undefined) {
      console.log(
         `ed2k: ${formatEd2kState(status)}  kad: ${formatKadState(status)}`,
      );
   }

   if (status.uploadSpeed === undefined && status.downloadSpeed === undefined)
      return;

   console.log(
      `up: ${formatSpeed(status.uploadSpeed)} (limit ${formatSpeed(status.uploadSpeedLimit)}, queue: ${status.uploadQueueLength ?? "?"})` +
         `  down: ${formatSpeed(status.downloadSpeed)} (limit ${formatSpeed(status.downloadSpeedLimit)})`,
   );
   console.log(
      `sources: ${status.totalSourceCount ?? "?"}` +
         `  ed2k: ${status.ed2kUsers ?? "?"} users / ${status.ed2kFiles ?? "?"} files` +
         `  kad: ${status.kadUsers ?? "?"} users / ${status.kadFiles ?? "?"} files / ${status.kadNodes ?? "?"} nodes`,
   );
}

function printStatsGraphs(statsGraphs: ec.StatsGraphs): void {
   if (statsGraphs.points.length === 0) {
      console.log("No new graph points.");
      return;
   }
   for (const point of statsGraphs.points) {
      const clients =
         point.uploadingClients !== undefined || point.downloadingClients !== undefined
            ? `  clients up: ${point.uploadingClients ?? "?"} down: ${point.downloadingClients ?? "?"}`
            : "";
      console.log(
         `down: ${formatSpeed(point.downloadSpeed)}  up: ${formatSpeed(point.uploadSpeed)}` +
            `  connections: ${point.connections}  kad nodes: ${point.kadNodes}${clients}`,
      );
   }
   console.log(
      `session: down ${formatSize(statsGraphs.sessionDownloaded)} / up ${formatSize(statsGraphs.sessionUploaded)}` +
         `  kad nodes: ${statsGraphs.sessionKadNodes ?? "?"}` +
         `  timespan: ${statsGraphs.sessionTimespan?.toFixed(0) ?? "?"}s`,
   );
}

/**
 * Presentation-side tally of what's changed via push notifications since
 * the REPL last showed it, so the prompt can point the user at a command
 * instead of dumping full details for every single update as it arrives.
 */
class NotificationActivity {
   private downloadUpdates = 0;
   private sharedFileUpdates = 0;
   private statusChanged = false;

   public noteDownloadUpdate(): void {
      this.downloadUpdates++;
   }

   public noteSharedFileUpdate(): void {
      this.sharedFileUpdates++;
   }

   public noteStatusChange(): void {
      this.statusChanged = true;
   }

   /** Returns (and clears) a one-line summary of what changed, or undefined if nothing did. */
   public consume(): string | undefined {
      const parts: string[] = [];

      if (this.downloadUpdates > 0) {
         parts.push(`show dl (${this.downloadUpdates})`);
      }
      if (this.sharedFileUpdates > 0) {
         parts.push(`show shared (${this.sharedFileUpdates})`);
      }
      if (this.statusChanged) {
         parts.push("status");
      }

      this.downloadUpdates = 0;
      this.sharedFileUpdates = 0;
      this.statusChanged = false;

      return parts.length > 0
         ? `Updates available: ${parts.join(", ")}`
         : undefined;
   }
}

/**
 * A connected, authenticated EC session driving the interactive REPL -
 * owns the connection and every piece of state a command or a pushed
 * notification can touch, so runCommand()/applyNotification()/repl() read
 * it off `this` instead of threading five parameters through each call.
 */
class Repl {
   private readonly downloadTracker   = new ec.DownloadTracker();
   private readonly sharedFileTracker = new ec.SharedFileTracker();
   private readonly activity          = new NotificationActivity();
   private readonly status      : ec.Status;
   private readonly statsGraphs : ec.StatsGraphs;
   private readonly downloads   : ec.Downloads;
   private readonly categories  : ec.Categories;
   private readonly uploads     : ec.Uploads;
   private readonly sharedFiles : ec.SharedFiles;
   private readonly servers     : ec.Servers;
   private readonly search      : ec.Search;
   private readonly log         : ec.Log;
   private readonly kad         : ec.Kad;
   private readonly serverLog   : ec.ServerLog;
   private readonly daemon      : ec.Daemon;
   private readonly debugLog    : ec.DebugLog;
   private readonly friends     : ec.Friends;
   private readonly chat        : ec.Chat;
   private readonly ipFilter    : ec.IPFilter;
   private readonly preferences : ec.Preferences;
   private currentSearch?: ec.SearchSession;

   constructor(private readonly connection: ec.ECConnection) {
      this.downloads   = new ec.Downloads(this.connection);
      this.categories  = new ec.Categories(this.connection);
      this.uploads     = new ec.Uploads(this.connection);
      this.sharedFiles = new ec.SharedFiles(this.connection);
      this.status      = new ec.Status(this.connection);
      this.statsGraphs = new ec.StatsGraphs(this.connection);
      this.servers     = new ec.Servers(this.connection);
      this.search      = new ec.Search(this.connection);
      this.log         = new ec.Log(this.connection);
      this.kad         = new ec.Kad(this.connection);
      this.serverLog   = new ec.ServerLog(this.connection);
      this.daemon      = new ec.Daemon(this.connection);
      this.debugLog    = new ec.DebugLog(this.connection);
      this.friends     = new ec.Friends(this.connection);
      this.chat        = new ec.Chat(this.connection);
      this.ipFilter    = new ec.IPFilter(this.connection);
      this.preferences = new ec.Preferences(this.connection);
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

      if (this.status.applyNotification(packet)) {
         this.activity.noteStatusChange();
         return;
      }

      if (this.connection.localCapabilities.notify) {
         console.log(
            `[ec] unhandled notification opcode 0x${packet.opcode.toString(16)}`,
         );
      }
   }

   private async runSearchMore(args: string[]): Promise<void> {
      const idText = args[0];
      const id = idText ? BigInt(idText) : this.currentSearch?.id;
      await this.search.requestMore(id);
      const suffix = id !== undefined ? `: search ${id}` : "";
      console.log(`More results requested${suffix}.`);
   }

   /** Starts a search, polls it to completion, then prints the results - mirrors amulecmd's own search/progress/results/download command sequence. */
   private async runSearch(args: string[]): Promise<void> {
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
         return this.runSearchMore(args.slice(1));
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

   /** Bare "connect" is Kad.connect() (ed2k/Kad per daemon prefs); "connect <ip:port>" is Servers.connect(). */
   private async runConnect(args: string[]): Promise<void> {
      const ipPort = args[0];
      if (!ipPort) {
         const messages = await this.kad.connect();
         console.log(messages.length > 0 ? messages.join("\n") : "Nothing to connect to.");
         return;
      }
      await this.servers.connect(ipPort);
      console.log(`Connect requested: ${ipPort}.`);
   }

   private async runDisconnect(): Promise<void> {
      const messages = await this.kad.disconnect();
      console.log(messages.length > 0 ? messages.join("\n") : "Nothing was connected.");
   }

   private async runKad(args: string[]): Promise<void> {
      const sub = args[0]?.toLowerCase();
      switch (sub) {
         case "start":
            await this.kad.start();
            console.log("Kad started.");
            return;

         case "stop":
            await this.kad.stop();
            console.log("Kad stopped.");
            return;

         case "update": {
            const url = args[1];
            if (!url) {
               console.error("Usage: kad update <url>");
               return;
            }
            await this.kad.updateNodesFromUrl(url);
            console.log(`nodes.dat update requested: ${url}.`);
            return;
         }

         case "bootstrap": {
            const ip = args[1];
            const port = Number(args[2]);
            if (!ip || !args[2] || Number.isNaN(port)) {
               console.error("Usage: kad bootstrap <ip> <port>");
               return;
            }
            await this.kad.bootstrapFromIp(ip, port);
            console.log(`Bootstrap requested: ${ip}:${port}.`);
            return;
         }

         default:
            console.error("Usage: kad <start|stop|update <url>|bootstrap <ip> <port>>");
      }
   }

   /** Downloads one or more of the last search's results, identified by hash - see Search.download()'s doc. */
   private async runDownload(hashes: string[]): Promise<void> {
      if (hashes.length === 0) {
         console.error("Usage: download <hash> [<hash> ...]");
         return;
      }
      await this.search.download(hashes);
      console.log(`Download requested: ${hashes.length} file(s).`);
   }

   private async runCancel(args: string[]): Promise<void> {
      const hash = args[0];
      if (!hash) {
         console.error("Usage: cancel <hash>");
         return;
      }
      await this.downloads.cancel(hash);
      console.log(`Cancelled: ${hash}.`);
   }

   private async runPause(args: string[]): Promise<void> {
      const hash = args[0];
      if (!hash) {
         console.error("Usage: pause <hash>");
         return;
      }
      await this.downloads.pause(hash);
      console.log(`Paused: ${hash}.`);
   }

   private async runResume(args: string[]): Promise<void> {
      const hash = args[0];
      if (!hash) {
         console.error("Usage: resume <hash>");
         return;
      }
      await this.downloads.resume(hash);
      console.log(`Resumed: ${hash}.`);
   }

   private async runStop(args: string[]): Promise<void> {
      const hash = args[0];
      if (!hash) {
         console.error("Usage: stop <hash>");
         return;
      }
      await this.downloads.stop(hash);
      console.log(`Stopped: ${hash}.`);
   }

   private async runPriority(args: string[]): Promise<void> {
      const hash = args[0];
      const name = args[1]?.toLowerCase();
      const priority = name ? PRIORITY_NAMES[name] : undefined;
      if (!hash || priority === undefined) {
         console.error(
            `Usage: priority <hash> <${Object.keys(PRIORITY_NAMES).join("|")}>`,
         );
         return;
      }
      await this.downloads.prioritySet(hash, priority);
      console.log(`Priority set: ${hash} -> ${name}.`);
   }

   private async runSwap(args: string[]): Promise<void> {
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

   private async runSetCategory(args: string[]): Promise<void> {
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

   private async runCategoryCreate(args: string[]): Promise<void> {
      const [title, path, comment, colorText, prioText] = args;
      if (!title || !path) {
         console.error("Usage: category create <title> <path> [comment] [color] [prio]");
         return;
      }
      await this.categories.create(
         title,
         path,
         comment,
         colorText === undefined ? undefined : Number(colorText),
         prioText === undefined ? undefined : Number(prioText),
      );
      console.log(`Category created: ${title}.`);
   }

   private async runCategoryUpdate(args: string[]): Promise<void> {
      const [indexText, title, path, comment, colorText, prioText] = args;
      const index = indexText ? Number(indexText) : NaN;
      if (Number.isNaN(index) || !title || !path) {
         console.error(
            "Usage: category update <index> <title> <path> [comment] [color] [prio]",
         );
         return;
      }
      await this.categories.update(
         index,
         title,
         path,
         comment,
         colorText === undefined ? undefined : Number(colorText),
         prioText === undefined ? undefined : Number(prioText),
      );
      console.log(`Category updated: ${index}.`);
   }

   private async runCategoryDelete(args: string[]): Promise<void> {
      const indexText = args[0];
      const index = indexText ? Number(indexText) : NaN;
      if (Number.isNaN(index)) {
         console.error("Usage: category delete <index>");
         return;
      }
      await this.categories.delete(index);
      console.log(`Category deleted: ${index}.`);
   }

   private async runCategory(args: string[]): Promise<void> {
      const sub = args[0]?.toLowerCase();
      if (sub === "create") return this.runCategoryCreate(args.slice(1));
      if (sub === "update") return this.runCategoryUpdate(args.slice(1));
      if (sub === "delete") return this.runCategoryDelete(args.slice(1));
      console.error("Usage: category <create ...|update ...|delete <index>>");
   }

   private async runAddLink(args: string[]): Promise<void> {
      const link = args[0];
      if (!link) {
         console.error("Usage: addlink <ed2k-link>");
         return;
      }
      await this.downloads.addLink(link);
      console.log(`Link added: ${link}.`);
   }

   /** Fetches the download queue, clears every completed entry, and reports how many. */
   private async runClearCompleted(): Promise<void> {
      await this.downloads.fetch();
      const ecids = this.downloads.files
         .filter((file) => file.status === BigInt(ec.ECPartFileStatus.PS_COMPLETE))
         .map((file) => file.ecid)
         .filter((ecid): ecid is bigint => ecid !== undefined);
      await this.downloads.clearCompleted(ecids);
      console.log(`Cleared: ${ecids.length} completed download(s).`);
   }

   private async runServerPriority(args: string[]): Promise<void> {
      const ecidText = args[0];
      const options: { static?: boolean; prio?: ec.ServerPriority } = {};
      for (const token of args.slice(1)) {
         const lower = token.toLowerCase();
         if (lower === "static") options.static = true;
         else if (lower === "nostatic") options.static = false;
         else if (lower in SERVER_PRIORITY_NAMES) options.prio = SERVER_PRIORITY_NAMES[lower];
      }
      if (!ecidText || (options.static === undefined && options.prio === undefined)) {
         console.error(
            `Usage: server priority <ecid> [static|nostatic] [${Object.keys(SERVER_PRIORITY_NAMES).join("|")}]`,
         );
         return;
      }
      await this.servers.setStaticPrio(BigInt(ecidText), options);
      console.log(`Server priority updated: ecid=${ecidText}.`);
   }

   private async runServerRemove(args: string[]): Promise<void> {
      const ipPort = args[0];
      if (!ipPort) {
         console.error("Usage: server remove <ip:port>");
         return;
      }
      await this.servers.remove(ipPort);
      console.log(`Server removed: ${ipPort}.`);
   }

   private async runServerAdd(args: string[]): Promise<void> {
      const ipPort = args[0];
      if (!ipPort) {
         console.error("Usage: server add <ip:port> [name]");
         return;
      }
      const name = args.slice(1).join(" ");
      await this.servers.add(ipPort, name);
      console.log(`Server added: ${ipPort}.`);
   }

   private async runServerUpdate(args: string[]): Promise<void> {
      const url = args[0];
      if (!url) {
         console.error("Usage: server update <url>");
         return;
      }
      await this.servers.updateFromUrl(url);
      console.log(`Server list update requested: ${url}.`);
   }

   private async runServer(args: string[]): Promise<void> {
      const sub = args[0]?.toLowerCase();
      if (sub === "disconnect") {
         await this.servers.disconnect();
         console.log("Disconnected from the current server.");
         return;
      }
      if (sub === "priority") {
         await this.runServerPriority(args.slice(1));
         return;
      }
      if (sub === "remove") return this.runServerRemove(args.slice(1));
      if (sub === "add") return this.runServerAdd(args.slice(1));
      if (sub === "update") return this.runServerUpdate(args.slice(1));
      console.error(
         "Usage: server <disconnect|priority ...|remove <ip:port>|add <ip:port> [name]|update <url>>",
      );
   }

   private async runShutdown(): Promise<void> {
      await this.daemon.shutdown();
      console.log("Shutdown requested.");
   }

   private async runCheckVersion(): Promise<void> {
      await this.daemon.checkVersion();
      console.log("Version check requested.");
   }

   private async runSwapClient(args: string[]): Promise<void> {
      const ecidText = args[0];
      const hash = args[1];
      if (!ecidText || !hash) {
         console.error("Usage: swapclient <client-ecid> <hash>");
         return;
      }
      await this.uploads.swapClientToAnotherFile(BigInt(ecidText), hash);
      console.log(`Swap requested: client ${ecidText} -> ${hash}.`);
   }

   private async runVerify(args: string[]): Promise<void> {
      const hash = args[0];
      if (!hash) {
         console.error("Usage: verify <hash>");
         return;
      }
      await this.sharedFiles.verifyLocalData(hash);
      console.log(`Verification requested: ${hash}.`);
   }

   private async runIpfilter(args: string[]): Promise<void> {
      const sub = args[0]?.toLowerCase();
      if (sub === "reload") {
         await this.ipFilter.reload();
         console.log("IP filter reloaded.");
         return;
      }
      if (sub === "update") {
         const url = args[1];
         await this.ipFilter.updateFromUrl(url);
         console.log(`IP filter update requested: ${url ?? "(default URL)"}.`);
         return;
      }
      console.error("Usage: ipfilter <reload|update [url]>");
   }

   private async runPrefs(args: string[]): Promise<void> {
      const section = args[0]?.toLowerCase();
      const rest = args.slice(1);
      if (section === "messagefilter") {
         await this.runPrefsMessageFilter(rest);
         return;
      }
      if (section === "connections") {
         await this.runPrefsConnections(rest);
         return;
      }
      if (section === "coretweaks") {
         await this.runPrefsCoreTweaks(rest);
         return;
      }
      console.error("Usage: prefs <messagefilter|connections|coretweaks> ...");
   }

   private async runPrefsMessageFilter(args: string[]): Promise<void> {
      const onOff = args[0]?.toLowerCase();
      if (onOff !== "on" && onOff !== "off") {
         console.error("Usage: prefs messagefilter <on|off>");
         return;
      }
      const current = await this.preferences.getMessageFilter();
      await this.preferences.setMessageFilter({
         ...current,
         enabled: onOff === "on",
      });
      console.log(`Message filter ${onOff === "on" ? "enabled" : "disabled"}.`);
   }

   private async runPrefsConnections(args: string[]): Promise<void> {
      const field = args[0]?.toLowerCase();
      const onOff = args[1]?.toLowerCase();
      if (field !== "reconnect" || (onOff !== "on" && onOff !== "off")) {
         console.error("Usage: prefs connections reconnect <on|off>");
         return;
      }
      const current = await this.preferences.getConnections();
      await this.preferences.setConnections({
         ...current,
         reconnect: onOff === "on",
      });
      console.log(
         `ed2k auto-reconnect ${onOff === "on" ? "enabled" : "disabled"}.`,
      );
   }

   private async runPrefsCoreTweaks(args: string[]): Promise<void> {
      const field = args[0]?.toLowerCase();
      const onOff = args[1]?.toLowerCase();
      if (field !== "verbose" || (onOff !== "on" && onOff !== "off")) {
         console.error("Usage: prefs coretweaks verbose <on|off>");
         return;
      }
      const current = await this.preferences.getCoreTweaks();
      await this.preferences.setCoreTweaks({
         ...current,
         verbose: onOff === "on",
      });
      console.log(
         `Core verbose logging ${onOff === "on" ? "enabled" : "disabled"}.`,
      );
   }

   private async runAddLog(args: string[]): Promise<void> {
      const text = args.join(" ");
      if (!text) {
         console.error("Usage: addlog <text>");
         return;
      }
      await this.log.addLine(text);
      console.log("Log line added.");
   }

   /** Always passes toStatus: true - see DebugLog.addLine()'s doc: without it, a non-debug-build daemon silently drops the line. */
   private async runAddDebugLog(args: string[]): Promise<void> {
      const text = args.join(" ");
      if (!text) {
         console.error("Usage: adddebuglog <text>");
         return;
      }
      await this.debugLog.addLine(text, true);
      console.log("Debug log line added.");
   }

   private async runFriendAdd(args: string[]): Promise<void> {
      if (args.length === 1) {
         const [ecid] = args as [string];
         await this.friends.addByEcid(BigInt(ecid));
         console.log(`Friend added: ecid=${ecid}.`);
         return;
      }
      if (args.length === 4) {
         const [hash, ip, portText, name] = args as [string, string, string, string];
         await this.friends.addByHash(hash, ip, Number(portText), name);
         console.log(`Friend added: ${name}.`);
         return;
      }
      console.error("Usage: friend add <ecid>  |  friend add <hash> <ip> <port> <name>");
   }

   private async runFriend(args: string[]): Promise<void> {
      const sub = args[0]?.toLowerCase();
      if (sub === "add") {
         await this.runFriendAdd(args.slice(1));
         return;
      }
      if (sub === "remove") {
         const ecid = args[1];
         if (!ecid) {
            console.error("Usage: friend remove <ecid>");
            return;
         }
         await this.friends.remove(BigInt(ecid));
         console.log(`Friend removed: ecid=${ecid}.`);
         return;
      }
      if (sub === "slot") {
         const ecid = args[1];
         const state = args[2]?.toLowerCase();
         if (!ecid || (state !== "on" && state !== "off")) {
            console.error("Usage: friend slot <ecid> <on|off>");
            return;
         }
         await this.friends.setFriendSlot(BigInt(ecid), state === "on");
         console.log(`Friend slot ${state}: ecid=${ecid}.`);
         return;
      }
      console.error("Usage: friend <add ...|remove <ecid>|slot <ecid> <on|off>>");
   }

   private async runComment(args: string[]): Promise<void> {
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

   private async runKadNotes(args: string[]): Promise<void> {
      const hash = args[0];
      if (!hash) {
         console.error("Usage: kadnotes <hash>");
         return;
      }
      await this.sharedFiles.searchKadNotes(hash);
      console.log(`Kad notes search requested: ${hash}.`);
   }

   private async runSharedPrio(args: string[]): Promise<void> {
      const hash = args[0];
      const name = args[1]?.toLowerCase();
      const priority = name ? PRIORITY_NAMES[name] : undefined;
      if (!hash || priority === undefined) {
         console.error(
            `Usage: sharedprio <hash> <${Object.keys(PRIORITY_NAMES).join("|")}>`,
         );
         return;
      }
      await this.sharedFiles.setPriority(hash, priority);
      console.log(`Shared file priority set: ${hash} -> ${name}.`);
   }

   private async runShowSharedDirs(): Promise<void> {
      const dirs = await this.sharedFiles.getSharedDirs();
      if (dirs.length === 0) {
         console.log("No shared directories configured.");
         return;
      }
      for (const dir of dirs) {
         console.log(`${dir.path}${dir.recursive ? " (recursive)" : ""}`);
      }
   }

   /** Reports any rejections from setSharedDirs() - see SharedFiles.setSharedDirs()'s doc on why this isn't all-or-nothing. */
   private reportSharedDirRejections(rejections: readonly ec.SharedDirRejection[]): void {
      for (const rejection of rejections) {
         const reasonText =
            rejection.reason === ec.SharedDirRejectReason.UNREADABLE
               ? "unreadable"
               : "missing or not a directory";
         console.error(`Rejected: ${rejection.path} (${reasonText}).`);
      }
   }

   private async runSharedDirAdd(args: string[]): Promise<void> {
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

   private async runSharedDirRemove(args: string[]): Promise<void> {
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

   private async runSharedDir(args: string[]): Promise<void> {
      const sub = args[0]?.toLowerCase();
      if (sub === "add") return this.runSharedDirAdd(args.slice(1));
      if (sub === "remove") return this.runSharedDirRemove(args.slice(1));
      console.error("Usage: shareddir <add <path> [recursive]|remove <path>>");
   }

   /** Verbs that take a variable argument list, dispatched by lookup rather than a long if-chain (keeps runCommand()'s complexity down). */
   private readonly verbHandlers: Record<string, (args: string[]) => Promise<void>> = {
      search: (args) => this.runSearch(args),
      connect: (args) => this.runConnect(args),
      download: (args) => this.runDownload(args),
      cancel: (args) => this.runCancel(args),
      pause: (args) => this.runPause(args),
      resume: (args) => this.runResume(args),
      stop: (args) => this.runStop(args),
      priority: (args) => this.runPriority(args),
      addlink: (args) => this.runAddLink(args),
      swap: (args) => this.runSwap(args),
      setcat: (args) => this.runSetCategory(args),
      category: (args) => this.runCategory(args),
      disconnect: () => this.runDisconnect(),
      kad: (args) => this.runKad(args),
      server: (args) => this.runServer(args),
      shutdown: () => this.runShutdown(),
      checkversion: () => this.runCheckVersion(),
      swapclient: (args) => this.runSwapClient(args),
      verify: (args) => this.runVerify(args),
      ipfilter: (args) => this.runIpfilter(args),
      prefs: (args) => this.runPrefs(args),
      addlog: (args) => this.runAddLog(args),
      adddebuglog: (args) => this.runAddDebugLog(args),
      friend: (args) => this.runFriend(args),
      comment: (args) => this.runComment(args),
      kadnotes: (args) => this.runKadNotes(args),
      sharedprio: (args) => this.runSharedPrio(args),
      shareddir: (args) => this.runSharedDir(args),
   };

   private async runCommand(command: string[]): Promise<void> {
      const verb = command[0]?.toLowerCase();
      const handler = verb ? this.verbHandlers[verb] : undefined;
      if (handler) {
         await handler(command.slice(1));
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

         case "show dl": {
            await this.downloads.fetch();
            this.downloadTracker.seed(this.downloads);
            printDownloadFiles(this.downloads.files);
            break;
         }

         case "show ul": {
            await this.uploads.fetch();
            printUploadClients(this.uploads.clients);
            break;
         }

         case "show shared": {
            await this.sharedFiles.fetch();
            this.sharedFileTracker.seed(this.sharedFiles);
            printSharedFiles(this.sharedFiles.files);
            break;
         }

         case "show shareddirs":
            await this.runShowSharedDirs();
            break;

         case "show prefs messagefilter": {
            const prefs = await this.preferences.getMessageFilter();
            printMessageFilterPrefs(prefs);
            break;
         }

         case "show prefs connections": {
            const prefs = await this.preferences.getConnections();
            printConnectionsPrefs(prefs);
            break;
         }

         case "show prefs coretweaks": {
            const prefs = await this.preferences.getCoreTweaks();
            printCoreTweaksPrefs(prefs);
            break;
         }

         case "show categories": {
            const categories = await this.preferences.listCategories();
            printCategories(categories);
            break;
         }

         case "clear completed":
            await this.runClearCompleted();
            break;

         case "show servers": {
            await this.servers.fetch();
            printServers(this.servers.servers);
            break;
         }

         case "show searches": {
            const searches = await this.search.list();
            printKnownSearches(searches);
            break;
         }

         case "show log": {
            await this.log.fetch();
            printLog(this.log.lines);
            break;
         }

         case "reset log":
            await this.log.reset();
            console.log("Log cleared.");
            break;

         case "show log last": {
            const last = await this.log.fetchLast();
            console.log(last ?? "Log is empty.");
            break;
         }

         case "show debug log": {
            await this.debugLog.fetch();
            printLog(this.debugLog.lines);
            break;
         }

         case "reset debug log":
            await this.debugLog.reset();
            console.log("Debug log cleared.");
            break;

         case "show chat": {
            await this.chat.fetch();
            printChatMessages(this.chat.messages);
            break;
         }

         case "show server log": {
            await this.serverLog.fetch();
            printLog(this.serverLog.lines);
            break;
         }

         case "reset server log":
            await this.serverLog.reset();
            console.log("Server log cleared.");
            break;

         case "status":
            await this.status.fetch();
            printStatus(this.status);
            break;

         case "show statsgraphs":
            // scale/width match amule-remote-gui.cpp/WebServer.cpp's own
            // polling convention (see StatsGraphs.fetch()'s doc) - omitting
            // them isn't "use the daemon's default", it's width=0, which
            // always looks like "no new points".
            await this.statsGraphs.fetch({ last: this.statsGraphs.last, scale: 1, width: 32 });
            printStatsGraphs(this.statsGraphs);
            break;

         default:
            console.error(`Unknown command: "${command.join(" ")}"`);
            console.error(HELP);
      }
   }

   async run(): Promise<void> {
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

   terminate(): void {
      this.connection.close();
   }
}

interface CliOptions {
   notify: boolean;
}

function parseArgs(argv: string[]): CliOptions {
   const options: CliOptions = {
      notify: false,
   };
   for (const arg of argv) {
      if (arg === "--notify") {
         options.notify = true;
      }
      else {
         console.error(`Unknown option: "${arg}"`);
         process.exit(1);
      }
   }
   return options;
}

async function main(): Promise<void> {
   const options = parseArgs(process.argv.slice(2));
   const { port, passwordHash } = readExternalConnectSettings();
   await ec.ECEngine.start({ host: HOST, port, passwordHash, notify: options.notify, multiSearch: true });
   const repl = new Repl(ec.ECEngine.connection);
   try {
      await repl.run();
   } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exitCode = 1;
   } finally {
      repl.terminate();
   }
}

await main();
