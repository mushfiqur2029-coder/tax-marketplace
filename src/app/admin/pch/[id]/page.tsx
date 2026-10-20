import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { StatusPill } from "@/components/case/status-pill";
import {
  PCH_OVERRIDE_FIELDS,
  currentOverrides,
  type OverrideRow,
} from "@/lib/pch/overrides";
import type { TaxEngineOutput } from "@/lib/tax-engine";

// Admin read-only inspect view for a PCH automated case. The admin
// console is observational: it never applies overrides, moves status,
// or edits intake. That stays with the accountant and client.
//
// What this page needs to answer at a glance:
//   - who the client is + the headline figures from the current snapshot
//   - what the engine said and what the accountant changed on top
//   - whether the client approved and against which snapshot version

export const dynamic = "force-dynamic";

const money = (pence: number | null | undefined) =>
  pence == null ? "-" : "£" + (pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 });

const moneyFromNumber = (n: number | null | undefined) =>
  n == null ? "-" : "£" + Math.round(n).toLocaleString("en-GB");

export default async function AdminPchInspectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("admin");
  const { id: caseId } = await params;
  const admin = createAdminClient();

  const { data: caseRow } = await admin
    .from("cases")
    .select("id, client_id, accountant_id, status, created_at, updated_at, tier, deadline")
    .eq("id", caseId)
    .single();
  if (!caseRow || caseRow.tier !== "uber_phv_automated") notFound();

  const [
    { data: head },
    { data: income },
    { data: expenses },
    { data: vehicle },
    { data: docStatus },
    { data: slots },
    { data: overrides },
    { data: client },
    { data: accountant },
  ] = await Promise.all([
    admin.from("pch_cases").select("*").eq("case_id", caseId).single(),
    admin
      .from("pch_income_lines")
      .select("source, gross_takings_pence, platform_fee_pence, on_trip_miles, dead_miles, evidence, line_type")
      .eq("case_id", caseId)
      .order("sort_order"),
    admin
      .from("pch_expense_lines")
      .select("label, amount_paid_pence, evidence, car_cost, category, sa103s_box")
      .eq("case_id", caseId)
      .order("sort_order"),
    admin.from("pch_vehicle").select("*").eq("case_id", caseId).maybeSingle(),
    admin.from("pch_doc_status").select("slot_code, status, updated_at").eq("case_id", caseId),
    admin.from("pch_doc_slots").select("code, section, display_name, sort_order").order("sort_order"),
    admin
      .from("pch_overrides")
      .select("id, field_path, old_value, new_value, reason, overridden_by, overridden_at")
      .eq("case_id", caseId)
      .order("overridden_at", { ascending: false }),
    admin.from("users").select("id, email").eq("id", caseRow.client_id).maybeSingle(),
    caseRow.accountant_id
      ? admin.from("users").select("id, email").eq("id", caseRow.accountant_id).maybeSingle()
      : Promise.resolve({ data: null } as { data: { id: string; email: string } | null }),
  ]);

  // Resolve display names for every user_id that appears in override
  // rows so we can show "Jane Smith" instead of a uuid.
  const touchedBy = new Set<string>();
  for (const r of overrides ?? []) if (r.overridden_by) touchedBy.add(r.overridden_by);
  const otherIds = Array.from(touchedBy).filter(
    (id) => id !== caseRow.client_id && id !== caseRow.accountant_id,
  );
  const { data: otherUsers } = otherIds.length
    ? await admin.from("users").select("id, email").in("id", otherIds)
    : { data: [] as { id: string; email: string }[] };
  const userById = new Map<string, { email: string }>();
  if (client) userById.set(client.id, { email: client.email });
  if (accountant) userById.set(accountant.id, { email: accountant.email });
  for (const u of otherUsers ?? []) userById.set(u.id, { email: u.email });
  const nameOf = (id: string | null) => {
    if (!id) return "-";
    const u = userById.get(id);
    return u?.email ?? id.slice(0, 8);
  };

  const snapshot = (head?.engine_snapshot ?? null) as TaxEngineOutput | null;
  const current = currentOverrides((overrides ?? []) as OverrideRow[]);

  const docStatusByCode = new Map((docStatus ?? []).map((d) => [d.slot_code, d]));
  const docsUploaded = (docStatus ?? []).filter((d) => d.status === "Uploaded").length;
  const docsNA = (docStatus ?? []).filter((d) => d.status === "Not applicable").length;

  return (
    <>
      <AdminPageHeader
        eyebrow="PCH automated · admin inspect"
        title={head?.cl_name ?? client?.email ?? "Case"}
        description="Read-only view. Admins observe; the accountant and client do the editing."
        rightSlot={
          <Link
            href="/admin/pch"
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Back to list
          </Link>
        }
      />

      {/* Case meta */}
      <section className="mb-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetaCard label="Status">
          <StatusPill status={caseRow.status} />
        </MetaCard>
        <MetaCard label="Client">
          <div className="text-sm font-medium text-slate-800">
            {client?.email ?? "-"}
          </div>
          <div className="text-xs text-slate-500">{client?.email}</div>
        </MetaCard>
        <MetaCard label="Accountant">
          <div className="text-sm font-medium text-slate-800">
            {accountant?.email ?? "Unassigned"}
          </div>
          {accountant?.email ? (
            <div className="text-xs text-slate-500">{accountant.email}</div>
          ) : null}
        </MetaCard>
        <MetaCard label="Deadline">
          <div className="text-sm font-medium text-slate-800">
            {caseRow.deadline ? new Date(caseRow.deadline).toLocaleDateString() : "-"}
          </div>
          <div className="text-xs text-slate-500">
            Opened {new Date(caseRow.created_at).toLocaleDateString()}
          </div>
        </MetaCard>
      </section>

      {/* Client approval */}
      <Section title="Client approval">
        {head?.client_approval_at ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
            <div className="font-medium text-emerald-800">
              ✓ Approved by {head.client_approval_name}
            </div>
            <div className="mt-1 text-xs text-emerald-700">
              {new Date(head.client_approval_at).toLocaleString()}
              {head.client_approval_ip ? <> · from {head.client_approval_ip}</> : null}
              {head.client_approval_version != null ? (
                <> · against snapshot v{head.client_approval_version}</>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            Not approved yet.
          </p>
        )}
      </Section>

      {/* Engine snapshot vs overrides */}
      <Section
        title={`Engine snapshot ${head?.engine_snapshot_at ? "(" + new Date(head.engine_snapshot_at).toLocaleString() + ")" : ""}`}
      >
        {snapshot ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600 uppercase tracking-wide">
                <tr>
                  <th className="text-left py-2 px-3">Field</th>
                  <th className="text-right py-2 px-3 w-32">Engine</th>
                  <th className="text-right py-2 px-3 w-32">Effective</th>
                  <th className="text-right py-2 px-3 w-32">Δ</th>
                  <th className="text-left py-2 px-3 w-48">Reason</th>
                </tr>
              </thead>
              <tbody>
                {PCH_OVERRIDE_FIELDS.map((f) => {
                  const calc = f.read(snapshot);
                  const override = current.get(f.path);
                  const effective = override?.value ?? calc;
                  const delta = effective - calc;
                  return (
                    <tr key={f.path} className="border-t border-slate-100">
                      <td className="py-2 px-3">
                        <div className="text-slate-800">{f.label}</div>
                        <div className="text-xs text-slate-500">{f.group}</div>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-slate-700">
                        {moneyFromNumber(calc)}
                      </td>
                      <td
                        className={
                          "py-2 px-3 text-right tabular-nums font-medium " +
                          (override ? "text-amber-700" : "text-slate-800")
                        }
                      >
                        {moneyFromNumber(effective)}
                      </td>
                      <td
                        className={
                          "py-2 px-3 text-right tabular-nums " +
                          (Math.abs(delta) < 0.5
                            ? "text-slate-400"
                            : delta > 0
                              ? "text-emerald-700"
                              : "text-rose-700")
                        }
                      >
                        {Math.abs(delta) < 0.5
                          ? "-"
                          : (delta > 0 ? "+" : "") + moneyFromNumber(delta)}
                      </td>
                      <td className="py-2 px-3 text-xs text-slate-600">
                        {override?.reason ?? ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            Engine has not run yet.
          </p>
        )}
      </Section>

      {/* Override history */}
      <Section title={`Override history (${overrides?.length ?? 0})`}>
        {!overrides || overrides.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            No overrides on this case.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600 uppercase tracking-wide">
                <tr>
                  <th className="text-left py-2 px-3 w-40">When</th>
                  <th className="text-left py-2 px-3">Field</th>
                  <th className="text-right py-2 px-3 w-24">Old</th>
                  <th className="text-right py-2 px-3 w-24">New</th>
                  <th className="text-left py-2 px-3">Reason</th>
                  <th className="text-left py-2 px-3 w-40">By</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => {
                  const field = PCH_OVERRIDE_FIELDS.find((f) => f.path === o.field_path);
                  const isRevert = o.new_value === null;
                  return (
                    <tr key={o.id} className="border-t border-slate-100">
                      <td className="py-2 px-3 text-xs text-slate-500">
                        {new Date(o.overridden_at).toLocaleString()}
                      </td>
                      <td className="py-2 px-3">
                        {field?.label ?? o.field_path}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-slate-600">
                        {o.old_value != null ? moneyFromNumber(Number(o.old_value)) : "-"}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums font-medium">
                        {isRevert ? (
                          <span className="text-slate-400">reverted</span>
                        ) : (
                          moneyFromNumber(Number(o.new_value))
                        )}
                      </td>
                      <td className="py-2 px-3 text-xs text-slate-600">
                        {o.reason ?? ""}
                      </td>
                      <td className="py-2 px-3 text-xs text-slate-600">
                        {nameOf(o.overridden_by)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Intake summary: head */}
      <Section title="Intake · client details">
        <dl className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Field label="UTR" value={head?.cl_utr} />
          <Field label="NI Number" value={head?.cl_nino} />
          <Field label="Date of birth" value={head?.cl_dob} />
          <Field
            label="Address"
            value={[head?.cl_address, head?.cl_postcode].filter(Boolean).join(", ")}
          />
          <Field label="Phone" value={head?.cl_phone} />
          <Field label="Email" value={head?.cl_email} />
          <Field label="Licensing authority" value={head?.cl_licensing_authority} />
          <Field label="Platforms" value={head?.cl_platforms} />
          <Field label="Start / stop" value={[head?.cl_start_date, head?.cl_stop_date].filter(Boolean).join(" → ")} />
          <Field label="Marriage allowance" value={head?.marriage_allowance_status} />
          <Field label="Student loan plan" value={head?.student_loan_plan} />
          <Field label="VAT registered" value={head?.vat_registered ? "Yes" : "No"} />
        </dl>
      </Section>

      {/* Income lines */}
      <Section title={`Income lines (${income?.length ?? 0})`}>
        {!income || income.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            No income lines recorded.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600 uppercase tracking-wide">
                <tr>
                  <th className="text-left py-2 px-3">Source</th>
                  <th className="text-left py-2 px-3 w-20">Type</th>
                  <th className="text-right py-2 px-3 w-28">Gross</th>
                  <th className="text-right py-2 px-3 w-28">Platform fee</th>
                  <th className="text-right py-2 px-3 w-24">On-trip mi</th>
                  <th className="text-right py-2 px-3 w-24">Dead mi</th>
                  <th className="text-left py-2 px-3 w-40">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {income.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-2 px-3">{r.source}</td>
                    <td className="py-2 px-3 text-xs text-slate-600">{r.line_type}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{money(r.gross_takings_pence)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{money(r.platform_fee_pence)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{r.on_trip_miles ?? "-"}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{r.dead_miles ?? "-"}</td>
                    <td className="py-2 px-3 text-xs text-slate-600">{r.evidence ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Expense lines */}
      <Section title={`Expense lines (${expenses?.length ?? 0})`}>
        {!expenses || expenses.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            No expense lines recorded.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600 uppercase tracking-wide">
                <tr>
                  <th className="text-left py-2 px-3">Label</th>
                  <th className="text-left py-2 px-3">Category</th>
                  <th className="text-right py-2 px-3 w-28">Amount</th>
                  <th className="text-left py-2 px-3 w-16">Car?</th>
                  <th className="text-right py-2 px-3 w-16">Box</th>
                  <th className="text-left py-2 px-3 w-40">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-2 px-3">{r.label}</td>
                    <td className="py-2 px-3 text-xs text-slate-600">{r.category}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{money(r.amount_paid_pence)}</td>
                    <td className="py-2 px-3 text-xs text-slate-600">{r.car_cost}</td>
                    <td className="py-2 px-3 text-right text-xs text-slate-600">{r.sa103s_box}</td>
                    <td
                      className={
                        "py-2 px-3 text-xs " +
                        (!r.evidence && (r.amount_paid_pence ?? 0) > 0
                          ? "text-rose-700"
                          : "text-slate-600")
                      }
                    >
                      {r.evidence ?? "- (missing)"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Vehicle */}
      <Section title="Vehicle">
        {!vehicle ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            No vehicle recorded.
          </p>
        ) : (
          <dl className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Status" value={vehicle.status} />
            <Field label="Fuel" value={vehicle.fuel} />
            <Field label="Make / model" value={vehicle.make_model} />
            <Field label="Registration" value={vehicle.registration} />
            <Field label="CO₂ g/km" value={vehicle.co2_gpkm} />
            <Field label="Method choice" value={vehicle.method_choice} />
            <Field
              label="Odometer"
              value={
                vehicle.odo_start != null && vehicle.odo_end != null
                  ? `${vehicle.odo_start} → ${vehicle.odo_end} (${vehicle.odo_end - vehicle.odo_start} mi)`
                  : "-"
              }
            />
            <Field label="Other business miles" value={vehicle.other_business_miles} />
            <Field
              label="Business %"
              value={vehicle.business_pct_override != null ? `${(vehicle.business_pct_override * 100).toFixed(0)}%` : "from mileage"}
            />
            <Field label="Bought this year" value={vehicle.bought_this_year ? "Yes" : "No"} />
            <Field label="Purchase date" value={vehicle.purchase_date} />
            <Field label="Purchase price" value={money(vehicle.purchase_price_pence)} />
            <Field label="New / used" value={vehicle.new_or_used} />
            <Field label="WDV b/f" value={money(vehicle.wdv_brought_forward_pence)} />
            <Field label="Previous method" value={vehicle.previous_method} />
            <Field label="Disposed" value={vehicle.disposed ? "Yes" : "No"} />
            <Field label="Disposal proceeds" value={money(vehicle.disposal_proceeds_pence)} />
          </dl>
        )}
      </Section>

      {/* Documents summary */}
      <Section title={`Documents (${docsUploaded} uploaded · ${docsNA} N/A · ${(slots?.length ?? 24) - docsUploaded - docsNA} awaiting)`}>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600 uppercase tracking-wide">
              <tr>
                <th className="text-left py-2 px-3 w-20">Code</th>
                <th className="text-left py-2 px-3 w-28">Section</th>
                <th className="text-left py-2 px-3">Document</th>
                <th className="text-left py-2 px-3 w-28">Status</th>
                <th className="text-left py-2 px-3 w-40">Updated</th>
              </tr>
            </thead>
            <tbody>
              {(slots ?? []).map((s) => {
                const st = docStatusByCode.get(s.code);
                const status = st?.status ?? "Awaiting";
                return (
                  <tr key={s.code} className="border-t border-slate-100">
                    <td className="py-2 px-3 font-mono text-xs text-slate-500">{s.code}</td>
                    <td className="py-2 px-3 text-xs text-slate-600">{s.section}</td>
                    <td className="py-2 px-3 text-xs text-slate-800">{s.display_name}</td>
                    <td className="py-2 px-3">
                      <span
                        className={
                          "rounded px-1.5 py-0.5 text-xs font-mono " +
                          (status === "Uploaded"
                            ? "bg-emerald-100 text-emerald-800"
                            : status === "Not applicable"
                              ? "bg-slate-100 text-slate-700"
                              : "bg-amber-100 text-amber-800")
                        }
                      >
                        {status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-xs text-slate-500">
                      {st?.updated_at ? new Date(st.updated_at).toLocaleString() : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-600">
        {title}
      </h2>
      {children}
    </section>
  );
}

function MetaCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-800">
        {value == null || value === "" ? <span className="text-slate-400">-</span> : value}
      </dd>
    </div>
  );
}
