import Link from "next/link";

export type Step = {
  key: string;
  label: string;
  href: string;
  done: boolean;
  current?: boolean;
};

// Mobile: a compact single-row of numbered circles joined by a thin
// progress line, with the current step's label shown underneath.
// Desktop (sm+): the original 4-card layout — bigger tap targets +
// full labels per step make sense once there's room.
//
// The mobile pattern saves ~200px of vertical space vs the stacked
// mobile cards it replaces, which matters a lot above the fold on
// intake / documents / checkout where the form itself needs to be
// visible without scrolling past the tracker first.
export function StepTracker({ steps }: { steps: Step[] }) {
  const currentIndex = steps.findIndex((s) => s.current);
  const activeStep = currentIndex >= 0 ? steps[currentIndex] : steps[0];
  const activePosition = (currentIndex >= 0 ? currentIndex : 0) + 1;

  return (
    <>
      {/* Mobile compact tracker — hidden at sm+ */}
      <div className="sm:hidden">
        <ol className="flex items-center justify-between gap-1.5">
          {steps.map((s, i) => {
            const isLast = i === steps.length - 1;
            return (
              <li
                key={s.key}
                className="flex flex-1 items-center gap-1.5 last:flex-initial"
              >
                <Link
                  href={s.href}
                  aria-label={`Step ${i + 1}: ${s.label}`}
                  className={
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold transition " +
                    (s.done
                      ? "bg-mint/20 text-[#0E9E77]"
                      : s.current
                        ? "text-white"
                        : "bg-cloud text-slate")
                  }
                  style={
                    s.current && !s.done
                      ? {
                          background:
                            "linear-gradient(135deg, var(--navy), var(--sky))",
                        }
                      : undefined
                  }
                >
                  {s.done ? "✓" : i + 1}
                </Link>
                {isLast ? null : (
                  <span
                    aria-hidden="true"
                    className={
                      "h-0.5 flex-1 rounded-full " +
                      (steps[i + 1]?.done || s.done
                        ? "bg-mint/70"
                        : "bg-line")
                    }
                  />
                )}
              </li>
            );
          })}
        </ol>
        <div className="mt-3 text-center">
          <div
            className="text-[10px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Step {activePosition} of {steps.length}
          </div>
          <div className="mt-0.5 text-sm font-semibold text-ink">
            {activeStep?.label}
          </div>
        </div>
      </div>

      {/* Desktop tracker — the original 4-column card layout */}
      <ol className="hidden gap-3 sm:grid sm:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.key}>
            <Link
              href={s.href}
              className={
                "card-sl group flex h-full items-start gap-3 p-4 transition " +
                (s.current
                  ? "!border-sky/50 !shadow-[0_10px_26px_-14px_rgba(25,156,217,0.35)]"
                  : "hover:border-sky/40")
              }
            >
              <span
                className={
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold " +
                  (s.done
                    ? "bg-mint/20 text-[#0E9E77]"
                    : s.current
                      ? "text-white"
                      : "bg-cloud text-slate")
                }
                style={
                  s.current && !s.done
                    ? {
                        background:
                          "linear-gradient(135deg, var(--navy), var(--sky))",
                      }
                    : undefined
                }
              >
                {s.done ? "✓" : i + 1}
              </span>
              <div>
                <div
                  className="text-xs font-semibold uppercase tracking-wider text-slate"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  Step {i + 1}
                </div>
                <div className="mt-0.5 text-sm font-semibold text-ink">
                  {s.label}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
