#!/usr/bin/env node
// Feeds a list of commands to tests/repl/main.ts over stdin and forwards its
// stdout/stderr directly to this process - avoids scratch input/output files
// for one-off REPL smoke tests. "quit" is appended automatically.
//
// Usage: node scripts/repl-run.mjs [--debug=topic1,topic2] [--delay=ms] "command one" "command two" ...
// e.g.:  npm run repl-run -- --debug=amule-ec:statsgraphs "show statsgraphs" "show statsgraphs"

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
let debugTopics;
let delayMs = 0;
const commands = [];
for (const arg of args) {
   if (arg.startsWith("--debug=")) {
      debugTopics = arg.slice("--debug=".length);
   } else if (arg.startsWith("--delay=")) {
      delayMs = Number.parseInt(arg.slice("--delay=".length), 10) || 0;
   } else {
      commands.push(arg);
   }
}

const env = { ...process.env };
if (debugTopics) {
   env.NODE_DEBUG = debugTopics;
}

const child = spawn("node", ["--import", "tsx", "tests/repl/main.ts"], {
   stdio: ["pipe", "inherit", "inherit"],
   env,
});

async function feedCommands() {
   for (let i = 0; i < commands.length; i++) {
      child.stdin.write(commands[i] + "\n");
      if (delayMs > 0 && i < commands.length - 1) {
         await sleep(delayMs);
      }
   }
   child.stdin.write("quit\n");
   child.stdin.end();
}

feedCommands().catch((err) => {
   console.error(err);
   process.exitCode = 1;
});
child.on("exit", (code) => {
   process.exitCode = code ?? 0;
});
