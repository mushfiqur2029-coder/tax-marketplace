import { NextResponse, type NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// TEMPORARY diagnostic endpoint, added 2026-11-10 to verify the
// single-field OCR helper in intake-actions.ts (callOpenAiVision)
// after the Claude -> OpenAI migration. That helper calls the OpenAI
// Responses API directly via fetch (not the SDK the other two
// extraction files use) with reasoning effort "minimal" - a value
// that doesn't appear anywhere else in the codebase, where every
// other call site uses "low". This route reimplements that exact
// call (copied verbatim) against a real document, with both
// "minimal" and "low" for comparison, and surfaces the raw HTTP
// status + error body instead of collapsing a failure to null the
// way the production helper deliberately does. No DB writes.
// Removed once the check is done.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OCR_MODEL = "gpt-6.1-sol";

async function callOpenAiVision(
  apiKey: string,
  bytes: Uint8Array,
  mediaType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp",
  prompt: string,
  effort: string,
  maxOutputTokens = 256,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const base64 = Buffer.from(bytes).toString("base64");
  const contentBlock: Record<string, unknown> =
    mediaType === "application/pdf"
      ? { type: "input_file", file_data: `data:application/pdf;base64,${base64}`, filename: "document.pdf" }
      : { type: "input_image", image_url: `data:${mediaType};base64,${base64}`, detail: "high" };

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: OCR_MODEL,
      max_output_tokens: maxOutputTokens,
      reasoning: { effort },
      input: [
        {
          role: "user",
          content: [contentBlock, { type: "input_text", text: prompt }],
        },
      ],
    }),
  });
  const body = await resp.json().catch(() => null);
  return { ok: resp.ok, status: resp.status, body };
}

export async function GET(req: NextRequest) {
  const secret = process.env.DIAG_TEST_SECRET;
  const given = req.nextUrl.searchParams.get("secret");
  if (!secret || given !== secret) {
    return new NextResponse("Unauthorised", { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });
  }

  const path = join(process.cwd(), "fixtures", "diag", "utr_letter_test.jpg");
  const bytes = new Uint8Array(readFileSync(path));
  const prompt =
    "Find the UK Unique Taxpayer Reference (UTR) on this document. It is a 10-digit number, "
    + "usually printed on an HMRC letter after the word 'UTR' or 'Unique Taxpayer Reference'. "
    + "Return just the 10 digits, no spaces or punctuation. If you cannot find it, return null.";

  const minimal = await callOpenAiVision(apiKey, bytes, "image/jpeg", prompt, "minimal");
  const low = await callOpenAiVision(apiKey, bytes, "image/jpeg", prompt, "low");

  return NextResponse.json({ minimal, low });
}
