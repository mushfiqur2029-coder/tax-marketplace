import { NextResponse, type NextRequest } from "next/server";
import { extractBulkIntakeDocument } from "@/lib/pch/bulk-intake-extract";

// TEMPORARY diagnostic endpoint, added 2026-11-10 to live-test the
// OpenAI bulk-intake extraction pipeline (speed + output quality)
// against the real production OPENAI_API_KEY without creating any
// case, upload or line-item rows. Calls extractBulkIntakeDocument
// directly and returns its result plus timing. Nothing is written
// to the database. Protected by DIAG_TEST_SECRET (a one-off env var,
// not CRON_SECRET) so this never doubles as a side door into the
// cron auth. Both this route and the env var are removed once the
// test is done - see the commit that follows this one.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorised(req: NextRequest): boolean {
  const secret = process.env.DIAG_TEST_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === "Bearer " + secret;
}

export async function POST(req: NextRequest) {
  if (!isAuthorised(req)) {
    return new NextResponse("Unauthorised", { status: 401 });
  }

  const mimeType = req.nextUrl.searchParams.get("mimeType") as
    | "application/pdf"
    | "image/jpeg"
    | "image/png"
    | "image/webp"
    | "text/csv"
    | null;
  if (!mimeType) {
    return NextResponse.json({ error: "missing ?mimeType=" }, { status: 400 });
  }

  const bytes = new Uint8Array(await req.arrayBuffer());

  const startedAt = Date.now();
  try {
    const result = await extractBulkIntakeDocument({ bytes, mimeType });
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
