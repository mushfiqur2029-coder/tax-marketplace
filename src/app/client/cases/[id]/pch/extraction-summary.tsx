"use client";

// Case-level AI confidence summary. Lives above the Documents section
// in the client workspace. Pulls per-field data from every extraction
// across every uploaded document and surfaces the aggregate the client
// cares about at a glance:
//
//   "19 of 22 fields extracted with high confidence, 3 need your input."
//
// Only counts fields that would actually pre-fill the intake (targetable
// per the slot's apply-map). Informational-only fields and skip-mode
// slots don't contribute. Fields the client has already confirmed /
// edited drop out of the "need your input" count.

import type { ExtractionReviewPayload } from "./extraction-review";

type Breakdown = {
  high: number;        // Reviewable + ready to confirm
  medium: number;      // Reviewable but worth double-checking
  attention: number;   // Low confidence OR missing OR rejected
  resolved: number;    // Already accepted or edited by the client
  total: number;
};

function computeBreakdown(extractions: ExtractionReviewPayload[]): Breakdown {
  let high = 0, medium = 0, attention = 0, resolved = 0, total = 0;
  for (const ext of extractions) {
    if (ext.status !== "done") continue;
    for (const [key, field] of Object.entries(ext.fields)) {
      if (!ext.targetable[key]) continue;
      total += 1;
      const state = ext.fieldStates[key]?.status ?? "proposed";
      if (state === "accepted" || state === "edited") {
        resolved += 1;
        continue;
      }
      if (state === "rejected" || field.confidence === "low" || field.confidence === "missing") {
        attention += 1;
        continue;
      }
      if (field.confidence === "medium") {
        medium += 1;
      } else {
        high += 1;
      }
    }
  }
  return { high, medium, attention, resolved, total };
}

export function ExtractionSummaryPanel({ extractions }: {
  extractions: ExtractionReviewPayload[];
}) {
  // Only render for cases with actual completed extractions. Pending
  // and errored ones shouldn't flash a summary that'll change.
  const relevant = extractions.filter((e) => e.status === "done" && Object.keys(e.fields).length > 0);
  if (relevant.length === 0) return null;
  const b = computeBreakdown(relevant);
  if (b.total === 0) return null;

  const everythingResolved = b.resolved === b.total;
  const needsAttention = b.attention > 0;
  const headline = everythingResolved
    ? "All extracted fields reviewed and applied to your intake."
    : needsAttention
      ? (
          b.high + b.medium > 0
            ? `${b.attention} field${b.attention === 1 ? "" : "s"} ${b.attention === 1 ? "needs" : "need"} your input, ${b.high + b.medium} ready to confirm.`
            : `${b.attention} field${b.attention === 1 ? "" : "s"} ${b.attention === 1 ? "needs" : "need"} your input.`
        )
      : `${b.high + b.medium} of ${b.total - b.resolved} field${b.total - b.resolved === 1 ? "" : "s"} ready to confirm.`;

  const subhead = everythingResolved
    ? "Nothing left to review here."
    : `We read ${relevant.length} document${relevant.length === 1 ? "" : "s"} and extracted ${b.total} fields the engine will use. Review each in the document panels below.`;

  const bannerClass = everythingResolved
    ? "border-emerald-200 bg-emerald-50"
    : needsAttention
      ? "border-amber-200 bg-amber-50"
      : "border-sky-200 bg-sky-50";

  return (
    <section className={"mb-6 rounded-lg border " + bannerClass + " p-4"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">AI pre-fill summary</h2>
          <p className="mt-1 text-sm text-slate-700">{headline}</p>
          <p className="mt-1 text-xs text-slate-600">{subhead}</p>
        </div>
        <div className="shrink-0">
          <ConfidenceRing resolved={b.resolved} highMedium={b.high + b.medium} attention={b.attention} total={b.total} />
        </div>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2 text-xs">
        <Chip label="High confidence" count={b.high} tone="emerald" show />
        <Chip label="Medium" count={b.medium} tone="sky" show={b.medium > 0} />
        <Chip label="Need your input" count={b.attention} tone="amber" show={b.attention > 0} />
        <Chip label="Reviewed" count={b.resolved} tone="slate" show={b.resolved > 0} />
      </ul>
    </section>
  );
}

function Chip({ label, count, tone, show }: {
  label: string; count: number; tone: "emerald" | "sky" | "amber" | "slate"; show: boolean;
}) {
  if (!show) return null;
  const toneMap: Record<string, string> = {
    emerald: "border-emerald-300 bg-emerald-100 text-emerald-900",
    sky: "border-sky-300 bg-sky-100 text-sky-900",
    amber: "border-amber-300 bg-amber-100 text-amber-900",
    slate: "border-slate-300 bg-slate-100 text-slate-800",
  };
  return (
    <li className={"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium " + toneMap[tone]}>
      <span className="font-semibold">{count}</span>
      <span>{label}</span>
    </li>
  );
}

// Small inline progress ring. Three arcs so it reads at a glance:
//   resolved     = slate (done, out of the way)
//   highMedium   = emerald/sky (reviewable, no action required yet)
//   attention    = amber (needs the client's eye)
function ConfidenceRing({ resolved, highMedium, attention, total }: {
  resolved: number; highMedium: number; attention: number; total: number;
}) {
  const circumference = 2 * Math.PI * 16; // r=16
  // Four slices: resolved, high+medium, attention, remainder (shouldn't exist).
  const slices = [
    { v: resolved, color: "#334155" },  // slate-700
    { v: highMedium, color: "#059669" }, // emerald-600
    { v: attention, color: "#d97706" }, // amber-600
  ];
  let acc = 0;
  return (
    <svg width="56" height="56" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="16" fill="none" stroke="#e2e8f0" strokeWidth="6" />
      {slices.map((s, i) => {
        if (s.v <= 0) return null;
        const dash = (s.v / total) * circumference;
        const node = (
          <circle
            key={i}
            cx="20"
            cy="20"
            r="16"
            fill="none"
            stroke={s.color}
            strokeWidth="6"
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-acc}
            transform="rotate(-90 20 20)"
          />
        );
        acc += dash;
        return node;
      })}
      <text x="20" y="24" textAnchor="middle" fontSize="11" fontWeight="700" fill="#0f172a">
        {total}
      </text>
    </svg>
  );
}
