const PERCENT: Record<string, number> = {
  draft: 0,
  submitted: 10,
  in_review: 30,
  prepared: 60,
  client_approval: 80,
  filed: 95,
  complete: 100,
};

const LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_review: "In review",
  prepared: "Prepared",
  client_approval: "Awaiting your approval",
  filed: "Filed",
  complete: "Complete",
};

export function ProgressBar({ status }: { status: string }) {
  const pct = PERCENT[status] ?? 0;
  return (
    <div className="card-sl p-5">
      <div className="flex items-baseline justify-between">
        <span
          className="text-xs font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Progress
        </span>
        <span
          className="text-sm font-bold text-ink"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {pct}%
        </span>
      </div>
      <div className="mt-2 text-sm font-semibold text-ink">
        {LABEL[status] ?? status}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-cloud">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${pct}%`,
            background:
              "linear-gradient(90deg, var(--sky), var(--mint))",
          }}
        />
      </div>
    </div>
  );
}
