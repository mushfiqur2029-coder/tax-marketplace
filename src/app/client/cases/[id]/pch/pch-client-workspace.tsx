"use client";

import type { TaxEngineOutput } from "@/lib/tax-engine";
import type { ActionResult } from "@/lib/action-result";
import { useLiveRow, useLiveList } from "@/lib/realtime-live-merge";
import { approvePchFinalDocsAction } from "@/app/client/pch/actions";
import { useState, useTransition } from "react";
import { startAddonCheckoutAction } from "@/app/client/actions";
import { AddonPayBanner } from "../addon-pay-banner";
import { FinalPackReview } from "./final-pack-review";
import { IntakeMethodChoice } from "./intake-method-choice";
import { BulkDocumentUpload } from "./bulk-document-upload";
import type { BulkIntakeUploadView } from "@/app/client/pch/bulk-intake-actions";
import {
  EXPENSE_FIXED_SLOTS,
  INCOME_FIXED_SLOTS,
} from "@/lib/pch/intake-slots";
import { PriorYearPrompt, type PriorYearOption } from "./prior-year-prompt";
import { Section1Identity, type Section1InitialHead } from "./section-1-identity";
import { Section2Income, type IncomeLine } from "./section-2-income";
import { Section3Expenses, type ExpenseLine } from "./section-3-expenses";
import { Section4Vehicle, type VehicleInitial } from "./section-3-vehicle";
import {
  Section4to14Declarations,
  type DeclarationsInitial,
  type GiftAidEntry,
} from "./section-4-14-declarations";
import { Section15LastYearSA, type Section15Initial } from "./section-15-last-year-sa";
import { SectionGeneralUploads, type GeneralUpload } from "./section-general-uploads";
import { IntakeProgress, INTAKE_PROGRESS_ANCHOR_ID } from "./intake-progress";
import {
  IntakeProgressProvider,
  useIntakeProgress,
} from "./intake-progress-context";
import {
  INTAKE_SECTION_LABELS,
  areDeclarationsComplete,
  isExpensesComplete,
  isIdentityComplete,
  isIncomeComplete,
  isSection15Complete,
  isVehicleComplete,
  type IntakeCompletion,
} from "./intake-completion";
import { submitForReviewAction } from "@/app/client/pch/actions";
import { markLocalMutation } from "@/lib/realtime-self-mutation";

// Status-aware workspace for the automated PCH flow.
//
//   submitted     -> editable intake (sections 1-15, landing across
//                    phases B-D of the rebuild) + "Submit for accountant
//                    review" button at the bottom.
//   in_review /   -> intake visible read-only, with a "Your accountant
//     prepared       is reviewing" panel. No figures.
//   client_approval -> figures + Approve button. First time the client
//                    sees any number.
//   filed /       -> final figures + confirmation banner.
//     complete
//
// Phase A ships the shell: status-switch modes, approval view, final-
// pack review, filed view, live-merges, the addon pay banner and the
// prior-year prompt all work. The intake surface itself (sections
// 1-15) is a placeholder; it comes online in phases B-D under the
// migration 0113 schema. All mutating actions re-check status
// server-side; the UI changes here are UX-first, not the security
// boundary.

type Head = Record<string, string | number | boolean | null>;

type Section1LicenceDoc = {
  id: string;
  file_name: string;
  uploaded_at: string;
  photo_id_side: "front" | "back" | null;
};
type Section1Pch24Extraction = {
  id: string;
  status: string;
  photo_id_side: "front" | "back" | null;
  applied_at: string | null;
};

