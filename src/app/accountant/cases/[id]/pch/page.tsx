import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, requireApprovedAccountant } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PchAccountantView } from "./pch-accountant-view";
import { type CaseMessageView } from "@/components/case/case-messages-panel";
import { CaseConversationsPanel } from "@/components/case/case-conversations-panel";
import { loadSupportThreadForCaseAndUser } from "@/lib/support/data";
import {
  takeCaseAction,
  getDocSignedUrlForAccountant,
  updateCaseStatusAction,
} from "@/app/accountant/actions";
import { TakeCaseForm } from "../take-case-form";
import { PortalPageHeader } from "@/components/portal-page-header";
import { formatDateTime } from "@/lib/format";
import type { TaxEngineOutput } from "@/lib/tax-engine";

// Phase I: server page for the PCH accountant workspace. Sub-phase 1
// of the rebuild deleted the old 33-check / override / SA302
// comparison / bookkeeping-confirm / final-pack surface along with
// its data loads; this page now fetches only what the new orchestrator
// stub needs (identity head + documents + slot meta + chat). Later
// Phase I slices add back the P&L review feed, final-pack doc paths,
// and the client-approval status flip.

export default async function PchAccountantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me || me.role !== "accountant") {
    redirect(`/login?next=/accountant/cases/${id}/pch`);
  }

  const admin = createAdminClient();
  const { data: caseRow } = await admin
    .from("cases")
    .select("id, client_id, accountant_id, status, tier, stripe_payment_status, submitted_at, deadline, is_urgent")
    .eq("id", id)
    .single();
  if (!caseRow) {
    return (
      <>
        <PortalPageHeader
          eyebrow="Case"
          title="This case has been removed"
          description="It no longer exists in the system."
        />
        <div className="card-sl max-w-xl p-6 sm:p-8">
          <p className="text-sm text-slate">
            The case you followed a link to is no longer here. It may have
            been removed by an admin, or the link may be out of date.
          </p>
          <div className="mt-5">
            <Link href="/accountant" className="btn-sl btn-sl-primary">
              Back to your cases
            </Link>
          </div>
        </div>
      </>
    );
  }
  if (caseRow.tier !== "uber_phv_automated") {
    redirect(`/accountant/cases/${id}`);
  }

  // Queue state: paid PCH case not yet taken by any accountant.
  if (caseRow.accountant_id === null) {
    if (caseRow.status !== "submitted" || caseRow.stripe_payment_status !== "succeeded") {
      return (
        <>
          <PortalPageHeader
            eyebrow="Case"
            title="Not ready to take yet"
            description="This case isn't in a state an accountant can pick up right now."
          />
          <div className="card-sl max-w-xl p-6 sm:p-8">
            <p className="text-sm text-slate">
              Status is <strong>{caseRow.status}</strong> with no accountant
              assigned, and payment is <strong>{caseRow.stripe_payment_status ?? "unknown"}</strong>.
              If you expect this case to be in the queue, ask an admin to
              check it.
            </p>
            <div className="mt-5">
              <Link href="/accountant" className="btn-sl btn-sl-primary">
                Back to your cases
              </Link>
            </div>
          </div>
        </>
      );
    }
    const approved = await requireApprovedAccountant();
    const [clientRes, pchHeadRes] = await Promise.all([
      admin.from("users").select("email").eq("id", caseRow.client_id).maybeSingle(),
      admin.from("pch_cases").select("cl_name, tax_year, engine_snapshot_at").eq("case_id", id).maybeSingle(),
    ]);
    const take = async (): Promise<{ ok: true } | { ok: false; error: string }> => {
      "use server";
      return takeCaseAction(id);
    };
    const intakeComplete = !!pchHeadRes.data?.engine_snapshot_at;
    return (
      <>
        <PortalPageHeader
          eyebrow="PCH automated · in the queue"
          title={pchHeadRes.data?.cl_name ?? "New PCH case"}
          description={
            clientRes.data?.email
              ? `Client: ${clientRes.data.email}`
              : "Paid and waiting for an accountant to pick up."
          }
        />
        <div className="card-sl max-w-xl space-y-4 p-6 sm:p-8">
          <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[160px_1fr]">
            <dt className="text-slate">Tax year</dt>
            <dd className="font-medium text-ink">{pchHeadRes.data?.tax_year ?? "."}</dd>
            <dt className="text-slate">Submitted</dt>
            <dd className="font-medium text-ink">
              {caseRow.submitted_at ? formatDateTime(caseRow.submitted_at as string) : "."}
            </dd>
            <dt className="text-slate">Intake</dt>
            <dd className={intakeComplete ? "font-medium text-emerald-700" : "font-medium text-amber-700"}>
              {intakeComplete
                ? "Submitted for review (engine snapshot ready)"
                : "Still in progress (client hasn't clicked Submit for review yet)"}
            </dd>
          </dl>
          {!intakeComplete ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Not ready to take yet. The client has paid but hasn't
              clicked "Submit for review" on their intake, so this
              case isn't open for pickup. Check back once they've
              submitted; it will then show as available here and in the
              queue.
            </p>
          ) : approved.status !== "suspended" ? (
            <TakeCaseForm take={take} />
          ) : (
            <p className="text-sm text-slate">
              Your account is suspended. Taking new cases is locked until an
              admin reinstates you.
            </p>
          )}
        </div>
      </>
    );
  }

  // Case assigned to another accountant.
  if (caseRow.accountant_id !== me.id) {
    return (
      <>
        <PortalPageHeader
          eyebrow="PCH automated"
          title="This case isn't available"
          description="Another accountant has already picked this one up."
        />
        <div className="card-sl max-w-xl space-y-3 p-6 sm:p-8">
          <p className="text-sm text-slate">
            This case was in the queue when you last looked, but another
            accountant claimed it before you got here. Head back to the
            queue for the next one.
          </p>
          <Link href="/accountant?view=queue" className="btn-sl btn-sl-primary">
            Back to the queue
          </Link>
        </div>
      </>
    );
  }

  const [head, slotMeta, caseDocs, incomeLines, expenseLines, vehicleRes] = await Promise.all([
    admin
      .from("pch_cases")
      .select("cl_name, cl_dob, cl_address, cl_postcode, cl_utr, cl_nino, cl_phone, cl_email, pl_confirmed_at, pl_confirmed_by, sa_forwarding_pdf_path, pch_accounts_pdf_path, sa302_upload_path, sa100_upload_path, docs_sent_for_approval_at, client_approved_at, client_approved_signature_name, engine_snapshot")
      .eq("case_id", id)
      .single(),
    admin.from("pch_doc_slots").select("code, section, display_name"),
    admin.from("case_documents")
      .select("id, file_name, file_url, uploaded_at, requirement_key")
      .eq("case_id", id)
      .order("uploaded_at", { ascending: false }),
    admin.from("pch_income_lines")
      .select("id, source, gross_takings_pence, sort_order")
      .eq("case_id", id)
      .order("sort_order"),
    admin.from("pch_expense_lines")
      .select("id, label, amount_paid_pence, sort_order")
      .eq("case_id", id)
      .order("sort_order"),
    admin.from("pch_vehicle")
      .select("private_use_amount_pence")
      .eq("case_id", id)
      .maybeSingle(),
  ]);

  // Resolve the display name of the accountant who confirmed the P&L
  // (if confirmed) so the panel can show "Confirmed by X" instead of
  // a raw uuid. One-shot lookup; nothing else needs the users table.
  let plConfirmedByLabel: string | null = null;
  const plConfirmedBy = (head.data?.pl_confirmed_by as string | null) ?? null;
  if (plConfirmedBy) {
    const { data: u } = await admin
      .from("users")
      .select("full_name, email")
      .eq("id", plConfirmedBy)
      .maybeSingle();
    plConfirmedByLabel =
      (u?.full_name as string | null) ?? (u?.email as string | null) ?? null;
  }

  const { data: clientRow } = await admin
    .from("users").select("email").eq("id", caseRow.client_id).maybeSingle();

  const signDocUrl = async (path: string) => {
    "use server";
    return getDocSignedUrlForAccountant(id, path);
  };
  const updateCaseStatus = async (
    _caseId: string,
    next: "complete",
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    "use server";
    // Scoped to this case: ignore the caseId arg from the client, use
    // the server-trusted id captured in this closure.
    void _caseId;
    const r = await updateCaseStatusAction(id, next);
    if (r.ok) return { ok: true };
    return { ok: false, error: r.error };
  };

  const documents = (caseDocs.data ?? []).map((d) => ({
    id: d.id as string,
    file_name: d.file_name as string,
    file_url: d.file_url as string,
    uploaded_at: d.uploaded_at as string,
    requirement_key: (d.requirement_key as string | null) ?? null,
  }));
  const documentSlotMeta = (slotMeta.data ?? []).map((s) => ({
    code: s.code as string,
    section: s.section as string,
    displayName: s.display_name as string,
  }));

  const messages = await loadMessages(admin, id);
  const supportThread = await loadSupportThreadForCaseAndUser(id, me.id);

  return (
    <PchAccountantView
      caseId={id}
      caseStatus={caseRow.status}
      identity={{
        name: (head.data?.cl_name as string | null) ?? null,
        dob: (head.data?.cl_dob as string | null) ?? null,
        address: (head.data?.cl_address as string | null) ?? null,
        postcode: (head.data?.cl_postcode as string | null) ?? null,
        utr: (head.data?.cl_utr as string | null) ?? null,
        nino: (head.data?.cl_nino as string | null) ?? null,
        phone: (head.data?.cl_phone as string | null) ?? null,
        email: (head.data?.cl_email as string | null) ?? clientRow?.email ?? null,
      }}
      documents={documents}
      documentSlotMeta={documentSlotMeta}
      signDocUrl={signDocUrl}
      progress={{
        caseStatus: caseRow.status,
        plConfirmedAt: (head.data?.pl_confirmed_at as string | null) ?? null,
        saForwardingPdfPath:
          (head.data?.sa_forwarding_pdf_path as string | null) ?? null,
        pchAccountsPdfPath:
          (head.data?.pch_accounts_pdf_path as string | null) ?? null,
        sa302UploadPath: (head.data?.sa302_upload_path as string | null) ?? null,
        sa100UploadPath: (head.data?.sa100_upload_path as string | null) ?? null,
        docsSentForApprovalAt:
          (head.data?.docs_sent_for_approval_at as string | null) ?? null,
        clientApprovedAt:
          (head.data?.client_approved_at as string | null) ?? null,
      }}
      plIncomeLines={(incomeLines.data ?? []).map((l) => ({
        id: l.id as string,
        source: (l.source as string) ?? "",
        gross_takings_pence: Number(l.gross_takings_pence ?? 0),
      }))}
      plExpenseLines={(expenseLines.data ?? []).map((l) => ({
        id: l.id as string,
        label: (l.label as string) ?? "",
        amount_paid_pence: Number(l.amount_paid_pence ?? 0),
      }))}
      plSnapshot={(head.data?.engine_snapshot ?? null) as TaxEngineOutput | null}
      plPrivateUsePence={
        (vehicleRes.data?.private_use_amount_pence as number | null) ?? 0
      }
      plConfirmedAt={(head.data?.pl_confirmed_at as string | null) ?? null}
      plConfirmedByLabel={plConfirmedByLabel}
      clientApprovedAt={(head.data?.client_approved_at as string | null) ?? null}
      clientApprovedSignatureName={
        (head.data?.client_approved_signature_name as string | null) ?? null
      }
      updateCaseStatus={updateCaseStatus}
      messagesPanel={
        <CaseConversationsPanel
          caseId={id}
          caseMessages={messages}
          supportThread={supportThread}
          viewerRole="accountant"
          viewerUserId={me.id}
        />
      }
    />
  );
}

async function loadMessages(
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
  const { data: users } = await admin.from("users").select("id, email").in("id", authorIds);
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
