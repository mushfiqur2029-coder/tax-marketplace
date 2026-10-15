// One-shot: strip every "Chartered Tax Adviser" (CTA) claim from the
// shipped and non-shipped tree. We do not actually have CTA-qualified
// accountants on the platform, so the claim is inaccurate.
//
// Scope:
//   - marketing-static-export/**/index.html  (shipped marketing)
//   - design-reference/*.html                (prototypes, not shipped
//                                             but still carry the claim)
//
// What stays untouched:
//   - "CTA" as shorthand for "call-to-action" in internal comments
//     and class names. Those matches are not touched by the targeted
//     string replacements below.
//
// Idempotent via marker-free replacement: if the OLD string is absent
// (already fixed) the file is left alone.

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Each pair is applied as a literal string replace, in order. All
// targets are copy strings that referenced Chartered Tax Adviser as
// one of the qualifications we vet, not call-to-action references.
const SWAPS = [
  // Hero badge below the Start-your-return button on service pages.
  [
    "Vetted ACCA · CIMA · CTA accountants only",
    "Vetted ACCA · CIMA accountants only",
  ],
  // Why-card copy on each service page's "Qualified accountants" tile.
  [
    "ACCA, CIMA, or CTA accredited",
    "ACCA or CIMA accredited",
  ],
  // About page strapline.
  [
    "ACCA, CIMA, and CTA only.",
    "ACCA and CIMA only.",
  ],
  // Terms-page clause about verifying accountants.
  [
    "ACCA, CIMA, CTA, or an equivalent",
    "ACCA, CIMA, or an equivalent",
  ],
  // Fake person-with-qualification shown in the homepage's mock case
  // list. Swap the suffix to a qualification we actually accept.
  [
    "S. Patel, CTA",
    "S. Patel, CIMA",
  ],
];

const DIRS = [
  join(ROOT, "marketing-static-export"),
  join(ROOT, "design-reference"),
];

async function walk(dir, acc = []) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = await stat(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === "_next" || name === "fonts") continue;
      await walk(full, acc);
    } else if (name.endsWith(".html")) {
      acc.push(full);
    }
  }
  return acc;
}

function patch(text) {
  for (const [from, to] of SWAPS) {
    if (text.includes(from)) text = text.split(from).join(to);
  }
  return text;
}

async function main() {
  const files = [];
  for (const d of DIRS) await walk(d, files);
  let touched = 0;
  for (const f of files) {
    const original = await readFile(f, "utf8");
    const next = patch(original);
    if (next !== original) {
      await writeFile(f, next);
      touched++;
      console.log("  " + f.replace(ROOT + "\\", "").replace(ROOT + "/", ""));
    }
  }
  console.log("\npatched " + touched + " of " + files.length + " html files");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
