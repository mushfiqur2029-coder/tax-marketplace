// One-shot: reorder the personal-tier pricing cards in every marketing
// HTML page so they match service_catalog.display_order after migration
// 0078, and rename the gig_worker card's title + description to drop
// the "gig workers" phrasing.
//
// The pricing grid is identical markup across all 12 pages that render
// it, so we locate the <div data-pricing-panel="personal"> section,
// extract each card by its data-tier-price attribute, and splice them
// back in NEW_ORDER. Each card's inner £price text and attributes are
// preserved verbatim: sterling.js overwrites those at runtime from the
// pricing API anyway, but we don't want to accidentally reset a sale
// price or an admin-edited fallback.
//
// Idempotent: if a file already has cards in NEW_ORDER and the
// renamed title, the patch returns the input unchanged.

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "marketing-static-export");

// Desired display order after migration 0091. Mirrors
// src/lib/plans.ts PLAN_TIERS personal section. The old uber_driver
// slot is now held by uber_phv_automated (same display_order=10).
const NEW_ORDER = [
  "uber_phv_automated",
  "gig_worker",
  "landlord_small",
  "sole_trader",
  "cis_subcontractor",
  "non_resident_landlord",
  "freelancer_consultant",
  "landlord_multi",
  "complex_international",
];

// Rename the gig_worker card's visible copy. Keyed by data-tier-price
// so we can run this card-by-card after extracting them.
const CARD_RENAMES = {
  gig_worker: {
    title: "Delivery Drivers",
    tagline:
      "Deliveroo, Uber Eats, Amazon Flex, Just Eat. Delivery income done right.",
  },
};

// Each card follows this shape (minified, one line, inside the grid):
//   <div class="group relative flex flex-col rounded-2xl border border-line
//               bg-paper p-6 shadow-sm transition hover:border-sky/50
//               hover:-translate-y-0.5">
//     <h3 class="text-base font-semibold text-ink">TITLE</h3>
//     <p class="mt-1 text-xs text-slate line-clamp-2">TAGLINE</p>
//     <div class="mt-4 flex items-baseline gap-1" ...>
//       <span ... data-tier-price="TIER_ID">£...</span>
//       <span ...>one-off</span>
//     </div>
//     <a class="btn-sl btn-sl-outline btn-sl-block mt-5" href="...">Choose</a>
//   </div>
//
// The regex matches from the opening group div to the closing </div>
// that follows the Choose anchor, non-greedy.
const CARD_RE =
  /<div class="group relative flex flex-col[^"]*"[^>]*>[\s\S]*?<a class="btn-sl btn-sl-outline[^"]*"[^>]*>Choose<\/a><\/div>/g;

function tierIdOf(cardHtml) {
  const m = cardHtml.match(/data-tier-price="([^"]+)"/);
  return m ? m[1] : null;
}

function renameCard(cardHtml, rename) {
  // Replace the first <h3>...</h3> contents (card title).
  cardHtml = cardHtml.replace(
    /<h3 class="text-base font-semibold text-ink">[^<]*<\/h3>/,
    `<h3 class="text-base font-semibold text-ink">${rename.title}</h3>`,
  );
  // Replace the first <p class="...line-clamp-2">...</p> contents (tagline).
  cardHtml = cardHtml.replace(
    /<p class="mt-1 text-xs text-slate line-clamp-2">[^<]*<\/p>/,
    `<p class="mt-1 text-xs text-slate line-clamp-2">${rename.tagline}</p>`,
  );
  return cardHtml;
}

function patch(html) {
  // Locate the personal pricing panel. The grid wrapper comes right
  // after the data-pricing-panel="personal" div opener. We take the
  // whole slice up to the next data-pricing-panel attribute (the
  // business panel) and operate inside.
  const panelStart = html.indexOf('data-pricing-panel="personal"');
  if (panelStart === -1) return html;
  const nextPanel = html.indexOf('data-pricing-panel="business"', panelStart);
  if (nextPanel === -1) return html;

  const before = html.substring(0, panelStart);
  const panelSection = html.substring(panelStart, nextPanel);
  const after = html.substring(nextPanel);

  const cards = panelSection.match(CARD_RE) || [];
  if (cards.length === 0) return html;

  // Map tier id -> card HTML (possibly renamed for gig_worker).
  const byId = new Map();
  for (const c of cards) {
    const id = tierIdOf(c);
    if (!id) continue;
    const rename = CARD_RENAMES[id];
    byId.set(id, rename ? renameCard(c, rename) : c);
  }

  // Reorder according to NEW_ORDER. Any tier not listed falls off the
  // end in its existing order, so a future tier addition doesn't get
  // silently dropped.
  const ordered = [];
  const seen = new Set();
  for (const id of NEW_ORDER) {
    if (byId.has(id)) {
      ordered.push(byId.get(id));
      seen.add(id);
    }
  }
  for (const [id, html] of byId) {
    if (!seen.has(id)) ordered.push(html);
  }

  // Reconstruct the panel section by swapping the original cards with
  // the reordered concatenation. Preserve the surrounding grid wrapper
  // and the "Compare all nine" footer.
  const firstCardIdx = panelSection.indexOf(cards[0]);
  const lastCard = cards[cards.length - 1];
  const lastCardEnd = panelSection.lastIndexOf(lastCard) + lastCard.length;
  const panelBefore = panelSection.substring(0, firstCardIdx);
  const panelAfter = panelSection.substring(lastCardEnd);
  const nextPanelSection = panelBefore + ordered.join("") + panelAfter;

  if (nextPanelSection === panelSection) return html;
  return before + nextPanelSection + after;
}

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
