"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaxEngineOutput } from "@/lib/tax-engine";
import {
  setPchCheckStatusAction,
  requestClientFilingAction,
} from "@/app/accountant/pch/actions";

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

      {/* Engine snapshot (read-only in phase 2a) */}
      <h2 className="text-lg font-bold mb-3">Engine snapshot</h2>
      {!props.snapshot
        ? <p className="text-sm text-slate-500">No draft has been run by the client yet.</p>
        : <SnapshotTable s={props.snapshot} at={props.snapshotAt} />}

      <h2 className="text-lg font-bold mt-10 mb-3">33-point review checklist</h2>
      <p className="text-xs text-slate-500 mb-3">
        Phase 2a: mark each item Done / N/A / Not started with an optional note. Override of
        engine figures with full audit log ships in phase 2b.
      </p>
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

function SnapshotTable({ s, at }: { s: TaxEngineOutput; at: string | null }) {
  const money = (n: number) =>
    "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const row = (label: string, v: string | number) => (
    <tr><td className="py-1 pr-4 text-slate-600">{label}</td>
      <td className="py-1 font-medium text-right">{typeof v === "number" ? money(v) : v}</td></tr>
  );
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500 mb-3">
        Snapshot last run: {at ? new Date(at).toLocaleString() : "—"}
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-sm">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">P&amp;L</h4>
          <table className="w-full"><tbody>
            {row("Turnover", s.pl.turnover)}
            {row("Expenses", s.pl.expensesTotal)}
            {row("Net profit", s.pl.netProfit)}
            {row("CA claim", s.pl.capitalAllowances)}
            {row("Taxable profit", s.pl.taxableProfit)}
          </tbody></table>
        </div>
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Tax &amp; NIC</h4>
          <table className="w-full"><tbody>
            {row("Income tax", s.tax.incomeTax)}
            {row("Class 4", s.tax.class4)}
            {row("Total due", s.tax.totalTaxAndNic)}
            {row("Balancing (31 Jan)", s.tax.balancingPayment)}
            {row("POA each", s.tax.poaForNextYear)}
          </tbody></table>
        </div>
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">SA103S boxes</h4>
          <table className="w-full"><tbody>
            {row("9 Turnover", s.sa103s.box9_turnover)}
            {row("20 Expenses", s.sa103s.box20_totalAllowable)}
            {row("21 Net profit", s.sa103s.box21_netProfit)}
            {row("25 CA", s.sa103s.box25_otherCapitalAllowances)}
            {row("31 Taxable", s.sa103s.box31_totalTaxableProfits)}
          </tbody></table>
        </div>
      </div>
    </div>
  );
}

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
