import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPchExportPayload } from "@/lib/pch/export-data";
import { renderPchExportXlsx } from "@/lib/pch/export-xlsx";

// Accountant-only Excel export: Summary / SA103S / Overrides sheets.
// Numbers match the PDF cell for cell (shared payload builder).

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
    .select("accountant_id, tier")
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

  const xlsxBytes = renderPchExportXlsx(payload);
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = (payload.client.name || "client").replace(/[^\w.-]+/g, "_");
  return new NextResponse(xlsxBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="pch-${safeName}-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
