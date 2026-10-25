import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensurePchHeadRow } from "@/app/client/pch/actions";
import { PchClientWorkspace } from "./pch-client-workspace";
import type { PriorYearOption } from "./prior-year-prompt";
import {
  computeReturnsOwed,
  hasRatePackFor,
  type TaxEngineOutput,
  type UkTaxYear,
} from "@/lib/tax-engine";
import { type CaseMessageView } from "@/components/case/case-messages-panel";
import { CaseConversationsPanel } from "@/components/case/case-conversations-panel";
import { loadSupportThreadForCaseAndUser } from "@/lib/support/data";

// Dynamic so a brand new extraction row (populated in a Next after()
// callback after an upload) is visible on the very next page load,
// not stale from an earlier render.
export const dynamic = "force-dynamic";

// Entry point for the automated PCH flow (phase 2a). One page with
// collapsible sections: identity, income, expenses, vehicle (as a
// subsection of expenses), sections 4-15, final general uploads.
// Phase A ships the status-aware shell; the intake sections land in
// phases B-D of the rebuild.
//
// Authenticated client only; redirects to the generic case detail if
// this isn't a uber_phv_automated case.

export default async function PchClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me || me.role !== "client") redirect(`/login?next=/client/cases/${id}/pch`);

  const admin = createAdminClient();
  const { data: caseRow } = await admin
    .from("cases")
    .select("id, client_id, accountant_id, status, tier")
    .eq("id", id)
    .single();
  if (!caseRow) notFound();
  if (caseRow.client_id !== me.id) notFound();
  if (caseRow.tier !== "uber_phv_automated") {
    redirect(`/client/cases/${id}`);
  }

  // Make sure the head row exists so every subsequent save finds a row.
  await ensurePchHeadRow(id);

  const [head, snapshot, pendingAddons] = await Promise.all([
    admin.from("pch_cases").select("*").eq("case_id", id).single(),
    admin
      .from("pch_cases")
      .select(
        "engine_snapshot, engine_snapshot_at, client_approval_at, client_approval_name",
      )
      .eq("case_id", id)
      .single(),
    admin
      .from("case_addons")
      .select("id, description, amount_pence, status")
      .eq("case_id", id)
      .eq("status", "pending_payment")
      .order("created_at", { ascending: true }),
  ]);

  const priorYearOptions = await buildPriorYearOptions({
    admin,
    parentCaseId: id,
    currentTaxYear: (head.data?.tax_year as UkTaxYear) ?? "2025/26",
    tradingStartDate: head.data?.cl_start_date ? new Date(head.data.cl_start_date) : null,
    tradingEndDate: head.data?.cl_stop_date ? new Date(head.data.cl_stop_date) : null,
  });

  // Hide the engine snapshot from the client until the accountant has
  // explicitly moved the case to client_approval.
  const showFigures =
    caseRow.status === "client_approval"
    || caseRow.status === "filed"
    || caseRow.status === "complete";

  const messages = await loadCaseMessages(admin, id);
  const supportThread = await loadSupportThreadForCaseAndUser(id, me.id);

  return (
    <>
      <PchClientWorkspace
        caseId={id}
        caseStatus={caseRow.status}
        head={head.data ?? null}
        priorYearOptions={priorYearOptions}
        pendingAddons={(pendingAddons.data ?? []).map((a) => ({
          id: a.id as string,
          description: a.description as string,
          amount_pence: Number(a.amount_pence),
        }))}
        finalPackSentAt={(head.data?.final_pack_sent_at as string | null) ?? null}
        finalPackConfirmedAt={(head.data?.final_pack_confirmed_at as string | null) ?? null}
        finalPackConfirmedName={(head.data?.final_pack_confirmed_name as string | null) ?? null}
        engineSnapshot={
          showFigures
            ? ((snapshot.data?.engine_snapshot ?? null) as TaxEngineOutput | null)
            : null
        }
        engineSnapshotAt={showFigures ? (snapshot.data?.engine_snapshot_at ?? null) : null}
        approvalAt={snapshot.data?.client_approval_at ?? null}
        approvalName={snapshot.data?.client_approval_name ?? null}
        messagesPanel={
          <CaseConversationsPanel
            caseId={id}
            caseMessages={messages}
            supportThread={supportThread}
            viewerRole="client"
            viewerUserId={me.id}
          />
        }
      />
    </>
  );
}

async function loadCaseMessages(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
): Promise<CaseMessageView[]> {
  const { data: rows } = await admin
    .from("case_messages")
    .select("id, author_id, author_role, body, created_at, attachments")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  const list = (rows ?? []) as {
    id: string;
    author_id: string;
    author_role: "client" | "accountant" | "admin";
    body: string;
    created_at: string;
    attachments: unknown;
  }[];
  if (list.length === 0) return [];
  const authorIds = Array.from(new Set(list.map((m) => m.author_id)));
  const { data: users } = await admin
    .from("users")
    .select("id, email")
    .in("id", authorIds);
  const emailById = new Map((users ?? []).map((u) => [u.id, u.email]));
  return list.map((m) => ({
    id: m.id,
    authorRole: m.author_role,
    authorLabel: emailById.get(m.author_id) ?? m.author_id.slice(0, 8),
    body: m.body,
    createdAt: m.created_at,
    attachments: Array.isArray(m.attachments)
      ? (m.attachments as CaseMessageView["attachments"])
      : null,
  }));
}

async function buildPriorYearOptions({
  admin, parentCaseId, currentTaxYear, tradingStartDate, tradingEndDate,
}: {
  admin: ReturnType<typeof createAdminClient>;
  parentCaseId: string;
  currentTaxYear: UkTaxYear;
  tradingStartDate: Date | null;
  tradingEndDate: Date | null;
}): Promise<PriorYearOption[]> {
  if (!tradingStartDate) return [];
  const asOf = new Date();
  const owed = computeReturnsOwed({
    tradingStartDate,
    tradingEndDate: tradingEndDate ?? undefined,
    alreadyFiledYears: [currentTaxYear],
    asOf,
  });
  if (owed.years.length === 0) return [];

  const { data: existingChildren } = await admin
    .from("cases")
    .select("tax_year_label")
    .eq("parent_case_id", parentCaseId);
  const alreadySpawnedSet = new Set(
    (existingChildren ?? []).map((c) => c.tax_year_label).filter(Boolean) as string[],
  );

  return owed.years.slice(0, 5).map((y) => ({
    taxYear: y.taxYear,
    filingDeadline: y.filingDeadline.toISOString(),
    overdue: y.filingOverdue,
    supported: hasRatePackFor(y.taxYear),
    alreadySpawned: alreadySpawnedSet.has(y.taxYear),
  }));
}
