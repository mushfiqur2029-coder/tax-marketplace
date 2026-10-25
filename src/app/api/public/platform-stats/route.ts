import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Public, unauthenticated platform-stats feed. Consumed by the static
// marketing site's "proof" stats band (sterlingledger.co.uk, served
// from cPanel), same pattern as /api/public/pricing: the static HTML
// ships with illustrative fallback numbers baked in, and this fetcher
// overwrites them with live figures so the band never goes stale
// again after a static redeploy.
//
// What this surfaces:
//   • vettedAccountants: count of accountant_profiles with
//     approval_status = 'approved'. Grows as admin approves more
//     accountants.
//   • filedBeforeDeadlinePct: among cases that have reached 'filed'
//     or 'complete' and have a deadline set, the % whose updated_at
//     is on/before that deadline. updated_at is a proxy for "when
//     filed" since cases has no dedicated filed_at column yet; both
//     'filed' and 'complete' are at-or-past-filing states so this is
//     a reasonable approximation, not exact.
//   • avgFirstResponseHours: average hours between a case being
//     submitted and the accountant's first message on it (case_
//     messages, author_role = 'accountant'). 0 when there's no
//     messaging data yet.
//   • accuracyGuaranteedPct: fixed at 100. This is a forward-looking
//     service guarantee, not a backward-looking measurement, there's
//     no HMRC-rejection/correction tracking to compute a real
//     historical rate from, so it's intentionally not DB-derived.
//
// What this does NOT surface: anything case- or client-identifying.
// Every figure here is an aggregate count/average/percentage, never
// a single case or person's data.

const ALLOWED_ORIGINS = new Set([
  "https://sterlingledger.co.uk",
  "https://www.sterlingledger.co.uk",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
  }
  return { "Vary": "Origin" };
}

export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const admin = createAdminClient();

  const [vettedResult, deadlineResult, assignedResult] = await Promise.all([
    admin
      .from("accountant_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("approval_status", "approved"),
    admin
      .from("cases")
      .select("deadline, updated_at")
      .in("status", ["filed", "complete"])
      .not("deadline", "is", null),
    admin
      .from("cases")
      .select("id, submitted_at, created_at")
      .not("accountant_id", "is", null),
  ]);

  const vettedAccountants = vettedResult.count ?? 0;

  let filedBeforeDeadlinePct = 0;
  const deadlineCases = deadlineResult.data ?? [];
  if (deadlineCases.length > 0) {
    const onTime = deadlineCases.filter(
      (c) => new Date(c.updated_at as string) <= new Date(c.deadline as string),
    ).length;
    filedBeforeDeadlinePct = Math.round((onTime / deadlineCases.length) * 100);
  }

  let avgFirstResponseHours = 0;
  const assignedCases = assignedResult.data ?? [];
  if (assignedCases.length > 0) {
    const ids = assignedCases.map((c) => c.id as string);
    const { data: firstMsgs } = await admin
      .from("case_messages")
      .select("case_id, created_at")
      .in("case_id", ids)
      .eq("author_role", "accountant")
      .order("created_at", { ascending: true });

    const firstByCase = new Map<string, string>();
    (firstMsgs ?? []).forEach((m) => {
      const caseId = m.case_id as string;
      if (!firstByCase.has(caseId)) firstByCase.set(caseId, m.created_at as string);
    });

    const hours: number[] = [];
    assignedCases.forEach((c) => {
      const firstResponseAt = firstByCase.get(c.id as string);
      if (!firstResponseAt) return;
      const startedAt = (c.submitted_at ?? c.created_at) as string;
      const hrs = (new Date(firstResponseAt).getTime() - new Date(startedAt).getTime()) / 3_600_000;
      if (hrs >= 0) hours.push(hrs);
    });

    if (hours.length > 0) {
      avgFirstResponseHours =
        Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10;
    }
  }

  const body = {
    vettedAccountants,
    filedBeforeDeadlinePct,
    avgFirstResponseHours,
    accuracyGuaranteedPct: 100,
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: 200,
    headers: {
      ...corsHeaders(origin),
      // Stats move slowly, longer cache than the pricing feed is fine.
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
    },
  });
}
