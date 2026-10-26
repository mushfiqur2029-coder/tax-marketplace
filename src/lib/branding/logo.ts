import "server-only";
import fs from "node:fs";
import path from "node:path";

// Sterling Ledger logo as a base64 data URL. Shared across every PDF
// template so the three generators (engagement letter, invoice, PCH
// Accounts, SA forwarding letter) all pull from one place rather than
// each shipping its own copy of this helper.
//
// Read once per process; the file lives in the repo at design-reference
// /Logo3s.png. Embedded as a data URL so Puppeteer's HTML stays fully
// self-contained (no network fetch, works under a tightened CSP).
//
// If the file read ever fails we return an empty string and templates
// render a text wordmark fallback via logoHtmlBlock() below - the only
// shape callers need to care about.

let logoDataUrlCache: string | null = null;

export function logoDataUrl(): string {
  if (logoDataUrlCache !== null) return logoDataUrlCache;
  try {
    const p = path.resolve(process.cwd(), "design-reference/Logo3s.png");
    const bytes = fs.readFileSync(p);
    logoDataUrlCache = `data:image/png;base64,${bytes.toString("base64")}`;
  } catch (err) {
    console.error(
      `[branding/logo] logo load failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    logoDataUrlCache = "";
  }
  return logoDataUrlCache;
}

// Convenience: the <img> tag or wordmark fallback the templates use.
// Keeps the three callers from having to repeat the same ternary.
// Caller is responsible for the CSS class names (templates differ on
// logo size + fallback styling).
export function logoHtmlBlock(opts?: {
  imgClass?: string;
  fallbackClass?: string;
  fallbackText?: string;
}): string {
  const imgClass = opts?.imgClass ?? "logo";
  const fallbackClass = opts?.fallbackClass ?? "logo-fallback";
  const fallbackText = opts?.fallbackText ?? "STERLING LEDGER";
  const url = logoDataUrl();
  return url
    ? `<img class="${imgClass}" alt="Sterling Ledger" src="${url}" />`
    : `<div class="${fallbackClass}">${fallbackText}</div>`;
}
