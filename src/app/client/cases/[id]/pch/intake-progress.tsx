"use client";

// Progress indicator rendered above Section 1. Reactive via
// IntakeProgressProvider: each section pushes its done/not-done
// boolean up as its local state evolves, and this bar reflects the
// change without a page refresh. Amber chip = still pending; green
// chip = done. When submit is attempted while anything is pending,
// the workspace calls highlightPending() and the matching chips get
// an amber ring/pulse until the user resolves them.
//
// Phase H: chips are also clickable and smooth-scroll to the section
// anchor they correspond to (mirroring the Submit-button scroll back
// up to this bar on a rejected submit).

import {
  INTAKE_SECTION_ANCHOR_IDS,
  INTAKE_SECTION_KEYS,
  INTAKE_SECTION_LABELS,
  type IntakeSectionKey,
} from "./intake-completion";
import { useIntakeProgress } from "./intake-progress-context";

export const INTAKE_PROGRESS_ANCHOR_ID = "pch-intake-progress";

function scrollToSection(key: IntakeSectionKey) {
  if (typeof window === "undefined") return;
  const el = window.document.getElementById(INTAKE_SECTION_ANCHOR_IDS[key]);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function IntakeProgress() {
  const { completion, highlighted } = useIntakeProgress();
  const done = INTAKE_SECTION_KEYS.filter((k) => completion[k]).length;
  const total = INTAKE_SECTION_KEYS.length;
  const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)));

  return (
    <section
      id={INTAKE_PROGRESS_ANCHOR_ID}
      className="mb-6 scroll-mt-24 rounded-xl border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div
            className="text-[11px] font-semibold uppercase tracking-widest text-slate-500"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Your progress
          </div>
          <div className="mt-0.5 text-sm font-bold text-ink">
            {done} of {total} sections complete
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
        {INTAKE_SECTION_KEYS.map((key) => (
          <SectionChip
            key={key}
            label={INTAKE_SECTION_LABELS[key]}
            done={completion[key]}
            highlighted={highlighted.has(key)}
            onClick={() => scrollToSection(key)}
          />
        ))}
      </div>
    </section>
  );
}

function SectionChip({
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
    <button
      type="button"
      onClick={onClick}
      className={base + colour + ring}
    >
      {done ? "✓ " : ""}{label}
    </button>
  );
}

// Re-exported so the workspace can hand the submit gate the same
// labels and keys without reaching into the context module itself.
export type { IntakeSectionKey };
