import { notFound } from "next/navigation";
import { requireApprovedAccountant, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSegment, type Segment } from "@/lib/segments";
import { getTier, type PlanTier } from "@/lib/plans";
import type { CaseRow, CaseDoc } from "@/lib/case";
import type { ChatMessage } from "@/components/case/multi-thread-chat";

export type AccountantCaseData = {
  me: { id: string; email: string; role: Role; name?: string | null };
  row: CaseRow;
  segment: Segment;
  tier: PlanTier;
  docs: CaseDoc[];
  messages: ChatMessage[];
  clientEmail: string | null;
  canTake: boolean;
  isMine: boolean;
};

export async function loadAccountantCase(
  caseId: string,
): Promise<AccountantCaseData> {
  const me = await requireApprovedAccountant();
  const supabase = await createClient();

  const { data: row, error } = await supabase
    .from("cases")
    .select(
      "id, client_id, accountant_id, segment, tier, status, stripe_payment_status, stripe_checkout_session_id, intake_answers, submitted_at, created_at, deadline",
    )
    .eq("id", caseId)
    .single();
  if (error || !row) notFound();

  const segment = getSegment(row.segment);
  const tier = getTier(row.tier);
  if (!segment || !tier) notFound();

  const isMine = row.accountant_id === me.id;
  const canTake =
    !row.accountant_id &&
    row.status === "submitted" &&
    row.stripe_payment_status === "succeeded";

  if (!isMine && !canTake) {
    // Neither theirs nor claimable — hide it.
    notFound();
  }

  // Documents + messages are RLS-gated. Docs are only visible if the accountant
  // has taken the case; messages likewise.
  const [docsRes, msgsRes] = await Promise.all([
    isMine
      ? supabase
          .from("case_documents")
          .select("id, file_name, file_url, uploaded_at")
          .eq("case_id", caseId)
          .order("uploaded_at", { ascending: false })
      : Promise.resolve({ data: [] as CaseDoc[] }),
    isMine
      ? supabase
          .from("messages")
          .select("id, case_id, sender_id, body, created_at")
          .eq("case_id", caseId)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as ChatMessage[] }),
  ]);

  // Look up the client's email using the admin client (accountant can't select
  // from public.users due to RLS, and we only need one email for display).
  let clientEmail: string | null = null;
  if (isMine) {
    const admin = createAdminClient();
    const { data: clientUser } = await admin
      .from("users")
      .select("email")
      .eq("id", row.client_id)
      .single();
    clientEmail = clientUser?.email ?? null;
  }

  return {
    me,
    row: row as CaseRow,
    segment,
    tier,
    docs: (docsRes.data ?? []) as CaseDoc[],
    messages: (msgsRes.data ?? []) as ChatMessage[],
    clientEmail,
    canTake,
    isMine,
  };
}
