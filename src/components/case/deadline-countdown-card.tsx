// Dashboard-level countdown card. Shows the nearest HMRC filing
// deadline across all of the client's open cases, with per-case
// breakdown underneath when there's more than one. Colour-coded by
// urgency so a client glancing at the dashboard knows if they have
// time (green), should start soon (amber), or need to act now (red).
//
// Thresholds mirror the engine's returns-owed vocabulary:
//   > 60 days = calm green
//   8..60     = urgent-amber
//   0..7      = red
//   overdue   = darker red + "overdue by N days"

import Link from "next/link";

export type DeadlineEntry = {
  caseId: string;
  caseLabel: string;        // "2025/26 Uber / PHV automated"
  deadlineIso: string;      // HMRC filing deadline (31 Jan after year end)
  taxYearLabel: string;     // "2025/26"
};

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return Math.ceil((to - from) / (24 * 60 * 60 * 1000));
}

function urgency(days: number): "overdue" | "red" | "amber" | "green" {
  if (days < 0) return "overdue";
  if (days <= 7) return "red";
  if (days <= 60) return "amber";
  return "green";
}

const URGENCY_STYLES: Record<ReturnType<typeof urgency>, { card: string; headline: string; chip: string }> = {
  overdue: {
    card: "border-rose-300 bg-rose-50",
    headline: "text-rose-900",
    chip: "bg-rose-200 text-rose-900",
  },
  red: {
    card: "border-rose-200 bg-rose-50",
    headline: "text-rose-800",
    chip: "bg-rose-100 text-rose-800",
  },
  amber: {
    card: "border-amber-200 bg-amber-50",
    headline: "text-amber-900",
    chip: "bg-amber-100 text-amber-900",
  },
  green: {
    card: "border-emerald-200 bg-emerald-50",
    headline: "text-emerald-900",
    chip: "bg-emerald-100 text-emerald-900",
  },
};

export function DeadlineCountdownCard({ entries }: { entries: DeadlineEntry[] }) {
  if (entries.length === 0) return null;

  // Sort nearest first, use that for the top-line card colour.
  const nowIso = new Date().toISOString();
  const sorted = [...entries]
    .map((e) => ({ ...e, days: daysBetween(nowIso, e.deadlineIso) }))
    .sort((a, b) => a.days - b.days);
  const nearest = sorted[0];
  const u = urgency(nearest.days);
  const style = URGENCY_STYLES[u];

  const headlineText =
    u === "overdue"
      ? `Overdue by ${Math.abs(nearest.days)} day${Math.abs(nearest.days) === 1 ? "" : "s"}`
      : `${nearest.days} day${nearest.days === 1 ? "" : "s"} until your next HMRC deadline`;

  return (
    <section className={`mb-6 rounded-lg border ${style.card} p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={`text-sm font-semibold uppercase tracking-wide ${style.headline}`}>
            {headlineText}
          </h2>
          <p className="mt-1 text-sm text-slate-700">
            Filing deadline for the <strong>{nearest.taxYearLabel}</strong> tax year is{" "}
            <strong>{formatUk(nearest.deadlineIso)}</strong>.
            {u === "overdue"
              ? " HMRC starts fixed late-filing penalties the day after the deadline."
              : u === "red"
                ? " Submit your intake as soon as you can; your accountant needs time to review."
                : u === "amber"
                  ? " Still time, but worth getting your documents in now."
                  : " Plenty of time left, but earlier is always better."}
          </p>
        </div>
      </div>
      {sorted.length > 1 ? (
        <ul className="mt-3 flex flex-wrap gap-2 text-xs">
          {sorted.map((e) => {
            const uu = urgency(e.days);
            const chip = URGENCY_STYLES[uu].chip;
            return (
              <li key={e.caseId}>
                <Link
                  href={`/client/cases/${e.caseId}`}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium ${chip} ${URGENCY_STYLES[uu].card} hover:brightness-95 transition`}
                >
                  <span>{e.taxYearLabel}</span>
                  <span className="opacity-70">·</span>
                  <span>{labelForDays(e.days)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function labelForDays(d: number): string {
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return "due today";
  return `${d}d left`;
}

function formatUk(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
