type Status =
  | "draft"
  | "submitted"
  | "in_review"
  | "prepared"
  | "client_approval"
  | "filed"
  | "complete";

const LABELS: Record<Status, { label: string; tone: "grey" | "blue" | "amber" | "green" }> = {
  draft: { label: "Draft", tone: "grey" },
  submitted: { label: "Awaiting accountant", tone: "amber" },
  in_review: { label: "In review", tone: "blue" },
  prepared: { label: "Prepared", tone: "blue" },
  client_approval: { label: "Awaiting your approval", tone: "amber" },
  filed: { label: "Filed", tone: "green" },
  complete: { label: "Complete", tone: "green" },
};

const TONES: Record<string, string> = {
  grey: "bg-line/70 text-slate",
  blue: "bg-sky/12 text-sky",
  amber: "text-[#B57E12]",
  green: "text-[#0E9E77]",
};

const TONE_STYLES: Record<string, React.CSSProperties> = {
  amber: { background: "rgba(217, 159, 25, 0.14)" },
  green: { background: "rgba(19, 217, 160, 0.14)" },
  blue: { background: "rgba(25, 156, 217, 0.14)" },
};

export function StatusPill({ status }: { status: string }) {
  const key = (status as Status) in LABELS ? (status as Status) : "draft";
  const { label, tone } = LABELS[key];
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider " +
        TONES[tone]
      }
      style={{
        fontFamily: "var(--font-mono)",
        ...TONE_STYLES[tone],
      }}
    >
      {label}
    </span>
  );
}
