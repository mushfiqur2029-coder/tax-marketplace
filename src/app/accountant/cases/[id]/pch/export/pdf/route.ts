import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPchExportPayload } from "@/lib/pch/export-data";
import { renderPchExportPdf } from "@/lib/pch/export-pdf";

// Accountant-only PDF export of the P&L, Tax & NIC and SA103S boxes
// plus the override audit trail. Auth guard matches the actions file:
// the signed-in accountant must own this specific case.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  const pdfBytes = await renderPchExportPdf(payload);
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = (payload.client.name || "client").replace(/[^\w.-]+/g, "_");
  return new NextResponse(pdfBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="pch-${safeName}-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
