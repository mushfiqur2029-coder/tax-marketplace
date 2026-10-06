import { redirect } from "next/navigation";
import { loadClientCase } from "@/lib/case";
import { startCheckoutAction } from "@/app/client/actions";
import {
  caseEyebrow,
  companyNameFromAnswers,
} from "@/lib/case/company-label";
import { PortalPageHeader } from "@/components/portal-page-header";
import { ClientSuspensionBanner } from "@/app/client/suspension-banner";
import { effectiveFeePence, formatFeeGbp } from "@/lib/case/pricing";
import { StepTracker } from "@/components/case/step-tracker";
import { buildSteps } from "@/components/case/build-steps";
import { PayButton } from "./pay-button";

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
  // Both Personal (new 9-up catalogue) and Limited Company gate on the
  // engagement letter — intake was retired. If the letter isn't signed,
  // push them back to the engagement page.
  if (!data.progress.engagementSigned) {
    redirect(`/client/cases/${id}/engagement`);
  }
  // Suspended clients can't take payments; send them back to their case
  // page where the banner explains why.
  if (data.me.status === "suspended") {
    redirect(`/client/cases/${id}`);
  }

  const bound = async () => {
    "use server";
    return startCheckoutAction(id);
  };

  const planPence = effectiveFeePence(data.row, data.tier);
  const urgentPence = data.row.urgent_fee_pence ?? 0;
  const totalPence = planPence + urgentPence;

  return (
    <>
      <PortalPageHeader
        eyebrow={caseEyebrow({
          segmentTitle: data.segment.title,
          tierTitle: data.tier.title,
          companyName: companyNameFromAnswers(
            data.row.intake_answers,
            data.row.segment,
          ),
        })}
        title="Review and pay"
        description="Your case is queued to accountants the moment payment succeeds."
      />
      <ClientSuspensionBanner />
      <div className="mb-8">
        <StepTracker steps={buildSteps(id, data, "checkout")} />
      </div>

      {canceled ? (
        <div
          role="status"
          className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          Payment cancelled. Your details are saved. pay whenever you're ready.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="card-sl p-6 sm:p-8">
          <h3 className="text-lg font-semibold text-ink">What we have from you</h3>
          <dl className="mt-4 divide-y divide-line">
            <Row label="Service" value={data.tier.title} />
            <Row label="Engagement letter" value="Signed" />
          </dl>

          <p className="mt-6 text-xs text-slate">
            Once paid, we&rsquo;ll ask you to upload the documents required
            for your service in the next step.
          </p>
        </div>

        <aside className="card-sl p-6">
          <span className="eyebrow">Order summary</span>
          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-ink">{data.tier.title}</dt>
              <dd className="font-semibold text-ink">{formatFeeGbp(planPence)}</dd>
            </div>
            {data.row.is_urgent ? (
              <div className="flex items-baseline justify-between">
                <dt className="text-ink">Urgent processing</dt>
                <dd className="font-semibold text-ink">
                  +{formatFeeGbp(urgentPence)}
                </dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between border-t border-line pt-2.5">
              <dt
                className="text-[11px] font-bold uppercase tracking-widest text-slate"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Total
              </dt>
              <dd
                className="text-2xl font-bold text-ink"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {formatFeeGbp(totalPence)}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-slate">
            {data.tier.tagline}
            {data.tier.priceGbpSubtitle ? ` · ${data.tier.priceGbpSubtitle}` : ""}
          </p>
          <PayButton
            amountLabel={formatFeeGbp(totalPence)}
            start={bound}
          />
          <p className="mt-3 text-[11px] text-slate">
            You'll be redirected to Stripe. Test card <code className="font-mono">4242 4242 4242 4242</code>, any future date, any CVC.
          </p>
        </aside>
      </div>
    </>
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
