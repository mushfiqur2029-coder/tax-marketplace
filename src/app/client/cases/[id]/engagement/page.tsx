import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTier } from "@/lib/service-catalog";
import { effectiveFeePence, formatFeeGbp } from "@/lib/case/pricing";
import { PortalPageHeader } from "@/components/portal-page-header";
import { ClientSuspensionBanner } from "@/app/client/suspension-banner";
import { loadClientCase } from "@/lib/case";
import { StepTracker } from "@/components/case/step-tracker";
import { buildSteps } from "@/components/case/build-steps";
import { renderEngagementLetterHtml } from "@/lib/engagement/letter-template";
import {
  clearCompanyIdentityAction,
  setCompanyIdentityAction,
  signEngagementAction,
} from "@/app/client/engagement-actions";
import {
  caseEyebrow,
  companyNameFromAnswers,
} from "@/lib/case/company-label";
import { EngagementSignForm } from "./sign-form";
import { CompanyIdentityCard } from "./company-identity-card";

export const dynamic = "force-dynamic";

export default async function EngagementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await requireRole("client");

  const supabase = await createClient();
  const { data: caseRow } = await supabase
    .from("cases")
    .select(
      "id, client_id, accountant_id, segment, tier, status, engagement_signed_at, intake_answers, custom_fee_pence, deposit_pence, balance_pence",
    )
    .eq("id", id)
    .single();
  if (!caseRow || caseRow.client_id !== me.id) notFound();
  if (
    caseRow.segment !== "limited_company_vat" &&
    caseRow.segment !== "personal"
  ) {
    notFound();
  }

  // Already signed → send them to the next step. The sign page is one-
  // shot; coming back here after signing is almost certainly a stale
  // bookmark, not an intentional revisit.
  if (caseRow.engagement_signed_at) {
    redirect(`/client/cases/${id}/checkout`);
  }

  const admin = createAdminClient();
  const accountantId = (caseRow as unknown as { accountant_id: string | null })
    .accountant_id;

  // These reads don't depend on each other (only on caseRow, already
  // in hand), so run them together instead of one after another. This
  // page used to take them sequentially, four round-trips end to end,
  // which was a chunk of the visible delay between submitting Step 3
  // and landing here.
  const [tier, caseData, profileRes, accProfileRes] = await Promise.all([
    getTier(caseRow.tier),
    loadClientCase(id),
    admin
      .from("client_profiles")
      .select("name, contact_number")
      .eq("user_id", me.id)
      .maybeSingle(),
    accountantId
      ? admin
          .from("accountant_profiles")
          .select("legal_name, legal_company_number, trading_name")
          .eq("user_id", accountantId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!tier) notFound();
  const isCompany = caseRow.segment === "limited_company_vat";
  if (isCompany && tier.group !== "company") notFound();
  if (!isCompany && tier.group !== "personal") notFound();

  // Pull the profile for the on-screen preview so the letter the client
  // signs shows their real name/phone, not placeholders.
  const profile = profileRes.data;
  const clientName = (profile?.name ?? me.name ?? me.email).trim();
  const clientPhone = (profile?.contact_number ?? "").trim();

  const answers =
    (caseRow as unknown as { intake_answers: Record<string, string> | null })
      .intake_answers ?? {};
  // Company identity only matters on the LC path. Personal cases carry
  // no company_name / company_number, the letter renders a client-only
  // Parties block via variant: "personal".
  const companyName = (answers.company_name ?? "").trim();
  const companyNumber = (answers.company_number ?? "").trim();
  const companyStatus = (answers.company_status ?? "").trim();
  const companyReady = !!companyName && !!companyNumber;

  const todayLong = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });

  const feeRow = caseRow as unknown as {
    custom_fee_pence: number | null;
    deposit_pence: number | null;
    balance_pence: number | null;
  };
  const feeLabel = formatFeeGbp(effectiveFeePence(feeRow, tier));
  const hasSplit =
    feeRow.deposit_pence != null &&
    feeRow.deposit_pence > 0 &&
    feeRow.balance_pence != null &&
    feeRow.balance_pence > 0;

  // Same accountant legal-identity lookup as the signing action
  // (engagement-actions.ts). Null fields fall back to the hardcoded
  // Shann / NAFH values inside the template so legacy / unassigned
  // cases still render.
  const accProfile = accProfileRes.data;
  const accountantLegalName: string | null = accProfile?.legal_name ?? null;
  const accountantCompanyNumber: string | null =
    accProfile?.legal_company_number ?? null;
  const accountantTradingName: string | null =
    accProfile?.trading_name ?? null;

  const previewHtml = renderEngagementLetterHtml({
    effectiveDate: todayLong,
    variant: isCompany ? "limited_company" : "personal",
    companyName,
    companyNumber,
    clientName,
    clientEmail: me.email,
    clientPhone: clientPhone || "-",
    serviceName: tier.title,
    totalFee: feeLabel,
    depositFee: hasSplit ? formatFeeGbp(feeRow.deposit_pence!) : null,
    balanceFee: hasSplit ? formatFeeGbp(feeRow.balance_pence!) : null,
    accountantLegalName,
    accountantCompanyNumber,
    accountantTradingName,
    signatureDataUrl: null,
    signDate: null,
  });

  const sign = async (dataUrl: string) => {
    "use server";
    return signEngagementAction(id, dataUrl);
  };
  const setIdentity = async (input: {
    companyName: string;
    companyNumber: string;
    companyStatus: string | null;
  }) => {
    "use server";
    return setCompanyIdentityAction(id, input);
  };
  const clearIdentity = async () => {
    "use server";
    return clearCompanyIdentityAction(id);
  };

  // Signing gate: LC blocks on company identity being set; Personal has
  // no gate, the sign form is ready as soon as the page loads.
  const signDisabled = isCompany && !companyReady;

  // Header copy. The LC path mentions confirming the company; Personal
  // doesn't have that step so the description is shorter.
  const headerDescription = isCompany
    ? "Confirm your company, read the full letter below, draw your signature at the bottom, and tick to accept. The signed PDF is emailed to you and we start work after payment."
    : "Read the letter below, draw your signature at the bottom, and tick to accept. The signed PDF is emailed to you and we start work after payment.";

  return (
    <>
      <PortalPageHeader
        eyebrow={caseEyebrow({
          segmentTitle: tier.title,
          tierTitle: feeLabel,
          companyName: companyNameFromAnswers(answers, caseRow.segment),
        })}
        title="Review and sign your engagement letter"
        description={headerDescription}
      />
      <ClientSuspensionBanner />

      <div className="mb-8">
        <StepTracker steps={buildSteps(id, caseData, "engagement")} />
      </div>

      {clientPhone ? null : (
        <div
          className="mb-6 rounded-xl border px-4 py-3 text-sm"
          role="status"
          style={{
            background: "rgba(217,159,25,0.10)",
            borderColor: "rgba(217,159,25,0.45)",
            color: "#8a5c05",
          }}
        >
          Your profile doesn&rsquo;t have a contact number yet. You can
          still sign; the letter will show a dash for the number.
          We&apos;d recommend adding one on your{" "}
          <Link
            href="/client/profile"
            className="font-semibold underline underline-offset-4"
          >
            account page
          </Link>{" "}
          first so the signed PDF is complete.
        </div>
      )}

      {isCompany ? (
        <section className="card-sl mb-6 p-6 sm:p-8">
          <h3
            className="text-sm font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Your company
          </h3>
          <p className="mt-2 text-sm text-slate">
            Pick your company so we can print its real name and number on
            the engagement letter. Companies House is the source of truth;
            manual entry is available if your company is brand-new and not
            yet showing.
          </p>
          <div className="mt-4">
            <CompanyIdentityCard
              initial={
                companyReady
                  ? {
                      company_number: companyNumber,
                      company_name: companyName,
                      company_status: companyStatus || "unknown",
                    }
                  : null
              }
              setIdentity={setIdentity}
              clearIdentity={clearIdentity}
            />
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Letter preview, isolated from the dashboard styles via iframe
             srcDoc, since the engagement letter has its own typography and
             should look identical to the printed PDF.
             On mobile the iframe comes second (via lg:order-1) so the
             sign CTA is visible without scrolling past a tall preview;
             a shorter iframe height on mobile keeps the preview itself
             scannable without eating the whole viewport. */}
        <section className="order-2 card-sl p-2 sm:p-3 lg:order-1">
          <iframe
            title="Engagement letter preview"
            srcDoc={previewHtml}
            className="h-[460px] w-full rounded-lg border border-line bg-white sm:h-[600px] lg:h-[720px]"
          />
        </section>

        <aside className="order-1 card-sl p-6 sm:p-8 lg:order-2">
          <h3
            className="text-sm font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Sign and continue
          </h3>
          <p className="mt-2 text-sm text-slate">
            Your signature is embedded in the PDF. We send a signed copy
            to <strong>{me.email}</strong> and a second copy to Sterling
            Ledger&rsquo;s records. After signing you&apos;ll go straight
            to the {feeLabel} checkout.
          </p>
          {signDisabled ? (
            <div
              className="mt-4 rounded-lg border px-3 py-2 text-xs"
              role="status"
              style={{
                background: "rgba(217,159,25,0.10)",
                borderColor: "rgba(217,159,25,0.45)",
                color: "#8a5c05",
              }}
            >
              Pick your company above before signing.
            </div>
          ) : null}
          <div className="mt-5">
            <EngagementSignForm
              sign={sign}
              fee={feeLabel}
              disabled={signDisabled}
            />
          </div>
        </aside>
      </div>

      <div className="mt-10">
        <Link
          href={`/client/cases/${id}`}
          className="text-sm font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
        >
          ← Back to the case
        </Link>
      </div>
    </>
  );
}
