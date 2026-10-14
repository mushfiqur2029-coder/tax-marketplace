// One-shot: inject Open Graph + Twitter Card + canonical + JSON-LD
// structured data into every static marketing HTML file. Idempotent
// via marker comments so re-running does not duplicate tags.
//
// Why: the scoping report flagged M2 and M3 as must-fix. Sharing any
// link to Slack, WhatsApp, LinkedIn, X currently renders a blank
// preview card. Google rich snippets never show FAQ or Service info.
//
// Rules:
//   og:title / twitter:title       mirror <title>
//   og:description / twitter:...   mirror <meta description>
//   og:url                         derived from the output slug
//   og:image / twitter:image       /og-image.png (shared default)
//   og:type                        article for /about, /terms, /privacy
//                                  service for the 12 service pages
//                                  website for everything else
//   canonical                      the clean URL for this page
//   application/ld+json            Organization block on every page,
//                                  plus FAQPage block if the page has a
//                                  faq-item list, plus Service for the
//                                  per-service pages

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "marketing-static-export");
const SITE_URL = "https://sterlingledger.co.uk";
const APP_URL = "https://apisterlingledger.co.uk";

// Pages that are specifically Service-schema, map of slug to service name.
const SERVICE_PAGES = new Map([
  ["self-employed", "Self Assessment for Self-Employed"],
  ["landlords", "Landlord Self Assessment"],
  ["first-time-filers", "First-Time Self Assessment Filing"],
  ["high-earners", "High-Earner Self Assessment"],
  ["investors", "Investor Self Assessment"],
  ["expats", "Expat UK Tax Returns"],
  ["cis-construction", "CIS Subcontractor Returns"],
  ["limited-company-tax-returns", "Limited Company Accounts and Corporation Tax"],
  ["ltd-company-directors", "Director Self Assessment"],
  ["vat-business", "VAT Return Filing"],
  ["making-tax-digital", "Making Tax Digital Compliance"],
  ["tax-advice", "Tax Consultation Calls"],
]);

// Pages treated as articles rather than websites.
const ARTICLE_SLUGS = new Set(["about", "guides", "terms", "privacy"]);

const ORGANIZATION_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Sterling Ledger",
  "url": SITE_URL,
  "logo": SITE_URL + "/favicon.png",
  "description":
    "UK tax marketplace. Self Assessment, Corporation Tax, VAT, done online by qualified independent accountants on a flat fee.",
  "areaServed": "GB",
  "contactPoint": {
    "@type": "ContactPoint",
    "contactType": "customer support",
    "email": "info@sterlingledger.co.uk",
    "url": SITE_URL + "/contact/",
    "availableLanguage": ["en-GB"]
  }
};

async function build() {
  const files = await findHtmlFiles(OUT);
  let touched = 0;
  for (const file of files) {
    const slug = fileToSlug(file);
    const original = await readFile(file, "utf8");
    const rewritten = injectMeta(original, slug);
    if (rewritten !== original) {
      await writeFile(file, rewritten);
      touched++;
    }
  }
  console.log("injected SEO meta into " + touched + " files");
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

function fileToSlug(file) {
  const rel = file.slice(OUT.length + 1).replace(/\\/g, "/");
  if (rel === "index.html") return "";
  return rel.replace(/\/index\.html$/, "");
}

function pageUrl(slug) {
  if (!slug) return SITE_URL + "/";
  return SITE_URL + "/" + slug + "/";
}

function pageType(slug) {
  if (ARTICLE_SLUGS.has(slug)) return "article";
  if (SERVICE_PAGES.has(slug)) return "website";
  return "website";
}

// Parse the page's <title> and <meta description> for OG mirrors.
function extractTitleAndDescription(html) {
  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"\s*\/?>/);
  return {
    title: (titleMatch ? titleMatch[1] : "Sterling Ledger").replace(/&amp;/g, "&"),
    description: descMatch ? descMatch[1] : "",
  };
}

// Extract the FAQ Q/A pairs from a page so we can emit FAQPage JSON-LD.
function extractFaqPairs(html) {
  const section = html.match(/<section[^>]*id="faq"[\s\S]*?<\/section>/);
  if (!section) return [];
  const pairs = [];
  const re = /aria-expanded="(?:true|false)">([^<]+)<span[^>]*><\/span><\/button><div class="faq-a"><p>([^<]+)<\/p>/g;
  let m;
  while ((m = re.exec(section[0]))) {
    pairs.push({ q: unescapeHtml(m[1]), a: unescapeHtml(m[2]) });
  }
  return pairs;
}

function unescapeHtml(s) {
  return s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&mdash;/g, ",")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildMetaBlock(slug, { title, description }, faqPairs) {
  const url = pageUrl(slug);
  const type = pageType(slug);
  const image = SITE_URL + "/apple-touch-icon.png";
  const ogType = type === "article" ? "article" : "website";

  const ldItems = [ORGANIZATION_LD];
  const serviceName = SERVICE_PAGES.get(slug);
  if (serviceName) {
    ldItems.push({
      "@context": "https://schema.org",
      "@type": "Service",
      "name": serviceName,
      "provider": { "@type": "Organization", "name": "Sterling Ledger", "url": SITE_URL },
      "areaServed": "GB",
      "url": url,
      "description": description
    });
  }
  if (faqPairs.length > 0) {
    ldItems.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": faqPairs.map((p) => ({
        "@type": "Question",
        "name": p.q,
        "acceptedAnswer": { "@type": "Answer", "text": p.a }
      }))
    });
  }
  const ldJson = ldItems
    .map((item) => '<script type="application/ld+json">' + JSON.stringify(item) + "</script>")
    .join("");

  return (
    "<!--SL_SEO_START-->" +
    '<link rel="canonical" href="' + url + '"/>' +
    '<meta property="og:type" content="' + ogType + '"/>' +
    '<meta property="og:site_name" content="Sterling Ledger"/>' +
    '<meta property="og:title" content="' + esc(title) + '"/>' +
    '<meta property="og:description" content="' + esc(description) + '"/>' +
    '<meta property="og:url" content="' + url + '"/>' +
    '<meta property="og:image" content="' + image + '"/>' +
    '<meta property="og:locale" content="en_GB"/>' +
    '<meta name="twitter:card" content="summary_large_image"/>' +
    '<meta name="twitter:title" content="' + esc(title) + '"/>' +
    '<meta name="twitter:description" content="' + esc(description) + '"/>' +
    '<meta name="twitter:image" content="' + image + '"/>' +
    ldJson +
    "<!--SL_SEO_END-->"
  );
}

function injectMeta(html, slug) {
  const { title, description } = extractTitleAndDescription(html);
  const faqPairs = extractFaqPairs(html);
  const block = buildMetaBlock(slug, { title, description }, faqPairs);
  // Idempotent: strip any prior block first, then insert the fresh one.
  html = html.replace(/<!--SL_SEO_START-->[\s\S]*?<!--SL_SEO_END-->/g, "");
  // Insert right before </head> so canonical + og tags sit at the end
  // of the head (standard SEO position).
  return html.replace(/<\/head>/, block + "</head>");
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
