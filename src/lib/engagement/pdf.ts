import "server-only";
import puppeteer, { type Browser } from "puppeteer-core";
import chromium from "@sparticuz/chromium";

// Resolve the Chromium binary to launch:
//   • production (Vercel / Lambda): use the serverless-friendly
//     @sparticuz/chromium pack
//   • local dev: use CHROMIUM_PATH env to point at a system Chrome, or
//     fall back to the usual Windows / macOS install paths. Local Chrome
//     is fine, @sparticuz is Lambda-specific
async function resolveExecutablePath(): Promise<string> {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return await chromium.executablePath();
  }

  // Local dev fallbacks. Order: Windows → macOS → Linux.
  const guesses = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
  ];
  const fs = await import("node:fs");
  for (const p of guesses) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    "Could not find a Chromium binary. Set CHROMIUM_PATH to your local Chrome executable, or install Google Chrome in the default location.",
  );
}

// Launch flags for the serverless chromium pack. In local dev we also
// want --no-sandbox since a non-root user runs the browser.
async function launchBrowser(): Promise<Browser> {
  const executablePath = await resolveExecutablePath();
  const isServerless =
    !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

  if (isServerless) {
    return puppeteer.launch({
      executablePath,
      args: chromium.args,
      headless: true,
    });
  }

  return puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

// Render the HTML to a PDF Uint8Array. Caller is responsible for storing
// or sending the bytes. Throws on failure so the sign action surfaces a
// clear error ("engagement PDF couldn't be generated — contact support")
// rather than silently storing a half-cooked file.
export async function renderPdfFromHtml(html: string): Promise<Uint8Array> {
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    // waitUntil 'networkidle0' is overkill here — our template is self-
    // contained with the logo as a data URL. 'load' avoids a flaky wait.
    await page.setContent(html, { waitUntil: "load" });
    const buf = await page.pdf({
      format: "a4",
      printBackground: true,
      // Our template already sets @page margin: 20mm, so pass 0 here to
      // avoid Chromium adding its own on top.
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    return buf;
  } finally {
    if (browser) {
      await browser.close().catch(() => {
        // We don't want a close failure to mask an upstream error.
      });
    }
  }
}
