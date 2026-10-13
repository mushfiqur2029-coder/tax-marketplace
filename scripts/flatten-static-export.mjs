// Flattens marketing-static-export/ so nothing lives under /_next/:
//   /_next/static/chunks/<hash>.css       -> /styles.css
//   /_next/static/media/<hash>.woff2      -> /fonts/<hash>.woff2
//   (every HTML's <link rel=stylesheet>)  -> /styles.css
//   (every HTML's <link rel=preload font>) -> removed
//
// Why: cPanel/LiteSpeed deployments sometimes block or misroute paths
// under /_next/, and keeping Next-internal paths on a static site is
// fragile anyway. A flat styles.css + fonts/ dir is portable to any
// static host.
//
// Reads font URLs OUT OF THE CSS (not just the ones HTML preloads) so
// no on-demand @font-face fetch 404s after extraction. Grabs any
// missing fonts from the running Next dev server at localhost:3000.
//
// Idempotent: safe to re-run. Looks for the current CSS filename in
// _next/static/chunks/ dynamically so a rebuild with a different hash
// still works.

import { readFile, writeFile, readdir, mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPORT_DIR = join(__dirname, "..", "marketing-static-export");
const DEV_SERVER = "http://localhost:3000";

async function run() {
  if (!existsSync(EXPORT_DIR)) {
    console.error(`Not found: ${EXPORT_DIR}`);
    process.exit(1);
  }
  await flattenCssAndFonts(EXPORT_DIR, DEV_SERVER);
  await rewriteHtmlFiles(EXPORT_DIR);
  const legacyNext = join(EXPORT_DIR, "_next");
  if (existsSync(legacyNext)) {
    await rm(legacyNext, { recursive: true, force: true });
    console.log("removed _next/");
  }
  console.log("\nflatten complete");
}

// ----- 1. CSS + fonts ------------------------------------------------
export async function flattenCssAndFonts(exportDir, devServerBase) {
  const nextChunksDir = join(exportDir, "_next", "static", "chunks");
  let cssPath = null;
  if (existsSync(nextChunksDir)) {
    const entries = await readdir(nextChunksDir);
    const cssName = entries.find((n) => n.endsWith(".css"));
    if (cssName) cssPath = join(nextChunksDir, cssName);
  }
  if (!cssPath) {
    // Already-flattened or missing. If styles.css exists, nothing to do.
    if (existsSync(join(exportDir, "styles.css"))) {
      console.log("styles.css already present — skip CSS extraction");
      return;
    }
    throw new Error("No CSS found in _next/static/chunks/ to flatten");
  }

  let css = await readFile(cssPath, "utf8");
  console.log(`reading CSS: ${cssPath} (${css.length}B)`);

  // Every ../media/<hash> inside url(...) becomes /fonts/<basename>.
  const fontRefs = new Set();
  css = css.replace(
    /url\("\.\.\/media\/([^"]+)"\)/g,
    (_, filename) => {
      fontRefs.add(filename);
      return `url("/fonts/${filename}")`;
    },
  );
  console.log(`found ${fontRefs.size} font refs`);

  // Download fonts not already present under fonts/. Prefer the local
  // copy under _next/static/media/<hash> if it exists (zero network);
  // fall back to the dev server fetch.
  const fontsDir = join(exportDir, "fonts");
  await mkdir(fontsDir, { recursive: true });
  const localMediaDir = join(exportDir, "_next", "static", "media");
  let downloaded = 0;
  let fromLocal = 0;
  for (const filename of fontRefs) {
    const dst = join(fontsDir, filename);
    if (existsSync(dst)) continue;
    const localSrc = join(localMediaDir, filename);
    if (existsSync(localSrc)) {
      await writeFile(dst, await readFile(localSrc));
      fromLocal++;
      continue;
    }
    const url = `${devServerBase}/_next/static/media/${encodeURIComponent(filename)}`;
    const r = await fetch(url);
    if (!r.ok) {
      console.warn(`  skip ${filename}: ${r.status} ${url}`);
      continue;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    await writeFile(dst, buf);
    downloaded++;
  }
  console.log(`fonts: ${fromLocal} reused from _next, ${downloaded} fetched from dev server`);

  await writeFile(join(exportDir, "styles.css"), css);
  console.log(`wrote styles.css (${css.length}B)`);
}

// ----- 2. HTML files -------------------------------------------------
async function rewriteHtmlFiles(exportDir) {
  const htmlFiles = [];
  await (async function walk(dir) {
    const entries = await readdir(dir);
    for (const name of entries) {
      const p = join(dir, name);
      const st = await stat(p);
      if (st.isDirectory()) {
        if (name === "_next") continue; // will be deleted anyway
        await walk(p);
      } else if (name.endsWith(".html")) {
        htmlFiles.push(p);
      }
    }
  })(exportDir);

  console.log(`rewriting ${htmlFiles.length} HTML files`);
  for (const f of htmlFiles) {
    const original = await readFile(f, "utf8");
    const rewritten = rewriteHtml(original);
    if (rewritten !== original) await writeFile(f, rewritten);
  }
}

export function rewriteHtml(html) {
  // Replace the Next CSS stylesheet <link> (whatever its hash) with
  // the flat /styles.css. There may be preload <link rel="preload"
  // as="style"> and the real <link rel="stylesheet"> — both go.
  html = html.replace(
    /<link[^>]*href="\/_next\/static\/chunks\/[^"]+\.css"[^>]*\/?>/g,
    "",
  );
  // Insert a single <link rel="stylesheet" href="/styles.css"/> if
  // not already present, right before </head>.
  if (!/href="\/styles\.css"/.test(html)) {
    html = html.replace(
      /<\/head>/,
      '<link rel="stylesheet" href="/styles.css"/></head>',
    );
  }
  // Font preload hints pointed at /_next: delete them. The CSS still
  // declares @font-face url("/fonts/...") so the browser fetches on
  // demand. We could rewrite each preload to /fonts/... but the perf
  // gain for a static marketing page vs the complexity of parsing
  // every preload Link header is a bad trade.
  html = html.replace(
    /<link[^>]*rel="preload"[^>]*href="\/_next\/[^"]+"[^>]*\/?>/g,
    "",
  );
  return html;
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