export function PchClientWorkspace(props: {
  caseId: string;
  caseStatus: string;
  head: Head | null;
  pendingAddons: Array<{ id: string; description: string; amount_pence: number }>;
  priorYearOptions: PriorYearOption[];
  finalPackSentAt: string | null;
  finalPackConfirmedAt: string | null;
  finalPackConfirmedName: string | null;
  // Migration 0119: real "client has handed off" lock, independent of
  // cases.status. Null = still editable; a timestamp = locked, every
  // intake-mutating server action refuses.
  intakeSubmittedAt: string | null;
  // Migration 0123: how the client chose to enter their income /
  // expenses. Null = hasn't picked yet; "manual" = typed fixed-slot
  // entry; "auto_upload" = AI-extraction flow (Phase B, not yet
  // reachable). Live-synced so the choice screen unmounts the moment
  // setIntakeMethodAction writes the column.
  intakeMethod: "manual" | "auto_upload" | null;
  engineSnapshot: TaxEngineOutput | null;
  engineSnapshotAt: string | null;
  // Figures-approval columns from the old Slice-7 flow. Still read so
  // historical cases that passed through recordClientApprovalAction
  // keep rendering sensibly, but new approvals go through
  // approvePchFinalDocsAction (below) and write client_approved_at /
  // client_approved_signature_name instead; that pair is what the
  // accountant and admin portals also key off, so the three sides
  // can stay in step on one live column.
  approvalAt: string | null;
  approvalName: string | null;
  approvedAt: string | null;
  approvedSignatureName: string | null;
  // Final document pack generated / uploaded by the accountant on
  // final-docs-actions.ts. By the time this workspace enters an
  // approval or filed view, sendForClientConfirmationAction has
  // already refused to flip the status unless all four paths are
  // set, so these are expected non-null here - the FinalDocsSection
  // below still guards per-path, but as a safety net not an
  // expected state.
  saForwardingPdfPath: string | null;
  pchAccountsPdfPath: string | null;
  sa302UploadPath: string | null;
  sa100UploadPath: string | null;
  signDocUrl: (path: string) => Promise<ActionResult<string>>;
  section1Initial: Section1InitialHead;
  licenceDocs: Section1LicenceDoc[];
  pch24Extractions: Section1Pch24Extraction[];
  incomeLines: IncomeLine[];
  expenseLines: ExpenseLine[];
  bulkIntakeUploads: BulkIntakeUploadView[];
  intakeAttachments: Record<string, Array<{ docId: string; fileName: string }>>;
  vehicleInitial: VehicleInitial;
  privateUseAttachments: Array<{ docId: string; fileName: string }>;
  caseFeePence: number;
  declarationsInitial: DeclarationsInitial;
  giftAidEntries: GiftAidEntry[];
  section15Initial: Section15Initial;
  generalUploads: GeneralUpload[];
  messagesPanel: React.ReactNode;
}) {
  // Live-tracked state so the whole workspace stays current without
  // ever rendering the generic "new updates" banner. Covers:
  //   - cases.status: workspace swaps modes (submitted / in_review /
  //     client_approval / filed) the instant the row flips.
  //   - pch_cases head: the fields the accountant can flip from their
  //     side (final_pack_sent_at, final_pack_confirmed_at + name,
  //     approval_at + name) which gate the "final pack" and "approve"
  //     UI below.
  //   - case_addons: a new addon raised by the accountant surfaces a
  //     Pay banner at the top of the workspace.
  const status = useLiveRow(props.caseStatus, {
    table: "cases",
    filter: `id=eq.${props.caseId}`,
    channel: `client-workspace-status-${props.caseId}`,
    map: (row, prev) => {
      const s = row.status;
      return typeof s === "string" && s.length > 0 ? s : prev;
    },
  });

  type LiveHead = {
    final_pack_sent_at: string | null;
    final_pack_confirmed_at: string | null;
    final_pack_confirmed_name: string | null;
    client_approval_at: string | null;
    client_approval_name: string | null;
    // Phase I "real approval" columns. These are what the new
    // approvePchFinalDocsAction writes and what flipClientApprovalToFiled
    // then reads to move cases.status -> "filed". The accountant and
    // admin portals subscribe to the same two columns, so adding them
    // here is what lets all three sides agree live.
    client_approved_at: string | null;
    client_approved_signature_name: string | null;
    intake_submitted_at: string | null;
    intake_method: "manual" | "auto_upload" | null;
  };
  const initialHead: LiveHead = {
    final_pack_sent_at: props.finalPackSentAt,
    final_pack_confirmed_at: props.finalPackConfirmedAt,
    final_pack_confirmed_name: props.finalPackConfirmedName,
    client_approval_at: props.approvalAt,
    client_approval_name: props.approvalName,
    client_approved_at: props.approvedAt,
    client_approved_signature_name: props.approvedSignatureName,
    intake_submitted_at: props.intakeSubmittedAt,
    intake_method: props.intakeMethod,
  };
  const liveHead = useLiveRow<LiveHead>(initialHead, {
    table: "pch_cases",
    filter: `case_id=eq.${props.caseId}`,
    channel: `client-workspace-head-${props.caseId}`,
    map: (row, prev) => ({
      final_pack_sent_at:
        row.final_pack_sent_at === undefined
          ? prev.final_pack_sent_at
          : (row.final_pack_sent_at as string | null),
      final_pack_confirmed_at:
        row.final_pack_confirmed_at === undefined
          ? prev.final_pack_confirmed_at
          : (row.final_pack_confirmed_at as string | null),
      final_pack_confirmed_name:
        row.final_pack_confirmed_name === undefined
          ? prev.final_pack_confirmed_name
          : (row.final_pack_confirmed_name as string | null),
      client_approval_at:
        row.client_approval_at === undefined
          ? prev.client_approval_at
          : (row.client_approval_at as string | null),
      client_approval_name:
        row.client_approval_name === undefined
          ? prev.client_approval_name
          : (row.client_approval_name as string | null),
      client_approved_at:
        row.client_approved_at === undefined
          ? prev.client_approved_at
          : (row.client_approved_at as string | null),
      client_approved_signature_name:
        row.client_approved_signature_name === undefined
          ? prev.client_approved_signature_name
          : (row.client_approved_signature_name as string | null),
      intake_submitted_at:
        row.intake_submitted_at === undefined
          ? prev.intake_submitted_at
          : (row.intake_submitted_at as string | null),
      intake_method:
        row.intake_method === undefined
          ? prev.intake_method
          : (row.intake_method as "manual" | "auto_upload" | null),
    }),
  });

  // IntakeMethodChoice's write to pch_cases is wrapped in
  // markLocalMutation() to suppress the generic RealtimeRefresh
  // "someone else changed this" banner, but that same marker makes
  // the useLiveRow above actively IGNORE the realtime echo of the
  // viewer's own write. So after a successful pick(), liveHead.
  // intake_method never flips from null to the new value and the
  // choice component never unmounts.
  //
  // Fix is local to this component: track the pick in local state
  // and prefer it over liveHead for the branch decision below.
  // Server-rendered first paint still comes from liveHead (seeded
  // off props.intakeMethod, which is the authoritative server read),
  // so refreshes / new tabs / cross-tab live sync all still work.
  // Only the single-session self-write transition relies on this
  // override. The underlying useLiveRow / markLocalMutation
  // contract stays unchanged (it's correct for the banner-
  // suppression use case every other caller in this app relies on).
  const [localIntakeMethod, setLocalIntakeMethod] = useState<
    "manual" | "auto_upload" | null
  >(null);
  const effectiveIntakeMethod = localIntakeMethod ?? liveHead.intake_method;

  type LiveAddon = { id: string; description: string; amount_pence: number; status: string };
  const liveAddonsAll = useLiveList<LiveAddon>(
    props.pendingAddons.map((a) => ({ ...a, status: "pending_payment" })),
    {
      table: "case_addons",
      filter: `case_id=eq.${props.caseId}`,
      channel: `client-workspace-addons-${props.caseId}`,
      map: (row) => {
        const id = row.id;
        const description = row.description;
        const amount_pence = row.amount_pence;
        const addonStatus = row.status;
        if (
          typeof id !== "string" || typeof description !== "string"
          || typeof amount_pence !== "number" || typeof addonStatus !== "string"
        ) return null;
        return { id, description, amount_pence, status: addonStatus };
      },
    },
  );
  const liveAddons = liveAddonsAll.filter((a) => a.status === "pending_payment");

  // Migration 0119: the real "client can still edit?" test is whether
  // intake_submitted_at is null. The server guards
  // (requirePchIntakeEditable / assertEditableByClient) accept writes
  // whenever cases.status is in {submitted, in_review, prepared} AND
  // intake_submitted_at is null, so the UI must mirror that exact set
  // or the accountant's Re-open button can clear the DB flag while
  // the form stays visually disabled (status is already in_review by
  // the time an accountant is typically prompted to re-open).
  const intakeSubmittedAt = liveHead.intake_submitted_at;
  const inIntakeStatus =
    status === "submitted" || status === "in_review" || status === "prepared";
  const editable = inIntakeStatus && !intakeSubmittedAt;
  // Lock banner shows only inside the intake flow when the lock flag
  // is actually set. Mirrors `editable` so a Re-open hides the banner
  // AND re-enables the form in the same render pass.
  const locked = inIntakeStatus && !!intakeSubmittedAt;
  const awaitingApproval = status === "client_approval";
  const filed = status === "filed" || status === "complete";

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Uber / private-hire drivers return</h1>
        <p className="text-sm text-slate-600 mt-1">
          Case {props.caseId.slice(0, 8)}. Status <strong>{status}</strong>.
        </p>
      </div>

      {awaitingApproval && props.engineSnapshot && !liveHead.client_approval_at ? (
        <ApprovalView
          caseId={props.caseId}
          snapshot={props.engineSnapshot}
          snapshotAt={props.engineSnapshotAt}
          approvalAt={liveHead.client_approval_at}
          approvalName={liveHead.client_approval_name}
          saForwardingPdfPath={props.saForwardingPdfPath}
          pchAccountsPdfPath={props.pchAccountsPdfPath}
          sa302UploadPath={props.sa302UploadPath}
          sa100UploadPath={props.sa100UploadPath}
          signDocUrl={props.signDocUrl}
        />
      ) : awaitingApproval && liveHead.final_pack_sent_at ? (
        <FinalPackReview
          caseId={props.caseId}
          sentAt={liveHead.final_pack_sent_at}
          confirmedAt={liveHead.final_pack_confirmed_at}
          confirmedName={liveHead.final_pack_confirmed_name}
          prefillName={(props.head?.cl_name as string | undefined) ?? liveHead.client_approval_name ?? ""}
        />
      ) : awaitingApproval && liveHead.client_approval_at ? (
        <section className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
          <div
            className="text-[11px] font-semibold uppercase tracking-widest text-slate-700"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Awaiting final pack from your accountant
          </div>
          <h2 className="mt-1 text-base font-semibold text-ink">
            Figures approved on {new Date(liveHead.client_approval_at).toLocaleString("en-GB")}
          </h2>
          <p className="mt-1 text-xs text-slate-700">
            Your accountant is preparing the final accounts pack. You'll be prompted to review and confirm it here once it's ready.
          </p>
        </section>
      ) : filed && props.engineSnapshot ? (
        <FiledView
          snapshot={props.engineSnapshot}
          approvalAt={liveHead.client_approved_at}
          approvalName={liveHead.client_approved_signature_name}
          saForwardingPdfPath={props.saForwardingPdfPath}
          pchAccountsPdfPath={props.pchAccountsPdfPath}
          sa302UploadPath={props.sa302UploadPath}
          sa100UploadPath={props.sa100UploadPath}
          signDocUrl={props.signDocUrl}
        />
      ) : (
        <IntakeProgressProvider initial={initialCompletionFromProps(props)}>
          {locked ? <WithAccountantBanner /> : null}

          {liveAddons.length > 0
            ? liveAddons.map((a) => (
                <AddonPayBanner
                  key={a.id}
                  addonId={a.id}
                  amountPence={a.amount_pence}
                  description={a.description}
                  startCheckout={startAddonCheckoutAction}
                />
              ))
            : null}

          {props.priorYearOptions.length > 0 ? (
            <PriorYearPrompt
              parentCaseId={props.caseId}
              years={props.priorYearOptions}
              editable={editable}
            />
          ) : null}

          <IntakeProgress />

          <Section1Identity
            caseId={props.caseId}
            editable={editable}
            initial={props.section1Initial}
            licenceDocs={props.licenceDocs}
            pch24Extractions={props.pch24Extractions}
          />

          {/*
            Phase A: the client picks between typing their figures in
            or uploading documents for AI extraction. Null intake_method
            means they haven't picked yet, so show the choice screen
            and hide income/expenses/vehicle until they do - that keeps
            the two flows from clashing visually. Every pre-existing
            case was backfilled to 'manual' by migration 0123, so they
            fall straight through to Section2Income without ever seeing
            the choice screen (preserving today's behaviour). Only new
            cases created after migration 0123 land here with
            intake_method = null and see the picker.
          */}
          {effectiveIntakeMethod === null ? (
            <IntakeMethodChoice
              caseId={props.caseId}
              onPicked={(method) => setLocalIntakeMethod(method)}
            />
          ) : effectiveIntakeMethod === "auto_upload" ? (
            <AutoUploadIntakeFlow
              caseId={props.caseId}
              editable={editable}
              incomeLines={props.incomeLines}
              expenseLines={props.expenseLines}
              intakeAttachments={props.intakeAttachments}
              caseFeePence={props.caseFeePence}
              vehicleInitial={props.vehicleInitial}
              privateUseAttachments={props.privateUseAttachments}
              bulkIntakeUploads={props.bulkIntakeUploads}
            />
          ) : (
            <>
              <Section2Income
                caseId={props.caseId}
                editable={editable}
                initial={props.incomeLines}
                attachmentsByLineId={props.intakeAttachments}
              />

              <Section3Expenses
                caseId={props.caseId}
                editable={editable}
                initial={props.expenseLines}
                caseFeePence={props.caseFeePence}
                attachmentsByLineId={props.intakeAttachments}
                privateUseInitialPence={props.vehicleInitial.private_use_amount_pence ?? 0}
                privateUseAttachments={props.privateUseAttachments}
              />
            </>
          )}

          <Section4Vehicle
            caseId={props.caseId}
            editable={editable}
            initial={props.vehicleInitial}
          />

          <Section4to14Declarations
            caseId={props.caseId}
            editable={editable}
            initial={props.declarationsInitial}
            giftAidEntries={props.giftAidEntries}
          />

          <Section15LastYearSA
            caseId={props.caseId}
            editable={editable}
            initial={props.section15Initial}
          />

          <SectionGeneralUploads
            caseId={props.caseId}
            editable={editable}
            initial={props.generalUploads}
          />

          <SubmitForReviewSection
            caseId={props.caseId}
            status={status}
            intakeSubmittedAt={intakeSubmittedAt}
          />
        </IntakeProgressProvider>
      )}

      <div id={PCH_MESSAGES_ANCHOR_ID} className="mt-10 scroll-mt-24">
        {props.messagesPanel}
      </div>
    </main>
  );
}

