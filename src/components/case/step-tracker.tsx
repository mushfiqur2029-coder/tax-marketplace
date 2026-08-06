import Link from "next/link";

export type Step = {
  key: string;
  label: string;
  href: string;
  done: boolean;
  current?: boolean;
};

export function StepTracker({ steps }: { steps: Step[] }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-4">
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
              <div className="text-xs font-semibold uppercase tracking-wider text-slate" style={{ fontFamily: "var(--font-mono)" }}>
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
  );
}
