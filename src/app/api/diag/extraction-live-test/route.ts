import { NextResponse, type NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractBulkIntakeDocument } from "@/lib/pch/bulk-intake-extract";

// TEMPORARY diagnostic endpoint, added 2026-11-10 to live-test the
// OpenAI bulk-intake extraction pipeline (speed + output quality)
// against the real production OPENAI_API_KEY without creating any
// case, upload or line-item rows. Reads a synthetic fixture file
// from fixtures/diag/ (GET, auth via query param since the fetch
// path available here can't send custom headers), calls
// extractBulkIntakeDocument directly, and returns its result plus
// timing. Nothing is written to the database. Protected by
// DIAG_TEST_SECRET (a one-off env var, not CRON_SECRET). This route,
// its env var, and the fixture files are removed once the test is
// done - see the commit that follows this one.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FIXTURES = {
  receipt: { file: "receipt_test.jpg", mimeType: "image/jpeg" as const },
  bank: { file: "bank_statement_test.pdf", mimeType: "application/pdf" as const },
};

export async function GET(req: NextRequest) {
  const secret = process.env.DIAG_TEST_SECRET;
  const given = req.nextUrl.searchParams.get("secret");
  if (!secret || given !== secret) {
    return new NextResponse("Unauthorised", { status: 401 });
  }

  const which = req.nextUrl.searchParams.get("which") ?? "";
  const fixture = FIXTURES[which as keyof typeof FIXTURES];
  if (!fixture) {
    return NextResponse.json(
      { error: "pass ?which=receipt or ?which=bank" },
      { status: 400 },
    );
  }

  const path = join(process.cwd(), "fixtures", "diag", fixture.file);
  const bytes = new Uint8Array(readFileSync(path));

  const startedAt = Date.now();
  try {
    const result = await extractBulkIntakeDocument({ bytes, mimeType: fixture.mimeType });
    const elapsedMs = Date.now() - startedAt;
    return NextResponse.json({ elapsedMs, ...result });
  } catch (e) {
    const elapsedMs = Date.now() - startedAt;
    return NextResponse.json(
      { elapsedMs, error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 },
    );
  }
}
