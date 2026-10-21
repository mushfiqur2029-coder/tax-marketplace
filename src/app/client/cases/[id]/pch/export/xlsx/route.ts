import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPchExportPayload } from "@/lib/pch/export-data";
import { renderPchExportXlsx } from "@/lib/pch/export-xlsx";

// Client-facing Excel export of the final accounts pack. See pdf/route.ts
// in this same folder for why this exists alongside the accountant-only
// route: the client's final-pack review screen used to link straight to
// /accountant/cases/.../pch/export/xlsx, which redirected the client to
// their own dashboard instead of downloading (requireRole("accountant")
// bounces anyone who isn't an accountant). Same shared payload builder,
// so the numbers match the accountant's copy cell for cell; only the
// auth check differs (case ownership via client_id, not accountant_id).

export const dynamic = "force-dynamic";

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
