#!/usr/bin/env node
// Fail-fast scan for em (U+2014) and en (U+2013) dashes anywhere in the
// shipping tree. Run before every commit. Exits non-zero when any are
// found so a pre-commit hook (or CI step) will block the push.
//
// Written as code points so a self-run cannot mangle its own constants
// if ever piped through strip-dashes.mjs by mistake.

import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EM = String.fromCodePoint(0x2014);
const EN = String.fromCodePoint(0x2013);
const DASHES = new RegExp("[" + EM + EN + "]", "g");

const EXCLUDE_DIRS = new Set([
  "node_modules", ".next", ".git", "design-reference", "dist",
  "reference", ".e2e-shots", ".claude",
]);
const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".md", ".txt", ".sql", ".html", ".htm", ".gs", ".json",
]);
const EXCLUDE_FILENAMES = new Set([
  "package-lock.json",
  "credentials.local.json",
]);

async function walk(dir, out = []) {
  for (const name of await readdir(dir)) {
    if (EXCLUDE_DIRS.has(name)) continue;
    if (EXCLUDE_FILENAMES.has(name)) continue;
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) await walk(full, out);
    else if (TEXT_EXTENSIONS.has(extname(name))) out.push(full);
  }
  return out;
}

// Blocks Next.js regenerates on every `next dev` (see
// node_modules/next/dist/server/lib/generate-agent-files.js) use em
// dashes that we can't rewrite without the dev server putting them
// right back on the next run. Skip anything inside the marker pair.
const NEXT_AUTO_BLOCK = new RegExp(
  "<!-- BEGIN:nextjs-agent-rules -->[\\s\\S]*?<!-- END:nextjs-agent-rules -->",
  "g",
);

const files = await walk(ROOT);
const hits = [];
for (const file of files) {
  const txt = await readFile(file, "utf8");
  const scanned = txt.replace(NEXT_AUTO_BLOCK, "");
  const matches = scanned.match(DASHES);
  if (matches) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
    hits.push({ file: rel, count: matches.length });
  }
}

if (hits.length === 0) {
  console.log("Dash check: clean (" + files.length + " files scanned).");
  process.exit(0);
}

console.error("Dash check: FAILED");
console.error("");
console.error("Em (U+2014) or en (U+2013) dashes found in these shipping-tree files:");
for (const h of hits) {
  console.error("  " + h.file + ": " + h.count);
}
console.error("");
console.error("Rewrite as commas, periods, or 'to' for number ranges.");
console.error("Fix auto: node scripts/strip-dashes.mjs");
process.exit(1);
