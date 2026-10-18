// Replace every em dash (U+2014) and en dash (U+2013) in the repo
// with natural phrasing. CRITICAL: only touches those two chars.
// Never collapses periods (a prior version broke TypeScript spread
// operators `...prev` into `.prev` which crashed production).
//
// Rules per line:
//   `digit, digit` -> `digit to digit`  (en dash in numeric range)
//   remaining en dashes get normalized to em dash and fall through
//
//   `foo. Bar`   (capital after)   -> `foo. Bar`
//   `foo, bar`   (lower after)     -> `foo, bar`
//   `foo, bar`     (no spaces)       -> `foo, bar`
//   `,  foo`       (dash at start)   -> `foo`
//   `foo , ` or ` , ` at end          -> `foo.` (period)
//   any remaining `, `               -> `, `
//   consecutive commas              -> single comma (safe cleanup)
//
// Explicitly: NO period cleanup, NO `\.+` regexes. Spread operators
// `...x` must survive.
//
// Skips: node_modules, .next, .git, design-reference, dist. Only
// touches text source extensions below. Env files + lockfiles excluded.

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const EXCLUDE_DIRS = new Set([
  "node_modules", ".next", ".git", "design-reference", "dist",
]);
const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".md", ".txt",
  ".sql",
  ".html", ".htm",
  ".gs",
]);
const EXCLUDE_FILENAMES = new Set([
  ".env.local",
  ".env.example",
  "package-lock.json",
  "sterling-marketing.zip",
]);

// Written as code points so a self-run of this script can never mangle its
// own constants. Prior failure mode: the script replaced its own literal
// em/en dashes with ", ", which then matched `.slice(0, 10)` on the next run.
const EM = String.fromCodePoint(0x2014);
const EN = String.fromCodePoint(0x2013);

function rewriteLine(line) {
  let out = line;

  // 1. En-dash numeric ranges: "9, 11" -> "9, 11"
  out = out.replace(new RegExp("(\\d)\\s*" + EN + "\\s*(\\d)", "g"), "$1 to $2");

  // 2. Treat all remaining en dashes like em dashes.
  out = out.split(EN).join(EM);

  // 3. `foo. Bar` -> `foo. Bar`  (sentence break)
  out = out.replace(
    new RegExp("(\\w[\\w'\")\\]]*)\\s+" + EM + "\\s+([A-Z])", "g"),
    "$1. $2",
  );
  // 4. `foo, bar` -> `foo, bar`
  out = out.replace(
    new RegExp("(\\w[\\w'\")\\]]*)\\s+" + EM + "\\s+(\\w)", "g"),
    "$1, $2",
  );
  // 5. `foo, bar` -> `foo, bar`
  out = out.replace(new RegExp("(\\w)" + EM + "(\\w)", "g"), "$1, $2");
  // 6. Em dash at start of line -> drop (list-bullet style).
  out = out.replace(new RegExp("^\\s*" + EM + "\\s*"), "");
  // 7. Em dash at end of line -> period.
  out = out.replace(new RegExp("\\s*" + EM + "\\s*$"), ".");
  // 8. Catchall: any remaining em dash -> `, `
  out = out.replace(new RegExp(EM, "g"), ", ");

  // Comma cleanup only. NEVER periods, so `...x` stays intact.
  out = out.replace(/,\s*,/g, ",");

  return out;
}

async function walk(dir, cb) {
  const entries = await readdir(dir);
  for (const name of entries) {
    if (EXCLUDE_DIRS.has(name)) continue;
    if (EXCLUDE_FILENAMES.has(name)) continue;
    const full = join(dir, name);
    const st = await stat(full);
    if (st.isDirectory()) await walk(full, cb);
    else await cb(full);
  }
}

let filesTouched = 0;
let replacementsMade = 0;

await walk(ROOT, async (full) => {
  const ext = extname(full).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) return;
  let content;
  try { content = await readFile(full, "utf8"); } catch { return; }
  if (!content.includes(EM) && !content.includes(EN)) return;

  // Skip the Next-generated agent-rules block (it uses em dashes and
  // next dev re-writes them on every start; stripping them creates an
  // endless loop).
  const NEXT_AUTO_BLOCK = new RegExp(
    "<!-- BEGIN:nextjs-agent-rules -->[\\s\\S]*?<!-- END:nextjs-agent-rules -->",
    "g",
  );
  const before = (content.replace(NEXT_AUTO_BLOCK, "").match(new RegExp("[" + EM + EN + "]", "g")) || []).length;
  const rewritten = content.split("\n").map((line) =>
    NEXT_AUTO_BLOCK.test(line) ? line : rewriteLine(line),
  ).join("\n");
  if (rewritten !== content) {
    await writeFile(full, rewritten);
    filesTouched++;
    const after = (rewritten.match(new RegExp("[" + EM + EN + "]", "g")) || []).length;
    replacementsMade += before - after;
    const rel = full.slice(ROOT.length + 1).replace(/\\/g, "/");
    console.log("  " + rel + ": " + (before - after) + " rewritten" +
      (after > 0 ? " (" + after + " remain)" : ""));
  }
});

console.log("\nTouched " + filesTouched + " files, rewrote " + replacementsMade + " dashes.");
