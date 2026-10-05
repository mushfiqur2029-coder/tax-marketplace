import Link from "next/link";
import { loadAccountantCase } from "@/lib/case-accountant";
import { createClient } from "@/lib/supabase/server";
import {
  takeCaseAction,
  updateCaseStatusAction,
  getDocSignedUrlForAccountant,
  requestPresetAddonAction,
  requestCustomAddonAction,
  setCasePeriodAction,
  clearCasePeriodAction,
  uploadAccountantDocumentAction,
  removeAccountantDocumentAction,
  prepareApprovalAction,
} from "@/app/accountant/actions";
import {
  sendMessageAction,
  uploadMessageAttachmentAction,
  getMessageAttachmentSignedUrl,
} from "@/app/messages";
import { DashboardShell } from "@/components/dashboard-shell";
import { Bell } from "@/components/bell";
import { AccountantSuspensionBanner } from "@/app/accountant/suspension-banner";
import { StatusPill } from "@/components/case/status-pill";
import { DeadlinePill } from "@/components/case/deadline-pill";
import { UrgentPill } from "@/components/case/urgent-pill";
import { ProgressBar } from "@/components/case/progress-bar";
import {
  MultiThreadChat,
  type ChatMessage,
  type ChatThread,
} from "@/components/case/multi-thread-chat";
import { TakeCaseForm } from "./take-case-form";
import { StatusTransition } from "./status-transition";
import { DocumentsList } from "./documents-list";
import { AddonPanel, type AddonRow, type CatalogOption } from "./addon-panel";
import {
  getEngagementAssetSignedUrl,
  revealCompanyAuthCodeAction,
} from "@/app/client/engagement-actions";
import { SignedEngagementPanel } from "@/components/engagement/signed-engagement-panel";
import { OnboardingAnswersPanel } from "@/components/engagement/onboarding-answers-panel";
import {
  sectionsForTier,
  fieldsForTier,
} from "@/lib/engagement/checklist";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TierId } from "@/lib/plans";
import {
  periodDocsApplyToTier,
  periodDocFieldsForCase,
  readNeedsPayeRegistration,
  SECTION_A_PAYE_UPLOAD_ID,
  ACCOUNTANT_ANNUAL_ACCOUNTS_KEY,
  ACCOUNTANT_CT600_KEY,
} from "@/lib/engagement/period-docs";
import { PeriodCard } from "./period-card";
import { PrepareApprovalCard } from "./prepare-approval-card";
import { PeriodDocsPanel } from "./period-docs-panel";
import {
  ACCOUNTANT_VAT_RETURN_DOC_KEY,
  VAT_CYCLE_UPLOAD_FIELDS,
  getVatFrequency,
} from "@/lib/vat/cycle";
import {
  openFirstVatCycleAction,
  editVatCycleDatesAction,
  uploadVatReturnDocAction,
  removeVatReturnDocAction,
  prepareVatApprovalAction,
} from "@/app/accountant/actions";
import { VatFirstCycleForm } from "./vat-first-cycle-form";
import { VatEditDatesForm } from "./vat-edit-dates-form";
import { PrepareVatApprovalCard } from "./prepare-vat-approval-card";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AccountantCaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const load = await loadAccountantCase(id);

  // If the case has been taken by a different accountant, render a
  // helpful explanation instead of a bare 404.
  if (load.kind === "taken") {
    return (
      <DashboardShell
        eyebrow={`${load.segment.title} · ${load.tier.title}`}
        title="Already taken"
        description="Another accountant picked this case up first."
        name={load.me.name}
        email={load.me.email}
        role={load.me.role}
        bell={<Bell userId={load.me.id} role={load.me.role} />}
      >
        <AccountantSuspensionBanner />
        <div className="card-sl max-w-xl p-6 sm:p-8">
          <p className="text-sm text-slate">
            This case was in the queue when you last looked, but another
            accountant claimed it before you got here. Head back to the
            queue for the next one.
          </p>
          <div className="mt-5">
            <Link
              href="/accountant?view=queue"
              className="btn-sl btn-sl-primary"
            >
              Back to the queue
            </Link>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const data = load;
  const seg = data.segment;
  const answers = (data.row.intake_answers ?? {}) as Record<string, string>;

  // Onboarding checklist (limited-company only, visible once the client
  // has submitted and this accountant has taken the case). We load the
  // tagged docs + check whether the encrypted auth code column is
  // populated so the panel can show a "Reveal" button vs "(not provided)".
  const isCompany = data.segment.id === "limited_company_vat";
  // Onboarding panel renders even when the client hasn't submitted yet,
  // so the accountant can see what the client has partially filled in
  // and help via chat. The panel header surfaces whether the checklist
  // has been submitted or is still in progress.
  const showOnboarding = isCompany && data.isMine;
  const onboardingInProgress =
    isCompany && !data.row.onboarding_submitted_at;
  type OnboardingDocRow = {
    id: string;
    file_name: string;
    file_url: string;
    uploaded_at: string;
    requirement_key: string | null;
  };
  let onboardingDocs: OnboardingDocRow[] = [];
  let onboardingAuthCodeAvailable = false;
  if (showOnboarding) {
    const adminClient = createAdminClient();
    const [{ data: docRows }, { data: cryptoRow }] = await Promise.all([
      adminClient
        .from("case_documents")
        .select("id, file_name, file_url, uploaded_at, requirement_key")
        .eq("case_id", id)
        .not("requirement_key", "is", null)
        .order("uploaded_at", { ascending: true }),
      adminClient
        .from("cases")
        .select("company_auth_code_encrypted")
        .eq("id", id)
        .single(),
    ]);
    onboardingDocs = (docRows ?? []) as OnboardingDocRow[];
    onboardingAuthCodeAvailable = !!cryptoRow?.company_auth_code_encrypted;
  }

  // Limited-company period + approval section data. Only the assigned
  // accountant on a non-dormant limited-company case gets these.
  type PeriodDocRow = {
    id: string;
    file_name: string;
    file_url: string;
    uploaded_at: string;
    requirement_key: string | null;
  };
  const needsPeriodDocs =
    isCompany && periodDocsApplyToTier(data.tier.id as TierId);
  const showPeriodSection =
    needsPeriodDocs && data.isMine && !!data.row.onboarding_submitted_at;
  const periodDocsByKey: Record<string, PeriodDocRow[]> = {};
  let periodFieldList: ReturnType<typeof periodDocFieldsForCase> = [];
  let payeInSectionA = false;
  let accountantAnnualAccounts: PeriodDocRow[] = [];
  let accountantCt600: PeriodDocRow[] = [];
  if (showPeriodSection) {
    const adminClient = createAdminClient();
    const { data: periodRows } = await adminClient
      .from("case_documents")
      .select("id, file_name, file_url, uploaded_at, requirement_key")
      .eq("case_id", id)
      .order("uploaded_at", { ascending: true });
    const rows = (periodRows ?? []) as PeriodDocRow[];
    payeInSectionA = rows.some(
      (d) => d.requirement_key === SECTION_A_PAYE_UPLOAD_ID,
    );
    periodFieldList = periodDocFieldsForCase({
      payrollRegistered: data.row.payroll_registered,
      payeCertificateUploadedInSectionA: payeInSectionA,
      needsPayeRegistration: readNeedsPayeRegistration(
        data.row.intake_answers as Record<string, string> | null,
      ),
    });
    for (const d of rows) {
      if (!d.requirement_key?.startsWith("period_")) continue;
      const arr = periodDocsByKey[d.requirement_key] ?? [];
      arr.push(d);
      periodDocsByKey[d.requirement_key] = arr;
    }
    accountantAnnualAccounts = rows.filter(
      (d) => d.requirement_key === ACCOUNTANT_ANNUAL_ACCOUNTS_KEY,
    );
    accountantCt600 = rows.filter(
      (d) => d.requirement_key === ACCOUNTANT_CT600_KEY,
    );
  }

  // VAT return cycles. Only the assigned accountant on a vat_reg
  // limited-company case past onboarding gets this section. Cycles are
  // loaded most-recent first; the current open cycle (if any) is
  // whichever is not 'filed'.
  type VatCycleRow = {
    id: string;
    cycle_number: number;
    period_label: string;
    cycle_start_date: string;
    cycle_end_date: string;
    cycle_hmrc_due_date: string;
    status:
      | "awaiting_client_docs"
      | "in_review"
      | "client_approval"
      | "filed";
    client_docs_submitted_at: string | null;
    filed_at: string | null;
  };
  const vatFrequency = getVatFrequency(
    (data.row.intake_answers ?? null) as Record<string, string> | null,
  );
  // VAT section renders even when vatFrequency is null (client picked
  // "I don't know" in Section D) — the first-cycle form prompts the
  // accountant to confirm the frequency alongside the first period
  // end date, and the server action persists it back.
  const showVatSection =
    isCompany &&
    data.tier.id === "vat_reg" &&
    data.isMine &&
    !!data.row.onboarding_submitted_at;
  let vatCycles: VatCycleRow[] = [];
  let currentVatCycle: VatCycleRow | null = null;
  let currentVatReturnDocs: {
    id: string;
    file_name: string;
    uploaded_at: string;
  }[] = [];
  if (showVatSection) {
    const adminClient = createAdminClient();
    const { data: cycleRows } = await adminClient
      .from("vat_return_cycles")
      .select(
        "id, cycle_number, period_label, cycle_start_date, cycle_end_date, cycle_hmrc_due_date, status, client_docs_submitted_at, filed_at",
      )
      .eq("case_id", id)
      .order("cycle_number", { ascending: false });
    vatCycles = (cycleRows ?? []) as VatCycleRow[];
    currentVatCycle =
      vatCycles.find((c) => c.status !== "filed") ?? null;

    if (currentVatCycle) {
      const { data: returnDocs } = await adminClient
        .from("case_documents")
        .select("id, file_name, uploaded_at")
        .eq("vat_cycle_id", currentVatCycle.id)
        .eq("requirement_key", ACCOUNTANT_VAT_RETURN_DOC_KEY)
        .order("uploaded_at", { ascending: true });
      currentVatReturnDocs = (returnDocs ?? []) as typeof currentVatReturnDocs;
    }
  }

  // Add-ons on this case + the active catalog for the request picker.
  // Loaded once whether or not the case is theirs; the panel is only
  // rendered when data.isMine below.
  let addons: AddonRow[] = [];
  let catalog: CatalogOption[] = [];
  if (data.isMine) {
    const supabase = await createClient();
    const [{ data: addonRows }, { data: catalogRows }] = await Promise.all([
      supabase
        .from("case_addons")
        .select(
          "id, kind, description, amount_pence, status, created_at, reviewed_at, review_note, paid_at",
        )
        .eq("case_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("addon_catalog")
        .select("key, name, description, amount_pence")
        .eq("active", true)
        .order("name", { ascending: true }),
    ]);
    addons = (addonRows ?? []) as AddonRow[];
    catalog = (catalogRows ?? []) as CatalogOption[];
  }

  // Chat threads (only available after taking): direct with client, support with admin.
  let threads: ChatThread[] = [];
  if (data.isMine) {
    const supabase = await createClient();
    const { data: msgs } = await supabase
      .from("messages")
      .select("id, case_id, channel, sender_id, body, attachments, attachment_path, attachment_name, attachment_type, created_at")
      .eq("case_id", id)
      .in("channel", ["client_accountant", "accountant_admin"])
      .order("created_at", { ascending: true });
    const all = (msgs ?? []) as ChatMessage[];
    // On the direct thread the accountant may see their client and admin.
    // Explicitly labelling the client makes any other sender fall through to
    // the "Admin" fallback.
    const directLabels: Record<string, string> = {
      [data.row.client_id]: "Client",
    };
    threads = [
      {
        channel: "client_accountant",
        label: data.clientEmail?.split("@")[0] ?? "Client",
        senderLabels: directLabels,
        fallbackSenderLabel: "Admin",
        initial: all.filter((m) => m.channel === "client_accountant"),
      },
      {
        channel: "accountant_admin",
        label: "Support",
        senderLabels: {},
        fallbackSenderLabel: "Admin",
        initial: all.filter((m) => m.channel === "accountant_admin"),
      },
    ];
  }

  const take = async () => {
    "use server";
    return takeCaseAction(id);
  };
  const advance = async (next: string) => {
    "use server";
    return updateCaseStatusAction(id, next);
  };
  const signDocUrl = async (path: string) => {
    "use server";
    return getDocSignedUrlForAccountant(id, path);
  };
  const send = async (input: Parameters<typeof sendMessageAction>[0]) => {
    "use server";
    return sendMessageAction(input);
  };
  const uploadAttachment = async (caseId: string, fd: FormData) => {
    "use server";
    return uploadMessageAttachmentAction(caseId, fd);
  };
  const getAttachmentUrl = async (path: string) => {
    "use server";
    return getMessageAttachmentSignedUrl(path);
  };
  const requestPreset = async (presetKey: string) => {
    "use server";
    return requestPresetAddonAction(id, presetKey);
  };
  const requestCustom = async (input: {
    description: string;
    amountPence: number;
  }) => {
    "use server";
    return requestCustomAddonAction({ caseId: id, ...input });
  };
  const getEngagementPdf = async () => {
    "use server";
    return getEngagementAssetSignedUrl(id, "pdf");
  };
  const getEngagementSignature = async () => {
    "use server";
    return getEngagementAssetSignedUrl(id, "signature");
  };
  const getOnboardingDocUrl = async (path: string) => {
    "use server";
    return getDocSignedUrlForAccountant(id, path);
  };
  const revealAuthCode = async () => {
    "use server";
    return revealCompanyAuthCodeAction(id);
  };
  const setPeriod = async (input: {
    periodStart: string;
    periodEnd: string;
    payrollRegistered: boolean;
  }) => {
    "use server";
    return setCasePeriodAction(id, input);
  };
  const clearPeriod = async () => {
    "use server";
    return clearCasePeriodAction(id);
  };
  const uploadAccountantDoc = async (
    requirementKey: string,
    fd: FormData,
  ) => {
    "use server";
    return uploadAccountantDocumentAction(id, requirementKey, fd);
  };
  const removeAccountantDoc = async (docId: string) => {
    "use server";
    return removeAccountantDocumentAction(id, docId);
  };
  const prepareApproval = async (input: {
    ctLiabilityPence: number;
    hmrcPaymentReference: string;
    note: string;
  }) => {
    "use server";
    return prepareApprovalAction(id, input);
  };
  const openFirstVatCycle = async (
    input: Parameters<typeof openFirstVatCycleAction>[1],
  ) => {
    "use server";
    return openFirstVatCycleAction(id, input);
  };
  const editVatCycleDates = async (
    cycleId: string,
    input: { periodStart: string; periodEnd: string },
  ) => {
    "use server";
    return editVatCycleDatesAction(cycleId, input);
  };
  const uploadVatReturnDoc = async (cycleId: string, fd: FormData) => {
    "use server";
    return uploadVatReturnDocAction(cycleId, fd);
  };
  const removeVatReturnDoc = async (cycleId: string, docId: string) => {
    "use server";
    return removeVatReturnDocAction(cycleId, docId);
  };
  const prepareVatApproval = async (
    cycleId: string,
    input: Parameters<typeof prepareVatApprovalAction>[1],
  ) => {
    "use server";
    return prepareVatApprovalAction(cycleId, input);
  };

  return (
    <DashboardShell
      eyebrow={`${data.segment.title} · ${data.tier.title}`}
      title={data.isMine ? "Case dashboard" : "New case in the queue"}
      description={
        data.isMine
          ? `Client: ${data.clientEmail ?? "."}`
          : "Review the intake and take this case to see documents and start chat."
      }
      name={data.me.name}
      email={data.me.email}
      role={data.me.role}
      bell={<Bell userId={data.me.id} role={data.me.role} />}
    >
      <AccountantSuspensionBanner />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusPill status={data.row.status} />
        {data.row.is_urgent ? <UrgentPill /> : null}
        {data.row.deadline ? <DeadlinePill deadline={data.row.deadline} /> : null}
        {data.canTake && data.me.status !== "suspended" ? (
          <TakeCaseForm take={take} />
        ) : null}
      </div>

      {data.isMine ? (
        <div className="mb-6">
          <ProgressBar status={data.row.status} />
        </div>
      ) : null}

      {/* Case detail: two-column at xl+ where there's genuine room for a
          side chat panel. Below xl (which covers phones, tablets, and
          even typical laptops at 1024-1280px wide) the chat and
          main-content columns stack full-width — chat used to drop to
          ~400px at 1024 which was unusable, and the lg breakpoint fired
          too eagerly for a side-column layout. */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          {data.row.engagement_signed_at ? (
            <section className="card-sl p-6 sm:p-8">
              <h3
                className="text-sm font-semibold uppercase tracking-wider text-slate"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Engagement letter
              </h3>
              <div className="mt-4">
                <SignedEngagementPanel
                  signedAt={data.row.engagement_signed_at}
                  getPdfUrl={getEngagementPdf}
                  getSignatureUrl={getEngagementSignature}
                />
              </div>
            </section>
          ) : null}

          {showOnboarding ? (
            <section className="card-sl p-6 sm:p-8">
              <h3
                className="text-sm font-semibold uppercase tracking-wider text-slate"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Onboarding checklist
              </h3>
              {onboardingInProgress ? (
                <p
                  className="mt-2 rounded-lg px-3 py-2 text-xs font-medium"
                  style={{
                    background: "rgba(217, 159, 25, 0.14)",
                    color: "#B57E12",
                  }}
                >
                  Onboarding is still in progress — the client hasn&apos;t
                  submitted the checklist yet. What you see below is
                  partial. Reach out via chat if they look stuck.
                </p>
              ) : null}
              <div className="mt-4">
                <OnboardingAnswersPanel
                  sections={sectionsForTier(data.tier.id as TierId)}
                  fields={fieldsForTier(data.tier.id as TierId)}
                  answers={answers}
                  docs={onboardingDocs}
                  authCodeAvailable={onboardingAuthCodeAvailable}
                  getDocUrl={getOnboardingDocUrl}
                  revealAuthCode={revealAuthCode}
                />
              </div>
            </section>
          ) : null}

          {showPeriodSection ? (
            <section className="card-sl p-6 sm:p-8">
              <h3
                className="text-sm font-semibold uppercase tracking-wider text-slate"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Accounting period
              </h3>
              <p className="mt-1 text-xs text-slate">
                Enter the trading period. Saving notifies the client and
                opens their second-stage upload page.
              </p>
              <div className="mt-4">
                <PeriodCard
                  periodStart={data.row.period_start_date}
                  periodEnd={data.row.period_end_date}
                  payrollRegistered={data.row.payroll_registered}
                  periodDocsSubmittedAt={data.row.period_docs_submitted_at}
                  setPeriod={setPeriod}
                  clearPeriod={clearPeriod}
                />
              </div>
            </section>
          ) : null}

          {showPeriodSection &&
          data.row.period_start_date &&
          data.row.period_end_date ? (
            <section className="card-sl p-6 sm:p-8">
              <h3
                className="text-sm font-semibold uppercase tracking-wider text-slate"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Period documents
              </h3>
              <div className="mt-4">
                <PeriodDocsPanel
                  tierId={data.tier.id as TierId}
                  fields={periodFieldList}
                  docsByKey={periodDocsByKey}
                  submittedAt={data.row.period_docs_submitted_at}
                  getDocUrl={signDocUrl}
                />
              </div>
            </section>
          ) : null}

          {showPeriodSection &&
          data.row.status === "in_review" &&
          data.me.status !== "suspended" ? (
            <section className="card-sl p-6 sm:p-8">
              <h3
                className="text-sm font-semibold uppercase tracking-wider text-slate"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Prepare client approval
              </h3>
              <p className="mt-1 text-xs text-slate">
                Upload the Annual Accounts and CT600, enter the CT
                liability, then send. The client sees the approval screen
                with these files and this payment reference.
              </p>
              <div className="mt-4">
                <PrepareApprovalCard
                  initialAnnualAccounts={accountantAnnualAccounts.map(
                    (d) => ({
                      id: d.id,
                      file_name: d.file_name,
                      uploaded_at: d.uploaded_at,
                    }),
                  )}
                  initialCt600={accountantCt600.map((d) => ({
                    id: d.id,
                    file_name: d.file_name,
                    uploaded_at: d.uploaded_at,
                  }))}
                  annualAccountsKey={ACCOUNTANT_ANNUAL_ACCOUNTS_KEY}
                  ct600Key={ACCOUNTANT_CT600_KEY}
                  uploadDoc={uploadAccountantDoc}
                  removeDoc={removeAccountantDoc}
                  prepare={prepareApproval}
                />
              </div>
            </section>
          ) : null}

          {showVatSection ? (
            <section className="card-sl p-6 sm:p-8">
              <h3
                className="text-sm font-semibold uppercase tracking-wider text-slate"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                VAT returns
              </h3>
              <p className="mt-1 text-xs text-slate">
                Section D frequency:{" "}
                <b>{vatFrequency ?? "not confirmed by client"}</b>. The
                system opens each new cycle automatically once the
                previous one is filed.
              </p>

              {vatCycles.length === 0 ? (
                <div className="mt-4">
                  <VatFirstCycleForm
                    frequency={vatFrequency}
                    openFirstCycle={openFirstVatCycle}
                  />
                </div>
              ) : (
                <>
                  <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-paper">
                    {vatCycles.map((c) => (
                      <li
                        key={c.id}
                        className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-ink">
                            {c.period_label}
                          </div>
                          <div className="text-xs text-slate">
                            {c.cycle_start_date} → {c.cycle_end_date} ·
                            Due {c.cycle_hmrc_due_date}
                            {c.filed_at ? (
                              <> · Filed {formatDateTime(c.filed_at)}</>
                            ) : null}
                          </div>
                        </div>
                        <div className="sm:shrink-0">
                          <span
                            className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
                            style={{
                              background:
                                c.status === "filed"
                                  ? "rgba(19,217,160,0.14)"
                                  : c.status === "client_approval"
                                    ? "rgba(79,141,255,0.14)"
                                    : c.status === "in_review"
                                      ? "rgba(25,156,217,0.14)"
                                      : "rgba(217,159,25,0.14)",
                              color:
                                c.status === "filed"
                                  ? "#0E9E77"
                                  : c.status === "client_approval"
                                    ? "#1E3A8A"
                                    : c.status === "in_review"
                                      ? "var(--sky)"
                                      : "#B57E12",
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {c.status.replace(/_/g, " ")}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>

                  {currentVatCycle ? (
                    <div className="mt-4 rounded-xl border border-line bg-paper p-4">
                      <div className="flex items-center justify-between">
                        <h4
                          className="text-[11px] font-semibold uppercase tracking-wider text-slate"
                          style={{ fontFamily: "var(--font-mono)" }}
                        >
                          Current cycle · {currentVatCycle.period_label}
                        </h4>
                        <VatEditDatesForm
                          cycleId={currentVatCycle.id}
                          initialStart={currentVatCycle.cycle_start_date}
                          initialEnd={currentVatCycle.cycle_end_date}
                          disabled={
                            data.me.status === "suspended" ||
                            currentVatCycle.status === "client_approval"
                          }
                          editDates={editVatCycleDates}
                        />
                      </div>

                      {currentVatCycle.status === "in_review" &&
                      data.me.status !== "suspended" ? (
                        <div className="mt-4">
                          <PrepareVatApprovalCard
                            cycleId={currentVatCycle.id}
                            initialReturnDocs={currentVatReturnDocs}
                            uploadReturnDoc={uploadVatReturnDoc}
                            removeReturnDoc={removeVatReturnDoc}
                            prepare={prepareVatApproval}
                          />
                        </div>
                      ) : currentVatCycle.status ===
                        "awaiting_client_docs" ? (
                        <p className="mt-3 text-xs text-slate">
                          Waiting on the client to upload bank statement
                          and sales records for this period.
                        </p>
                      ) : currentVatCycle.status === "client_approval" ? (
                        <p className="mt-3 text-xs text-slate">
                          Sent to the client. They&apos;ll approve + file
                          from their case page; the next cycle opens
                          automatically.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}

              {/* Reference: show the per-cycle required slots so the
                  accountant knows what the client is expected to
                  upload. */}
              <details className="mt-4 text-xs text-slate">
                <summary className="cursor-pointer font-semibold">
                  Required docs per cycle
                </summary>
                <ul className="mt-2 list-disc space-y-0.5 pl-5">
                  {VAT_CYCLE_UPLOAD_FIELDS.map((f) => (
                    <li key={f.id}>
                      {f.label}{" "}
                      {["vat_bank_statement_pdf", "vat_sales_invoices"].includes(
                        f.id,
                      )
                        ? "(required)"
                        : "(optional)"}
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          ) : null}

          {/* Legacy intake answers card — only renders for personal-flow
              cases. Limited-company answers live in the Onboarding
              checklist card above instead, structured by section. */}
          {!isCompany ? (
            <section className="card-sl p-6 sm:p-8">
              <h3
                className="text-sm font-semibold uppercase tracking-wider text-slate"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Intake answers
              </h3>
            <dl className="mt-4 divide-y divide-line">
              {seg.intake.map((f) => {
                const val = answers[f.name];
                return (
                  <div key={f.name} className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[220px_1fr] sm:gap-4">
                    <dt className="text-xs font-semibold uppercase tracking-wider text-slate" style={{ fontFamily: "var(--font-mono)" }}>
                      {f.label}
                    </dt>
                    <dd className="text-sm text-ink">
                      {val
                        ? f.prefix
                          ? `${f.prefix}${val}`
                          : val
                        : <span className="text-slate italic">(not answered)</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
          ) : null}

          {data.isMine ? (
            <section className="card-sl p-6 sm:p-8">
              <h3
                className="text-sm font-semibold uppercase tracking-wider text-slate"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Documents ({data.docs.length})
              </h3>
              <div className="mt-3">
                <DocumentsList docs={data.docs} signUrl={signDocUrl} />
              </div>
            </section>
          ) : null}

          {data.isMine ? (
            <section className="card-sl p-6 sm:p-8">
              <h3
                className="text-sm font-semibold uppercase tracking-wider text-slate"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Add-ons ({addons.length})
              </h3>
              <p className="mt-1 text-xs text-slate">
                Charge for extra work mid-case. Preset services go straight to
                the client for payment; anything custom needs admin approval
                first.
              </p>
              <div className="mt-4">
                <AddonPanel
                  addons={addons}
                  catalog={catalog}
                  requestPreset={requestPreset}
                  requestCustom={requestCustom}
                  disabled={
                    data.row.status === "complete" ||
                    data.me.status === "suspended"
                  }
                  disabledReason={
                    data.me.status === "suspended"
                      ? "Your account is suspended — add-on requests are locked until reinstated."
                      : "Case is complete — no more add-ons."
                  }
                />
              </div>
            </section>
          ) : null}

          {data.isMine &&
          !(
            showPeriodSection && data.row.status === "in_review"
          ) ? (
            <section className="card-sl p-6 sm:p-8">
              <h3
                className="text-sm font-semibold uppercase tracking-wider text-slate"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Progress
              </h3>
              {data.me.status === "suspended" ? (
                <p className="text-sm text-slate">
                  Account suspended — status advances are locked until an
                  admin reinstates you.
                </p>
              ) : (
                <StatusTransition
                  current={data.row.status}
                  advance={advance}
                  variant={showPeriodSection ? "limited_company" : "personal"}
                />
              )}
            </section>
          ) : null}
        </div>

        <aside className="card-sl p-4 sm:p-6">
          <span className="eyebrow">Chat</span>
          <p className="mt-2 text-xs text-slate">
            {data.isMine
              ? "Message your client, or contact Sterling Ledger support."
              : "Available after you take the case."}
          </p>
          <div className="mt-3">
            {data.isMine ? (
              <MultiThreadChat
                caseId={id}
                meId={data.me.id}
                threads={threads}
                send={send}
                uploadAttachment={uploadAttachment}
                getAttachmentUrl={getAttachmentUrl}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-slate">
                Take the case first to open the chat and see documents.
              </div>
            )}
          </div>
        </aside>
      </div>

      <div className="mt-8">
        <Link href="/accountant" className="text-sm font-semibold text-navy-deep underline underline-offset-4 hover:text-sky">
          ← Back to queue
        </Link>
      </div>
    </DashboardShell>
  );
}
