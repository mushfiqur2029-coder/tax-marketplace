// Shared visual primitive for the small status/approval pills scattered
// across admin pages. Before this, at least six admin pages hand-rolled
// their own near-identical pill (rounded-full, uppercase, font-mono,
// bg/color pair) - same markup, slightly different sizing and tone
// palettes each time. This centralizes the markup; each call site still
// owns its own status -> tone/label mapping, since the status vocabularies
// differ by domain (case addon status, accountant approval, client
// suspension state, enquiry stage, ...).

export type AdminPillTone = "grey" | "blue" | "amber" | "green" | "red";

const TONE_STYLES: Record<AdminPillTone, { background: string; color: string }> = {
  grey: { background: "rgba(15,30,77,0.08)", color: "var(--navy-deep)" },
  blue: { background: "rgba(25,156,217,0.14)", color: "var(--sky)" },
  amber: { background: "rgba(217,159,25,0.14)", color: "#B57E12" },
  green: { background: "rgba(19,217,160,0.14)", color: "#0E9E77" },
  red: { background: "rgba(220,38,38,0.12)", color: "#B91C1C" },
};

export function AdminPill({
  tone,
  label,
  title,
  className = "",
}: {
  tone: AdminPillTone;
  label: string;
  title?: string;
  className?: string;
}) {
  return (
    <span
      className={
        "inline-flex shrink-0 items-center rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider " +
        className
      }
      style={{ fontFamily: "var(--font-mono)", ...TONE_STYLES[tone] }}
      title={title}
    >
      {label}
    </span>
  );
}
