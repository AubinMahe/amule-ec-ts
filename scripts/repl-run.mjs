#!/usr/bin/env node
// Feeds a list of commands to tests/repl/main.ts over stdin and forwards its
// stdout/stderr directly to this process - avoids scratch input/output files
// for one-off REPL smoke tests. "quit" is appended automatically.
//
// Usage: node scripts/repl-run.mjs [--debug=topic1,topic2] "command one" "command two" ...
// e.g.:  npm run repl-run -- --debug=amule-ec:statsgraphs "show statsgraphs" "show statsgraphs"

import { spawn } from "node:child_process";

const args = process.argv.slice(2);
let debugTopics;
const commands = [];
for (const arg of args) {
   if (arg.startsWith("--debug=")) {
      debugTopics = arg.slice("--debug=".length);
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
child.stdin.write(commands.join("\n") + "\nquit\n");
child.stdin.end();
child.on("exit", (code) => {
   process.exitCode = code ?? 0;
});
