"use client";

// Phase 6 Slice 3: live ledger view.
//
// Grouped-by-category table showing every bank transaction we read +
// categorised. Each row has an inline category dropdown so the client
// can correct a mistake without going through the chat. Group totals
// update after a save because the server action re-aggregates
// pch_income_lines / pch_expense_lines and calls revalidatePath.
//
// Three visual regions:
//   Income groups  (positive totals, emerald tone)
//   Expense groups (positive totals shown as spend, slate tone)
//   Excluded group (transfer / personal / fine / HMRC / uncategorised)
//
// Each group is collapsible; defaults to collapsed when the group has
// more than 8 rows so the page is scannable at a glance.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBankTransactionCategoryAction } from "@/app/client/pch/bank-actions";

export type BankTransactionView = {
  id: string;
  txnDate: string | null;
  description: string;
  amountPence: number;
  category: string | null;
  categoryConfidence: "high" | "medium" | "low" | "missing" | null;
};

type Props = {
  caseId: string;
  transactions: BankTransactionView[];
  editable?: boolean;
};

// Mirrors bank-categories.ts (client-safe copy of key, label, direction
// so this file does not import a server-only module). Keep in sync by
// hand: adding a key to BANK_CATEGORIES means adding it here too.
const CATEGORY_INDEX: {
  key: string;
  label: string;
  direction: "income" | "expense" | "excluded";
}[] = [
  { key: "platform_fares", label: "Platform fares (Uber / Bolt / FreeNow)", direction: "income" },
  { key: "cash_fares", label: "Cash fares paid in", direction: "income" },
  { key: "other_income", label: "Other business income", direction: "income" },
  { key: "fuel", label: "Fuel / charging", direction: "expense" },
  { key: "insurance", label: "Vehicle insurance", direction: "expense" },
  { key: "rental", label: "PCO rental", direction: "expense" },
  { key: "repairs_mot", label: "Repairs, servicing, MOT, road tax", direction: "expense" },
  { key: "tolls_parking", label: "Congestion / ULEZ / parking", direction: "expense" },
  { key: "licence", label: "Licence fees", direction: "expense" },
  { key: "phone", label: "Mobile phone (business portion)", direction: "expense" },
  { key: "finance_interest", label: "Finance interest (HP / PCP / loan)", direction: "expense" },
  { key: "cleaning", label: "Vehicle cleaning", direction: "expense" },
  { key: "accountancy", label: "Accountancy fees", direction: "expense" },
  { key: "other_business", label: "Other allowable expense", direction: "expense" },
  { key: "transfer", label: "Transfer between own accounts", direction: "excluded" },
  { key: "personal", label: "Personal spend", direction: "excluded" },
  { key: "hmrc_payment", label: "HMRC payment / refund", direction: "excluded" },
  { key: "fine", label: "Fine or penalty", direction: "excluded" },
  { key: "uncategorized", label: "Still uncategorised", direction: "excluded" },
];
const LABEL_BY_KEY: Record<string, string> = Object.fromEntries(
  CATEGORY_INDEX.map((c) => [c.key, c.label]),
);
const DIRECTION_BY_KEY: Record<string, "income" | "expense" | "excluded"> =
  Object.fromEntries(CATEGORY_INDEX.map((c) => [c.key, c.direction]));

type Group = {
  key: string;
  label: string;
  direction: "income" | "expense" | "excluded";
  rows: BankTransactionView[];
  totalPence: number;
};

function groupByCategory(txns: BankTransactionView[]): Group[] {
  const map = new Map<string, Group>();
  for (const t of txns) {
    const key = t.category ?? "uncategorized";
    const label = LABEL_BY_KEY[key] ?? key;
    const direction = DIRECTION_BY_KEY[key] ?? "excluded";
    const g = map.get(key) ?? { key, label, direction, rows: [], totalPence: 0 };
    g.rows.push(t);
    g.totalPence += Math.abs(t.amountPence);
    map.set(key, g);
  }
  // Order: income → expense → excluded, each sub-sorted by total desc.
  const order: ("income" | "expense" | "excluded")[] = ["income", "expense", "excluded"];
  return [...map.values()].sort((a, b) => {
    const ao = order.indexOf(a.direction);
    const bo = order.indexOf(b.direction);
    if (ao !== bo) return ao - bo;
    return b.totalPence - a.totalPence;
  });
}

