import "server-only";
import OpenAI from "openai";

// Shared plumbing for every OpenAI document-reading call in the PCH
// pipeline. Before this file existed, the model name, the API-key
// check, and the PDF-vs-image content-block shape were each copied
// into three separate files (ai-extract.ts, bulk-intake-extract.ts,
// intake-actions.ts) by hand. That's exactly how the "minimal"
// reasoning-effort bug (2026-11-10 audit) shipped silently: one of
// the three copies drifted from the other two and nothing caught it
// because there was nothing to catch it - each file was free to
// invent its own. Routing every call through this module means a
// typo or a drifted setting shows up once, not once-per-copy, and a
// future model swap is a one-line change here instead of a grep.
//
// Reasoning effort is always "low" (this model's cheapest valid
// value - "minimal" does not exist for it, confirmed live). That is
// deliberately not a parameter: every PCH extraction call wants the
// same cost/speed tradeoff, and the whole point of this file is one
// place to change that, not one more place to get it wrong.

export const EXTRACTION_MODEL = "gpt-6.1-sol";

export type VisionMimeType = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

/** Throws if OPENAI_API_KEY isn't set, so every caller fails the same way. */
export function openAiClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set. Document extraction is disabled.");
  }
  return new OpenAI({ apiKey });
}

/**
 * The one piece of shape-shifting every call site needs: a PDF goes
 * in as input_file (base64 data URL), an image as input_image with
 * detail="high" (the setting that actually matters for reading small
 * print - a receipt total or a licence number - accurately; this is
 * not the OpenAI vision detail default and every call site wants it
 * on purpose, including bulk-intake-extract.ts and intake-actions.ts
 * which used to construct this by hand).
 */
export function visionContentBlock(bytes: Uint8Array, mimeType: VisionMimeType, filename = "document.pdf") {
  const base64 = Buffer.from(bytes).toString("base64");
  if (mimeType === "application/pdf") {
    return {
      type: "input_file" as const,
      file_data: `data:application/pdf;base64,${base64}`,
      filename,
    };
  }
  return {
    type: "input_image" as const,
    image_url: `data:${mimeType};base64,${base64}`,
    detail: "high" as const,
  };
}

/**
 * Minimal one-field OCR: a short prompt in, one short plain-text
 * answer out, no structured-output schema. Used for UTR/NINO and the
 * various single-amount reads in intake-actions.ts. Returns null on
 * any failure (bad response, thrown error, truncated output) so
 * every caller can fall back the same way: the document is still
 * saved, the client just types the value in by hand. Failures are
 * logged (not just swallowed) so a bad setting or a model-side
 * rejection shows up in Vercel's logs instead of silently degrading
 * forever, the way the "minimal" bug did before this file existed.
 */
export async function extractShortTextAnswer(
  bytes: Uint8Array,
  mimeType: VisionMimeType,
  prompt: string,
  maxOutputTokens = 256,
): Promise<string | null> {
  try {
    const openai = openAiClient();
    const response = await openai.responses.create({
      model: EXTRACTION_MODEL,
      max_output_tokens: maxOutputTokens,
      reasoning: { effort: "low" },
      input: [
        {
          role: "user",
          content: [visionContentBlock(bytes, mimeType), { type: "input_text", text: prompt }],
        },
      ],
    });
    return typeof response.output_text === "string" && response.output_text.length > 0
      ? response.output_text
      : null;
  } catch (e) {
    console.error(
      "[extractShortTextAnswer] OpenAI call failed:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}
