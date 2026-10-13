// Build the static marketing site from the running Next.js dev server.
//
// Why scrape instead of hand-write: the design is already shipping and
// evolving. Scraping captures 100% visual fidelity + current copy with
// zero drift. Trade-off is verbose Tailwind-generated class names in
// the output HTML — still crawlable by search engines, just not as
// hand-tuned as a from-scratch rebuild would be.
//
// Pre-reqs:
//   • dev server running on localhost:3000
//   • NO signed-in session (otherwise `/` redirects to /{role})
//
// Produces /marketing-static-export/ ready to upload to cPanel's
// public_html. Static files only — zero Node/Next at runtime.

import {
  mkdir,
  writeFile,
  readFile,
  copyFile,
  readdir,
  stat,
  rm,
} from "node:fs/promises";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const BASE = "http://localhost:3000";
const OUT = join(PROJECT_ROOT, "marketing-static-export");
const APP_HOST = "https://apisterlingledger.co.uk";

// Routes that become static pages. Each one gets its own tuned
// <title> + <meta description> for SEO. Path is relative to OUT and
// uses the "folder/index.html" shape so cPanel URLs stay clean
// (/landlords/ not /landlords.html).
const PAGES = [
  {
    route: "/",
    out: "index.html",
    title: "Sterling Ledger. Tax & VAT, sorted by real accountants.",
    description:
      "UK tax marketplace. Self Assessment, Corporation Tax, VAT — one flat fee, qualified accountant on every case, done online.",
  },
  {
    route: "/about",
    out: "about/index.html",
    title: "About Sterling Ledger. Who we are and how we work.",
    description:
      "A UK accountancy marketplace built around qualified, vetted accountants and transparent flat-fee pricing.",
  },
  {
    route: "/calculators",
    out: "calculators/index.html",
    title: "Tax calculators. Quick estimates for UK tax situations.",
    description:
      "Free quick calculators for Self Assessment, Corporation Tax, VAT and more. Follow up with a full return via Sterling Ledger.",
  },
  {
    route: "/guides",
    out: "guides/index.html",
    title: "UK tax guides. Plain-English explainers for individuals and businesses.",
    description:
      "Practical UK tax guides: Self Assessment basics, landlord returns, limited company essentials, VAT, and more.",
  },
  {
    route: "/self-employed",
    out: "self-employed/index.html",
    title: "Self-employed tax returns. Sole traders, freelancers, contractors.",
    description:
      "UK self-employed tax returns from £99. Qualified accountants, every allowable expense captured, filed on time.",
  },
  {
    route: "/landlords",
    out: "landlords/index.html",
    title: "Landlord tax returns. One property or a full portfolio.",
    description:
      "Rental income, mortgage interest, allowable expenses — your Self Assessment, filed by a qualified accountant.",
  },
  {
    route: "/first-time-filers",
    out: "first-time-filers/index.html",
    title: "First time filing a UK tax return? Start here.",
    description:
      "Never filed before? We register you with HMRC, prepare and file your Self Assessment, and talk you through the result.",
  },
  {
    route: "/high-earners",
    out: "high-earners/index.html",
    title: "High earners. Multi-source UK tax returns, done properly.",
    description:
      "Over the Personal Allowance taper, pension annual allowance, multiple income sources — handled by a qualified accountant.",
  },
  {
    route: "/investors",
    out: "investors/index.html",
    title: "Investor tax returns. Capital gains, dividends, crypto.",
    description:
      "Shares, funds, crypto, property sales — gains reported and tax calculated correctly on your UK Self Assessment.",
  },
  {
    route: "/expats",
    out: "expats/index.html",
    title: "Expat UK tax returns. Non-resident landlords and overseas income.",
    description:
      "Living abroad with UK income or property? NRLS, treaty positions, remittance basis — all handled by a UK accountant.",
  },
  {
    route: "/cis-construction",
    out: "cis-construction/index.html",
    title: "CIS tax returns. Reconcile deductions, claim your refund.",
    description:
      "Construction Industry Scheme (CIS) subcontractors — deductions reconciled, allowable expenses claimed, refund filed.",
  },
  {
    route: "/limited-company-tax-returns",
    out: "limited-company-tax-returns/index.html",
    title: "Limited company tax returns. Accounts, CT600, VAT.",
    description:
      "UK Ltd companies — annual accounts to Companies House, Corporation Tax to HMRC, VAT returns. Flat fee, qualified accountant.",
  },
  {
    route: "/ltd-company-directors",
    out: "ltd-company-directors/index.html",
    title: "Director Self Assessment. Salary, dividends, benefits.",
    description:
      "UK Ltd company directors — the personal Self Assessment side of your tax, filed correctly alongside your company's.",
  },
  {
    route: "/vat-business",
    out: "vat-business/index.html",
    title: "VAT returns for UK businesses. Monthly, quarterly, annual.",
    description:
      "Making-Tax-Digital compliant VAT returns, filed by a qualified accountant for every scheme and frequency.",
  },
  {
    route: "/making-tax-digital",
    out: "making-tax-digital/index.html",
    title: "Making Tax Digital (MTD). What it means and how we handle it.",
    description:
      "HMRC's Making Tax Digital rules explained, and how Sterling Ledger keeps your VAT and Self Assessment MTD-compliant.",
  },
  {
    route: "/tax-advice",
    out: "tax-advice/index.html",
    title: "Tax advice calls. 30-minute consultations with a UK accountant.",
    description:
      "Book a one-off call with a UK-qualified accountant. Confidential, specific to your situation, straight answers.",
  },
];

