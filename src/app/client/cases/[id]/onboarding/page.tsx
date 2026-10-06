import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  caseEyebrow,
  companyNameFromAnswers,
} from "@/lib/case/company-label";
import { PortalPageHeader } from "@/components/portal-page-header";
import { ClientSuspensionBanner } from "@/app/client/suspension-banner";
import { getTier, type TierId } from "@/lib/plans";
import {
  sectionsForTier,
  fieldsForTier,
  footerForTier,
} from "@/lib/engagement/checklist";
import {
  saveChecklistAnswersAction,
  uploadChecklistDocumentAction,
  removeChecklistDocumentAction,
  submitChecklistAction,
} from "@/app/client/onboarding-actions";
import { OnboardingForm } from "./onboarding-form";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { id } = await params;
  const { paid } = await searchParams;
  const me = await requireRole("client");

  const supabase = await createClient();
  const { data: caseRow } = await supabase
    .from("cases")
    .select(
      "id, client_id, segment, tier, stripe_payment_status, onboarding_submitted_at, intake_answers",
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

  const tier = getTier(caseRow.tier);
  if (!tier) notFound();
  const isCompany = caseRow.segment === "limited_company_vat";
  if (isCompany && tier.group !== "company") notFound();
  if (!isCompany && tier.group !== "personal") notFound();

  // Flow guards: payment must have landed, and if onboarding is already
  // submitted send the client back to the dashboard where the "awaiting
  // accountant" status is shown. If still unpaid, bounce to the
  // engagement/checkout flow (the Stripe webhook usually wins the race,
  // but on local dev it can lag).
  if (caseRow.stripe_payment_status !== "succeeded") {
    redirect(`/client/cases/${id}`);
  }
  if (caseRow.onboarding_submitted_at) {
    redirect(`/client/cases/${id}`);
  }

  // The Company Authentication Code lives encrypted. We never read it
  // back for the client (they supplied it) — the form field shows an
  // "already saved" indicator when it's set, and lets them overwrite.
  // Personal cases have no encrypted field; the check short-circuits
  // with authCodeAlreadySet = false (ignored by the form for Personal).
  const admin = createAdminClient();
  let authCodeAlreadySet = false;
  if (isCompany) {
    const { data: cryptoCheck } = await admin
      .from("cases")
      .select("company_auth_code_encrypted")
      .eq("id", id)
      .single();
    authCodeAlreadySet = !!cryptoCheck?.company_auth_code_encrypted;
  }

  // Uploads for this case, grouped by requirement_key.
  const { data: allDocs } = await admin
    .from("case_documents")
    .select("id, file_name, file_url, uploaded_at, requirement_key")
    .eq("case_id", id)
    .order("uploaded_at", { ascending: true });

  const docsByKey = new Map<
    string,
    { id: string; file_name: string; uploaded_at: string }[]
  >();
  for (const d of allDocs ?? []) {
    if (!d.requirement_key) continue;
    const arr = docsByKey.get(d.requirement_key) ?? [];
    arr.push({
      id: d.id,
      file_name: d.file_name,
      uploaded_at: d.uploaded_at,
    });
    docsByKey.set(d.requirement_key, arr);
  }

  const tierId = tier.id as TierId;
  const sections = sectionsForTier(tierId);
  const fields = fieldsForTier(tierId);
  const answers = (caseRow.intake_answers ?? {}) as Record<string, string>;
  // Required count + progress now live inside OnboardingForm so they
  // recompute live when the Section B ID branch toggles between
  // Passport and Driving licence. The server-side guard uses the same
  // helper (requiredFieldsForTierGiven) in submitChecklistAction.

  const saveAnswers = async (fd: FormData) => {
    "use server";
    return saveChecklistAnswersAction(id, fd);
  };
  const uploadDoc = async (requirementKey: string, fd: FormData) => {
    "use server";
    return uploadChecklistDocumentAction(id, requirementKey, fd);
  };
  const removeDoc = async (docId: string) => {
    "use server";
    return removeChecklistDocumentAction(id, docId);
  };
  const submit = async () => {
    "use server";
    return submitChecklistAction(id);
  };

  return (
    <>
      <PortalPageHeader
        eyebrow={caseEyebrow({
          segmentTitle: tier.title,
          tierTitle: `£${tier.priceGbp}`,
          companyName: companyNameFromAnswers(answers, caseRow.segment),
        })}
        title="Your onboarding checklist"
        description="Fill in each required item below. You can save progress as you go. Nothing is sent to an accountant until you click Submit at the bottom."
      />
      <ClientSuspensionBanner />

      {paid === "1" ? (
        <div
          role="status"
          className="mb-6 rounded-xl border px-4 py-3 text-sm"
          style={{
            background: "rgba(19, 217, 160, 0.10)",
            borderColor: "rgba(19, 217, 160, 0.4)",
            color: "#0E7B57",
          }}
        >
          Payment received. One last step: give us the documents an
          accountant needs to start your filing.
        </div>
      ) : null}

      <OnboardingForm
        tierId={tierId}
        sections={sections}
        fields={fields}
        answers={answers}
        docsByKey={Object.fromEntries(docsByKey)}
        authCodeAlreadySet={authCodeAlreadySet}
        footer={footerForTier(tierId)}
        saveAnswers={saveAnswers}
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
