// Prior-year anomaly panel shown at the top of the accountant PCH
// workspace when a sibling snapshot from the same client's prior year
// shows material deviations. Not a block, just a call to attention
// before the accountant opens the override panels.

import type { Anomaly } from "@/lib/pch/prior-year-anomalies";

export function PriorYearAnomalyPanel({
  anomalies,
  priorYearLabel,
}: {
  anomalies: Anomaly[];
  priorYearLabel: string;
}) {
  if (anomalies.length === 0) return null;
  const severeCount = anomalies.filter((a) => a.severity === "severe").length;
  const notableCount = anomalies.length - severeCount;
  const borderClass = severeCount > 0 ? "border-rose-300 bg-rose-50" : "border-amber-300 bg-amber-50";
  const headlineClass = severeCount > 0 ? "text-rose-900" : "text-amber-900";

  return (
    <div className={"mb-6 rounded-lg border p-4 " + borderClass}>
      <h2 className={"text-sm font-semibold " + headlineClass}>
        Worth a closer look vs {priorYearLabel}
      </h2>
      <p className="mt-1 text-xs text-slate-700">
        {severeCount > 0 ? `${severeCount} severe` : null}
        {severeCount > 0 && notableCount > 0 ? ", " : null}
        {notableCount > 0 ? `${notableCount} notable` : null}
        {" "}deviation{anomalies.length === 1 ? "" : "s"} from the client&apos;s prior linked year. Not blocking, but
        resolve or note each before advancing to the client approval step.
      </p>
      <ul className="mt-3 space-y-2">
        {anomalies.map((a) => (
          <li
            key={a.key}
            className="rounded border bg-white p-2 text-xs"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-800">{a.label}</span>
                  <span
                    className={
                      "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase " +
                      (a.severity === "severe"
                        ? "bg-rose-100 text-rose-800"
                        : "bg-amber-100 text-amber-800")
                    }
                  >
                    {a.severity}
                  </span>
                </div>
                <div className="mt-0.5 text-slate-600">{a.note}</div>
              </div>
              <div className="shrink-0 text-right tabular-nums">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Δ</div>
                <div
                  className={
                    "font-semibold " +
                    (a.delta < 0 ? "text-rose-700" : "text-emerald-700")
                  }
                >
                  {a.delta > 0 ? "+" : ""}
                  {a.key === "businessMiles"
                    ? Math.round(a.delta).toLocaleString() + " mi"
                    : "£" + Math.round(a.delta).toLocaleString()}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
