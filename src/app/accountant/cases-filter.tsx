"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export type CasesView = "live" | "queue" | "completed" | "pending";
export type UrgencyFilter = "all" | "safe" | "soon" | "urgent";
export type IncomeFilter = "all" | "basic" | "standard" | "premium";
export type DateFilter = "all" | "7d" | "30d" | "90d";

export type ViewCounts = Record<CasesView, number>;

const VIEWS: { key: CasesView; label: string }[] = [
  { key: "live", label: "Live" },
  { key: "queue", label: "Queue" },
  { key: "completed", label: "Completed" },
  { key: "pending", label: "Pending" },
];

const URGENCY: { key: UrgencyFilter; label: string }[] = [
  { key: "all", label: "Any urgency" },
  { key: "safe", label: "> 14 days" },
  { key: "soon", label: "4 to 14 days" },
  { key: "urgent", label: "≤ 3 days / overdue" },
];

const INCOME: { key: IncomeFilter; label: string }[] = [
  { key: "all", label: "Any income" },
  { key: "basic", label: "£99 (Basic)" },
  { key: "standard", label: "£149 (Standard)" },
  { key: "premium", label: "£349 (Premium)" },
];

const DATES: { key: DateFilter; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
];

export function AccountantCasesFilter({
  view,
  urgency,
  income,
  date,
  counts,
}: {
  view: CasesView;
  urgency: UrgencyFilter;
  income: IncomeFilter;
  date: DateFilter;
  counts?: ViewCounts;
}) {
  return (
    <div className="mb-6 space-y-3">
      <ViewTabRow current={view} counts={counts} />
      <div className="flex flex-wrap gap-2">
        <FilterSelect current={urgency} options={URGENCY} paramKey="urgency" label="Urgency" />
        <FilterSelect current={date} options={DATES} paramKey="date" label="Date" />
        <FilterSelect current={income} options={INCOME} paramKey="income" label="Income" />
      </div>
    </div>
  );
}

// View tabs get a count badge — the same count that would render if you
// clicked into the tab. Updated live via the RealtimeCaseRefresh sibling.
function ViewTabRow({
  current,
  counts,
}: {
  current: CasesView;
  counts?: ViewCounts;
}) {
  const params = useSearchParams();
  return (
    <div className="inline-flex rounded-full border border-line bg-paper p-1">
      {VIEWS.map((v) => {
        const isActive = current === v.key;
        const next = new URLSearchParams(params?.toString());
        next.set("view", v.key);
        const n = counts?.[v.key] ?? 0;
        return (
          <Link
            key={v.key}
            href={`/accountant?${next.toString()}`}
            aria-pressed={isActive}
            className={
              "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition " +
              (isActive
                ? "bg-navy-deep text-white"
                : "text-slate hover:text-navy-deep")
            }
          >
            {v.label}
            {n > 0 ? (
              <span
                className={
                  "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold " +
                  (isActive ? "bg-white text-navy-deep" : "text-white")
                }
                style={
                  isActive
                    ? undefined
                    : { background: "linear-gradient(135deg, var(--sky), var(--mint))" }
                }
              >
                {n}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

function FilterSelect<K extends string>({
  current,
  options,
  paramKey,
  label,
}: {
  current: K;
  options: { key: K; label: string }[];
  paramKey: string;
  label: string;
}) {
  const params = useSearchParams();
  return (
    <label className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1.5 text-xs">
      <span
        className="font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </span>
      <select
        className="bg-transparent text-ink outline-none"
        value={current}
        onChange={(e) => {
          const next = new URLSearchParams(params?.toString());
          next.set(paramKey, e.target.value);
          window.location.href = `/accountant?${next.toString()}`;
        }}
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
