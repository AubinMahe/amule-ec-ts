import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import * as ec from "../../src/index.js";
import { Repl } from "./Repl.js";

const HOST = "localhost";

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
      throw new Error(`No ECPassword found in [ExternalConnect] section of ${path}.`);
   }
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
