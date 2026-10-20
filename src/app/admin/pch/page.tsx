import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { StatusPill } from "@/components/case/status-pill";
import type { TaxEngineOutput } from "@/lib/tax-engine";

// Admin index of every PCH automated case. One row per case with the
// operational columns that let an admin spot stuck cases at a glance:
// which stage they're in, whether the checklist is progressing, whether
// the client has approved yet, and how many accountant overrides sit
// on the engine's figures.

export const dynamic = "force-dynamic";

type Row = {
  case_id: string;
  client_id: string;
  client_name: string | null;
  client_email: string;
  status: string;
  status_since: string;             // created_at or updated_at proxy
  checks_resolved: number;
  checks_total: number;
  approval_at: string | null;
  approval_name: string | null;
  override_count: number;
  snapshot_at: string | null;
  taxable_profit: number | null;    // from engine_snapshot.pl.taxableProfit
};

function daysBetween(a: string, b: string): number {
  return Math.max(0, Math.round((+new Date(b) - +new Date(a)) / 86_400_000));
}

export default async function AdminPchListPage() {
  await requireRole("admin");
  const admin = createAdminClient();

  // Pull every PCH automated case + the head row + user info + override
  // counts + check counts in parallel. Volume is low enough that joining
  // in app code is simpler than a view.
  const [{ data: cases }, { data: heads }, { data: users }, { data: overrideRows }, { data: checkRows }] =
    await Promise.all([
      admin.from("cases")
        .select("id, client_id, status, created_at, updated_at")
        .eq("tier", "uber_phv_automated")
        .order("updated_at", { ascending: false }),
      admin.from("pch_cases").select("case_id, cl_name, cl_email, client_approval_at, client_approval_name, engine_snapshot, engine_snapshot_at"),
      admin.from("users").select("id, email"),
      admin.from("pch_overrides").select("case_id"),
      admin.from("pch_check_status").select("case_id, status"),
    ]);

  const headByCase = new Map((heads ?? []).map((h) => [h.case_id, h]));
  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  // override counts (append-only log, so count = history length)
  const overrideCountByCase = new Map<string, number>();
  for (const r of overrideRows ?? []) {
    overrideCountByCase.set(r.case_id, (overrideCountByCase.get(r.case_id) ?? 0) + 1);
  }
  // resolved-check counts
  const resolvedByCase = new Map<string, number>();
  for (const r of checkRows ?? []) {
    if (r.status === "Done" || r.status === "N/A") {
      resolvedByCase.set(r.case_id, (resolvedByCase.get(r.case_id) ?? 0) + 1);
    }
  }

  const rows: Row[] = (cases ?? []).map((c) => {
    const head = headByCase.get(c.id);
    const user = userById.get(c.client_id);
    const snapshot = (head?.engine_snapshot ?? null) as TaxEngineOutput | null;
    return {
      case_id: c.id,
      client_id: c.client_id,
      client_name: head?.cl_name ?? null,
      client_email: head?.cl_email ?? user?.email ?? "",
      status: c.status,
      status_since: c.updated_at ?? c.created_at,
      checks_resolved: resolvedByCase.get(c.id) ?? 0,
      checks_total: 33,
      approval_at: head?.client_approval_at ?? null,
      approval_name: head?.client_approval_name ?? null,
      override_count: overrideCountByCase.get(c.id) ?? 0,
      snapshot_at: head?.engine_snapshot_at ?? null,
      taxable_profit: snapshot?.pl?.taxableProfit ?? null,
    };
  });

  const today = new Date().toISOString();
  const money = (n: number | null) =>
    n == null ? "-" : "£" + Math.round(n).toLocaleString("en-GB");

  return (
    <>
      <AdminPageHeader
        eyebrow="PCH automated"
        title="PCH cases"
        description={`${rows.length} case${rows.length === 1 ? "" : "s"} on the automated flow`}
        rightSlot={
          <Link
            href="/admin/pch/export"
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
            Export CSV
          </Link>
        }
      />
      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600 uppercase tracking-wide">
            <tr>
              <th className="text-left py-2 px-3">Client</th>
              <th className="text-left py-2 px-3">Status</th>
              <th className="text-right py-2 px-3 w-24">Days in</th>
              <th className="text-right py-2 px-3 w-24">Checks</th>
              <th className="text-left py-2 px-3 w-32">Approval</th>
              <th className="text-right py-2 px-3 w-24">Overrides</th>
              <th className="text-left py-2 px-3 w-36">Snapshot</th>
              <th className="text-right py-2 px-3 w-28">Taxable £</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 px-3 text-center text-slate-500 text-sm">
                  No PCH cases yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.case_id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="py-2 px-3">
                    <Link href={`/admin/pch/${r.case_id}`} className="hover:underline">
                      <div className="font-medium text-slate-800">
                        {r.client_name ?? r.client_email}
                      </div>
                      {r.client_name && (
                        <div className="text-xs text-slate-500">{r.client_email}</div>
                      )}
                    </Link>
                  </td>
                  <td className="py-2 px-3">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="py-2 px-3 text-right text-slate-700 tabular-nums">
                    {daysBetween(r.status_since, today)}d
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    <span className={
                      r.checks_resolved >= r.checks_total ? "text-emerald-700 font-semibold"
                      : r.checks_resolved > 0 ? "text-amber-700" : "text-slate-500"
                    }>
                      {r.checks_resolved}/{r.checks_total}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-xs">
                    {r.approval_at ? (
                      <span className="text-emerald-700">
                        ✓ {r.approval_name} <br/>
                        <span className="text-slate-500">
                          {new Date(r.approval_at).toLocaleDateString()}
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-500">-</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    {r.override_count > 0 ? (
                      <span className="text-amber-700 font-semibold">{r.override_count}</span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-xs text-slate-600">
                    {r.snapshot_at
                      ? new Date(r.snapshot_at).toLocaleString()
                      : <span className="text-slate-400">not run</span>}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums font-medium">
                    {money(r.taxable_profit)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
