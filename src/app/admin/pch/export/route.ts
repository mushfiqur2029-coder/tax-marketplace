import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PCH_OVERRIDE_FIELDS,
  currentOverrides,
  type OverrideRow,
} from "@/lib/pch/overrides";
import type { TaxEngineOutput } from "@/lib/tax-engine";

// CSV export of every PCH automated case for admin reconciliation.
// One row per case; columns = basic case meta + each overridable
// engine figure resolved to its effective value (so what's exported
// matches what the accountant actually signed off, not the raw
// engine calculation).

export const dynamic = "force-dynamic";

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export async function GET() {
  await requireRole("admin");
  const admin = createAdminClient();

  const [
    { data: cases },
    { data: heads },
    { data: users },
    { data: overrideRows },
    { data: checkRows },
  ] = await Promise.all([
    admin
      .from("cases")
      .select("id, client_id, accountant_id, status, created_at, updated_at")
      .eq("tier", "uber_phv_automated")
      .order("created_at", { ascending: false }),
    admin
      .from("pch_cases")
      .select(
        "case_id, cl_name, cl_email, cl_utr, cl_nino, client_approval_at, client_approval_name, engine_snapshot, engine_snapshot_at",
      ),
    admin.from("users").select("id, email"),
    admin
      .from("pch_overrides")
      .select("case_id, field_path, old_value, new_value, reason, overridden_by, overridden_at")
      .order("overridden_at", { ascending: false }),
    admin.from("pch_check_status").select("case_id, status"),
  ]);

  const headByCase = new Map((heads ?? []).map((h) => [h.case_id, h]));
  const userById = new Map((users ?? []).map((u) => [u.id, u]));

  // Overrides grouped by case so we can fold each case's history
  // independently to get its "current" effective-value map.
  const overridesByCase = new Map<string, OverrideRow[]>();
  for (const r of overrideRows ?? []) {
    const list = overridesByCase.get(r.case_id) ?? [];
    list.push(r as unknown as OverrideRow);
    overridesByCase.set(r.case_id, list);
  }

  // Resolved-check tallies per case.
  const resolvedByCase = new Map<string, number>();
  for (const r of checkRows ?? []) {
    if (r.status === "Done" || r.status === "N/A") {
      resolvedByCase.set(r.case_id, (resolvedByCase.get(r.case_id) ?? 0) + 1);
    }
  }

  // Header row: static columns + one column per overridable field.
  const staticHeaders = [
    "case_id",
    "client_name",
    "client_email",
    "accountant_email",
    "status",
    "created_at",
    "snapshot_at",
    "approval_at",
    "approval_name",
    "utr",
    "ni_number",
    "override_count",
    "checks_resolved",
    "checks_total",
  ];
  const engineHeaders = PCH_OVERRIDE_FIELDS.map((f) => f.path);
  const headers = [...staticHeaders, ...engineHeaders];
  const lines: string[] = [headers.join(",")];

  for (const c of cases ?? []) {
    const head = headByCase.get(c.id);
    const client = userById.get(c.client_id);
    const accountant = c.accountant_id ? userById.get(c.accountant_id) : null;
    const history = overridesByCase.get(c.id) ?? [];
    const snapshot = (head?.engine_snapshot ?? null) as TaxEngineOutput | null;
    const current = currentOverrides(history);

    const row: (string | number | null)[] = [
      c.id,
      head?.cl_name ?? "",
      head?.cl_email ?? client?.email ?? "",
      accountant?.email ?? "",
      c.status,
      c.created_at,
      head?.engine_snapshot_at ?? "",
      head?.client_approval_at ?? "",
      head?.client_approval_name ?? "",
      head?.cl_utr ?? "",
      head?.cl_nino ?? "",
      history.length,
      resolvedByCase.get(c.id) ?? 0,
      33,
    ];

    for (const f of PCH_OVERRIDE_FIELDS) {
      if (!snapshot) {
        row.push("");
        continue;
      }
      const override = current.get(f.path);
      const value = override?.value ?? f.read(snapshot);
      row.push(Number.isFinite(value) ? Math.round(value * 100) / 100 : "");
    }

    lines.push(row.map(csvEscape).join(","));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const body = lines.join("\n") + "\n";
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pch-cases-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
