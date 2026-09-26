import { notFound } from "next/navigation";
import { requireApprovedAccountant, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSegment, type Segment } from "@/lib/segments";
import { getTier, type PlanTier } from "@/lib/plans";
import type { CaseRow, CaseDoc } from "@/lib/case";
import type { ChatMessage } from "@/components/case/multi-thread-chat";

type MeShape = {
  id: string;
  email: string;
  role: Role;
  name?: string | null;
  status: "active" | "warned" | "suspended";
};

export type AccountantCaseData = {
  me: MeShape;
  row: CaseRow;
  segment: Segment;
  tier: PlanTier;
  docs: CaseDoc[];
  messages: ChatMessage[];
  clientEmail: string | null;
  canTake: boolean;
  isMine: boolean;
};

// A case that exists but has already been taken by a different accountant.
// The current one landed here from a stale queue view / bookmark; we render
// an explanatory page rather than a bare 404.
export type TakenByOther = {
  kind: "taken";
  me: MeShape;
  caseId: string;
  segment: Segment;
  tier: PlanTier;
};

export type AccountantCaseLoad =
  | ({ kind: "ok" } & AccountantCaseData)
  | TakenByOther;

export async function loadAccountantCase(
  caseId: string,
): Promise<AccountantCaseLoad> {
  const me = await requireApprovedAccountant();
  const supabase = await createClient();

  // Read via the admin client so RLS doesn't hide a case that's simply been
  // taken by someone else — we need to distinguish "case doesn't exist" from
  // "taken by another accountant" to give the accountant a useful page.
  const admin = createAdminClient();
  const { data: row, error } = await admin
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
    // Case exists but is assigned to another accountant (or was paid but
    // not yet in the queue-state). Show a "taken by another accountant"
    // page instead of a bare 404.
    return { kind: "taken", me, caseId, segment, tier };
  }

  // Docs + messages: same fetches as before, still via the user's session so
  // RLS holds. Only relevant when it's this accountant's case.
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

  // Look up the client's email using the admin client (accountant can't
  // select from public.users due to RLS, and we only need one email).
  let clientEmail: string | null = null;
  if (isMine) {
    const { data: clientUser } = await admin
      .from("users")
      .select("email")
      .eq("id", row.client_id)
      .single();
    clientEmail = clientUser?.email ?? null;
  }

  return {
    kind: "ok",
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
