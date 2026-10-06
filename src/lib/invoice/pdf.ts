import "server-only";
import { renderInvoiceHtml, type InvoiceData } from "./template";
import { renderPdfFromHtml } from "@/lib/engagement/pdf";

// Thin wrapper. The HTML template is in ./template; the PDF renderer
// (Puppeteer + @sparticuz/chromium) is shared with the engagement
// letter so there is one chromium pipeline across the codebase.
//
// Caller gets a Uint8Array of PDF bytes and decides what to do with
// them — the Stripe webhook base64-encodes and hands them to the
// email layer; other callers (admin PDF preview, etc.) can
// `new Response(bytes, { headers: ... })` directly.

export type { InvoiceData } from "./template";

export async function renderInvoicePdf(
  data: InvoiceData,
): Promise<Uint8Array> {
  const html = renderInvoiceHtml(data);
  return renderPdfFromHtml(html);
}
