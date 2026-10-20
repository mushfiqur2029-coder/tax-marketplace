"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaxEngineOutput } from "@/lib/tax-engine";
import {
  setPchCheckStatusAction,
  requestClientFilingAction,
  applyPchOverrideAction,
  revertPchOverrideAction,
  savePchSa302ComparisonAction,
  rerunPchEngineSnapshotAction,
} from "@/app/accountant/pch/actions";
import {
  PCH_OVERRIDE_FIELDS,
  type OverrideRow,
  effectiveValues,
  reasonRequired,
  type FieldDef,
} from "@/lib/pch/overrides";
import {
  SA302_COMPARE_FIELDS,
  diffStatus,
  type Sa302Comparison,
  type Sa302Group,
} from "@/lib/pch/sa302";
import type { Anomaly } from "@/lib/pch/prior-year-anomalies";
import type { ChecklistPrefill } from "@/lib/pch/checklist-prefills";
import { classifyChecklistItem, type ChecklistKind } from "@/lib/pch/checklist-classification";
import {
  SA103S_UI,
  SA103S_SUBGROUP_ORDER,
  type Sa103sSubgroup,
} from "@/lib/pch/sa103s-labels";
import { PriorYearAnomalyPanel } from "./prior-year-anomaly-panel";
import {
  AwaitingAccountantPanel,
  type BlockedSlot,
} from "./awaiting-accountant-panel";
import {
  AddonRequestWidget,
  type AddonRow,
} from "./addon-request-widget";
import {
  PlEditGrid,
  type IncomeLineRow,
  type ExpenseLineRow,
} from "./pl-edit-grid";
import { FinalSignoffPanel } from "./final-signoff-panel";
import { IdentityPanel, type IdentityPanelProps } from "./identity-panel";
import {
  DocumentsPanel,
  type DocumentRow,
  type SlotMeta,
} from "./documents-panel";
import type { ActionResult } from "@/lib/action-result";

type CheckItem = { item_number: number; area: string; description: string };
type CheckStatus = {
  case_id: string; item_number: number;
  status: "Done" | "N/A" | "Not started"; note: string | null;
};

