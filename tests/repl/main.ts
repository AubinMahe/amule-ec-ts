import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import * as ec from "../../src/index.js";
import { Repl } from "./Repl.js";

const HOST = "localhost";

interface ExternalConnectSettings {
   port: number;
   passwordHash: string;
}

function getPasswordFromEnv(): string | undefined {
   const envHash = process.env["EC_PASSWORD_HASH"];
   if (envHash) {
      return envHash.toLowerCase();
   }
   const envPass = process.env["EC_PASSWORD"];
   if (envPass !== undefined) {
      // eslint-disable-next-line sonarjs/hashing
      return createHash("md5").update(envPass, "utf8").digest("hex").toLowerCase();
   }
   return undefined;
}

async function promptForPassword(configPath: string): Promise<string> {
   if (process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
         const answer = await rl.question("Enter EC password: ");
         if (answer) {
            // eslint-disable-next-line sonarjs/hashing
            return createHash("md5").update(answer, "utf8").digest("hex").toLowerCase();
         }
      } finally {
         rl.close();
      }
   }
   throw new Error(
      `No ECPassword found in [ExternalConnect] section of ${configPath}. ` +
         "Set EC_PASSWORD / EC_PASSWORD_HASH environment variable or enter it interactively.",
   );
}

/**
 * Reads the local amuled's own ~/.aMule/amule.conf [ExternalConnect]
 * section - this REPL's only filesystem dependency, kept local to the tool
 * itself (the library has none, see ECEngine's doc: it takes host/port/
 * passwordHash directly and has no opinion on where they come from).
 */
async function readExternalConnectSettings(): Promise<ExternalConnectSettings> {
   let passwordHash = getPasswordFromEnv();
   const path = join(homedir(), ".aMule", "amule.conf");
   let lines: string[] = [];
   try {
      lines = readFileSync(path, "utf8").split(/\r?\n/);
   } catch {
      // amule.conf may not exist if credentials were provided via environment
   }
   let inSection = false;
   let port = 4712;
   for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.startsWith("[")) {
         inSection = line === "[ExternalConnect]";
         continue;
      }
      if (!inSection) {
         continue;
      }
      const portMatch = /^ECPort=(\d+)$/.exec(line);
      if (portMatch?.[1]) {
         port = Number(portMatch[1]);
         continue;
      }
      if (!passwordHash) {
         const passwordMatch = /^ECPassword=([0-9a-fA-F]{32})$/.exec(line);
         if (passwordMatch?.[1]) {
            passwordHash = passwordMatch[1].toLowerCase();
         }
      }
   }
   passwordHash ??= await promptForPassword(path);
   return { port, passwordHash };
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
      } else {
         console.error(`Unknown option: "${arg}"`);
         process.exit(1);
      }
   }
   return options;
}

async function main(): Promise<void> {
   const options = parseArgs(process.argv.slice(2));
   const { port, passwordHash } = await readExternalConnectSettings();
   await ec.ECEngine.start({ host: HOST, port, passwordHash, notify: options.notify, multiSearch: true, chatSessions: true });
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
