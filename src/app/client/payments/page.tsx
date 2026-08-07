import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSegment } from "@/lib/segments";
import { getTier } from "@/lib/plans";
import { DashboardShell, EmptyState } from "@/components/dashboard-shell";
import { ClientNav } from "@/app/client/client-nav";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ClientPaymentsPage() {
  const me = await requireRole("client");
  const supabase = await createClient();

  const { data: cases } = await supabase
    .from("cases")
    .select(
      "id, segment, tier, status, stripe_payment_status, stripe_payment_id, stripe_checkout_session_id, submitted_at, created_at",
    )
    .eq("client_id", me.id)
    .eq("stripe_payment_status", "succeeded")
    .order("submitted_at", { ascending: false });

  const totalPence = (cases ?? []).reduce((sum, c) => {
    const t = getTier(c.tier);
    return sum + (t?.priceGbp ?? 0) * 100;
  }, 0);

  return (
    <DashboardShell
      eyebrow="Client workspace"
      title="Payments"
      description="Every case you've paid for, with the Stripe reference for your records."
      name={me.name}
      email={me.email}
      role={me.role}
      subnav={<ClientNav active="payments" />}
    >
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <StatCard label="Payments made" value={String(cases?.length ?? 0)} />
        <StatCard label="Total paid" value={`£${(totalPence / 100).toFixed(2)}`} />
      </div>

      {!cases || cases.length === 0 ? (
        <EmptyState
          title="No payments yet."
          hint="Once you submit and pay for a case, it will appear here with the Stripe reference."
        />
      ) : (
        <ul className="grid gap-3">
          {cases.map((c) => {
            const seg = getSegment(c.segment);
            const tier = getTier(c.tier);
            return (
              <li key={c.id} className="card-sl p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/client/cases/${c.id}`}
                        className="text-sm font-semibold text-ink hover:text-sky"
                      >
                        {seg?.title ?? c.segment}
                      </Link>
                      <span className="text-xs text-slate">.</span>
                      <span className="text-xs text-slate">
                        {tier?.title ?? c.tier}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate">
                      Paid{" "}
                      {c.submitted_at
                        ? formatDateTime(c.submitted_at)
                        : "date unavailable"}
                    </div>
                    <dl className="mt-3 grid gap-x-6 gap-y-1 text-[11px] sm:grid-cols-2">
                      <RefLine label="Payment intent" value={c.stripe_payment_id} />
                      <RefLine
                        label="Checkout session"
                        value={c.stripe_checkout_session_id}
                      />
                    </dl>
                  </div>
                  <div
                    className="text-right text-xl font-bold text-ink"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    £{tier?.priceGbp ?? "."}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardShell>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-sl p-5">
      <div
        className="text-[11px] font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </div>
      <div
        className="mt-2 text-2xl font-bold text-ink"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {value}
      </div>
    </div>
  );
}

function RefLine({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt
        className="shrink-0 uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </dt>
      <dd
        className="truncate text-ink"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {value ?? "."}
      </dd>
    </div>
  );
}