export function PchAccountantView(props: {
  caseId: string;
  caseStatus: string;
  checksMeta: CheckItem[];
  checkStatus: CheckStatus[];
  // Phase 7 Slice 7.4: per-item pre-fill from the server-side derive
  // step. Items with kind=auto in CHECKLIST_CLASSIFICATION map to one
  // entry here when derivation succeeded; empty in 7.4 (stub) and
  // filled per cluster in 7.5. Rendered inside CheckRow.
  checkPrefills: ChecklistPrefill[];
  snapshot: TaxEngineOutput | null;
  snapshotAt: string | null;
  editsSinceSnapshot: number;
  approvalAt: string | null;
  approvalName: string | null;
  overrideHistory: OverrideRow[];
  userDisplayNames: Record<string, string | null>;
  sa302Comparison: Sa302Comparison | null;
  priorYearAnomalies: Anomaly[];
  priorYearLabel: string;
  awaitingAccountantSlots: BlockedSlot[];
  addons: AddonRow[];
  incomeLines: IncomeLineRow[];
  expenseLines: ExpenseLineRow[];
  bookkeepingConfirmedAt: string | null;
  bookkeepingConfirmedByLabel: string | null;
  clientApprovalAt: string | null;
  clientApprovalName: string | null;
  finalPackSentAt: string | null;
  finalPackConfirmedAt: string | null;
  finalPackConfirmedName: string | null;
  messagesPanel: React.ReactNode;
  identity: IdentityPanelProps;
  documents: DocumentRow[];
  documentSlotMeta: SlotMeta[];
  signDocUrl: (path: string) => Promise<ActionResult<string>>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const statusByItem = new Map(props.checkStatus.map((s) => [s.item_number, s]));
  const prefillByItem = new Map(props.checkPrefills.map((p) => [p.item, p]));
  const resolvedCount = props.checkStatus.filter(
    (s) => s.status === "Done" || s.status === "N/A"
  ).length;
  const total = props.checksMeta.length;
  const allResolved = resolvedCount >= total;

  // Second advance-to-approval gate: every positive-amount expense line
  // must carry an evidence method. Mirrors the server-side canRequestFiling
  // check so the accountant sees the blocker count up-front, not just as
  // an error after clicking the big button.
  const missingEvidenceCount = props.expenseLines.filter(
    (l) => l.amount_paid_pence > 0 && !(l.evidence && l.evidence.trim().length > 0),
  ).length;
  const allEvidenced = missingEvidenceCount === 0;
  const canAdvance = allResolved && allEvidenced;

  const requestFiling = () => start(async () => {
    const r = await requestClientFilingAction(props.caseId);
    if (!r.ok) setErr(r.error);
    else { setErr(null); router.refresh(); }
  });

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">PCH automated, accountant review</h1>
          <p className="text-sm text-slate-600 mt-1">
            Case {props.caseId.slice(0, 8)}. Status <strong>{props.caseStatus}</strong>.
          </p>
        </div>
        {props.snapshot ? (
          <div className="flex flex-wrap gap-2">
            <a
              href={`/accountant/cases/${props.caseId}/pch/export/pdf`}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Download PDF
            </a>
            <a
              href={`/accountant/cases/${props.caseId}/pch/export/xlsx`}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Download Excel
            </a>
            {props.caseStatus === "filed" || props.caseStatus === "complete" ? (
              <a
                href={`/accountant/cases/${props.caseId}/pch/export/capium`}
                className="rounded border border-sky-300 bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-900 hover:bg-sky-100"
                title="Signed-off figures formatted for Capium Self Assessment import"
              >
                Capium CSV
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      <IdentityPanel {...props.identity} />

      <DocumentsPanel
        docs={props.documents}
        slotMeta={props.documentSlotMeta}
        signUrl={props.signDocUrl}
      />

      <AwaitingAccountantPanel
        caseId={props.caseId}
        blocked={props.awaitingAccountantSlots}
      />

      <PriorYearAnomalyPanel
        anomalies={props.priorYearAnomalies}
        priorYearLabel={props.priorYearLabel}
      />

      {/* Phase 6 Slice 6: bookkeeping confirm gate + P&L edit grid */}
      <div className="mb-6">
        <PlEditGrid
          caseId={props.caseId}
          incomeLines={props.incomeLines}
          expenseLines={props.expenseLines}
          confirmedAt={props.bookkeepingConfirmedAt}
          confirmedByLabel={props.bookkeepingConfirmedByLabel}
        />
      </div>

      {/* Pre-filing readiness band */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 mb-6">
        <h2 className="text-sm font-bold mb-3">Ready to hand back to client?</h2>
        <ul className="text-sm space-y-1">
          <li>
            <span className={allResolved ? "text-emerald-700" : "text-amber-700"}>
              {allResolved ? "✓" : "•"}
            </span>{" "}
            Accountant checks: <strong>{resolvedCount} of {total}</strong> resolved
          </li>
          <li>
            <span className={allEvidenced ? "text-emerald-700" : "text-amber-700"}>
              {allEvidenced ? "✓" : "•"}
            </span>{" "}
            Expense evidence:{" "}
            {allEvidenced
              ? <>all <strong>{props.expenseLines.length}</strong> line{props.expenseLines.length === 1 ? "" : "s"} have a method recorded</>
              : <><strong>{missingEvidenceCount}</strong> line{missingEvidenceCount === 1 ? "" : "s"} still need an evidence method, set one from each row above using the amber quick-pick</>
            }
          </li>
          {props.approvalAt ? (
            <li>
              <span className="text-emerald-700">✓</span>{" "}
              Client approval signed: {props.approvalName} on{" "}
              {new Date(props.approvalAt).toLocaleString()}
            </li>
          ) : null}
        </ul>
        <div className="mt-4 flex items-center gap-3">
          <button type="button"
            onClick={requestFiling}
            disabled={pending || !canAdvance}
            className="rounded bg-slate-900 px-4 py-1.5 text-white text-sm disabled:opacity-50">
            {pending ? "Requesting..." : "Advance to client approval"}
          </button>
          {err && <span className="text-red-600 text-xs">{err}</span>}
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Status will move to <code>client_approval</code>. The client sees the
          figures for the first time and clicks &quot;Approve figures&quot;;
          after that you send the final pack, the client confirms, and you
          mark it filed with HMRC from the panel below.
        </p>
      </div>

      {/* Engine snapshot with inline overrides */}
      <h2 className="text-lg font-bold mb-3">Engine snapshot</h2>
      {props.snapshot && props.editsSinceSnapshot > 0 && props.caseStatus === "in_review" ? (
        <StaleSnapshotBanner
          caseId={props.caseId}
          editsSinceSnapshot={props.editsSinceSnapshot}
          snapshotAt={props.snapshotAt}
        />
      ) : null}
      {!props.snapshot
        ? <p className="text-sm text-slate-500">No draft has been run by the client yet.</p>
        : <OverridableSnapshot
            caseId={props.caseId}
            snapshot={props.snapshot}
            snapshotAt={props.snapshotAt}
            history={props.overrideHistory} />}

      {/* Override audit log */}
      {props.overrideHistory.length > 0 && (
        <>
          <h2 className="text-lg font-bold mt-10 mb-3">
            Overrides audit log <span className="text-sm font-normal text-slate-500">
              ({props.overrideHistory.length})
            </span>
          </h2>
          <OverridesPanel
            history={props.overrideHistory}
            userDisplayNames={props.userDisplayNames} />
        </>
      )}

      {/* SA302 reconciliation */}
      {props.snapshot && (
        <>
          <h2 className="text-lg font-bold mt-10 mb-3">SA302 reconciliation</h2>
          <Sa302Reconciliation
            caseId={props.caseId}
            snapshot={props.snapshot}
            overrideHistory={props.overrideHistory}
            saved={props.sa302Comparison}
          />
        </>
      )}

      <h2 className="text-lg font-bold mt-10 mb-3">33-point review checklist</h2>
      <div className="space-y-2">
        {props.checksMeta.map((item) => (
          <CheckRow
            key={item.item_number}
            caseId={props.caseId}
            item={item}
            status={statusByItem.get(item.item_number)}
            prefill={prefillByItem.get(item.item_number) ?? null}
          />
        ))}
      </div>

      <div className="mt-10">
        <FinalSignoffPanel
          caseId={props.caseId}
          clientApprovalAt={props.clientApprovalAt}
          clientApprovalName={props.clientApprovalName}
          finalPackSentAt={props.finalPackSentAt}
          finalPackConfirmedAt={props.finalPackConfirmedAt}
          finalPackConfirmedName={props.finalPackConfirmedName}
          caseStatus={props.caseStatus}
        />
      </div>

      <div className="mt-10">
        <AddonRequestWidget caseId={props.caseId} addons={props.addons} />
      </div>

      <div className="mt-10">{props.messagesPanel}</div>
    </main>
  );
}

// -------------------- Snapshot with override cells --------------------

function money(n: number): string {
  return "£" + n.toLocaleString("en-GB", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

// Shown above the Engine snapshot panel when the accountant has edited
// one or more P&L lines since the snapshot was last computed. One-click
// Refresh re-runs the engine against the current DB state and overwrites
// the snapshot (so the SA103S boxes + SA302 reconciliation on this page
// line up with the edited lines).
function StaleSnapshotBanner({
  caseId,
  editsSinceSnapshot,
  snapshotAt,
}: {
  caseId: string;
  editsSinceSnapshot: number;
  snapshotAt: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => start(async () => {
    setErr(null);
    const r = await rerunPchEngineSnapshotAction(caseId);
    if (!r.ok) { setErr(r.error); return; }
    router.refresh();
  });
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
      <span>
        Engine snapshot stale, <strong>{editsSinceSnapshot}</strong> P&amp;L edit{editsSinceSnapshot === 1 ? "" : "s"} since the last run{snapshotAt ? ` on ${new Date(snapshotAt).toLocaleString("en-GB")}` : ""}. Refresh to recompute the SA103S boxes and SA302 reconciliation against the current lines.
      </span>
      <div className="flex items-center gap-2">
        {err ? <span className="text-rose-700">{err}</span> : null}
        <button
          type="button"
          onClick={refresh}
          disabled={pending}
          className="rounded bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {pending ? "Refreshing..." : "Refresh snapshot"}
        </button>
      </div>
    </div>
  );
}

function OverridableSnapshot({
  caseId, snapshot, snapshotAt, history,
}: {
  caseId: string;
  snapshot: TaxEngineOutput;
  snapshotAt: string | null;
  history: OverrideRow[];
}) {
  const effective = useMemo(() => effectiveValues(snapshot, history), [snapshot, history]);
  const [showAll, setShowAll] = useState(false);

  const plFields = PCH_OVERRIDE_FIELDS.filter((f) => f.group === "P&L");
  const taxFields = PCH_OVERRIDE_FIELDS.filter((f) => f.group === "Tax & NIC");
  const sa103sFields = PCH_OVERRIDE_FIELDS.filter((f) => f.group === "SA103S boxes");

  const sa103sBySubgroup = useMemo(() => {
    const m = new Map<Sa103sSubgroup, FieldDef[]>();
    for (const f of sa103sFields) {
      const sg = SA103S_UI[f.path]?.subgroup;
      if (!sg) continue;
      const arr = m.get(sg) ?? [];
      arr.push(f);
      m.set(sg, arr);
    }
    return m;
  }, [sa103sFields]);

  const zeroCount = sa103sFields.filter((f) => {
    const eff = effective.get(f.path);
    return eff && !eff.isOverride && Math.abs(eff.value) < 0.005;
  }).length;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-5">
      <p className="text-xs text-slate-500">
        Snapshot last run: {snapshotAt ? new Date(snapshotAt).toLocaleString() : ", "}
        {" · "}
        <span className="text-slate-400">Click any value to override.</span>
      </p>

      {/* Headline figures: P&L + Tax & NIC together in a compact card */}
      <section>
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Headline figures</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 rounded border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm">
          {[...plFields, ...taxFields].map((f) => {
            const eff = effective.get(f.path)!;
            return (
              <HeadlineRow
                key={f.path}
                caseId={caseId}
                field={f}
                value={eff.value}
                calculated={eff.calculated}
                isOverride={eff.isOverride}
              />
            );
          })}
        </div>
      </section>

      {/* SA103S boxes grouped by purpose; zero rows hidden behind a toggle */}
      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">SA103S return boxes</h4>
          {zeroCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="text-[11px] text-slate-500 underline underline-offset-2 hover:text-slate-700"
            >
              {showAll ? `Hide ${zeroCount} empty box${zeroCount === 1 ? "" : "es"}` : `Show all ${sa103sFields.length} boxes`}
            </button>
          ) : null}
        </div>
        <div className="space-y-3">
          {SA103S_SUBGROUP_ORDER.map((sg) => {
            const fields = sa103sBySubgroup.get(sg) ?? [];
            const visible = fields.filter((f) => {
              const eff = effective.get(f.path);
              if (!eff) return false;
              if (showAll) return true;
              if (eff.isOverride) return true;
              return Math.abs(eff.value) >= 0.005;
            });
            if (visible.length === 0) return null;
            return (
              <div key={sg} className="rounded border border-slate-200">
                <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  {sg}
                </div>
                <ul className="divide-y divide-slate-100">
                  {visible.map((f) => {
                    const eff = effective.get(f.path)!;
                    const ui = SA103S_UI[f.path];
                    return (
                      <Sa103sRow
                        key={f.path}
                        caseId={caseId}
                        field={f}
                        friendly={ui.friendly}
                        box={ui.box}
                        value={eff.value}
                        calculated={eff.calculated}
                        isOverride={eff.isOverride}
                      />
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// Compact headline row (P&L / Tax & NIC): label on the left, click-to-
// override value on the right. No HMRC box chip since these are internal
// engine totals, not filing boxes.
function HeadlineRow({
  caseId, field, value, calculated, isOverride,
}: {
  caseId: string; field: FieldDef;
  value: number; calculated: number; isOverride: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-slate-700">{field.label}</span>
      <OverrideValueButton
        caseId={caseId}
        field={field}
        value={value}
        calculated={calculated}
        isOverride={isOverride}
      />
    </div>
  );
}

// SA103S return-box row: friendly label primary, muted "Box 12" chip
// secondary, click-to-override value on the right.
function Sa103sRow({
  caseId, field, friendly, box, value, calculated, isOverride,
}: {
  caseId: string; field: FieldDef;
  friendly: string; box: string;
  value: number; calculated: number; isOverride: boolean;
}) {
  return (
    <li className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-sm">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-slate-800">{friendly}</span>
        <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
          {box}
        </span>
      </span>
      <OverrideValueButton
        caseId={caseId}
        field={field}
        value={value}
        calculated={calculated}
        isOverride={isOverride}
      />
    </li>
  );
}

// Shared value button + edit popover used by both HeadlineRow and
// Sa103sRow. Extracted so both layouts get identical override behaviour
// (click to edit, reason prompt on material change, revert button when
// an override is active).
function OverrideValueButton({
  caseId, field, value, calculated, isOverride,
}: {
  caseId: string; field: FieldDef;
  value: number; calculated: number; isOverride: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(String(value));
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const open = () => {
    setDraft(String(value));
    setReason("");
    setErr(null);
    setEditing(true);
  };
  const cancel = () => setEditing(false);

  const parsed = Number(draft);
  const needsReason = Number.isFinite(parsed)
    ? reasonRequired(value, parsed, field.scope)
    : false;
  const canSave = Number.isFinite(parsed)
    && (!needsReason || reason.trim().length >= 3)
    && parsed !== value;

  const save = () => start(async () => {
    const r = await applyPchOverrideAction(
      caseId, field.path, parsed, reason.trim() || null,
    );
    if (!r.ok) { setErr(r.error); return; }
    setEditing(false);
    router.refresh();
  });

  const revert = () => start(async () => {
    const r = await revertPchOverrideAction(caseId, field.path);
    if (!r.ok) { setErr(r.error); return; }
    setEditing(false);
    router.refresh();
  });

  if (editing) {
    return (
      <div className="w-full">
        <div className="rounded border border-sky-200 bg-sky-50/40 p-2 space-y-2">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="font-semibold">{field.label}</span>
            <span className="text-slate-400">Calculated: {money(calculated)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number" step="0.01" value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-32 rounded border border-slate-300 px-2 py-1 text-sm text-right"
              autoFocus />
            <button type="button" onClick={save} disabled={!canSave || pending}
              className="rounded bg-slate-900 px-3 py-1 text-white text-xs disabled:opacity-50">
              {pending ? "Saving..." : "Save"}
            </button>
            <button type="button" onClick={cancel} disabled={pending}
              className="rounded border border-slate-300 bg-white px-3 py-1 text-xs">
              Cancel
            </button>
            {isOverride && (
              <button type="button" onClick={revert} disabled={pending}
                className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:text-red-700">
                Revert to calculated
              </button>
            )}
          </div>
          {needsReason && (
            <div>
              <input
                type="text" value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason required (3+ chars)"
                className="w-full rounded border border-slate-300 px-2 py-1 text-xs" />
              <p className="text-[11px] text-slate-500 mt-1">
                Change of £{Math.abs(parsed - value).toFixed(2)} needs a short rationale for the audit trail.
              </p>
            </div>
          )}
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
      </div>
    );
  }
  return (
    <span className="whitespace-nowrap">
      <button type="button" onClick={open}
        className={"tabular-nums font-medium hover:underline underline-offset-2 " +
          (isOverride ? "text-amber-700" : "text-slate-900")}>
        {money(value)}
      </button>
      {isOverride && (
        <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
          override
        </span>
      )}
    </span>
  );
}

// -------------------- Audit log panel --------------------

function OverridesPanel({
  history, userDisplayNames,
}: {
  history: OverrideRow[]; userDisplayNames: Record<string, string | null>;
}) {
  const fieldLabel = (path: string) =>
    PCH_OVERRIDE_FIELDS.find((f) => f.path === path)?.label ?? path;
  const fmt = (v: string | null) =>
    v === null ? ", "
    : Number.isFinite(Number(v)) ? money(Number(v))
    : v;
  const author = (uid: string | null) =>
    uid && userDisplayNames[uid] ? userDisplayNames[uid] : (uid ?? "unknown");
  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600 uppercase tracking-wide">
          <tr>
            <th className="text-left py-2 px-3">When</th>
            <th className="text-left py-2 px-3">Field</th>
            <th className="text-right py-2 px-3">From</th>
            <th className="text-right py-2 px-3">To</th>
            <th className="text-left py-2 px-3">Reason</th>
            <th className="text-left py-2 px-3">By</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.id} className="border-t border-slate-100">
              <td className="py-2 px-3 text-xs text-slate-500 whitespace-nowrap">
                {new Date(h.overridden_at).toLocaleString()}
              </td>
              <td className="py-2 px-3">{fieldLabel(h.field_path)}</td>
              <td className="py-2 px-3 text-right text-slate-500">{fmt(h.old_value)}</td>
              <td className="py-2 px-3 text-right font-medium">
                {h.new_value === null
                  ? <span className="text-slate-500 italic">reverted</span>
                  : fmt(h.new_value)}
              </td>
              <td className="py-2 px-3 text-xs text-slate-600">{h.reason || ", "}</td>
              <td className="py-2 px-3 text-xs text-slate-600">{author(h.overridden_by)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// -------------------- SA302 reconciliation --------------------

// Reads the "effective" engine value for a comparison field. Engine
// value defaults to the field's own extractor; overrides take precedence
// where they exist (because the SA302 compare should reflect what the
// accountant actually plans to file, not the raw engine output).
function engineValueForCompare(
  snapshot: TaxEngineOutput,
  overrideHistory: OverrideRow[],
  key: string,
): number {
  const field = SA302_COMPARE_FIELDS.find((f) => f.key === key);
  if (!field) return 0;
  const base = field.read(snapshot);
  // Match the override field_path format (dot path on snapshot) for
  // the SA103S boxes + taxable profit + IT + C4 that overlap.
  // sa302 field keys mirror the box key but the override paths carry
  // the parent namespace. Translate here.
  const overridePath = key.startsWith("box")
    ? "sa103s." + key
    : key === "sa302_income_tax" ? "tax.incomeTax"
    : key === "sa302_class4" ? "tax.class4"
    // Other SA302 totals (profit, balancing, POA) don't have an
    // override field defined; fall back to engine's own calc.
    : null;
  if (!overridePath) return base;
  const eff = effectiveValues(snapshot, overrideHistory).get(overridePath);
  return eff ? eff.value : base;
}

function Sa302Reconciliation({
  caseId, snapshot, overrideHistory, saved,
}: {
  caseId: string;
  snapshot: TaxEngineOutput;
  overrideHistory: OverrideRow[];
  saved: Sa302Comparison | null;
}) {
  const router = useRouter();
  // Local state: software values, keyed by SA302 field key.
  const [pasted, setPasted] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    if (saved) {
      for (const f of SA302_COMPARE_FIELDS) {
        const v = saved[f.key];
        if (typeof v === "number") initial[f.key] = String(v);
      }
    }
    return initial;
  });
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const rows = useMemo(() => SA302_COMPARE_FIELDS.map((f) => {
    const engine = engineValueForCompare(snapshot, overrideHistory, f.key);
    const raw = pasted[f.key];
    const software = raw === undefined || raw === "" || Number.isNaN(Number(raw))
      ? null : Number(raw);
    const { diff, match } = diffStatus(engine, software, f.scope);
    return { field: f, engine, software, diff, match };
  }), [pasted, snapshot, overrideHistory]);

  const populated = rows.filter((r) => r.software !== null);
  const mismatches = populated.filter((r) => r.match === false);
  const allPopulatedMatch = populated.length > 0 && mismatches.length === 0;
  const allFilled = populated.length === SA302_COMPARE_FIELDS.length;

  const bannerClass = mismatches.length > 0
    ? "border-red-300 bg-red-50 text-red-800"
    : allPopulatedMatch
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : "border-slate-200 bg-slate-50 text-slate-600";
  const bannerText = mismatches.length > 0
    ? `${mismatches.length} ${mismatches.length === 1 ? "box" : "boxes"} differ, resolve before filing`
    : allFilled && allPopulatedMatch
      ? "Entered figures match the engine, safe to file"
      : populated.length === 0
        ? "No figures entered yet"
        : `${populated.length} of ${SA302_COMPARE_FIELDS.length} entered, all matching so far`;

  const save = () => start(async () => {
    const values: Record<string, number | null> = {};
    for (const f of SA302_COMPARE_FIELDS) {
      const raw = pasted[f.key];
      values[f.key] = raw === undefined || raw === ""
        ? null : Number(raw);
    }
    const r = await savePchSa302ComparisonAction(caseId, values);
    if (!r.ok) { setErr(r.error); setMsg(null); return; }
    setErr(null); setMsg("Saved");
    router.refresh();
  });

  const groups: Sa302Group[] = ["SA103S boxes", "SA302 totals"];
  return (
    <div className="space-y-4">
      <div className={"rounded-lg border p-3 text-sm " + bannerClass}>
        {mismatches.length === 0 && allPopulatedMatch && <span className="mr-1">✓</span>}
        {mismatches.length > 0 && <span className="mr-1">!</span>}
        {bannerText}
        {saved?.recorded_at && (
          <span className="float-right text-xs opacity-70">
            Last saved {new Date(String(saved.recorded_at)).toLocaleString()}
          </span>
        )}
      </div>
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600 uppercase tracking-wide">
            <tr>
              <th className="text-left py-2 px-3">Field</th>
              <th className="text-right py-2 px-3 w-32">Engine £</th>
              <th className="text-right py-2 px-3 w-36">Accountant input £</th>
              <th className="text-right py-2 px-3 w-24">Diff</th>
              <th className="text-center py-2 px-3 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRows
                key={g}
                group={g}
                rows={rows.filter((r) => r.field.group === g)}
                pasted={pasted}
                setPasted={setPasted}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={pending}
          className="rounded bg-slate-900 px-4 py-1.5 text-white text-sm disabled:opacity-50">
          {pending ? "Saving..." : "Save SA302 figures"}
        </button>
        {err && <span className="text-red-600 text-xs">{err}</span>}
        {msg && <span className="text-emerald-700 text-xs">{msg}</span>}
      </div>
    </div>
  );
}

function GroupRows({
  group, rows, pasted, setPasted,
}: {
  group: Sa302Group;
  rows: Array<{
    field: typeof SA302_COMPARE_FIELDS[number];
    engine: number;
    software: number | null;
    diff: number | null;
    match: boolean | null;
  }>;
  pasted: Record<string, string>;
  setPasted: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const fmt = (n: number, decimals: number) =>
    n.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (
    <>
      <tr className="bg-slate-50/50 border-t border-slate-100">
        <td colSpan={5} className="py-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {group}
        </td>
      </tr>
      {rows.map((r) => {
        const decimals = r.field.scope === "wholePound" ? 0 : 2;
        return (
          <tr key={r.field.key} className="border-t border-slate-100">
            <td className="py-2 px-3 text-slate-700">{r.field.label}</td>
            <td className="py-2 px-3 text-right text-slate-700 tabular-nums">
              {fmt(r.engine, decimals)}
            </td>
            <td className="py-2 px-3 text-right">
              <input
                type="number"
                step={r.field.scope === "wholePound" ? "1" : "0.01"}
                className="w-full rounded border border-slate-300 px-2 py-1 text-right text-sm tabular-nums"
                value={pasted[r.field.key] ?? ""}
                onChange={(e) => setPasted((p) => ({ ...p, [r.field.key]: e.target.value }))}
                placeholder="paste"
              />
            </td>
            <td className={"py-2 px-3 text-right tabular-nums " +
              (r.match === true ? "text-emerald-700"
                : r.match === false ? "text-red-700 font-semibold"
                : "text-slate-400")}>
              {r.diff === null ? ", " : (r.diff > 0 ? "+" : "") + fmt(r.diff, decimals)}
            </td>
            <td className="py-2 px-3 text-center">
              {r.match === true ? <span className="text-emerald-700">✓</span>
                : r.match === false ? <span className="text-red-700">Δ</span>
                : <span className="text-slate-300">·</span>}
            </td>
          </tr>
        );
      })}
    </>
  );
}

// -------------------- 33-check row (Phase 7 Slice 7.4 kind-aware) --------------------
//
// Row shape depends on the item's classification kind (auto / interview
// / manual). Original Done/N/A/Reset buttons stay on every row as an
// escape hatch so an accountant is never blocked by a bad prefill or a
// missing interview answer.

function CheckRow({
  caseId, item, status, prefill,
}: {
  caseId: string;
  item: CheckItem;
  status: CheckStatus | undefined;
  prefill: ChecklistPrefill | null;
}) {
  const router = useRouter();
  const [currentStatus, setCurrentStatus] = useState<"Done" | "N/A" | "Not started">(
    status?.status ?? "Not started"
  );
  const [note, setNote] = useState(status?.note ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const classification = classifyChecklistItem(item.item_number);
  const kind: ChecklistKind = classification.kind;

  // Shared status write. Optional noteOverride lets:
  //   - auto-row Confirm button stamp the AI's evidence string into
  //     pch_check_status.note so the audit trail carries what the AI
  //     said at confirm time
  //   - interview-row Re-open button wipe the client's stored answer by
  //     passing "" (empty string), so the "Waiting on client" strip
  //     renders cleanly on the next load
  const save = (
    nextStatus?: "Done" | "N/A" | "Not started",
    noteOverride?: string,
  ) => start(async () => {
    const s = nextStatus ?? currentStatus;
    setCurrentStatus(s);
    // Empty-string override means "wipe the note"; undefined means
    // "keep whatever's in the local note field".
    const effectiveNote = noteOverride !== undefined
      ? (noteOverride.length === 0 ? undefined : noteOverride)
      : (note || undefined);
    if (noteOverride !== undefined) setNote(noteOverride);
    const r = await setPchCheckStatusAction(caseId, item.item_number, s, effectiveNote);
    if (!r.ok) setMsg(r.error);
    else { setMsg(null); router.refresh(); }
  });

  const badge = currentStatus === "Done"
    ? "bg-emerald-100 text-emerald-800"
    : currentStatus === "N/A"
      ? "bg-slate-100 text-slate-600"
      : "bg-amber-100 text-amber-800";

  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="font-mono">#{item.item_number}</span>
            <span className="uppercase tracking-wide">{item.area}</span>
            <KindBadge kind={kind} />
          </div>
          <div className="text-sm mt-1">{item.description}</div>
        </div>
        <span className={"text-xs font-semibold rounded px-2 py-0.5 shrink-0 " + badge}>
          {currentStatus}
        </span>
      </div>

      {kind === "auto" ? (
        <AutoCheckSurface
          prefill={prefill}
          pending={pending}
          currentStatus={currentStatus}
          onConfirm={(evidence) => save("Done", evidence)}
        />
      ) : null}

      {kind === "interview" ? (
        <InterviewCheckSurface
          pending={pending}
          currentStatus={currentStatus}
          clientAnswer={status?.note ?? null}
          onReopen={() => save("Not started", "")}
        />
      ) : null}

      <div className="mt-2 flex items-center gap-2 text-xs">
        <button type="button" onClick={() => save("Done")} disabled={pending}
          className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-emerald-50 disabled:opacity-50">
          Done
        </button>
        <button type="button" onClick={() => save("N/A")} disabled={pending}
          className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-100 disabled:opacity-50">
          N/A
        </button>
        <button type="button" onClick={() => save("Not started")} disabled={pending}
          className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-amber-50 disabled:opacity-50">
          Reset
        </button>
        <input className="flex-1 rounded border border-slate-300 px-2 py-1"
          placeholder="Note (optional)" value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => save()} />
        {msg && <span className="text-red-600">{msg}</span>}
      </div>
    </div>
  );
}

// Small chip rendered inside the row header so the accountant can see
// at a glance whether a row is AI-prefilled, waiting on a client
// interview, or genuine manual judgement.
function KindBadge({ kind }: { kind: ChecklistKind }) {
  if (kind === "auto") {
    return (
      <span className="inline-block rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-800">
        AI prefilled
      </span>
    );
  }
  if (kind === "interview") {
    return (
      <span className="inline-block rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-800">
        From client
      </span>
    );
  }
  return (
    <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
      Manual review
    </span>
  );
}

// Auto-row surface. Three visual states driven by the prefill:
//   - prefill present with verdict pass or warn:
//       emerald/amber chip + evidence line + one-click Confirm
//   - prefill verdict nothing_to_show:
//       muted "AI had nothing to flag" line + Confirm still available
//   - prefill null (derivation returned no entry):
//       amber "AI could not derive this, review manually" fallback;
//       the manual Done/N/A buttons below handle it
function AutoCheckSurface({
  prefill, pending, currentStatus, onConfirm,
}: {
  prefill: ChecklistPrefill | null;
  pending: boolean;
  currentStatus: "Done" | "N/A" | "Not started";
  onConfirm: (evidence: string) => void;
}) {
  if (!prefill) {
    return (
      <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
        AI could not derive this one, review manually using the buttons below.
      </div>
    );
  }
  const toneClass =
    prefill.verdict === "pass" ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : prefill.verdict === "warn" ? "border-amber-200 bg-amber-50 text-amber-900"
    : "border-slate-200 bg-slate-50 text-slate-700";
  const verdictLabel =
    prefill.verdict === "pass" ? "Pass"
    : prefill.verdict === "warn" ? "Review"
    : "Nothing to flag";
  const alreadyDone = currentStatus === "Done";
  return (
    <div className={"mt-2 rounded border px-2 py-1.5 text-xs " + toneClass}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="font-semibold mr-1">AI: {verdictLabel}.</span>
          <span>{prefill.evidence}</span>
        </div>
        <button
          type="button"
          onClick={() => onConfirm(prefill.evidence)}
          disabled={pending || alreadyDone}
          className="shrink-0 rounded bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-50"
        >
          {alreadyDone ? "Confirmed" : "Confirm"}
        </button>
      </div>
    </div>
  );
}

// Interview-row surface. Two states driven by (status, note):
//
//   status=Done + note present  -> client has answered via the AI
//     interview. Shows "Client answered: {note}" + a Re-open button
//     that resets to Not started AND wipes the note (so a re-run of
//     the interview starts fresh rather than seeing stale text).
//
//   status=Done + no note       -> accountant marked Done manually
//     without a client interview answer. Render nothing; the manual
//     Done chip in the header already conveys state.
//
//   status=Not started          -> standard "waiting on client" strip.
//
//   status=N/A                  -> render nothing.
//
// 7.6b wires the actual interview flows into the client workspace; this
// surface only shows the accountant side of the handoff.
function InterviewCheckSurface({
  pending, currentStatus, clientAnswer, onReopen,
}: {
  pending: boolean;
  currentStatus: "Done" | "N/A" | "Not started";
  clientAnswer: string | null;
  onReopen: () => void;
}) {
  if (currentStatus === "Done") {
    if (!clientAnswer || clientAnswer.trim().length === 0) return null;
    return (
      <div className="mt-2 rounded border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-xs text-indigo-900">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span className="font-semibold mr-1">Client answered:</span>
            <span className="whitespace-pre-wrap">{clientAnswer}</span>
          </div>
          <button
            type="button"
            onClick={onReopen}
            disabled={pending}
            className="shrink-0 rounded border border-indigo-300 bg-white px-2 py-0.5 text-[11px] font-medium text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
          >
            Re-open
          </button>
        </div>
      </div>
    );
  }
  if (currentStatus === "N/A") return null;
  return (
    <div className="mt-2 rounded border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-xs text-indigo-900">
      Waiting on the client to answer. The matching AI interview is on
      the client workspace; once they commit, this row flips to Done
      with their answer below.
    </div>
  );
}
