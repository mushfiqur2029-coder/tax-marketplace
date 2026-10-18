// "Validated" badge, shown on a client dashboard case card when the
// accountant's SA302 reconciliation came back all-green: every field
// filled and every filled field inside its tolerance.
//
// Signals to the client that the figures the accountant will file have
// been cross-checked against the HMRC software independently. Not a
// substitute for the client's own approval; a confidence signal.

export function ValidatedBadge({ size = "sm" }: { size?: "sm" | "md" }) {
  const padding = size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 font-semibold text-emerald-800 ${padding}`}
      title="SA302 reconciliation complete. Every engine figure matches the HMRC software."
      aria-label="Validated against HMRC SA302"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3.5 8.5l3 3 6-6" />
      </svg>
      Validated
    </span>
  );
}
