import { NextResponse, type NextRequest } from "next/server";
import {
  findPchCasesNeedingReminder,
  runPchDocumentReminderSweep,
} from "@/lib/pch/document-reminders";

// Vercel cron hits this daily. Vercel attaches an
// Authorization: Bearer ${CRON_SECRET} header automatically when the
// env var is set; we require a match so random external POSTs can't
// trigger a mail flood.
//
// Query params:
//   ?dryRun=1   only lists candidates, doesn't send + doesn't update
//               last_doc_reminder_at. Useful in dev to check who
//               WOULD get reminded before enabling.
//
// Returns a JSON summary of the sweep. Vercel's cron dashboard surfaces
// non-2xx responses so failures (not individual email bounces, which
// are counted but not fatal) still get visibility.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Dev-friendly default: no secret configured = allow (so a local
    // curl works without extra setup). Production MUST set CRON_SECRET.
    return process.env.NODE_ENV !== "production";
  }
  const header = req.headers.get("authorization") ?? "";
  return header === "Bearer " + secret;
}

export async function GET(req: NextRequest) {
  if (!isAuthorised(req)) {
    return new NextResponse("Unauthorised", { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const now = new Date();
  if (dryRun) {
    const candidates = await findPchCasesNeedingReminder(now);
    return NextResponse.json({
      dryRun: true,
      found: candidates.length,
      cases: candidates.map((c) => ({
        caseId: c.caseId,
        clientEmail: c.clientEmail,
        missingSlots: c.missingSlots.map((s) => s.code),
      })),
    });
  }
  const result = await runPchDocumentReminderSweep(now);
  return NextResponse.json({ dryRun: false, ...result });
}
