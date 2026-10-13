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

// Hard upper bound on the whole render path (launch + setContent +
// page.pdf). Lower than the Stripe webhook's maxDuration=60s so a
// hung Chromium process fails fast with a clear error instead of
// burning through the whole function timeout and triggering a
// Stripe retry (whose idempotency guard would then skip the
// re-send). Also used by the engagement-sign flow where the same
// "hung forever" failure mode applies.
const RENDER_TIMEOUT_MS = 45_000;

function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `${label} did not finish within ${(ms / 1000).toFixed(0)}s. The Chromium render may be stuck or cold-starting; please retry.`,
        ),
      );
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// Render the HTML to a PDF Uint8Array. Caller is responsible for storing
// or sending the bytes. Throws on failure so the sign action surfaces a
// clear error ("engagement PDF couldn't be generated, contact support")
// rather than silently storing a half-cooked file.
//
// The whole render runs under a RENDER_TIMEOUT_MS cap. Without this a
// Chromium that got stuck (e.g. a cold start that never completes, or
// a bug in @sparticuz/chromium on a Lambda cold path) would hang
// until Vercel killed the whole function, by which point Stripe
// would have retried the webhook and the retry's idempotency guard
// would silently skip the re-send. Fast fail with a clear error
// means Stripe keeps retrying until it succeeds.
export async function renderPdfFromHtml(html: string): Promise<Uint8Array> {
  return withTimeout(
    renderPdfInner(html),
    RENDER_TIMEOUT_MS,
    "Chromium PDF render",
  );
}

async function renderPdfInner(html: string): Promise<Uint8Array> {
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    // waitUntil 'networkidle0' is overkill here, our template is self-
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
