// One-shot: upgrade `btn-sl-ghost` to `btn-sl-outline` wherever the
// ghost sits in a button-pair next to a primary on a light background.
// Ghost's resting state is navy-deep text on no background with no
// border, which reads as emphasised prose rather than a clickable
// button. Outline gives the same navy text + a visible border, so
// the click affordance is unambiguous.
//
// Scoped matches (specific CTAs we have in the shipped tree):
//   - Service-hero "Talk to an accountant first"
//   - Step-done "Read the guides"
//
// Not touched:
//   - btn-sl-ghost inside .consult-band (already white-text overridden)
//   - "Skip for now, just send my message" on contact step 2 (true
//     escape hatch, intentional de-emphasis)
//   - In-app avatar-picker etc. (admin UI; separate design system)

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "marketing-static-export");

// Each pair is a literal string replace. The ghost class is swapped
// only within these exact contexts; naked `btn-sl-ghost` elsewhere is
// untouched.
const SWAPS = [
  // Service pages: hero CTA pair "Start your return" + "Talk to an
  // accountant first". Second button becomes outline.
  [
    '<a class="btn-sl btn-sl-ghost" href="#consult">Talk to an accountant first</a>',
    '<a class="btn-sl btn-sl-outline" href="#consult">Talk to an accountant first</a>',
  ],
  // Contact page step 3: secondary action "Read the guides".
  [
    '<a href="/guides" class="btn-sl btn-sl-ghost">Read the guides</a>',
    '<a href="/guides" class="btn-sl btn-sl-outline">Read the guides</a>',
  ],
];

async function walk(dir, acc = []) {
  const entries = await readdir(dir);
  for (const name of entries) {
    const full = join(dir, name);
    const st = await stat(full);
    if (st.isDirectory()) {
      if (name === "_next" || name === "fonts") continue;
      await walk(full, acc);
    } else if (name === "index.html") {
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
  const files = await walk(OUT);
  let touched = 0;
  for (const f of files) {
    const original = await readFile(f, "utf8");
    const next = patch(original);
    if (next !== original) {
      await writeFile(f, next);
      touched++;
      console.log("  " + f.replace(ROOT, "").replace(/^[\\/]/, ""));
    }
  }
  console.log("\npatched " + touched + " of " + files.length + " files");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
