"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export type CasesView = "live" | "queue" | "completed" | "pending";
export type UrgencyFilter = "all" | "safe" | "soon" | "urgent";
export type IncomeFilter = "all" | "basic" | "standard" | "premium";
export type DateFilter = "all" | "7d" | "30d" | "90d";

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
}: {
  view: CasesView;
  urgency: UrgencyFilter;
  income: IncomeFilter;
  date: DateFilter;
}) {
  return (
    <div className="mb-6 space-y-3">
      <TabRow current={view} options={VIEWS} paramKey="view" />
      <div className="flex flex-wrap gap-2">
        <FilterSelect current={urgency} options={URGENCY} paramKey="urgency" label="Urgency" />
        <FilterSelect current={date} options={DATES} paramKey="date" label="Date" />
        <FilterSelect current={income} options={INCOME} paramKey="income" label="Income" />
      </div>
    </div>
  );
}

function TabRow<K extends string>({
  current,
  options,
  paramKey,
}: {
  current: K;
  options: { key: K; label: string }[];
  paramKey: string;
}) {
  const params = useSearchParams();
  return (
    <div className="inline-flex rounded-full border border-line bg-paper p-1">
      {options.map((o) => {
        const isActive = current === o.key;
        const next = new URLSearchParams(params?.toString());
        next.set(paramKey, o.key);
        return (
          <Link
            key={o.key}
            href={`/accountant?${next.toString()}`}
            aria-pressed={isActive}
            className={
              "rounded-full px-4 py-1.5 text-xs font-semibold transition " +
              (isActive
                ? "bg-navy-deep text-white"
                : "text-slate hover:text-navy-deep")
            }
          >
            {o.label}
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
