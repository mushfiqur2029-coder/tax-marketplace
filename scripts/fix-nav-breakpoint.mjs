// One-shot: raise the top-nav breakpoint from md (768px) to lg
// (1024px) and add whitespace-nowrap to each nav item.
//
// Why: with the Contact link added, the full nav plus logo plus CTA
// buttons do not fit on one row at md widths (~820 to ~1023px). The
// result was "How it works" and "Who it's for" wrapping onto two lines
// each, giving the header an uneven, cramped look.
//
// Fix is two-part:
//   1. Promote the breakpoint. md:flex -> lg:flex on the desktop nav
//      and md:hidden -> lg:hidden on the mobile toggle plus panel.
//      Below 1024px users see the hamburger, which is a cleaner
//      pattern anyway for tablet widths.
//   2. whitespace-nowrap on every nav link so an item can never split
//      across two lines, even in edge-case content.
//
// Idempotent via the same marker-free pattern as our other patchers:
// we only match the exact pre-fix string, so re-running after the fix
// is already applied is a no-op.

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "marketing-static-export");

// The three structural swaps. Each `from` is the exact byte string in
// the current HTML; `to` is the fixed form.
const SWAPS = [
  {
    from: '<nav class="hidden items-center gap-1 md:flex">',
    to: '<nav class="hidden items-center gap-1 lg:flex">',
  },
  {
    from: 'data-mobile-menu-toggle="true" class="inline-flex h-11 w-11 items-center justify-center rounded-lg text-navy-deep transition hover:bg-sky/10 md:hidden"',
    to: 'data-mobile-menu-toggle="true" class="inline-flex h-11 w-11 items-center justify-center rounded-lg text-navy-deep transition hover:bg-sky/10 lg:hidden"',
  },
  {
    from: '<div data-mobile-menu="true" class="mobile-panel md:hidden">',
    to: '<div data-mobile-menu="true" class="mobile-panel lg:hidden">',
  },
];

// Nav links share the exact class string. Prepend whitespace-nowrap
// and tighten horizontal padding from px-3.5 to px-3 so that at the
// lg breakpoint (1024px) the full nav plus logo plus CTAs still fit
// inside the max-w-6xl container with pixels to spare.
// replaceAll because every nav item carries this class.
const LINK_PRE = 'class="rounded-lg px-3.5 py-2 text-sm font-semibold text-ink/70 transition hover:bg-sky/10 hover:text-ink"';
const LINK_INTERIM = 'class="whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold text-ink/70 transition hover:bg-sky/10 hover:text-ink"';
const LINK_TO = 'class="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-ink/70 transition hover:bg-sky/10 hover:text-ink"';

async function findHtmlFiles(dir, acc = []) {
  const entries = await readdir(dir);
  for (const name of entries) {
    const full = join(dir, name);
    const st = await stat(full);
    if (st.isDirectory()) {
      if (name === "_next" || name === "fonts") continue;
      await findHtmlFiles(full, acc);
    } else if (name === "index.html") {
      acc.push(full);
    }
  }
  return acc;
}

function patch(html) {
  for (const { from, to } of SWAPS) {
    if (html.includes(from)) html = html.split(from).join(to);
  }
  // Link class: the pre-fix form had px-3.5 and no whitespace-nowrap;
  // an interim run of this script before the padding tightening added
  // whitespace-nowrap but kept px-3.5; the final form has both. Handle
  // all three starting states so re-runs are no-ops.
  if (!html.includes(LINK_TO)) {
    if (html.includes(LINK_INTERIM)) {
      html = html.split(LINK_INTERIM).join(LINK_TO);
    } else {
      html = html.split(LINK_PRE).join(LINK_TO);
    }
  }
  return html;
}

async function main() {
  const files = await findHtmlFiles(OUT);
  let touched = 0;
  for (const file of files) {
    const original = await readFile(file, "utf8");
    const next = patch(original);
    if (next !== original) {
      await writeFile(file, next);
      touched++;
    }
  }
  console.log("patched " + touched + " of " + files.length + " files");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
