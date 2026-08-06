import { formatDate } from "@/lib/format";

type Props = {
  deadline: string; // ISO
  size?: "sm" | "md";
};

function daysUntil(iso: string): number {
  const now = Date.now();
  const then = new Date(iso).getTime();
  return Math.round((then - now) / (1000 * 60 * 60 * 24));
}

type Tone = "green" | "yellow" | "amber" | "red";

function toneFor(days: number): Tone {
  if (days > 30) return "green";
  if (days > 14) return "yellow";
  if (days > 3) return "amber";
  return "red";
}

const TONES: Record<
  Tone,
  { bg: string; color: string; ring?: string }
> = {
  green: {
    bg: "rgba(19,217,160,0.14)",
    color: "#0E9E77",
  },
  yellow: {
    bg: "rgba(217,180,25,0.15)",
    color: "#8A6A0F",
  },
  amber: {
    bg: "rgba(217,133,25,0.16)",
    color: "#B4640F",
  },
  red: {
    bg: "rgba(220,38,38,0.14)",
    color: "#B91C1C",
    ring: "0 0 0 4px rgba(220,38,38,0.10)",
  },
};

export function DeadlinePill({ deadline, size = "md" }: Props) {
  const days = daysUntil(deadline);
  const overdue = days < 0;
  const tone = toneFor(days);
  const style = TONES[tone];

  const label = overdue
    ? `${Math.abs(days)}d overdue`
    : days === 0
      ? "Due today"
      : `${days}d left`;

  const pulse = tone === "red";
  const px = size === "sm" ? "px-2.5 py-0.5 text-[10px]" : "px-3 py-1 text-[11px]";

  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full font-bold uppercase tracking-wider " +
        px +
        (pulse ? " sl-deadline-pulse" : "")
      }
      style={{
        background: style.bg,
        color: style.color,
        boxShadow: style.ring,
        fontFamily: "var(--font-mono)",
      }}
      title={`Deadline: ${formatDate(deadline)}`}
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: style.color }}
      />
      {label}
    </span>
  );
}
