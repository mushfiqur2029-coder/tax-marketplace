import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PortalPageHeader } from "@/components/portal-page-header";
import { ClientSuspensionBanner } from "@/app/client/suspension-banner";
import { type TierId } from "@/lib/plans";
import { getTier } from "@/lib/service-catalog";
import { effectiveFeePence, formatFeeGbp } from "@/lib/case/pricing";
import {
  periodDocsApplyToTier,
  periodDocFieldsForCase,
  requiredPeriodDocFieldsForCase,
  readNeedsPayeRegistration,
  SECTION_A_PAYE_UPLOAD_ID,
  PERIOD_DOCS_FOOTER_NOTE,
} from "@/lib/engagement/period-docs";
import {
  uploadPeriodDocumentAction,
  removePeriodDocumentAction,
  submitPeriodDocsAction,
} from "@/app/client/period-docs-actions";
import { PeriodDocsForm } from "./period-docs-form";

export const dynamic = "force-dynamic";

// Pretty format a YYYY-MM-DD string as "Mon 1 Oct 2026" (en-GB).
function formatYmd(ymd: string | null | undefined): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function PeriodDocsPage({
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
      "id, client_id, segment, tier, stripe_payment_status, onboarding_submitted_at, period_start_date, period_end_date, payroll_registered, period_docs_submitted_at, intake_answers, custom_fee_pence",
    )
    .eq("id", id)
    .single();
  if (!caseRow || caseRow.client_id !== me.id) notFound();
  if (caseRow.segment !== "limited_company_vat") notFound();

  const tier = await getTier(caseRow.tier);
  if (!tier || !periodDocsApplyToTier(tier.id as TierId)) notFound();

  // Flow guards: must be past onboarding, must have the period dates set
  // by the accountant, must not have already submitted. Each guard
  // routes to the right place rather than a bare 404 so the client
  // isn't dropped on an unhelpful page.
  if (caseRow.stripe_payment_status !== "succeeded") {
    redirect(`/client/cases/${id}`);
  }
  if (!caseRow.onboarding_submitted_at) {
    redirect(`/client/cases/${id}/onboarding`);
  }
  if (!caseRow.period_start_date || !caseRow.period_end_date) {
    // Accountant hasn't set the dates yet — send client back to the case
    // page where the "awaiting accountant" state shows.
    redirect(`/client/cases/${id}`);
  }
  if (caseRow.period_docs_submitted_at) {
    redirect(`/client/cases/${id}`);
  }

  const admin = createAdminClient();
  const { data: allDocs } = await admin
    .from("case_documents")
    .select("id, file_name, file_url, uploaded_at, requirement_key")
    .eq("case_id", id)
    .order("uploaded_at", { ascending: true });

  const payeInSectionA = (allDocs ?? []).some(
    (d) => d.requirement_key === SECTION_A_PAYE_UPLOAD_ID,
  );

  // Section C answer drives the PAYE summary hard-override — if the
  // client said No to needing PAYE registration, the PAYE slot
  // disappears regardless of the payroll flag or any orphaned
  // Section A PAYE cert upload.
  const needsPayeRegistration = readNeedsPayeRegistration(
    caseRow.intake_answers as Record<string, string> | null,
  );
  const fields = periodDocFieldsForCase({
    payrollRegistered: caseRow.payroll_registered,
    payeCertificateUploadedInSectionA: payeInSectionA,
    needsPayeRegistration,
  });
  const required = requiredPeriodDocFieldsForCase({
    tier: tier.id as TierId,
    payrollRegistered: caseRow.payroll_registered,
    payeCertificateUploadedInSectionA: payeInSectionA,
    needsPayeRegistration,
  });

  const docsByKey = new Map<
    string,
    { id: string; file_name: string; uploaded_at: string }[]
  >();
  for (const d of allDocs ?? []) {
    if (!d.requirement_key?.startsWith("period_")) continue;
    const arr = docsByKey.get(d.requirement_key) ?? [];
    arr.push({ id: d.id, file_name: d.file_name, uploaded_at: d.uploaded_at });
    docsByKey.set(d.requirement_key, arr);
  }

  const doneCount = required.filter(
    (f) => (docsByKey.get(f.id)?.length ?? 0) > 0,
  ).length;

  const uploadDoc = async (requirementKey: string, fd: FormData) => {
    "use server";
    return uploadPeriodDocumentAction(id, requirementKey, fd);
  };
  const removeDoc = async (docId: string) => {
    "use server";
    return removePeriodDocumentAction(id, docId);
  };
  const submit = async () => {
    "use server";
    return submitPeriodDocsAction(id);
  };

  return (
    <>
      <PortalPageHeader
        eyebrow={`${tier.title} · ${formatFeeGbp(effectiveFeePence(caseRow, tier))}`}
        title="Documents for your accounting period"
        description={`Period: ${formatYmd(caseRow.period_start_date)} to ${formatYmd(
          caseRow.period_end_date,
        )}. Upload every required file. We'll start preparing your accounts the moment it's complete.`}
      />
      <ClientSuspensionBanner />

      <PeriodDocsForm
        tierId={tier.id as TierId}
        fields={fields}
        docsByKey={Object.fromEntries(docsByKey)}
        requiredCount={required.length}
        requiredDone={doneCount}
        footer={PERIOD_DOCS_FOOTER_NOTE}
        uploadDoc={uploadDoc}
        removeDoc={removeDoc}
        submit={submit}
      />

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
