"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaxEngineOutput } from "@/lib/tax-engine";
import {
  setPchCheckStatusAction,
  requestClientFilingAction,
  applyPchOverrideAction,
  revertPchOverrideAction,
} from "@/app/accountant/pch/actions";
import {
  PCH_OVERRIDE_FIELDS,
  type OverrideRow,
  effectiveValues,
  reasonRequired,
  type FieldDef,
} from "@/lib/pch/overrides";

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
  snapshot: TaxEngineOutput | null;
  snapshotAt: string | null;
  approvalAt: string | null;
  approvalName: string | null;
  overrideHistory: OverrideRow[];
  userDisplayNames: Record<string, string | null>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const statusByItem = new Map(props.checkStatus.map((s) => [s.item_number, s]));
  const resolvedCount = props.checkStatus.filter(
    (s) => s.status === "Done" || s.status === "N/A"
  ).length;
  const total = props.checksMeta.length;
  const allResolved = resolvedCount >= total;

  const requestFiling = () => start(async () => {
    const r = await requestClientFilingAction(props.caseId);
    if (!r.ok) setErr(r.error);
    else { setErr(null); router.refresh(); }
  });

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">PCH automated — accountant review</h1>
        <p className="text-sm text-slate-600 mt-1">
          Case {props.caseId.slice(0, 8)} — status <strong>{props.caseStatus}</strong>
        </p>
      </div>

      {/* Dual sign-off status band */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 mb-6">
        <h2 className="text-sm font-bold mb-3">Dual sign-off status</h2>
        <ul className="text-sm space-y-1">
          <li>
            <span className={allResolved ? "text-emerald-700" : "text-amber-700"}>
              {allResolved ? "✓" : "•"}
            </span>{" "}
            Accountant checks: <strong>{resolvedCount} of {total}</strong> resolved
          </li>
          <li>
            <span className={props.approvalAt ? "text-emerald-700" : "text-amber-700"}>
              {props.approvalAt ? "✓" : "•"}
            </span>{" "}
            Client approval:{" "}
            {props.approvalAt
              ? <>Approved by {props.approvalName} on {new Date(props.approvalAt).toLocaleString()}</>
              : <>Not yet approved by client</>}
          </li>
        </ul>
        <div className="mt-4 flex items-center gap-3">
          <button type="button"
            onClick={requestFiling}
            disabled={pending || !allResolved}
            className="rounded bg-slate-900 px-4 py-1.5 text-white text-sm disabled:opacity-50">
            {pending ? "Requesting..." : "Advance to client approval"}
          </button>
          {err && <span className="text-red-600 text-xs">{err}</span>}
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Status will move to <code>client_approval</code>. The client then clicks their own
          &quot;Approve and file&quot; button, which flips the case to <code>filed</code>.
        </p>
      </div>

      {/* Engine snapshot with inline overrides */}
      <h2 className="text-lg font-bold mb-3">Engine snapshot</h2>
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

      <h2 className="text-lg font-bold mt-10 mb-3">33-point review checklist</h2>
      <div className="space-y-2">
        {props.checksMeta.map((item) => (
          <CheckRow
            key={item.item_number}
            caseId={props.caseId}
            item={item}
            status={statusByItem.get(item.item_number)}
          />
        ))}
      </div>
    </main>
  );
}

// -------------------- Snapshot with override cells --------------------

function money(n: number): string {
  return "£" + n.toLocaleString("en-GB", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
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
  const groups: Array<"P&L" | "Tax & NIC" | "SA103S boxes"> = [
    "P&L", "Tax & NIC", "SA103S boxes",
  ];
  const fieldsByGroup = useMemo(() => {
    const m = new Map<string, FieldDef[]>();
    for (const f of PCH_OVERRIDE_FIELDS) {
      const arr = m.get(f.group) ?? [];
      arr.push(f);
      m.set(f.group, arr);
    }
    return m;
  }, []);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500 mb-3">
        Snapshot last run: {snapshotAt ? new Date(snapshotAt).toLocaleString() : "—"}
        {" · "}
        <span className="text-slate-400">Click any value to override.</span>
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-sm">
        {groups.map((g) => (
          <div key={g}>
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">{g}</h4>
            <table className="w-full">
              <tbody>
                {(fieldsByGroup.get(g) ?? []).map((f) => {
                  const eff = effective.get(f.path)!;
                  return (
                    <OverridableRow
                      key={f.path}
                      caseId={caseId}
                      field={f}
                      value={eff.value}
                      calculated={eff.calculated}
                      isOverride={eff.isOverride}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

function OverridableRow({
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
      <tr>
        <td colSpan={2} className="py-1">
          <div className="rounded border border-sky-200 bg-sky-50/40 p-2 space-y-2">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span className="font-semibold">{field.label}</span>
              <span className="text-slate-400">Calculated: {money(calculated)}</span>
            </div>
            <div className="flex items-center gap-2">
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
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td className="py-1 pr-4 text-slate-600">{field.label}</td>
      <td className="py-1 text-right">
        <button type="button" onClick={open}
          className={"font-medium hover:underline underline-offset-2 " +
            (isOverride ? "text-amber-700" : "text-slate-900")}>
          {money(value)}
        </button>
        {isOverride && (
          <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
            override
          </span>
        )}
      </td>
    </tr>
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
    v === null ? "—"
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
              <td className="py-2 px-3 text-xs text-slate-600">{h.reason || "—"}</td>
              <td className="py-2 px-3 text-xs text-slate-600">{author(h.overridden_by)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// -------------------- 33-check row (unchanged from phase 2a) --------------------

function CheckRow({
  caseId, item, status,
}: {
  caseId: string; item: CheckItem; status: CheckStatus | undefined;
}) {
  const router = useRouter();
  const [currentStatus, setCurrentStatus] = useState<"Done" | "N/A" | "Not started">(
    status?.status ?? "Not started"
  );
  const [note, setNote] = useState(status?.note ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const save = (nextStatus?: "Done" | "N/A" | "Not started") => start(async () => {
    const s = nextStatus ?? currentStatus;
    setCurrentStatus(s);
    const r = await setPchCheckStatusAction(caseId, item.item_number, s, note || undefined);
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
          <div className="text-xs text-slate-500">
            <span className="font-mono mr-2">#{item.item_number}</span>
            <span className="uppercase tracking-wide">{item.area}</span>
          </div>
          <div className="text-sm mt-1">{item.description}</div>
        </div>
        <span className={"text-xs font-semibold rounded px-2 py-0.5 " + badge}>
          {currentStatus}
        </span>
      </div>
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