export function BankLedgerTable({ caseId, transactions, editable = true }: Props) {
  const groups = useMemo(() => groupByCategory(transactions), [transactions]);
  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const g of groups) {
      if (g.direction === "income") income += g.totalPence;
      if (g.direction === "expense") expense += g.totalPence;
    }
    return { income, expense, net: income - expense };
  }, [groups]);

  if (transactions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs text-slate-600">
        No transactions yet. Upload a bank statement in the Documents section
        above and we&apos;ll categorise it for you.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <TotalPill label="Income" pence={totals.income} tone="emerald" />
        <TotalPill label="Expenses" pence={totals.expense} tone="slate" />
        <TotalPill
          label="Net before accountant edits"
          pence={totals.net}
          tone={totals.net >= 0 ? "emerald" : "rose"}
        />
      </div>
      <p className="text-[11px] text-slate-500">
        Running totals rebuilt live as you confirm each transaction. Your
        accountant will add any manual adjustments and sign off the P&amp;L
        before filing.
      </p>
      <ul className="space-y-2">
        {groups.map((g) => (
          <GroupCard
            key={g.key}
            caseId={caseId}
            group={g}
            editable={editable}
          />
        ))}
      </ul>
    </div>
  );
}

function TotalPill({
  label,
  pence,
  tone,
}: {
  label: string;
  pence: number;
  tone: "emerald" | "slate" | "rose";
}) {
  const toneClass =
    tone === "emerald" ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : tone === "rose" ? "border-rose-300 bg-rose-50 text-rose-900"
      : "border-slate-300 bg-slate-50 text-slate-900";
  return (
    <div className={"rounded border px-3 py-2 " + toneClass}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-bold">{formatPence(pence)}</div>
    </div>
  );
}

function GroupCard({
  caseId,
  group,
  editable,
}: {
  caseId: string;
  group: Group;
  editable: boolean;
}) {
  const defaultOpen = group.rows.length <= 8 || group.key === "uncategorized";
  const [open, setOpen] = useState(defaultOpen);
  const toneClass =
    group.direction === "income" ? "border-emerald-200"
      : group.direction === "expense" ? "border-slate-200"
      : "border-amber-200";
  return (
    <li className={"rounded-lg border bg-white " + toneClass}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-slate-900">{group.label}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            {group.rows.length} transaction{group.rows.length === 1 ? "" : "s"}
            {" "}
            <span className="opacity-60">·</span>{" "}
            {group.direction === "excluded" ? "not counted in P&L" : "counted in P&L"}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-bold text-slate-900">
            {formatPence(group.totalPence)}
          </div>
          <div className="text-[10px] text-slate-500">{open ? "Hide" : "Show"}</div>
        </div>
      </button>
      {open ? (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {group.rows.map((r) => (
            <TransactionRow key={r.id} caseId={caseId} txn={r} editable={editable} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function TransactionRow({
  caseId,
  txn,
  editable,
}: {
  caseId: string;
  txn: BankTransactionView;
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const current = txn.category ?? "uncategorized";

  const change = (next: string) => {
    if (next === current) {
      setEditing(false);
      return;
    }
    start(async () => {
      setErr(null);
      const r = await setBankTransactionCategoryAction(caseId, txn.id, next);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  return (
    <li className="px-3 py-2 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-slate-900">{txn.description}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            {txn.txnDate ? formatDate(txn.txnDate) : "No date"}
            {txn.categoryConfidence ? (
              <>
                {" "}<span className="opacity-60">·</span>{" "}
                <ConfidencePill value={txn.categoryConfidence} />
              </>
            ) : null}
          </div>
          {editing && editable ? (
            <select
              className="mt-2 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              value={current}
              onChange={(e) => change(e.target.value)}
              disabled={pending}
              autoFocus
            >
              {CATEGORY_INDEX.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : null}
          {err ? (
            <div className="mt-1 text-rose-700">{err}</div>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <div className={"text-sm font-semibold " + (txn.amountPence >= 0 ? "text-emerald-700" : "text-slate-900")}>
            {txn.amountPence >= 0 ? "+" : "-"}{formatPence(Math.abs(txn.amountPence))}
          </div>
          {editable && !editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-1 text-[11px] font-medium text-indigo-700 hover:underline"
            >
              Change category
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function ConfidencePill({ value }: { value: "high" | "medium" | "low" | "missing" }) {
  const map: Record<string, { label: string; className: string }> = {
    high: { label: "AI: high confidence", className: "text-emerald-700" },
    medium: { label: "AI: medium", className: "text-sky-700" },
    low: { label: "AI: low, please check", className: "text-amber-700" },
    missing: { label: "AI: couldn't tell", className: "text-rose-700" },
  };
  const chip = map[value];
  return <span className={chip.className}>{chip.label}</span>;
}

function formatPence(pence: number): string {
  return "£" + (pence / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
}
