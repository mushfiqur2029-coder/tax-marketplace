import Link from "next/link";
import { redirect } from "next/navigation";
import { loadClientCase } from "@/lib/case";
import { startCheckoutAction } from "@/app/client/actions";
import { DashboardShell } from "@/components/dashboard-shell";
import { SLButton } from "@/components/sl-button";
import { StepTracker } from "@/components/case/step-tracker";
import { buildSteps } from "@/components/case/build-steps";

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ canceled?: string }>;
}) {
  const { id } = await params;
  const { canceled } = await searchParams;
  const data = await loadClientCase(id);

  if (data.row.status !== "draft") {
    redirect(`/client/cases/${id}`);
  }
  if (!data.progress.intakeDone) {
    redirect(`/client/cases/${id}/intake`);
  }

  const bound = async () => {
    "use server";
    await startCheckoutAction(id);
  };

  return (
    <DashboardShell
      eyebrow={`${data.segment.title} · ${data.tier.title}`}
      title="Review and pay"
      description="Your case is queued to accountants the moment payment succeeds."
      email={data.me.email}
      role={data.me.role}
    >
      <div className="mb-8">
        <StepTracker steps={buildSteps(id, data, "checkout")} />
      </div>

      {canceled ? (
        <div
          role="status"
          className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          Payment cancelled. Your details are saved — pay whenever you're ready.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="card-sl p-6 sm:p-8">
          <h3 className="text-lg font-semibold text-ink">What we have from you</h3>
          <dl className="mt-4 divide-y divide-line">
            <Row label="Service" value={data.segment.title} />
            <Row label="Plan" value={`${data.tier.title} — £${data.tier.priceGbp}`} />
            <Row
              label="Intake"
              value={`${Object.keys(data.row.intake_answers ?? {}).length} answered`}
            />
            <Row
              label="Documents"
              value={
                data.docs.length > 0
                  ? `${data.docs.length} uploaded`
                  : "None (you can add later)"
              }
            />
          </dl>

          <div className="mt-6 flex flex-wrap gap-2 text-sm">
            <Link href={`/client/cases/${id}/intake`} className="btn-sl btn-sl-outline">
              Edit intake
            </Link>
            <Link href={`/client/cases/${id}/documents`} className="btn-sl btn-sl-outline">
              Edit documents
            </Link>
          </div>
        </div>

        <aside className="card-sl p-6">
          <span className="eyebrow">Order summary</span>
          <div className="mt-4 flex items-baseline justify-between">
            <div className="font-semibold text-ink">{data.tier.title}</div>
            <div className="text-2xl font-bold text-ink" style={{ fontFamily: "var(--font-heading)" }}>
              £{data.tier.priceGbp}
            </div>
          </div>
          <p className="mt-1 text-xs text-slate">{data.tier.tagline} · one-off</p>
          <form action={bound} className="mt-6">
            <SLButton type="submit" variant="primary" block>
              Pay £{data.tier.priceGbp} with card
            </SLButton>
          </form>
          <p className="mt-3 text-[11px] text-slate">
            You'll be redirected to Stripe. Test card <code className="font-mono">4242 4242 4242 4242</code>, any future date, any CVC.
          </p>
        </aside>
      </div>
    </DashboardShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-3">
      <dt className="text-xs font-semibold uppercase tracking-wider text-slate" style={{ fontFamily: "var(--font-mono)" }}>
        {label}
      </dt>
      <dd className="text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}
