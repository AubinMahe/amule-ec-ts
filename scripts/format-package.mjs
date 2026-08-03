#!/usr/bin/env node
// JSON pretty-printer with vertical value alignment (sorts keys,
// then aligns ':' on each object's longest key).
import { readFileSync, writeFileSync } from "node:fs";

const INDENT = "   ";

function sortKey(key, value) {
   const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
   return [isObject ? 2 : 1, key.toLowerCase(), key];
}

function compareEntries([keyA, valueA], [keyB, valueB]) {
   const [groupA, lowerA, rawA] = sortKey(keyA, valueA);
   const [groupB, lowerB, rawB] = sortKey(keyB, valueB);
   if (groupA !== groupB) return groupA - groupB;
   if (lowerA !== lowerB) return lowerA < lowerB ? -1 : 1;
   if (rawA !== rawB) return rawA < rawB ? -1 : 1;
   return 0;
}

function alignJson(value, indentLevel = 0) {
   const currentIndent = INDENT.repeat(indentLevel);
   const nextIndent = INDENT.repeat(indentLevel + 1);
   if (Array.isArray(value)) {
      if (value.length === 0) return "[]";
      const items = value.map((item) => alignJson(item, indentLevel + 1));
      const hasNested = value.some((item) => item !== null && typeof item === "object");
      if (hasNested) {
         return "[\n" + items.map((item) => `${nextIndent}${item}`).join(",\n") + `\n${currentIndent}]`;
      }
      return `[${items.join(", ")}]`;
   }
   if (value !== null && typeof value === "object") {
      const entries = Object.entries(value);
      if (entries.length === 0) return "{}";
      const sorted = [...entries].sort(compareEntries);
      const maxKeyLen = Math.max(...sorted.map(([key]) => JSON.stringify(key).length));
      const items = sorted.map(([key, val]) => {
         const paddedKey = JSON.stringify(key).padEnd(maxKeyLen);
         return `${nextIndent}${paddedKey}: ${alignJson(val, indentLevel + 1)}`;
      });
      return "{\n" + items.join(",\n") + `\n${currentIndent}}`;
   }
   return JSON.stringify(value);
}

function main() {
   const args = process.argv.slice(2);
   const inPlace = args.includes("-i") || args.includes("--in-place");
   const filepath = args.find((arg) => !arg.startsWith("-"));
   if (!filepath) {
      console.error("Usage: format-package.mjs [-i|--in-place] <file.json>");
      process.exit(1);
   }
   const data = JSON.parse(readFileSync(filepath, "utf-8"));
   const aligned = alignJson(data) + "\n";
   if (inPlace) {
      writeFileSync(filepath, aligned, "utf-8");
   } else {
      process.stdout.write(aligned);
   }
}

main();