// Any href starting with one of these paths is an app route and gets
// rewritten to the absolute apisterlingledger.co.uk URL during export.
const APP_PATH_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/client",
  "/accountant",
  "/admin",
  "/api",
];

// CSS and asset URLs we need to download from the dev server. Collected
// as we parse pages, then fetched once each.
const assetsToFetch = new Map();

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
async function fetchBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

async function writeFileEnsureDir(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function copyDir(src, dst) {
  await mkdir(dst, { recursive: true });
  const items = await readdir(src);
  for (const item of items) {
    const s = join(src, item);
    const d = join(dst, item);
    const st = await stat(s);
    if (st.isDirectory()) await copyDir(s, d);
    else await copyFile(s, d);
  }
}

// Strip all Next.js hydration scripts + preload hints for JS chunks.
// Keep <link rel="stylesheet"> because we download the CSS separately.
function stripNextScripts(html) {
  // Script tags: strip every one. Our vanilla sterling.js replaces them.
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
  html = html.replace(/<script[^>]*\/>/g, "");
  // JS preload hints under /_next/static/chunks/*.js (not CSS).
  html = html.replace(
    /<link[^>]+rel="preload"[^>]+as="script"[^>]*\/?>/g,
    "",
  );
  // __NEXT_DATA__ etc. — covered by the <script> stripper above.
  // Dev-mode banner/overlay containers injected by turbopack.
  html = html.replace(
    /<nextjs-portal[^>]*>[\s\S]*?<\/nextjs-portal>/g,
    "",
  );
  return html;
}

// Rewrite /path hrefs into absolute app URLs for anything that goes to
// the Next.js app. Leave anchors (#id) and already-absolute http(s)
// URLs alone. Also leave /_next/* URLs — we handle those as asset
// downloads.
function rewriteAppLinks(html) {
  return html.replace(/\bhref="\/([^"#]*)(#[^"]*)?"/g, (m, path, hash) => {
    const normalized = "/" + path;
    if (normalized.startsWith("/_next/")) return m;
    for (const prefix of APP_PATH_PREFIXES) {
      if (
        normalized === prefix ||
        normalized.startsWith(prefix + "/") ||
        normalized.startsWith(prefix + "?")
      ) {
        return `href="${APP_HOST}${normalized}${hash ?? ""}"`;
      }
    }
    return m;
  });
}

// Normalize a /_next/static/... URL for both the HTML rewrite and the
// on-disk filename. Next dev emits brackets as %5B/%5D in URLs, which
// most static web servers (apache/cPanel, Node http) decode before
// filesystem lookup — if we saved the literal "%5B..." filename the
// request would 404. Replacing [ ] with underscores sidesteps this
// entirely: safe URL, safe filename.
function normalizeAssetUrl(raw) {
  const decoded = decodeURIComponent(raw);
  return decoded.replace(/\[/g, "_").replace(/\]/g, "_");
}

// Collect /_next/static/... asset URLs referenced in the HTML. We'll
// download them once at the end. The HTML keeps the ORIGINAL href
// unless we normalize it (see rewriteAssetUrls below).
function collectAssets(html) {
  const re = /\/_next\/static\/[^\s"'<>]+/g;
  let m;
  while ((m = re.exec(html))) {
    const url = m[0].replace(/&quot;$/, "").replace(/\\$/, "");
    assetsToFetch.set(url, normalizeAssetUrl(url));
  }
}

// Rewrite the HTML's /_next/static/... hrefs to the normalized path so
// browsers can find the files on disk.
function rewriteAssetUrls(html) {
  for (const [raw, normalized] of assetsToFetch.entries()) {
    if (raw === normalized) continue;
    // raw is already URL-encoded. HTML contains it literally.
    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(new RegExp(escaped, "g"), normalized);
  }
  return html;
}

// Inject <title>, <meta name="description">, and our sterling.js tag.
// We replace Next's generated title + meta rather than appending so the
// crawler sees one canonical pair per page.
function injectMeta(html, title, description) {
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`);
  html = html.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${description}"/>`,
  );
  // sterling.js at end of body for interactive bits + pricing fetch.
  html = html.replace(
    "</body>",
    `<script src="/sterling.js" defer></script></body>`,
  );
  return html;
}

