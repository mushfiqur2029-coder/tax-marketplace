import { NextResponse, type NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractBulkIntakeDocument } from "@/lib/pch/bulk-intake-extract";
import { extractShortTextAnswer } from "@/lib/pch/openai-vision";

// TEMPORARY diagnostic endpoint, added 2026-11-10 to re-verify both
// extraction paths behave identically after consolidating the three
// previously-separate OpenAI call implementations into
// openai-vision.ts. No DB writes. Removed once the check is done.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.DIAG_TEST_SECRET;
  const given = req.nextUrl.searchParams.get("secret");
  if (!secret || given !== secret) {
    return new NextResponse("Unauthorised", { status: 401 });
  }

  const receiptBytes = new Uint8Array(readFileSync(join(process.cwd(), "fixtures", "diag", "receipt_test.jpg")));
  const utrBytes = new Uint8Array(readFileSync(join(process.cwd(), "fixtures", "diag", "utr_letter_test.jpg")));

  const t1 = Date.now();
  const receipt = await extractBulkIntakeDocument({ bytes: receiptBytes, mimeType: "image/jpeg" });
  const receiptMs = Date.now() - t1;

  const t2 = Date.now();
  const utr = await extractShortTextAnswer(
    utrBytes,
    "image/jpeg",
    "Find the UK Unique Taxpayer Reference (UTR) on this document. It is a 10-digit number, "
      + "usually printed on an HMRC letter after the word 'UTR' or 'Unique Taxpayer Reference'. "
      + "Return just the 10 digits, no spaces or punctuation. If you cannot find it, return null.",
  );
  const utrMs = Date.now() - t2;

  return NextResponse.json({
    receipt: { elapsedMs: receiptMs, ...receipt },
    utr: { elapsedMs: utrMs, raw: utr },
  });
}
