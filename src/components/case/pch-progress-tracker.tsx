// Live case progress tracker for PCH automated cases on the client
// dashboard and anywhere else a client view wants a "where are we"
// read at a glance.
//
// Four steps mirror the status machine shipped in Phase 2:
//   1 Submitted            cases.status in ('submitted')
//   2 With accountant      cases.status in ('in_review', 'prepared')
//   3 Ready to approve     cases.status = 'client_approval'
//   4 Filed                cases.status in ('filed', 'complete')
//
// Steps before the current one render as a filled green dot (done),
// the current step as a filled blue dot with a thicker ring (active),
// future steps as a light grey outline (pending). Connecting line
// between dots is coloured up to and including the current step.
// Exception: "Filed" (filed/complete) is terminal - there's no next
// step to be "active" toward, so it renders green/done like any other
// completed step rather than blue/active, once the case reaches it.
//
// Mobile-first: the layout wraps gracefully below 400px with the
// labels stacking under each dot.

type Step = {
  label: string;
  key: "submitted" | "with_accountant" | "ready_to_approve" | "filed";
};

const STEPS: readonly Step[] = [
  { key: "submitted", label: "Submitted" },
  { key: "with_accountant", label: "With accountant" },
  { key: "ready_to_approve", label: "Ready to approve" },
  { key: "filed", label: "Filed" },
];

function statusToStepIndex(status: string): number {
  switch (status) {
    case "draft": return -1;
    case "submitted": return 0;
    case "in_review":
    case "prepared":
      return 1;
    case "client_approval":
      return 2;
    case "filed":
    case "complete":
      return 3;
    default:
      return -1;
  }
}

export function PchProgressTracker({
  status,
  compact = false,
}: {
  status: string;
  compact?: boolean;
}) {
  const current = statusToStepIndex(status);
  if (current === -1) return null;

  // "Filed" is a terminal state, not a step the client is waiting to
  // move past - there's nothing after it to transition to. Rendering
  // it as "active" (the same blue used for "Ready to approve" while a
  // case is still in progress) reads as "still working on this", so a
  // completed case's last fully-green step appears to be "Ready to
  // approve" with "Filed" looking unfinished beside it. Treat the
  // final step as done (green) once the case has actually reached it,
  // same as every earlier step.
  const atFinalStep = current === STEPS.length - 1;

  // Compact variant used inside a dashboard card: smaller dots, labels
  // aria-hidden off-screen so the visual stays small but screen readers
  // still get the step name. Full variant used wherever we have room.
  const dotSize = compact ? "h-3 w-3" : "h-4 w-4";
  const activeDotSize = compact ? "h-3.5 w-3.5" : "h-5 w-5";
  const labelClass = compact
    ? "text-[10px] mt-1.5 text-slate-600"
    : "text-xs mt-2 text-slate-700";

  return (
    <ol className="flex w-full items-start" aria-label="Case progress">
      {STEPS.map((step, i) => {
        const done = i < current || (i === current && atFinalStep);
        const active = i === current && !atFinalStep;
        const dotClass = done
          ? "bg-emerald-500 border-emerald-500"
          : active
            ? "bg-sky-500 border-sky-500 ring-4 ring-sky-100"
            : "bg-white border-slate-300";
        const lineClass = done
          ? "bg-emerald-500"
          : "bg-slate-200";
        return (
          <li
            key={step.key}
            className="flex min-w-0 flex-1 flex-col items-center"
            aria-current={active ? "step" : undefined}
          >
            <div className="relative flex w-full items-center justify-center">
              {i > 0 ? (
                <span
                  className={`absolute left-0 right-1/2 top-1/2 h-0.5 -translate-y-1/2 ${lineClass}`}
                  aria-hidden="true"
                />
              ) : null}
              {i < STEPS.length - 1 ? (
                <span
                  className={`absolute left-1/2 right-0 top-1/2 h-0.5 -translate-y-1/2 ${i < current ? "bg-emerald-500" : "bg-slate-200"}`}
                  aria-hidden="true"
                />
              ) : null}
              <span
                className={`relative z-10 rounded-full border-2 ${active ? activeDotSize : dotSize} ${dotClass}`}
                aria-hidden="true"
              />
            </div>
            <span className={`${labelClass} text-center leading-tight`}>
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
