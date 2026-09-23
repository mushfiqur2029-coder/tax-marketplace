import { getCurrentUser } from "@/lib/auth";

// Renders a locked banner at the top of every client page when the account
// is suspended. Server component — reads status from getCurrentUser which
// already runs per page load. Returns null for active accounts.
export async function ClientSuspensionBanner() {
  const me = await getCurrentUser();
  if (!me || me.role !== "client" || me.status !== "suspended") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-6 rounded-2xl border p-4 sm:p-5"
      style={{
        background: "rgba(220,38,38,0.06)",
        borderColor: "rgba(220,38,38,0.35)",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
          style={{ background: "#B91C1C" }}
          aria-hidden="true"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div className="min-w-0">
          <p
            className="text-[11px] font-bold uppercase tracking-widest"
            style={{ color: "#B91C1C", fontFamily: "var(--font-mono)" }}
          >
            Account suspended
          </p>
          <p className="mt-1 text-sm font-semibold text-ink">
            Your account is in read-only mode.
          </p>
          <p className="mt-1 text-xs text-slate">
            You can view your existing cases, documents, and messages, but
            you can&apos;t submit new cases, make payments, or approve
            filings until an admin reinstates you. Reach out via the Support
            chat on any case for help.
          </p>
        </div>
      </div>
    </div>
  );
}
