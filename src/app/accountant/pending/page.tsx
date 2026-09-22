import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard-shell";
import { Bell } from "@/components/bell";

export const dynamic = "force-dynamic";

export default async function AccountantPendingPage() {
  const me = await requireRole("accountant");
  if (me.approvalStatus === "approved") {
    redirect("/accountant");
  }

  const rejected = me.approvalStatus === "rejected";

  return (
    <DashboardShell
      eyebrow="Awaiting approval"
      title={rejected ? "Application not approved" : "Thanks for signing up"}
      description={
        rejected
          ? "Sterling Ledger admins reviewed your application and weren't able to approve it at this time."
          : "Sterling Ledger admins review every accountant before you can take cases."
      }
      name={me.name}
      email={me.email}
      role={me.role}
      bell={<Bell userId={me.id} role={me.role} />}
    >
      <div className="card-sl p-8">
        <div className="flex items-start gap-4">
          <div
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white"
            style={{
              background: rejected
                ? "linear-gradient(135deg, #B91C1C, #F97316)"
                : "linear-gradient(135deg, var(--navy), var(--sky))",
            }}
            aria-hidden="true"
          >
            {rejected ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            )}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-ink">
              {rejected ? "Application declined" : "Your account is pending review"}
            </h2>
            <p className="mt-2 text-sm text-slate">
              {rejected
                ? "If you think this is a mistake, reply to your welcome email and we'll take another look."
                : "Approval usually happens within one working day. You'll be able to take cases as soon as we've reviewed your credentials. In the meantime, there's nothing more you need to do."}
            </p>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
