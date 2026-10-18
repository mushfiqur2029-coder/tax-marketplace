import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPchExportPayload } from "@/lib/pch/export-data";
import { renderPchExportCapiumCsv } from "@/lib/pch/export-capium";

// Capium Self Assessment CSV. Accountant-only; only emits a CSV when
// the case has reached filed or complete status AND the client has
// signed off, so the figures the accountant imports to Capium match
// the ones the client approved.

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await requireRole("accountant");
  const { id: caseId } = await params;

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("cases")
    .select("accountant_id, tier, status")
    .eq("id", caseId)
    .single();
  if (!row || row.tier !== "uber_phv_automated") {
    return new NextResponse("Not found", { status: 404 });
  }
  if (row.accountant_id !== me.id) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const payload = await buildPchExportPayload(caseId);
  if (!payload) return new NextResponse("Not found", { status: 404 });

  // Gate on final approved+filed status. Capium CSV is intended for the
  // post-filing bookkeeping import, not a mid-review draft dump.
  if (!(payload.status === "filed" || payload.status === "complete") || !payload.approval.at) {
    return new NextResponse(
      "This case is not yet filed and approved; Capium export is only available after the client has approved and the case has moved to filed.",
      { status: 409 },
    );
  }

  const csv = renderPchExportCapiumCsv(payload);
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = (payload.client.name || "client").replace(/[^\w.-]+/g, "_");
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="capium-${safeName}-${payload.taxYear.replace("/", "-")}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