// Pages are built in two passes: first collect every asset URL across
// all pages, then rewrite + write. Needed so rewriteAssetUrls knows
// about every asset before any page is written.
const pageHtml = new Map();

async function fetchPage(page) {
  const url = BASE + page.route;
  console.log(`  fetch ${page.route}`);
  let html = await fetchText(url);
  collectAssets(html);
  pageHtml.set(page, html);
}

async function writePage(page) {
  let html = pageHtml.get(page);
  html = stripNextScripts(html);
  html = rewriteAppLinks(html);
  html = rewriteAssetUrls(html);
  html = injectMeta(html, page.title, page.description);
  await writeFileEnsureDir(join(OUT, page.out), html);
  console.log(`  wrote ${page.out}`);
}

async function main() {
  // Clean slate for a reproducible build.
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  console.log("Fetching pages:");
  for (const p of PAGES) {
    await fetchPage(p);
  }
  console.log("\nWriting pages:");
  for (const p of PAGES) {
    await writePage(p);
  }

  console.log(`\nDownloading ${assetsToFetch.size} /_next assets...`);
  // Skip JS chunks — we don't need them. Only download CSS, fonts, and
  // media (woff, images). Save each file at the NORMALIZED path (no
  // brackets in the filename) so static web servers can serve it.
  for (const [raw, normalized] of assetsToFetch.entries()) {
    const ext = extname(raw.split("?")[0]).toLowerCase();
    if (ext === ".js" || ext === ".map") continue;
    try {
      const buf = await fetchBuffer(BASE + raw);
      await writeFileEnsureDir(join(OUT, normalized), buf);
      console.log(`  ${normalized} (${buf.length}B)`);
    } catch (e) {
      console.log(`  SKIP ${raw}: ${e.message}`);
    }
  }

  // Copy /public/* into the export root.
  console.log("\nCopying /public assets...");
  await copyDir(join(PROJECT_ROOT, "public"), OUT);

  // Write sterling.js (interactive bits + pricing fetcher).
  console.log("\nWriting sterling.js...");
  await writeFile(join(OUT, "sterling.js"), STERLING_JS);

  // Write README.
  console.log("Writing README.md...");
  await writeFile(join(OUT, "README.md"), README);

  console.log("\nDone. Upload the contents of marketing-static-export/ into cPanel's public_html.");
}

const STERLING_JS = `// Vanilla replacements for the three bits that need JS once the
// Next hydration scripts are stripped: mobile nav toggle, FAQ
// accordion, audience tabs on the homepage. Plus the live pricing
// fetcher that keeps displayed prices synced with the admin catalog.
(function () {
  "use strict";

  var API_PRICING_URL = "https://apisterlingledger.co.uk/api/public/pricing";

  // --- Mobile nav toggle -----------------------------------------
  // Looks for a button with [data-mobile-menu-toggle] and a target
  // element with [data-mobile-menu]. The Next render uses aria-expanded
  // on the toggle button; we flip it + a .open class on the target.
  document.addEventListener("click", function (e) {
    var toggle = e.target.closest && e.target.closest("[data-mobile-menu-toggle]");
    if (!toggle) return;
    var target = document.querySelector("[data-mobile-menu]");
    if (!target) return;
    var open = target.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  // --- FAQ accordion ---------------------------------------------
  // Each FAQ item is a <details> element in the SSR HTML; browsers
  // handle open/close natively. Nothing to do, but we add a smooth
  // transition hook if the page uses a different structure.
  document.addEventListener("click", function (e) {
    var trigger = e.target.closest && e.target.closest("[data-faq-trigger]");
    if (!trigger) return;
    var item = trigger.closest("[data-faq-item]");
    if (!item) return;
    item.classList.toggle("open");
  });

  // --- Audience tabs on homepage ---------------------------------
  document.addEventListener("click", function (e) {
    var tab = e.target.closest && e.target.closest("[data-audience-tab]");
    if (!tab) return;
    var key = tab.getAttribute("data-audience-tab");
    var tabs = document.querySelectorAll("[data-audience-tab]");
    var panels = document.querySelectorAll("[data-audience-panel]");
    tabs.forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-audience-tab") === key);
    });
    panels.forEach(function (p) {
      p.hidden = p.getAttribute("data-audience-panel") !== key;
    });
  });

  // --- Pricing toggle (Personal / Business) ----------------------
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("[data-pricing-mode]");
    if (!btn) return;
    var mode = btn.getAttribute("data-pricing-mode");
    document.querySelectorAll("[data-pricing-mode]").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-pricing-mode") === mode);
    });
    document.querySelectorAll("[data-pricing-panel]").forEach(function (p) {
      p.hidden = p.getAttribute("data-pricing-panel") !== mode;
    });
  });

  // --- Live pricing fetcher --------------------------------------
  // Looks for elements marked data-tier-price="{tierId}" and swaps in
  // the latest price from the admin-edited catalog. When salePriceGbp
  // is set, renders strike-through was/now styling.
  //
  // Attribute conventions (apply during static-export post-processing
  // or hand-markup if you edit the HTML directly):
  //   <span data-tier-price="sole_trader">£199</span>
  //   <span data-tier-sub="sole_trader">one-off</span>
  //
  // If an element isn't present for a tier, we skip it silently so
  // this is additive — pages without pricing render fine.
  function renderPrice(el, tier) {
    if (tier.priceDisplay) {
      el.textContent = tier.priceDisplay;
      return;
    }
    if (tier.salePriceGbp != null) {
      // was/now: wrap originals in <s> and bold the sale.
      el.innerHTML =
        '<span class="price-was">£' + tier.priceGbp + '</span> ' +
        '<span class="price-now">£' + tier.salePriceGbp + '</span>';
    } else {
      el.textContent = "£" + tier.priceGbp;
    }
  }

  function fetchPricing() {
    fetch(API_PRICING_URL, { credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !Array.isArray(data.tiers)) return;
        data.tiers.forEach(function (tier) {
          document
            .querySelectorAll('[data-tier-price="' + tier.id + '"]')
            .forEach(function (el) { renderPrice(el, tier); });
        });
      })
      .catch(function () {
        // Silent failure — the HTML already has the price at build
        // time as a fallback. User still sees a number.
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fetchPricing);
  } else {
    fetchPricing();
  }
})();
`;

