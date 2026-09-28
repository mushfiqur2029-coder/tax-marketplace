// Small "URGENT" chip shown next to the deadline pill on case cards and
// case detail pages. Same visual language (rounded-full, mono caps) as the
// existing StatusPill / DeadlinePill so it slots in cleanly.
export function UrgentPill({ size = "md" }: { size?: "sm" | "md" }) {
  const pad = size === "sm" ? "px-2 py-0.5 text-[9px]" : "px-2.5 py-0.5 text-[10px]";
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full font-bold uppercase tracking-widest text-white " +
        pad
      }
      style={{
        background: "linear-gradient(135deg, #B91C1C, #F97316)",
        fontFamily: "var(--font-mono)",
      }}
      title="Urgent case — fast-tracked past the standard 5-working-day rule"
    >
      <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <polygon points="13,2 3,14 12,14 11,22 21,10 12,10" />
      </svg>
      Urgent
    </span>
  );
}
