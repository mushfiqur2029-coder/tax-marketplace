"use client";

// Error boundary for /admin/cases/[id]/**. Same branded shell as the
// top-level admin error page; back link points at the dashboard.
export default function AdminCaseError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl">
      <div className="card-sl p-6 sm:p-8">
        <span className="eyebrow">Something went wrong</span>
        <h1
          className="mt-2 text-2xl sm:text-3xl"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          We couldn&rsquo;t load this case
        </h1>
        <p className="mt-3 text-sm text-slate">
          A transient error stopped the case from rendering. Click retry,
          or head back to the admin dashboard.
        </p>
        {error.digest ? (
          <p
            className="mt-4 text-[11px] uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Ref: {error.digest}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center rounded-full border border-navy-deep bg-navy-deep px-4 py-2 text-sm font-semibold text-paper hover:bg-sky hover:border-sky"
          >
            Retry
          </button>
          <a
            href="/admin"
            className="inline-flex items-center rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-navy-deep hover:border-sky/50"
          >
            Back to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