const README = `# Sterling Ledger — static marketing site

This folder is the deployable static marketing site. Upload its
contents into cPanel's \`public_html/\` and the domain
\`sterlingledger.co.uk\` is live. Nothing in here needs Node, PHP, or
any runtime — it's plain HTML + CSS + JS.

## What's where

\`\`\`
public_html/
  index.html             — / homepage
  about/index.html       — /about
  calculators/index.html — /calculators
  guides/index.html      — /guides
  self-employed/index.html
  landlords/index.html
  first-time-filers/index.html
  high-earners/index.html
  investors/index.html
  expats/index.html
  cis-construction/index.html
  limited-company-tax-returns/index.html
  ltd-company-directors/index.html
  vat-business/index.html
  making-tax-digital/index.html
  tax-advice/index.html
  _next/static/...       — CSS + fonts the pages reference
  sterling.js            — mobile menu, FAQ, tabs, live pricing
  (plus every file from the project's /public/)
\`\`\`

Each page has its own \`<head>\` with a tuned \`<title>\` + meta
description for SEO. Prices are populated at build time as a fallback
and refreshed live on page load from the admin-edited catalog at
\`https://apisterlingledger.co.uk/api/public/pricing\`.

## Live pricing — how it works

\`sterling.js\` fetches the public pricing endpoint on every page load
and swaps the HTML text inside any element with the attribute
\`data-tier-price="{tier_id}"\` to match the live catalog value. When a
sale is set on a tier (\`salePriceGbp\` non-null), the swap renders
\`<s>£regular</s> £sale\` styling via two inner spans (\`.price-was\`
+ \`.price-now\`) you can style with CSS.

If the API call fails (network, CORS, DNS), the HTML's built-in
price stays visible — users never see a blank price card.

## Internal links

All login / register / dashboard / case-flow links go to
\`https://apisterlingledger.co.uk/*\`. The marketing site itself only
serves this folder.

## Rebuilding

From the Next.js project root with the dev server running at
\`localhost:3000\` and NO signed-in session (otherwise the homepage
redirects away from the marketing content), run:

\`\`\`
node scripts/build-marketing-static.mjs
\`\`\`

Then upload the regenerated \`marketing-static-export/\` to cPanel.

## cPanel upload tips

- Compress the folder to a .zip or .tar.gz locally, upload once, then
  extract on the server. Much faster than FTPing 100+ files.
- Set \`AddDefaultCharset UTF-8\` in your \`.htaccess\` so meta tags
  render correctly.
- Consider adding \`.htaccess\` rules for pretty URLs
  (\`/landlords\` → \`/landlords/index.html\`) if your cPanel server
  isn't already configured to serve index.html on folder requests.

## SEO work later

Each page is a standalone HTML file. Add structured data
(\`<script type="application/ld+json">\`), tweak meta descriptions,
add Open Graph tags, drop in a Plausible snippet, etc. — all
without touching the Next.js app or doing a code deploy. Just edit
the HTML and re-upload.
`;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