// Scroll target the "locked, message your accountant" banner anchors
// at. Lives on the wrapper around the shared messages panel, which
// renders unconditionally at the bottom of this page.
const PCH_MESSAGES_ANCHOR_ID = "pch-messages";

// Submit for review: runs the engine server-side and parks the case
// in the shared accountant queue. Flips pch_cases.intake_submitted_at
// (migration 0119), which is what gates every intake-mutating action
// after this. cases.status stays at 'submitted' until an accountant
// claims the case, so it is NOT the lock signal here.
//
// Renders throughout the intake window (status in submitted /
// in_review / prepared, matching the parent's inIntakeStatus set):
// shows the button while intake_submitted_at is null, flips to the
// "Submitted" confirmation once the DB flag is set. The in_review /
// prepared branches matter after an accountant Re-open (M+4) - the
// client needs the Submit button back to re-lock after a correction.
//
// Phase G: the button is disabled while any section is still amber
// in the progress bar. If a server-side rejection ever beats the
// client-side gate (stale state, race), highlightPending() paints
// the matching chips amber and we smooth-scroll back to the bar.
function SubmitForReviewSection({
  caseId, status, intakeSubmittedAt,
}: {
  caseId: string;
  status: string;
  intakeSubmittedAt: string | null;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [submittedLocal, setSubmittedLocal] = useState<boolean>(false);
  const { pendingKeys, highlightPending } = useIntakeProgress();

  // "Submitted" means the DB flag is set (live-synced from the parent)
  // OR this tab just clicked the button (local flip, so the UI
  // responds instantly even before the realtime echo lands).
  const submitted = !!intakeSubmittedAt || submittedLocal;

  // Mirror the parent's inIntakeStatus set so the Submit button shows
  // throughout the editable window. Without the in_review / prepared
  // branches here, an accountant Re-open at status=in_review would
  // leave the client with an editable form but no visible button to
  // re-submit and re-lock.
  const inIntakeStatus =
    status === "submitted" || status === "in_review" || status === "prepared";
  if (!inIntakeStatus && !submitted) return null;

  const scrollToProgress = () => {
    if (typeof window === "undefined") return;
    const el = window.document.getElementById(INTAKE_PROGRESS_ANCHOR_ID);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const submit = () => start(async () => {
    if (pendingKeys.length > 0) {
      highlightPending();
      scrollToProgress();
      return;
    }
    // Same mark-around-the-write pattern that the old submit button
    // used: cases + pch_cases are live-merged across the workspace,
    // so without a mark on either side the "someone else changed
    // this" filter in realtime-live-merge can double-fire.
    markLocalMutation();
    const r = await submitForReviewAction(caseId);
    markLocalMutation();
    if (!r.ok) {
      setErr(r.error);
      highlightPending();
      scrollToProgress();
      return;
    }
    setErr(null);
    setSubmittedLocal(true);
  });

  const pendingLabels = pendingKeys.map((k) => INTAKE_SECTION_LABELS[k]);
  const blocked = pendingKeys.length > 0;

  return (
    <section className="mt-10 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-1 text-lg font-bold">Ready to send to your accountant?</h2>
      <p className="mb-3 text-sm text-slate-600">
        One click runs the engine and sends your return into the queue
        for one of our accountants to pick up. You'll get an email
        when they take it on, and another when the figures are ready
        for your approval. Once you submit, the intake above locks;
        message your accountant below if anything needs to change
        after that.
      </p>
      {submitted ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          Submitted. Your return is in the queue for an accountant to pick up.
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={submit}
              disabled={pending || blocked}
              className="rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Submitting..." : "Submit for accountant review"}
            </button>
            {err ? <span className="text-xs text-rose-700">{err}</span> : null}
          </div>
          {blocked ? (
            <p className="text-xs text-amber-900">
              {pendingLabels.length} section{pendingLabels.length === 1 ? "" : "s"} still need
              {pendingLabels.length === 1 ? "s" : ""} attention: {pendingLabels.join(", ")}.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function WithAccountantBanner() {
  const scrollToMessages = () => {
    if (typeof window === "undefined") return;
    const el = window.document.getElementById(PCH_MESSAGES_ANCHOR_ID);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <section className="mb-6 rounded-xl border border-sky-200 bg-sky-50 p-5">
      <div
        className="text-[11px] font-semibold uppercase tracking-widest text-sky-900"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Your return is with your accountant
      </div>
      <h2 className="mt-1 text-base font-semibold text-ink">
        Your return is submitted and locked.
      </h2>
      <p className="mt-2 text-sm text-slate-700">
        Spotted something that needs changing? Message your accountant
        below and they'll update it for you. We'll email you when the
        figures are ready to approve.
      </p>
      <button
        type="button"
        onClick={scrollToMessages}
        className="mt-3 inline-flex items-center gap-1 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-900 hover:border-sky hover:text-sky"
      >
        Go to messages ↓
      </button>
    </section>
  );
}

function ApprovalView(props: {
  caseId: string;
  snapshot: TaxEngineOutput;
  snapshotAt: string | null;
  approvalAt: string | null;
  approvalName: string | null;
  saForwardingPdfPath: string | null;
  pchAccountsPdfPath: string | null;
  sa302UploadPath: string | null;
  sa100UploadPath: string | null;
  signDocUrl: (path: string) => Promise<ActionResult<string>>;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-900">
          Your figures are ready for your approval.
        </p>
        <p className="mt-1 text-xs text-emerald-800">
          Your accountant has prepared the Self Assessment numbers below.
          Review them, then approve to file. Message your accountant first
          if anything looks wrong.
        </p>
      </div>
      <FinalDocsSection
        saForwardingPdfPath={props.saForwardingPdfPath}
        pchAccountsPdfPath={props.pchAccountsPdfPath}
        sa302UploadPath={props.sa302UploadPath}
        sa100UploadPath={props.sa100UploadPath}
        signDocUrl={props.signDocUrl}
      />
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <SnapshotTable s={props.snapshot} />
      </div>
      <ApprovalSection
        caseId={props.caseId}
        snapshotAt={props.snapshotAt}
        approvalAt={props.approvalAt}
        approvalName={props.approvalName}
      />
    </div>
  );
}

function FiledView(props: {
  snapshot: TaxEngineOutput;
  approvalAt: string | null;
  approvalName: string | null;
  saForwardingPdfPath: string | null;
  pchAccountsPdfPath: string | null;
  sa302UploadPath: string | null;
  sa100UploadPath: string | null;
  signDocUrl: (path: string) => Promise<ActionResult<string>>;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-900">Approved and filed.</p>
        {props.approvalAt && props.approvalName ? (
          <p className="mt-1 text-xs text-emerald-800">
            Approved by {props.approvalName} on {new Date(props.approvalAt).toLocaleString()}.
          </p>
        ) : null}
      </div>
      <FinalDocsSection
        saForwardingPdfPath={props.saForwardingPdfPath}
        pchAccountsPdfPath={props.pchAccountsPdfPath}
        sa302UploadPath={props.sa302UploadPath}
        sa100UploadPath={props.sa100UploadPath}
        signDocUrl={props.signDocUrl}
      />
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <SnapshotTable s={props.snapshot} />
      </div>
    </div>
  );
}

// Lists the four final documents the accountant generated / uploaded
// for this case (SA Tax Return forwarding letter, PCH Accounts, SA302,
// SA100). Open button on each row signs a short-lived URL via the
// shared getDocumentSignedUrl action and opens it in a new tab;
// matches the accountant-side final-documents-panel's DocCard
// pattern so the two sides look and behave the same way.
//
// sendForClientConfirmationAction already refuses to flip a case to
// client_approval unless every path is set, so by the time this
// section renders in ApprovalView / FiledView all four are expected
// non-null. The per-row guard below is a defensive safety net - a
// missing path shows "Not available" rather than a broken Open
// button, but it isn't a user-facing state we design for.
function FinalDocsSection(props: {
  saForwardingPdfPath: string | null;
  pchAccountsPdfPath: string | null;
  sa302UploadPath: string | null;
  sa100UploadPath: string | null;
  signDocUrl: (path: string) => Promise<ActionResult<string>>;
}) {
  const docs: Array<{ title: string; path: string | null }> = [
    { title: "SA Tax Return forwarding letter", path: props.saForwardingPdfPath },
    { title: "PCH Accounts", path: props.pchAccountsPdfPath },
    { title: "SA302", path: props.sa302UploadPath },
    { title: "SA100", path: props.sa100UploadPath },
  ];
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-bold text-slate-900">Your documents</h3>
      <p className="mt-1 text-xs text-slate-600">
        Open each one to review before approving. We'll keep them here
        for you to come back to after filing.
      </p>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {docs.map((d) => (
          <FinalDocCard
            key={d.title}
            title={d.title}
            path={d.path}
            signDocUrl={props.signDocUrl}
          />
        ))}
      </ul>
    </section>
  );
}

function FinalDocCard({
  title, path, signDocUrl,
}: {
  title: string;
  path: string | null;
  signDocUrl: (path: string) => Promise<ActionResult<string>>;
}) {
  const [opening, setOpening] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = async () => {
    if (!path || opening) return;
    setOpening(true);
    setErr(null);
    try {
      const r = await signDocUrl(path);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      window.open(r.data, "_blank", "noopener,noreferrer");
    } finally {
      setOpening(false);
    }
  };

  return (
    <li className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      {path ? (
        <button
          type="button"
          onClick={open}
          disabled={opening}
          className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:border-sky hover:text-sky disabled:opacity-50"
        >
          {opening ? "Opening." : "Open"}
        </button>
      ) : (
        <p className="mt-1 text-xs text-slate-500">Not available yet.</p>
      )}
      {err ? <p className="mt-1 text-xs text-rose-700">{err}</p> : null}
    </li>
  );
}

function SnapshotTable({ s }: { s: TaxEngineOutput }) {
  // Only the P&L is surfaced to the client. The Tax & NIC breakdown
  // (income tax, Class 4 NIC, total due, balancing payment, POA, MTD
  // status) was removed deliberately: that is advice the client
  // should receive from their accountant with the accompanying
  // caveats, not something the portal should quote back at them
  // directly. The accountant's TotalsStrip and SA302 still carry
  // these figures; this surface shows the P&L figures the client is
  // being asked to approve, nothing more.
  const money = (n: number) =>
    "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const row = (label: string, v: string | number) => (
    <tr>
      <td className="py-1 pr-4 text-slate-600">{label}</td>
      <td className="py-1 font-medium text-right">
        {typeof v === "number" ? money(v) : v}
      </td>
    </tr>
  );
  return (
    <div>
      <h4 className="text-sm font-bold mb-2">Profit &amp; Loss</h4>
      <table className="w-full text-sm">
        <tbody>
          {row("Turnover", s.pl.turnover)}
          {row("Total expenses", s.pl.expensesTotal)}
          {row("Net profit", s.pl.netProfit)}
          {row("Capital allowances", s.pl.capitalAllowances)}
          {row("Taxable profit", s.pl.taxableProfit)}
        </tbody>
      </table>
    </div>
  );
}

function ApprovalSection({
  caseId, snapshotAt, approvalAt, approvalName,
}: {
  caseId: string;
  snapshotAt: string | null;
  approvalAt: string | null;
  approvalName: string | null;
}) {
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [localApproval, setLocalApproval] = useState<{ at: string; name: string } | null>(
    approvalAt && approvalName ? { at: approvalAt, name: approvalName } : null,
  );
  void snapshotAt;

  if (localApproval) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
        <p className="text-sm">
          <strong>Figures approved</strong> by {localApproval.name} on{" "}
          {new Date(localApproval.at).toLocaleString()}. Your accountant
          will file this with HMRC and confirm here once it's done.
        </p>
      </div>
    );
  }
  const submit = () => start(async () => {
    markLocalMutation();
    const trimmed = name.trim();
    const r = await approvePchFinalDocsAction(caseId, trimmed);
    markLocalMutation();
    if (!r.ok) { setErr(r.error); return; }
    setErr(null);
    setLocalApproval({ at: new Date().toISOString(), name: trimmed });
  });
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <p className="text-sm text-slate-700">
        By typing your name below I approve the Profit and Loss Account
        for the year ended 5 April 2026 and approve the four documents
        above for filing with HMRC.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
          placeholder="Type your full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          onClick={submit}
          disabled={pending || name.trim().length < 2}
          className="rounded bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {pending ? "Approving..." : "Approve figures"}
        </button>
      </div>
      {err && <p className="text-red-600 text-xs">{err}</p>}
    </div>
  );
}

// Phase B: the auto_upload intake flow. Renders in place of the
// manual-path Section2+Section3 duo when the client picked
// intake_method='auto_upload'. Composes:
//
//   BulkDocumentUpload   - dropzone + live-tracked list of uploads
//   Section2Income       - fixed 5-slot grid + extra income rows
//   Section3Expenses     - fixed 13-slot grid + Less: Private use +
//                          extra expense rows
//
// The two sections are keyed on a local `linesVersion` counter: when
// any upload's live status flips to 'done', BulkDocumentUpload fires
// onExtractionDone, which bumps the counter and forces Section2 /
// Section3 to remount with fresh server-fetched initial lines (both
// use useState(() => ...) to seed their internal state from `initial`
// once; a prop change alone wouldn't resync already-mounted state).
//
// Fixed/extra split is computed inline against the shared slot
// labels: a line is "fixed" if its source/label (case-insensitive-
// trim) exactly matches one of INCOME_FIXED_SLOTS / EXPENSE_FIXED_
// SLOTS, otherwise it's an "extra". Pre-migration-0124 cases won't
// have anything in the extras bucket because every row was created
// via a fixed-slot upsert.
function AutoUploadIntakeFlow(props: {
  caseId: string;
  editable: boolean;
  incomeLines: IncomeLine[];
  expenseLines: ExpenseLine[];
  intakeAttachments: Record<string, Array<{ docId: string; fileName: string }>>;
  caseFeePence: number;
  vehicleInitial: VehicleInitial;
  privateUseAttachments: Array<{ docId: string; fileName: string }>;
  bulkIntakeUploads: BulkIntakeUploadView[];
}) {
  const [linesVersion, setLinesVersion] = useState(0);

  const incomeFixedLabels = new Set(
    INCOME_FIXED_SLOTS.map((s) => s.label.trim().toLowerCase()),
  );
  const expenseFixedLabels = new Set(
    EXPENSE_FIXED_SLOTS.map((s) => s.label.trim().toLowerCase()),
  );

  const incomeFixed: IncomeLine[] = [];
  const incomeExtras: IncomeLine[] = [];
  for (const l of props.incomeLines) {
    if (incomeFixedLabels.has((l.source ?? "").trim().toLowerCase())) {
      incomeFixed.push(l);
    } else {
      incomeExtras.push(l);
    }
  }
  const expenseFixed: ExpenseLine[] = [];
  const expenseExtras: ExpenseLine[] = [];
  for (const l of props.expenseLines) {
    if (expenseFixedLabels.has((l.label ?? "").trim().toLowerCase())) {
      expenseFixed.push(l);
    } else {
      expenseExtras.push(l);
    }
  }

  return (
    <>
      <BulkDocumentUpload
        caseId={props.caseId}
        editable={props.editable}
        initialUploads={props.bulkIntakeUploads}
        onExtractionDone={() => setLinesVersion((v) => v + 1)}
      />
      <Section2Income
        key={`income-${linesVersion}`}
        caseId={props.caseId}
        editable={props.editable}
        initial={incomeFixed}
        attachmentsByLineId={props.intakeAttachments}
        allowExtraRows
        extraLines={incomeExtras}
      />
      <Section3Expenses
        key={`expense-${linesVersion}`}
        caseId={props.caseId}
        editable={props.editable}
        initial={expenseFixed}
        caseFeePence={props.caseFeePence}
        attachmentsByLineId={props.intakeAttachments}
        privateUseInitialPence={props.vehicleInitial.private_use_amount_pence ?? 0}
        privateUseAttachments={props.privateUseAttachments}
        allowExtraRows
        extraLines={expenseExtras}
      />
    </>
  );
}

// Compute the starting completion vector from server-rendered props,
// so the progress bar's chips render in the right colour on first
// paint. Each section's own useEffect then takes over and keeps the
// context in sync with the user's local edits.
function initialCompletionFromProps(props: {
  section1Initial: Section1InitialHead;
  licenceDocs: Section1LicenceDoc[];
  incomeLines: IncomeLine[];
  expenseLines: ExpenseLine[];
  vehicleInitial: VehicleInitial;
  declarationsInitial: DeclarationsInitial;
  section15Initial: Section15Initial;
}): IntakeCompletion {
  return {
    identity: isIdentityComplete(props.section1Initial, props.licenceDocs),
    income: isIncomeComplete(props.incomeLines),
    expenses: isExpensesComplete(props.expenseLines),
    vehicle: isVehicleComplete(props.vehicleInitial),
    declarations: areDeclarationsComplete(props.declarationsInitial.statuses),
    lastYearSa: isSection15Complete(props.section15Initial),
  };
}
