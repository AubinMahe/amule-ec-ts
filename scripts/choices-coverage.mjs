#!/usr/bin/env node
// Counts the Supported/Tested/REPL checkmarks in CHOICES.md's opcode coverage
// table, for keeping that section's intro paragraph numbers in sync after
// editing rows.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const choicesPath = join(dirname(fileURLToPath(import.meta.url)), "..", "CHOICES.md");
const lines = readFileSync(choicesPath, "utf8").split(/\r?\n/);

let supported = 0;
let tested = 0;
let repl = 0;
for (const line of lines) {
   if (!line.startsWith("|0x")) continue;
   const columns = line.split("|");
   if (columns[4] === "✓") supported++;
   if (columns[5] === "✓") tested++;
   if (columns[7] === "✓") repl++;
}

console.log(`supported=${supported} tested=${tested} repl=${repl}`);
