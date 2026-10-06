// Dashed-outline tile with a document icon, a heading, and a short hint.
// Used across portals for empty case lists, no-payment lists, etc.
// Lifted out of DashboardShell when the shell was retired for the
// portal-shell migration.

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint: string;
}) {
  return (
    <div className="card-sl border-dashed p-10 text-center sm:p-14">
      <div
        className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl text-white"
        style={{
          background:
            "linear-gradient(135deg, var(--color-navy), var(--color-sky))",
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M9 3h6l4 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
          <path d="M14 3v5h5" />
        </svg>
      </div>
      <p className="text-lg font-semibold text-ink">{title}</p>
      <p className="mt-2 text-sm text-slate">{hint}</p>
    </div>
  );
}
