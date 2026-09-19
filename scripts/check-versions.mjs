#!/usr/bin/env node
// Checks that package.json, package-lock.json (its two root version fields) and, when one is
// given as the first argument, a release tag (with or without its leading "v") all carry the
// same version. Exits 1 listing every mismatch - see CONTRIBUTING.md's "Releasing".

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (name) => JSON.parse(readFileSync(join(root, name), "utf8"));

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");

const found = {
   "package.json": pkg.version,
   "package-lock.json": lock.version,
   'package-lock.json packages[""]': lock.packages?.[""]?.version,
};
const tag = process.argv[2];
if (tag !== undefined) {
   found[`tag ${tag}`] = tag.replace(/^v/, "");
}

const mismatches = Object.entries(found).filter(([, version]) => version !== pkg.version);
if (mismatches.length > 0) {
   console.error(`Versions differ from package.json's ${pkg.version}:`);
   for (const [source, version] of mismatches) {
      console.error(`  ${source}: ${version}`);
   }
   process.exit(1);
}
console.log(`All versions match: ${pkg.version}`);
