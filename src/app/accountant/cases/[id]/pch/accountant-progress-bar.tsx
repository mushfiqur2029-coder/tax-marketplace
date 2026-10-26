"use client";

// Phase I progress bar for the PCH accountant workspace. Six amber /
// green chips in a row, same visual language as the client intake
// (see src/app/client/cases/[id]/pch/intake-progress.tsx). Clicking a
// chip smooth-scrolls the page down to the matching panel anchor.
//
// Colours intentionally match the client intake 1:1:
//   amber (pending)  -> border-amber-300  bg-amber-50  text-amber-900
//   green (done)     -> border-emerald-200 bg-emerald-50 text-emerald-800
//   highlight pulse  -> ring-2 ring-amber-400 animate-pulse (only when
//                       the step is pending AND highlighted; green chips
//                       never pulse)

import {
  ACCOUNTANT_STEP_ANCHOR_IDS,
  ACCOUNTANT_STEP_KEYS,
  ACCOUNTANT_STEP_LABELS,
  type AccountantStepKey,
} from "./accountant-progress";
import { useAccountantProgress } from "./accountant-progress-context";

export const ACCOUNTANT_PROGRESS_ANCHOR_ID = "pch-acc-progress";

function scrollToStep(key: AccountantStepKey) {
  if (typeof window === "undefined") return;
  const el = window.document.getElementById(ACCOUNTANT_STEP_ANCHOR_IDS[key]);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function AccountantProgressBar() {
  const { completion, highlighted } = useAccountantProgress();
  const done = ACCOUNTANT_STEP_KEYS.filter((k) => completion[k]).length;
  const total = ACCOUNTANT_STEP_KEYS.length;
  const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)));

  return (
    <section
      id={ACCOUNTANT_PROGRESS_ANCHOR_ID}
      className="mb-6 scroll-mt-24 rounded-xl border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div
            className="text-[11px] font-semibold uppercase tracking-widest text-slate-500"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Workflow progress
          </div>
          <div className="mt-0.5 text-sm font-bold text-ink">
            {done} of {total} steps complete
          </div>
        </div>
        <div className="w-full max-w-xs">
          <div className="h-2 w-full overflow-hidden rounded-full bg-amber-100">
            <div
              className="h-2 rounded-full bg-emerald-500 transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {ACCOUNTANT_STEP_KEYS.map((key) => (
          <StepChip
            key={key}
            label={ACCOUNTANT_STEP_LABELS[key]}
            done={completion[key]}
            highlighted={highlighted.has(key)}
            onClick={() => scrollToStep(key)}
          />
        ))}
      </div>
    </section>
  );
}

function StepChip({
  label, done, highlighted, onClick,
}: {
  label: string;
  done: boolean;
  highlighted: boolean;
  onClick: () => void;
}) {
  const base =
    "rounded-full border px-2 py-0.5 text-[11px] font-medium transition "
    + "cursor-pointer hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-sky/40 ";
  const colour = done
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-amber-300 bg-amber-50 text-amber-900";
  const ring = highlighted && !done
    ? " ring-2 ring-amber-400 animate-pulse"
    : "";
  return (
    <button type="button" onClick={onClick} className={base + colour + ring}>
      {done ? "✓ " : ""}{label}
    </button>
  );
}
