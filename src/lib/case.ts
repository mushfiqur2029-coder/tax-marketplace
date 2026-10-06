import { notFound } from "next/navigation";
import { requireRole, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSegment, type Segment } from "@/lib/segments";
import { type PlanTier, type TierId } from "@/lib/plans";
import { getTier } from "@/lib/service-catalog";
import { periodDocsApplyToTier } from "@/lib/engagement/period-docs";

export type CaseRow = {
  id: string;
  client_id: string;
  accountant_id: string | null;
  segment: string;
  tier: string;
  status:
    | "draft"
    | "submitted"
    | "in_review"
    | "prepared"
    | "client_approval"
    | "filed"
    | "complete";
  stripe_payment_status: "pending" | "succeeded" | "failed" | "refunded";
  stripe_checkout_session_id: string | null;
  intake_answers: Record<string, string> | null;
  submitted_at: string | null;
  created_at: string;
  deadline: string | null;
  is_urgent: boolean;
  urgent_fee_pence: number;
  // Admin-created bespoke engagement override. When set, every price
  // surface (Stripe, engagement letter, checkout display, payments
  // history, wallet commission) reads custom_fee_pence instead of
  // the tier catalogue priceGbp.
  custom_fee_pence: number | null;
  // Audit trail link back to the originating enquiry row, if the case
  // was created from one. Null on self-serve wizard cases.
  service_enquiry_id: string | null;
  // Limited-company engagement letter: null on personal cases, set
  // after the client signs on a limited-company case.
  engagement_signed_at: string | null;
  engagement_pdf_path: string | null;
  // Limited-company onboarding checklist: null until the client has
  // completed Sections A/B/C/[D] and clicked Submit. Gates accountant
  // queue visibility for the limited-company path.
  onboarding_submitted_at: string | null;
  // Accounting period dates (set by assigned accountant). Non-dormant
  // limited-company only. Null → the second-stage docs step hasn't
  // started yet.
  period_start_date: string | null;
  period_end_date: string | null;
  payroll_registered: boolean;
  // Stamped when the client submits the second-stage docs. Null →
  // accountant can't send for approval yet.
  period_docs_submitted_at: string | null;
  // Approval screen payload: ct_liability_pence, hmrc_payment_reference,
  // note, prepared_at, prepared_by. Written by the accountant when they
  // move the case to client_approval.
  approval_payload: Record<string, unknown> | null;
};

export type CaseDoc = {
  id: string;
  file_name: string;
  file_url: string;
  uploaded_at: string;
};

export type CaseData = {
  me: {
    id: string;
    email: string;
    role: Role;
    name?: string | null;
    status: "active" | "warned" | "suspended";
  };
  row: CaseRow;
  segment: Segment;
  tier: PlanTier;
  docs: CaseDoc[];
  progress: {
    // Legacy personal-flow markers. Both Personal (new 9-up catalogue)
    // and Limited Company now use the engagement → pay → onboarding
    // chain; these fields stay for compat with retired-personal cases
    // (none exist after the data wipe) and are always false for new
    // Personal / Limited Company cases.
    intakeDone: boolean;
    hasDocs: boolean;
    paid: boolean;
    // Limited-company gate: true once the client has signed the
    // engagement letter.
    engagementSigned: boolean;
    // Limited-company gate: true once the client has submitted the
    // post-payment document checklist. Case becomes visible in the
    // accountant queue only after this flips.
    onboardingSubmitted: boolean;
    // True once the accountant has set the accounting period dates for
    // a non-dormant limited-company case. Dormant short-circuits this.
    periodDatesSet: boolean;
    // True once the client has submitted the second-stage docs.
    periodDocsSubmitted: boolean;
    // What the client should do next on this case. Both Personal (new
    // 9-up) and Limited Company flow through engagement → checkout →
    // onboarding → (period_docs for non-dormant LC) → done. "intake"
    // and "documents" remain in the union for retired-personal
    // compatibility but are never emitted now.
    nextStep:
      | "engagement"
      | "intake"
      | "documents"
      | "checkout"
      | "onboarding"
      | "period_docs"
      | "done";
  };
};

export async function loadClientCase(caseId: string): Promise<CaseData> {
  const me = await requireRole("client");
  const supabase = await createClient();
  const { data: caseRow, error } = await supabase
    .from("cases")
    .select(
      "id, client_id, accountant_id, segment, tier, status, stripe_payment_status, stripe_checkout_session_id, intake_answers, submitted_at, created_at, deadline, is_urgent, urgent_fee_pence, custom_fee_pence, service_enquiry_id, engagement_signed_at, engagement_pdf_path, onboarding_submitted_at, period_start_date, period_end_date, payroll_registered, period_docs_submitted_at, approval_payload",
    )
    .eq("id", caseId)
    .single();

  if (error || !caseRow) notFound();
  if (caseRow.client_id !== me.id) notFound();

  const segment = getSegment(caseRow.segment);
  const tier = await getTier(caseRow.tier);
  if (!segment || !tier) notFound();

  const { data: docs } = await supabase
    .from("case_documents")
    .select("id, file_name, file_url, uploaded_at")
    .eq("case_id", caseId)
    .order("uploaded_at", { ascending: false });

  const intakeDone = !!(
    caseRow.intake_answers && Object.keys(caseRow.intake_answers).length > 0
  );
  const hasDocs = (docs?.length ?? 0) > 0;
  const paid = caseRow.stripe_payment_status === "succeeded";
  const engagementSigned = !!caseRow.engagement_signed_at;
  const onboardingSubmitted = !!caseRow.onboarding_submitted_at;
  const periodDatesSet = !!(
    caseRow.period_start_date && caseRow.period_end_date
  );
  const periodDocsSubmitted = !!caseRow.period_docs_submitted_at;
  // Both Personal (new 9-up catalogue) and Limited Company take the
  // engagement → pay → onboarding chain. period_docs applies to
  // non-dormant Limited Company only.
  const isFlatFeeFlow =
    caseRow.segment === "limited_company_vat" ||
    caseRow.segment === "personal";
  const needsPeriodDocs =
    caseRow.segment === "limited_company_vat" &&
    periodDocsApplyToTier(tier.id as TierId);

  let nextStep: CaseData["progress"]["nextStep"];
  if (isFlatFeeFlow) {
    if (!engagementSigned) nextStep = "engagement";
    else if (!paid) nextStep = "checkout";
    else if (!onboardingSubmitted) nextStep = "onboarding";
    else if (needsPeriodDocs && !periodDocsSubmitted) nextStep = "period_docs";
    else nextStep = "done";
  } else {
    // Retired personal cases (none exist after the data wipe). The
    // branch is dead but kept so loadClientCase cleanly handles any
    // residual rows without a type assertion.
    if (!paid) nextStep = "checkout";
    else nextStep = "done";
  }

  return {
    me,
    row: caseRow as CaseRow,
    segment,
    tier,
    docs: (docs ?? []) as CaseDoc[],
    progress: {
      intakeDone,
      hasDocs,
      paid,
      engagementSigned,
      onboardingSubmitted,
      periodDatesSet,
      periodDocsSubmitted,
      nextStep,
    },
  };
}
