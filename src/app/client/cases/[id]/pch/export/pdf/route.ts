import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPchExportPayload } from "@/lib/pch/export-data";
import { renderPchExportPdf } from "@/lib/pch/export-pdf";

// Client-facing PDF export of the final accounts pack. Mirrors the
// accountant route one-for-one (same shared payload builder, so the
// figures can never drift), but the links on the client's final-pack
// review screen (final-pack-review.tsx) used to point straight at the
// accountant-only route: requireRole("accountant") there redirected the
// client to their own dashboard instead of downloading. This route
// exists so the client can download their own pack with their own
// auth, checking case ownership (client_id) rather than assignment
// (accountant_id).

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await requireRole("client");
  const { id: caseId } = await params;

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("cases")
    .select("client_id, tier")
    .eq("id", caseId)
    .single();
  if (!row || row.tier !== "uber_phv_automated") {
    return new NextResponse("Not found", { status: 404 });
  }
  if (row.client_id !== me.id) {
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
