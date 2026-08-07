import { notFound } from "next/navigation";
import { requireRole, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSegment, type Segment } from "@/lib/segments";
import { getTier, type PlanTier } from "@/lib/plans";

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
};

export type CaseDoc = {
  id: string;
  file_name: string;
  file_url: string;
  uploaded_at: string;
};

export type CaseData = {
  me: { id: string; email: string; role: Role; name?: string | null };
  row: CaseRow;
  segment: Segment;
  tier: PlanTier;
  docs: CaseDoc[];
  progress: {
    intakeDone: boolean;
    hasDocs: boolean;
    paid: boolean;
    nextStep: "intake" | "documents" | "checkout" | "done";
  };
};

export async function loadClientCase(caseId: string): Promise<CaseData> {
  const me = await requireRole("client");
  const supabase = await createClient();
  const { data: caseRow, error } = await supabase
    .from("cases")
    .select(
      "id, client_id, accountant_id, segment, tier, status, stripe_payment_status, stripe_checkout_session_id, intake_answers, submitted_at, created_at, deadline",
    )
    .eq("id", caseId)
    .single();

  if (error || !caseRow) notFound();
  if (caseRow.client_id !== me.id) notFound();

  const segment = getSegment(caseRow.segment);
  const tier = getTier(caseRow.tier);
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

  let nextStep: CaseData["progress"]["nextStep"];
  if (!intakeDone) nextStep = "intake";
  else if (!hasDocs) nextStep = "documents";
  else if (!paid) nextStep = "checkout";
  else nextStep = "done";

  return {
    me,
    row: caseRow as CaseRow,
    segment,
    tier,
    docs: (docs ?? []) as CaseDoc[],
    progress: { intakeDone, hasDocs, paid, nextStep },
  };
}
