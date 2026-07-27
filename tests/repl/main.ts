import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import * as ec from "../../src/index.js";

const HOST = "localhost";

const HELP =
   'Type a command ("help", "info", "show dl", "show ul", "show shared", "status"), "quit", "exit" or Ctrl-D to exit.\n';

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
   private readonly downloads   : ec.Downloads;
   private readonly uploads     : ec.Uploads;
   private readonly sharedFiles : ec.SharedFiles;

   constructor(private readonly connection: ec.ECConnection) {
      this.downloads   = new ec.Downloads(this.connection);
      this.uploads     = new ec.Uploads(this.connection);
      this.sharedFiles = new ec.SharedFiles(this.connection);
      this.status      = new ec.Status(this.connection);
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

   private async runCommand(command: string[]): Promise<void> {
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

         case "status":
            await this.status.fetch();
            printStatus(this.status);
            break;

         default:
            console.error(`Unknown command: "${command.join(" ")}"`);
            console.error(HELP);
      }
   }

   async run(): Promise<void> {
      const rl = readline.createInterface({ input: stdin, output: stdout });
      const closed = new Promise<"closed">((resolve) =>
         rl.once("close", () => { resolve("closed"); }),
      );
      console.log(HELP);
      for (;;) {
         const indicator = this.activity.consume();
         if (indicator) console.log(indicator);
         const answer = await Promise.race([rl.question("> "), closed]);
         if (answer === "closed") break;
         const command = answer.trim();
         if (command === "") continue;
         if (command.toLowerCase() === "quit" || command.toLowerCase() === "exit")
            break;
         await this.runCommand(command.split(/\s+/).filter(Boolean));
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
   await ec.ECEngine.start({ host: HOST, port, passwordHash, notify: options.notify });
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
