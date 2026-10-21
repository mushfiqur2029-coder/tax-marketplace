"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import type { TaxEngineOutput } from "@/lib/tax-engine";
import { useLiveRow, useLiveList } from "@/lib/realtime-live-merge";
import {
  setPchDocStatusAction,
  uploadPchDocumentAction,
  submitForReviewAction,
  recordClientApprovalAction,
  setPchPhotoIdKindAction,
} from "@/app/client/pch/actions";
import { startAddonCheckoutAction } from "@/app/client/actions";
import { AddonPayBanner } from "../addon-pay-banner";
import { FinalPackReview } from "./final-pack-review";
import { IdentitySection, type IdentityHead } from "./identity-section";
import { LedgerSection } from "./ledger-section";
import type { BankTransactionView } from "./bank-ledger-table";
import { VehicleSection, type VehicleSummary } from "./vehicle-section";
import { AiInterviewPanel } from "@/components/case/ai-interview-panel";
import {
  startPchReliefsInterviewAction,
  advancePchReliefsInterviewAction,
  commitPchReliefsInterviewAction,
  startPchIncomeProbeInterviewAction,
  advancePchIncomeProbeInterviewAction,
  commitPchIncomeProbeInterviewAction,
  startPchExpensesProbeInterviewAction,
  advancePchExpensesProbeInterviewAction,
  commitPchExpensesProbeInterviewAction,
  startPchFilingDetailsInterviewAction,
  advancePchFilingDetailsInterviewAction,
  commitPchFilingDetailsInterviewAction,
  startPchIncomeInterviewAction,
  advancePchIncomeInterviewAction,
  commitPchIncomeInterviewAction,
  startPchExpenseInterviewAction,
  advancePchExpenseInterviewAction,
  commitPchExpenseInterviewAction,
  markPchChecklistNotApplicableAction,
} from "@/app/client/pch/other-interview-actions";
import {
  ExtractionReview,
  type ExtractionReviewPayload,
} from "./extraction-review";
import { AccountantHelpPrompt } from "./accountant-help-prompt";
import { CameraCaptureModal } from "@/components/case/camera-capture-modal";
import { canRequestAlternative } from "@/lib/pch/ai-interview-slots";
import {
  PriorYearPrompt,
  type PriorYearOption,
} from "./prior-year-prompt";
import { ExtractionSummaryPanel } from "./extraction-summary";
import { canRunDraft } from "@/lib/pch/validation";
import { markLocalMutation } from "@/lib/realtime-self-mutation";

// Status-aware workspace for the automated PCH flow.
//
//   submitted     -> editable intake (sections 1-5) + "Submit for
//                    accountant review" button at the bottom.
//   in_review /   -> intake visible read-only, with a "Your accountant
//     prepared       is reviewing" panel. No figures.
//   client_approval -> figures + Approve button. First time the client
//                    sees any number.
//   filed /       -> final figures + confirmation banner.
//     complete
//
// All mutating actions re-check status server-side; the UI changes
// here are UX-first, not the security boundary.

type Slot = {
  code: string; section: string; display_name: string;
  why_we_need_it: string | null; accepted_formats: string; required_rule: string;
  sort_order: number;
  // Phase 7 Slice 7.1: when true the DocRow renders <input multiple>
  // and loops uploadPchDocumentAction per file (bank statements across
  // several accounts, bulk cash-receipt upload). Added via migration
  // 0099; the client page.tsx picks it up through select("*").
  allow_multiple: boolean;
};
type DocStatus = { case_id: string; slot_code: string; status: string; note: string | null };
type UploadedDoc = {
  id: string; file_name: string; uploaded_at: string;
  requirement_key: string | null;
  // Phase 8 Slice 8.3: licence Front / Back tag for PCH-24 uploads.
  // Null for passports and every non-PCH-24 slot.
  photo_id_side?: "front" | "back" | null;
};
type IncomeRow = {
  id?: string; source: string; gross_takings_pence: number; platform_fee_pence: number;
  on_trip_miles: number; dead_miles: number; evidence?: string | null; notes?: string | null;
  line_type: "Fares" | "Other" | "VAT";
};
type ExpenseRow = {
  id?: string; label: string; amount_paid_pence: number; evidence?: string | null;
  car_cost: "Yes" | "No" | "Phone";
  category: string; sa103s_box: number;
};
type Head = Record<string, string | number | boolean | null>;
type Vehicle = Record<string, string | number | boolean | null>;

export function PchClientWorkspace(props: {
  caseId: string;
  caseStatus: string;
  head: Head | null;
  incomeLines: IncomeRow[];
  expenseLines: ExpenseRow[];
  vehicle: Vehicle | null;
  docSlots: Slot[];
  docStatus: DocStatus[];
  uploadedDocs: UploadedDoc[];
  extractions: ExtractionReviewPayload[];
  priorYearOptions: PriorYearOption[];
  bankTransactions: BankTransactionView[];
  // Checklist item numbers currently marked "not applicable" via the
  // card-level skip buttons on sections 5-8. The sections render a
  // "Marked as not applicable" captured state when their item is in
  // this list, so the skip persists visually across refresh.
  skippedItems: number[];
  pendingAddons: Array<{ id: string; description: string; amount_pence: number }>;
  finalPackSentAt: string | null;
  finalPackConfirmedAt: string | null;
  finalPackConfirmedName: string | null;
  messagesPanel: React.ReactNode;
  engineSnapshot: TaxEngineOutput | null;
  engineSnapshotAt: string | null;
  approvalAt: string | null;
  approvalName: string | null;
}) {
  const h2 = "text-lg font-bold mt-10 mb-3 border-b border-slate-200 pb-2";
  const card = "rounded-lg border border-slate-200 bg-white p-4";
  // Live-tracked state so the whole workspace stays current without
  // ever rendering the generic "new updates" banner. Covers:
  //   - cases.status: workspace swaps modes (submitted / in_review /
  //     client_approval / filed) the instant the row flips.
  //   - pch_cases head: the fields the accountant can flip from their
  //     side (final_pack_sent_at, final_pack_confirmed_at + name,
  //     approval_at + name, bookkeeping_confirmed_at), which gate
  //     the "final pack" and "approve" UI below. Also carries the
  //     head columns consumed by inline AI-interview summaries and
  //     the HMRC references card so an accountant override lands
  //     without an F5.
  //   - case_addons: a new addon raised by the accountant surfaces
  //     a Pay banner at the top of the workspace. The hook dedupes
  //     by id + handles paid/rejected status flips through UPDATE.
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
  };
  const initialHead: LiveHead = {
    final_pack_sent_at: props.finalPackSentAt,
    final_pack_confirmed_at: props.finalPackConfirmedAt,
    final_pack_confirmed_name: props.finalPackConfirmedName,
    client_approval_at: props.approvalAt,
    client_approval_name: props.approvalName,
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
    }),
  });
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
        if (typeof id !== "string" || typeof description !== "string"
          || typeof amount_pence !== "number" || typeof addonStatus !== "string") return null;
        return { id, description, amount_pence, status: addonStatus };
      },
    },
  );
  const liveAddons = liveAddonsAll.filter((a) => a.status === "pending_payment");
  // Intake (documents, income, expenses, vehicle) stays editable all the
  // way up to client_approval, including while the accountant has the
  // case (in_review / prepared). The accountant's review screen reads
  // the same live tables, so a client edit after pickup is visible to
  // them immediately rather than silently invalidating a frozen
  // snapshot. Locked only once the case reaches client_approval, where
  // the client is reviewing figures that have already been signed off
  // for presentation.
  const editable =
    status === "submitted" || status === "in_review" || status === "prepared";
  const withAccountant = status === "in_review" || status === "prepared";
  const awaitingApproval = status === "client_approval";
  const filed = status === "filed" || status === "complete";

  // Readiness check uses the last-saved income + vehicle state (what
  // the engine would read on Submit for review). Live edits in the
  // forms do not flip the readiness state until the user hits Save in
  // each tab.
  // Task: confirming a Photo ID field (front of licence: name, DOB,
  // address, postcode) in the Documents review card used to only show
  // up in "2. Your identity" after a full page reload, which is
  // disruptive while the client is actively working elsewhere on the
  // page. ExtractionReview now reports each applied field straight up
  // here (see onIdentityFieldApplied below), merged over the
  // server-rendered head so the identity summary updates live, no
  // reload.
  const [identityOverrides, setIdentityOverrides] = useState<Partial<IdentityHead>>({});
  const onIdentityFieldApplied = (patch: Partial<IdentityHead>) => {
    setIdentityOverrides((prev) => ({ ...prev, ...patch }));
  };

  const readiness = useMemo(() => canRunDraft(
    props.incomeLines.map((l) => ({
      grossTakings: (l.gross_takings_pence ?? 0) / 100,
      type: l.line_type,
    })),
    props.vehicle ? {
      status: (props.vehicle.status ?? null) as string | null,
      odo_start: Number(props.vehicle.odo_start ?? 0) || null,
      odo_end: Number(props.vehicle.odo_end ?? 0) || null,
      method_choice: (props.vehicle.method_choice ?? null) as string | null,
      business_pct_override: Number(props.vehicle.business_pct_override ?? 0) || null,
    } : null,
  ), [props.incomeLines, props.vehicle]);

  return (
    <main className="mx-auto max-w-4xl p-6">
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
            Your accountant is preparing the final accounts pack. You&apos;ll be prompted to review and confirm it here once it&apos;s ready.
          </p>
        </section>
      ) : filed && props.engineSnapshot ? (
        <FiledView
          snapshot={props.engineSnapshot}
          approvalAt={liveHead.client_approval_at}
          approvalName={liveHead.client_approval_name}
        />
      ) : (
        <>
          {withAccountant ? (
            <WithAccountantBanner />
          ) : null}

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

          <ExtractionSummaryPanel extractions={props.extractions} />

          <fieldset disabled={!editable} className={editable ? "" : "opacity-80"}>
            <h2 className={h2}>1. Documents</h2>
            <DocSection
              caseId={props.caseId}
              slots={props.docSlots}
              status={props.docStatus}
              uploaded={props.uploadedDocs}
              extractions={props.extractions}
              editable={editable}
              photoIdKind={(props.head?.photo_id_kind as "passport" | "licence" | null | undefined) ?? null}
              onIdentityFieldApplied={onIdentityFieldApplied}
            />

            <h2 className={h2}>2. Your identity</h2>
            <div className={card}>
              <IdentitySection
                caseId={props.caseId}
                head={{ ...headToIdentity(props.head ?? {}), ...identityOverrides }}
                editable={editable}
              />
            </div>

            {props.bankTransactions.length > 0 ? (
              <>
                <h2 className={h2}>3. Your bookkeeping (from your bank)</h2>
                <div className={card}>
                  <LedgerSection
                    caseId={props.caseId}
                    transactions={props.bankTransactions}
                    editable={editable}
                  />
                </div>
              </>
            ) : editable ? (
              <>
                <h2 className={h2}>3. Your income and expenses (from our chat)</h2>
                <div className={card}>
                  <IncomeInterviewSection
                    caseId={props.caseId}
                    interviewLine={findInterviewIncomeLine(props.incomeLines)}
                  />
                </div>
                <div className={card}>
                  <ExpenseInterviewSection
                    caseId={props.caseId}
                    interviewLines={findInterviewExpenseLines(props.expenseLines)}
                  />
                </div>
              </>
            ) : null}

            <h2 className={h2}>4. Vehicle and capital allowances</h2>
            <div className={card}>
              <VehicleSection
                caseId={props.caseId}
                vehicle={vehicleToSummary(props.vehicle)}
                editable={editable}
              />
            </div>

            {editable ? (
              <>
                <h2 className={h2}>5. Reliefs and personal allowances</h2>
                <div className={card}>
                  <ReliefsSection
                    caseId={props.caseId}
                    pensionPence={Number(props.head?.personal_pension_net_pence ?? 0) || 0}
                    giftAidPence={Number(props.head?.gift_aid_net_pence ?? 0) || 0}
                    maStatus={(props.head?.marriage_allowance_status as string | null) ?? "None"}
                    skipped={props.skippedItems.includes(19)}
                  />
                </div>

                <h2 className={h2}>6. Any other income sources?</h2>
                <div className={card}>
                  <SingleAnswerSection
                    caseId={props.caseId}
                    title="Nil-platform check"
                    body="Quick confirmation that we have every platform you drove for this year, even the ones that paid nothing. Takes about 30 seconds."
                    answer={(props.head?.nil_platforms_note as string | null) ?? null}
                    emptyPrompt="You haven't told us yet about any other platforms you drove for."
                    openLabel="Walk through it with the AI"
                    reopenLabel="Update your answer"
                    panelFlowLabel="Any other income sources?"
                    panelFlowSubtitle="Confirming any platforms with nil activity"
                    panelFinishedMessage="Thanks, saving that answer now."
                    panelCommitLabel="Save this answer"
                    panelCommitPendingLabel="Saving..."
                    startAction={startPchIncomeProbeInterviewAction}
                    advanceAction={advancePchIncomeProbeInterviewAction}
                    commitAction={commitPchIncomeProbeInterviewAction}
                    checklistItems={[5]}
                    skipped={props.skippedItems.includes(5)}
                  />
                </div>

                <h2 className={h2}>7. Any expenses we missed?</h2>
                <div className={card}>
                  <SingleAnswerSection
                    caseId={props.caseId}
                    title="Expenses probe"
                    body="Two quick questions: any costs we may have missed (PCO rental, DBS/medical, VED, breakdown), and if any of your expense figures were estimates, how you worked them out."
                    answer={(props.head?.expenses_probe_note as string | null) ?? null}
                    emptyPrompt="You haven't told us yet about any often-missed costs or how any estimates were worked out."
                    openLabel="Walk through it with the AI"
                    reopenLabel="Update your answer"
                    panelFlowLabel="Any expenses we missed?"
                    panelFlowSubtitle="Often-missed costs + estimate workings"
                    panelFinishedMessage="Thanks, saving that answer now."
                    panelCommitLabel="Save this answer"
                    panelCommitPendingLabel="Saving..."
                    startAction={startPchExpensesProbeInterviewAction}
                    advanceAction={advancePchExpensesProbeInterviewAction}
                    commitAction={commitPchExpensesProbeInterviewAction}
                    checklistItems={[11, 27]}
                    skipped={props.skippedItems.includes(11) || props.skippedItems.includes(27)}
                  />
                </div>

                <h2 className={h2}>8. Where should a refund go?</h2>
                <div className={card}>
                  <SingleAnswerSection
                    caseId={props.caseId}
                    title="Repayment account name"
                    body="If HMRC owes you a refund this year, whose bank account should it be paid into? The name on the account must match your HMRC-registered name exactly."
                    answer={(props.head?.repayment_account_name as string | null) ?? null}
                    emptyPrompt="You haven't told us yet whose account HMRC should refund to."
                    openLabel="Walk through it with the AI"
                    reopenLabel="Update your answer"
                    panelFlowLabel="Where should a refund go?"
                    panelFlowSubtitle="Account name only, no account numbers needed yet"
                    panelFinishedMessage="Thanks, saving that answer now."
                    panelCommitLabel="Save this answer"
                    panelCommitPendingLabel="Saving..."
                    startAction={startPchFilingDetailsInterviewAction}
                    advanceAction={advancePchFilingDetailsInterviewAction}
                    commitAction={commitPchFilingDetailsInterviewAction}
                    checklistItems={[31]}
                    skipped={props.skippedItems.includes(31)}
                  />
                </div>
              </>
            ) : null}
          </fieldset>

          {status === "submitted" ? (
            <SubmitForReviewSection caseId={props.caseId} readiness={readiness} />
          ) : null}
        </>
      )}

      <div className="mt-10">{props.messagesPanel}</div>
    </main>
  );
}

// Banner shown while the accountant is working. Replaces the figures
// view the client used to see so there's no risk of them acting on
// a draft number before the accountant has validated it.
function WithAccountantBanner() {
  return (
    <div className="mb-6 rounded-lg border border-sky-200 bg-sky-50 p-4">
      <p className="text-sm font-semibold text-sky-900">
        Your return is with your accountant.
      </p>
      <p className="mt-1 text-xs text-sky-800">
        They are reviewing what you sent and preparing your figures. You will
        get a notification when they are ready for your approval. You can
        still upload documents or update your details below if something
        changes. Your accountant sees the update straight away.
      </p>
    </div>
  );
}

// Phase 7 Slice 7.6b: reusable section for single-answer interview
// flows (INCOME_PROBE, EXPENSES_PROBE, FILING_DETAILS). Shows what the
// client has previously answered (if anything), lets them open/update
// the chat. The RELIEFS flow has its own section component below
// because the "already captured" summary needs to format three fields.
function SingleAnswerSection({
  caseId, title, body, answer, emptyPrompt, openLabel, reopenLabel,
  panelFlowLabel, panelFlowSubtitle, panelFinishedMessage,
  panelCommitLabel, panelCommitPendingLabel,
  startAction, advanceAction, commitAction,
  checklistItems, skipped: initialSkipped,
}: {
  caseId: string;
  title: string;
  body: string;
  answer: string | null;
  emptyPrompt: string;
  openLabel: string;
  reopenLabel: string;
  panelFlowLabel: string;
  panelFlowSubtitle: string;
  panelFinishedMessage: string;
  panelCommitLabel: string;
  panelCommitPendingLabel: string;
  startAction: (caseId: string) => Promise<{ ok: true; opener: { role: "user" | "assistant"; content: string } } | { ok: false; error: string }>;
  advanceAction: Parameters<typeof AiInterviewPanel>[0]["advance"];
  commitAction: Parameters<typeof AiInterviewPanel>[0]["commit"];
  // Phase 8 Slice 8.1: checklist item(s) to flip to Done + "Client
  // confirmed not applicable" when the client taps "Not applicable"
  // in the panel header.
  checklistItems: number[];
  // True when any mapped checklist item is already marked
  // "Client confirmed not applicable" in pch_check_status. The card
  // shows a "Marked as not applicable" captured state and hides the
  // skip button so the client sees the skip persist across refresh.
  skipped: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [skipping, startSkip] = useTransition();
  const [skipErr, setSkipErr] = useState<string | null>(null);
  // Task #14: no reload, the skip write is all-or-nothing per checklist
  // item, so a successful call means exactly what it says on the tin.
  const [skipped, setSkipped] = useState(initialSkipped);
  const hasAnswer = (answer ?? "").trim().length > 0;
  // markLocalMutation() fires before the request goes out: see the
  // matching comment in extraction-review.tsx's run() for why marking
  // only on success can lose the race against this write's own
  // realtime push on pch_check_status, a watched table.
  const skipCard = () => startSkip(async () => {
    setSkipErr(null);
    markLocalMutation();
    const r = await markPchChecklistNotApplicableAction(caseId, checklistItems);
    // Mark again now that the write is confirmed, not just when it was
    // fired: a slow action (cold start, several DB round trips) can run
    // past the fixed suppression window counted from the first mark, so
    // refreshing it here guarantees the window covers the moment the
    // realtime echo for this exact write actually arrives.
    markLocalMutation();
    if (!r.ok) {
      setSkipErr(r.error);
      return;
    }
    setSkipped(true);
  });
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-slate-900">{title}</div>
      <p className="text-xs text-slate-600">{body}</p>
      {hasAnswer ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <div className="font-semibold mb-0.5">Captured answer</div>
          <div className="whitespace-pre-wrap">{answer}</div>
        </div>
      ) : skipped ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <div className="font-semibold mb-0.5">Marked as not applicable</div>
          <div>You said this doesn&apos;t apply. Open the chat if you want to add something after all.</div>
        </div>
      ) : (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {emptyPrompt}
        </div>
      )}
      {!open ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
          >
            {hasAnswer || skipped ? reopenLabel : openLabel}
          </button>
          {/* Card-level skip: one-tap "Not applicable" that writes
              the same checklist state as the in-panel N/A button,
              without forcing the client to open the chat first.
              Hidden once there's an answer OR the item is already
              marked skipped. */}
          {!hasAnswer && !skipped ? (
            <button
              type="button"
              onClick={skipCard}
              disabled={skipping}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {skipping ? "Skipping..." : "Not needed, skip this"}
            </button>
          ) : null}
          {skipErr ? <span className="text-xs text-rose-700">{skipErr}</span> : null}
        </div>
      ) : (
        <AiInterviewPanel
          caseId={caseId}
          onClose={() => setOpen(false)}
          flowLabel={panelFlowLabel}
          flowSubtitle={panelFlowSubtitle}
          finishedMessage={panelFinishedMessage}
          commitButtonLabel={panelCommitLabel}
          commitPendingLabel={panelCommitPendingLabel}
          start={startAction}
          advance={advanceAction}
          commit={commitAction}
          notApplicable={{
            label: "Not applicable",
            action: () => markPchChecklistNotApplicableAction(caseId, checklistItems),
            // AiInterviewPanel marks the local mutation itself before
            // this action's request goes out; this callback just
            // reflects the confirmed outcome locally.
            onConfirmed: () => {
              setSkipped(true);
            },
          }}
        />
      )}
    </div>
  );
}

// Phase 8 Slice 8.5: INCOME_INTERVIEW section. Shown in place of the
// bookkeeping ledger when the client has no bank statement uploaded.
// Captured state shows a short "£X across platforms Y" summary; empty
// state is a short invitation to walk through the chat.
const INCOME_INTERVIEW_SOURCE_PREFIX = "Interview: ";

function findInterviewIncomeLine(lines: IncomeRow[]): IncomeRow | null {
  for (const l of lines) {
    if (typeof l.source === "string" && l.source.startsWith(INCOME_INTERVIEW_SOURCE_PREFIX)) {
      return l;
    }
  }
  return null;
}

function IncomeInterviewSection({
  caseId, interviewLine,
}: {
  caseId: string;
  interviewLine: IncomeRow | null;
}) {
  const [open, setOpen] = useState(false);
  const captured = interviewLine && interviewLine.gross_takings_pence > 0;
  const fmt = (p: number) =>
    "£" + (p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const platforms = captured
    ? interviewLine.source.slice(INCOME_INTERVIEW_SOURCE_PREFIX.length)
    : "";

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-slate-900">Capture your income by chat</div>
      <p className="text-xs text-slate-600">
        No bank statement to upload? We&apos;ll walk through your platforms and
        roughly what came in together. Takes a couple of minutes, ballpark
        figures are fine.
      </p>
      {captured ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 space-y-0.5">
          <div className="font-semibold mb-0.5">Captured so far</div>
          <div>Platforms: <strong>{platforms || "Driver-reported"}</strong></div>
          <div>Gross: <strong>{fmt(interviewLine.gross_takings_pence)}</strong></div>
          <div>Platform fees: <strong>{fmt(interviewLine.platform_fee_pence)}</strong></div>
        </div>
      ) : (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          No income captured yet. Upload a bank statement under Documents above,
          or walk through the AI chat here.
        </div>
      )}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
        >
          {captured ? "Update my income" : "Walk through it with the AI"}
        </button>
      ) : (
        <AiInterviewPanel
          caseId={caseId}
          onClose={() => setOpen(false)}
          flowLabel="Capture your income by chat"
          flowSubtitle="Platforms, rough gross, rough fees"
          finishedMessage="Thanks, saving your income now."
          commitButtonLabel="Save my income"
          commitPendingLabel="Saving your income..."
          start={startPchIncomeInterviewAction}
          advance={advancePchIncomeInterviewAction}
          commit={commitPchIncomeInterviewAction}
        />
      )}
    </div>
  );
}

// EXPENSE_INTERVIEW section (post Phase 8). Companion to the income
// section above. Walks the client through non-vehicle allowable
// expenses one category at a time, writing a single pch_expense_lines
// row per confirmed category. Vehicle running costs (fuel, repairs,
// finance) stay with VEHICLE_CA; this section only covers the
// consumables that would otherwise fall through for a no-bank client.
function findInterviewExpenseLines(lines: ExpenseRow[]): ExpenseRow[] {
  return lines.filter(
    (l) => typeof l.label === "string" && l.label.startsWith(INCOME_INTERVIEW_SOURCE_PREFIX),
  );
}

// Three quick-entry boxes covering the opening questions of the
// EXPENSE_INTERVIEW flow (phone/data, vehicle cleaning, congestion/
// ULEZ/parking). Typing numbers into a row is quicker than composing a
// chat sentence; the composed line is sent in as the client's first
// reply (see autoFirstReply on AiInterviewPanel), so the AI moves
// straight on to insurance, licences, and "anything else to declare".
function QuickFigureInput({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex-1 min-w-[140px] text-xs text-slate-700">
      <div className="mb-1 font-medium">{label}</div>
      <div className="flex items-center rounded border border-slate-300 bg-white px-2 py-1">
        <span className="mr-1 text-slate-400">£</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="1"
          placeholder="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full text-sm outline-none"
        />
      </div>
    </label>
  );
}

function ExpenseInterviewSection({
  caseId, interviewLines,
}: {
  caseId: string;
  interviewLines: ExpenseRow[];
}) {
  const [stage, setStage] = useState<"closed" | "quick" | "chat">("closed");
  const [phone, setPhone] = useState("");
  const [cleaning, setCleaning] = useState("");
  const [parking, setParking] = useState("");
  const captured = interviewLines.length > 0;
  const fmt = (p: number) =>
    "£" + (p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const total = interviewLines.reduce((n, l) => n + l.amount_paid_pence, 0);

  const figureOrNone = (v: string) => {
    const n = Number(v);
    return v.trim().length > 0 && Number.isFinite(n) && n > 0 ? `£${n}` : "none";
  };
  const composedFirstReply =
    `Phone and data: ${figureOrNone(phone)}. ` +
    `Vehicle cleaning / valeting: ${figureOrNone(cleaning)}. ` +
    `Congestion, ULEZ and parking (not fines or penalties): ${figureOrNone(parking)}.`;

  const closeAndReset = () => {
    setStage("closed");
    setPhone("");
    setCleaning("");
    setParking("");
  };

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-slate-900">Capture your business expenses by chat</div>
      <p className="text-xs text-slate-600">
        Phone, cleaning, parking and tolls, insurance, licences, anything
        else, rough yearly figures are fine for all of these. Every category
        is optional, say &quot;none&quot; or &quot;don&apos;t know&quot; for anything that
        doesn&apos;t apply and we&apos;ll skip it. Vehicle running costs (fuel,
        repairs, finance) are already covered in section 4.
      </p>
      {captured ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 space-y-0.5">
          <div className="font-semibold mb-0.5">Captured so far</div>
          <ul className="space-y-0.5">
            {interviewLines.map((l) => (
              <li key={l.label}>
                {l.label.slice(INCOME_INTERVIEW_SOURCE_PREFIX.length)}: <strong>{fmt(l.amount_paid_pence)}</strong>
              </li>
            ))}
          </ul>
          <div className="pt-1 border-t border-emerald-200 mt-1">
            Total: <strong>{fmt(total)}</strong>
          </div>
        </div>
      ) : (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          No business expenses captured yet. You can still submit without
          them (we won&apos;t block you), but you may miss out on claimable
          costs. Walk through the AI chat here, or upload a bank statement
          under Documents above.
        </div>
      )}
      {stage === "closed" ? (
        <button
          type="button"
          onClick={() => setStage("quick")}
          className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
        >
          {captured ? "Update my expenses" : "Walk through it with the AI"}
        </button>
      ) : stage === "quick" ? (
        <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
          <div className="text-xs font-medium text-slate-900">
            Three to start, rough yearly figures, leave blank for none
          </div>
          <div className="flex flex-wrap gap-2">
            <QuickFigureInput label="Phone & data (year)" value={phone} onChange={setPhone} />
            <QuickFigureInput label="Vehicle cleaning / valeting" value={cleaning} onChange={setCleaning} />
            <QuickFigureInput label="Congestion, ULEZ & parking" value={parking} onChange={setParking} />
          </div>
          <p className="text-[11px] text-slate-500">
            Not fines or penalties, those aren&apos;t claimable. After this
            the AI will ask about insurance, licences, and anything else
            to declare.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeAndReset}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setStage("chat")}
              className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
            >
              Continue to chat
            </button>
          </div>
        </div>
      ) : (
        <AiInterviewPanel
          caseId={caseId}
          onClose={closeAndReset}
          flowLabel="Capture your business expenses by chat"
          flowSubtitle="Rough yearly figures: phone, cleaning, parking, insurance, subs, other"
          finishedMessage="Thanks, saving your expenses now."
          commitButtonLabel="Save my expenses"
          commitPendingLabel="Saving your expenses..."
          start={startPchExpenseInterviewAction}
          advance={advancePchExpenseInterviewAction}
          commit={commitPchExpenseInterviewAction}
          autoFirstReply={composedFirstReply}
        />
      )}
    </div>
  );
}

// Phase 7 Slice 7.6b: Reliefs section. Formats the three captured
// fields (pension net, Gift Aid net, Marriage Allowance status) into
// a short summary; otherwise same open / re-open UX as
// SingleAnswerSection above.
function ReliefsSection({
  caseId, pensionPence, giftAidPence, maStatus, skipped: initialSkipped,
}: {
  caseId: string;
  pensionPence: number;
  giftAidPence: number;
  maStatus: string;
  // True when checklist item 19 is already marked "Client confirmed
  // not applicable" in pch_check_status. Same visual behaviour as
  // SingleAnswerSection's skipped state.
  skipped: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [skipping, startSkip] = useTransition();
  const [skipErr, setSkipErr] = useState<string | null>(null);
  // Task #14: no reload, see SingleAnswerSection's matching comment.
  const [skipped, setSkipped] = useState(initialSkipped);
  const hasAny = pensionPence > 0 || giftAidPence > 0 || (maStatus && maStatus !== "None");
  const fmt = (p: number) =>
    "£" + (p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const skipCard = () => startSkip(async () => {
    setSkipErr(null);
    markLocalMutation();
    const r = await markPchChecklistNotApplicableAction(caseId, [19]);
    // See SingleAnswerSection's matching comment: refresh the mark once
    // the write is confirmed so a slow request can't outrun the window.
    markLocalMutation();
    if (!r.ok) {
      setSkipErr(r.error);
      return;
    }
    setSkipped(true);
  });
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-slate-900">Pension, Gift Aid, Marriage Allowance</div>
      <p className="text-xs text-slate-600">
        Three quick questions on reliefs that can lower your tax bill. Takes about a minute.
      </p>
      {hasAny ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 space-y-0.5">
          <div className="font-semibold mb-0.5">Captured so far</div>
          <div>Personal pension (net): <strong>{fmt(pensionPence)}</strong></div>
          <div>Gift Aid (net): <strong>{fmt(giftAidPence)}</strong></div>
          <div>Marriage Allowance: <strong>{maStatus || "None"}</strong></div>
        </div>
      ) : skipped ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <div className="font-semibold mb-0.5">Marked as not applicable</div>
          <div>You said none of these apply. Open the chat if you want to add something after all.</div>
        </div>
      ) : (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          You haven&apos;t told us yet about any pension contributions, Gift Aid or Marriage Allowance.
        </div>
      )}
      {!open ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
          >
            {hasAny || skipped ? "Update your reliefs" : "Walk through it with the AI"}
          </button>
          {!hasAny && !skipped ? (
            <button
              type="button"
              onClick={skipCard}
              disabled={skipping}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {skipping ? "Skipping..." : "Not needed, skip this"}
            </button>
          ) : null}
          {skipErr ? <span className="text-xs text-rose-700">{skipErr}</span> : null}
        </div>
      ) : (
        <AiInterviewPanel
          caseId={caseId}
          onClose={() => setOpen(false)}
          flowLabel="Reliefs and personal allowances"
          flowSubtitle="Pension, Gift Aid, Marriage Allowance"
          finishedMessage="Thanks, saving your reliefs now."
          commitButtonLabel="Save my reliefs"
          commitPendingLabel="Saving your reliefs..."
          start={startPchReliefsInterviewAction}
          advance={advancePchReliefsInterviewAction}
          commit={commitPchReliefsInterviewAction}
          notApplicable={{
            label: "None of these apply",
            action: () => markPchChecklistNotApplicableAction(caseId, [19]),
            // AiInterviewPanel marks the local mutation itself before
            // this action's request goes out; this callback just
            // reflects the confirmed outcome locally.
            onConfirmed: () => {
              setSkipped(true);
            },
          }}
        />
      )}
    </div>
  );
}

// First time the client sees any number: the accountant has advanced
// the case to client_approval. One click signs off and files.
function ApprovalView(props: {
  caseId: string;
  snapshot: TaxEngineOutput;
  snapshotAt: string | null;
  approvalAt: string | null;
  approvalName: string | null;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-900">
          Your figures are ready for your approval.
        </p>
        <p className="mt-1 text-xs text-emerald-800">
          Your accountant has prepared the Self Assessment numbers below.
          Review them, then approve to file. Message your accountant first if
          anything looks wrong.
        </p>
      </div>
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

// Terminal view once the client has signed off.
function FiledView(props: {
  snapshot: TaxEngineOutput;
  approvalAt: string | null;
  approvalName: string | null;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-900">
          Approved and filed.
        </p>
        {props.approvalAt && props.approvalName ? (
          <p className="mt-1 text-xs text-emerald-800">
            Approved by {props.approvalName} on{" "}
            {new Date(props.approvalAt).toLocaleString()}.
          </p>
        ) : null}
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <SnapshotTable s={props.snapshot} />
      </div>
    </div>
  );
}

// Replaces the old "Run draft" button. One click runs the engine
// server-side and parks the case in the shared accountant queue; an
// accountant picks it up through their own workspace. Status flips to
// in_review at pickup, not here.
function SubmitForReviewSection({
  caseId, readiness,
}: {
  caseId: string;
  readiness: { ok: boolean; blockers: string[] };
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  // Task #14: no reload. Submitting for review only stamps
  // pch_cases.engine_snapshot_at (see submitForReviewAction); it doesn't
  // touch cases.status, so nothing on this page actually needs fresh
  // server data afterward, intake stays editable exactly as before. A
  // plain local flag is enough to show the confirmation.
  const [submitted, setSubmitted] = useState(false);
  const submit = () => start(async () => {
    // Fire before the request goes out: see the matching comment in
    // extraction-review.tsx's run() for why marking only on success
    // can lose the race against this write's own realtime push on
    // pch_cases, a watched table.
    //
    // This action is the slow one in the whole PCH flow: it hydrates
    // every intake table, runs the full tax engine, then writes the
    // snapshot, which under a cold serverless start can comfortably run
    // past a few seconds. The fixed suppression window counted from the
    // mark above was landing before the realtime echo for this exact
    // write arrived, so RealtimeRefresh treated the viewer's own submit
    // as someone else's change and reloaded the page a couple of
    // seconds after the "Submitted" message appeared, resetting this
    // component's local state and bringing the button straight back.
    // Marking again right as the write is confirmed restarts the window
    // from the moment that matters, regardless of how long the request
    // took to get there.
    markLocalMutation();
    const r = await submitForReviewAction(caseId);
    markLocalMutation();
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setErr(null);
    setSubmitted(true);
  });
  return (
    <div className="mt-10 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-bold mb-1">Ready to send to your accountant?</h2>
      <p className="text-sm text-slate-600 mb-3">
        Once you submit, your return goes into the queue for one of our
        accountants to pick up. You will get an email when they take it on,
        and another when your figures are ready for your approval. If you
        spot something to fix before they pick it up, you can still come
        back and change it; the engine re-runs on their side.
      </p>
      {!readiness.ok ? (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold mb-1">A few things first:</p>
          <ul className="list-disc list-inside space-y-0.5 text-xs">
            {readiness.blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
        </div>
      ) : null}
      {submitted ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          Submitted. Your return is now in the queue for an accountant to pick up.
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={pending || !readiness.ok}
            className="rounded bg-slate-900 px-4 py-2 text-white text-sm font-medium disabled:opacity-50"
          >
            {pending ? "Submitting..." : "Submit for accountant review"}
          </button>
          {err ? <span className="text-xs text-red-600">{err}</span> : null}
        </div>
      )}
    </div>
  );
}

// -------------------- Documents --------------------

function DocSection({
  caseId, slots, status, uploaded, extractions, editable = true, photoIdKind,
  onIdentityFieldApplied,
}: {
  caseId: string; slots: Slot[]; status: DocStatus[]; uploaded: UploadedDoc[];
  extractions: ExtractionReviewPayload[];
  editable?: boolean;
  // Phase 8 Slice 8.3: lets the Photo ID row swap in the custom passport
  // vs licence UI; null means "client hasn't picked yet".
  photoIdKind: "passport" | "licence" | null;
  // Reports an accepted/edited Photo ID field straight up to the page so
  // "2. Your identity" updates live. See the matching comment in
  // PchClientWorkspace.
  onIdentityFieldApplied?: (patch: Partial<IdentityHead>) => void;
}) {
  const statusByCode = new Map(status.map((s) => [s.slot_code, s]));
  const uploadedByKey = new Map<string, UploadedDoc[]>();
  for (const d of uploaded) {
    const key = d.requirement_key ?? "";
    if (!uploadedByKey.has(key)) uploadedByKey.set(key, []);
    uploadedByKey.get(key)!.push(d);
  }
  const extractionsBySlot = new Map<string, ExtractionReviewPayload[]>();
  for (const e of extractions) {
    const list = extractionsBySlot.get(e.slotCode) ?? [];
    list.push(e);
    extractionsBySlot.set(e.slotCode, list);
  }
  const sections = Array.from(new Set(slots.map((s) => s.section)));

  // One shared reload scheduler for every slot in this section, instead
  // of each slot calling window.location.reload() the instant its own
  // upload resolves. Two uploads fired close together (classic case: a
  // licence's front and back, picked one after the other) used to race:
  // whichever upload's onChanged() landed first reloaded the page
  // immediately, and that hard navigation aborted the other upload's
  // still-in-flight request, so it silently never saved. Debouncing to a
  // single reload after everything quiets down lets every in-flight
  // upload in this section finish before the page actually reloads.
  const reloadTimer = useRef<number | null>(null);
  const scheduleReload = () => {
    if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => {
      window.location.reload();
    }, 1200);
  };

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <div key={section}>
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600 mb-2">{section}</h3>
          <div className="space-y-2">
            {slots.filter((s) => s.section === section).map((s) => (
              s.code === "PCH-24" ? (
                <PhotoIdSection
                  key={s.code}
                  caseId={caseId}
                  slot={s}
                  status={statusByCode.get(s.code)}
                  uploaded={uploadedByKey.get(s.code) ?? []}
                  extractions={extractionsBySlot.get(s.code) ?? []}
                  canEdit={editable}
                  photoIdKind={photoIdKind}
                  onChanged={scheduleReload}
                  onIdentityFieldApplied={onIdentityFieldApplied}
                />
              ) : (
                <DocRow
                  key={s.code}
                  caseId={caseId}
                  slot={s}
                  status={statusByCode.get(s.code)}
                  uploaded={uploadedByKey.get(s.code) ?? []}
                  extractions={extractionsBySlot.get(s.code) ?? []}
                  canEdit={editable}
                  onChanged={scheduleReload}
                />
              )
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DocRow({
  caseId, slot, status, uploaded, extractions, canEdit, onChanged,
}: {
  caseId: string; slot: Slot; status: DocStatus | undefined;
  uploaded: UploadedDoc[]; extractions: ExtractionReviewPayload[];
  canEdit: boolean; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // A direct `await someServerAction()` call from an event handler (not
  // a <form action>) should be wrapped in a transition so React treats
  // it as an action; kept for that, and because onChanged() runs inside
  // it. onChanged() itself is a hard window.location.reload(), not
  // router.refresh() 2026-10-20 testing on production showed the
  // mutation and server-side revalidation both land correctly (a fresh
  // manual RSC fetch, and a Link navigation away and back, both show
  // the new data immediately) but router.refresh() alone on the same
  // route reliably failed to apply that refreshed payload to the
  // screen, which is exactly the "have to refresh after every click"
  // bug. A full reload is heavier but guaranteed correct.
  const [, startActionTransition] = useTransition();
  // Task #14: "Mark not applicable" doesn't involve AI extraction or any
  // server-decided content (unlike an upload), so it doesn't need the
  // reload below, a local override is enough.
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const inputId = `up-${slot.code}`;
  const isRequired = /^Required/i.test(slot.required_rule);
  const effectiveStatus =
    localStatus ?? status?.status ?? (uploaded.length ? "Uploaded" : "Awaiting");
  // Phase 6 Slice 7: the per-slot AI-interview path (PCH-01/02/03) is
  // gone; the only non-upload option left is the accountant-help
  // request. Shown on non-mandatory slots once no help request is
  // already in flight.
  const helpAvailable =
    canEdit
    && canRequestAlternative(slot.code)
    && effectiveStatus !== "Awaiting accountant";
  // Phase 7 Slice 7.1: camera button on every image-accepting slot. The
  // bank-statement slot (PCH-14) accepts images now too so a client can
  // photograph a paper statement; parsed via Claude vision in
  // bank-parse.ts. Only PCH-14's CSV/XLSX cousins (non-image) would be
  // odd targets for the camera; the check below picks every slot whose
  // accept list carries an image mime hint.
  const imageSlot = /image|jpg|png|jpeg|heic|webp/i.test(slot.accepted_formats);

  // Phase 7 Slice 7.1: one file at a time upload loop so we can give
  // per-file progress feedback for multi-file slots (bank statements
  // across accounts, bulk receipts). The server action still accepts
  // one file per call; this is a client-side loop around it.
  const uploadMany = (files: File[]) => {
    if (files.length === 0) return;
    startActionTransition(async () => {
      setBusy(true); setErr(null);
      setProgress({ done: 0, total: files.length });
      try {
  let anySucceeded = false;
        for (let i = 0; i < files.length; i++) {
          const fd = new FormData();
          fd.set("file", files[i]);
          try {
            const r = await uploadPchDocumentAction(caseId, slot.code, fd);
            if (!r.ok) { setErr(r.error); break; }
            anySucceeded = true;
            markLocalMutation();
          } catch (e) {
            setErr(
              e instanceof Error
                ? "Upload failed: " + e.message
                : "Upload failed. Try again, and if it keeps failing, re-save the file smaller.",
            );
            break;
          }
          setProgress({ done: i + 1, total: files.length });
        }
        // Show "Uploaded" the instant the request(s) succeed rather than
        // leaving the badge on its old value for the ~1s the debounced
        // reload (see scheduleReload in the parent) takes to actually
        // bring in the fresh server data.
        if (anySucceeded) setLocalStatus("Uploaded");
      } finally {
        setBusy(false);
        setProgress(null);
        onChanged();
      }
    });
  };
  const markNA = () => {
    startActionTransition(async () => {
      setBusy(true); setErr(null);
      const r = await setPchDocStatusAction(caseId, slot.code, "Not applicable");
      setBusy(false);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setLocalStatus("Not applicable");
    });
  };
  // Phase 7 Slice 7.1: drag-drop handlers wrap the whole row. Visual
  // feedback via the sky border when dragOver.
  const onDragEnter = (e: React.DragEvent) => {
    if (!canEdit || busy) return;
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDragOver(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!canEdit || busy) return;
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!canEdit || busy) return;
    e.preventDefault();
    setDragOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!canEdit || busy) return;
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;
    uploadMany(slot.allow_multiple ? files : files.slice(0, 1));
  };
  return (
    <div
      className={
        "rounded border bg-white p-3 transition "
        + (dragOver ? "border-sky-400 ring-2 ring-sky-200" : "border-slate-200")
      }
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm">
            <span className="font-mono text-xs text-slate-500 mr-2">{slot.code}</span>
            {slot.display_name}
            {/* Phase 8 Slice 8.4: PCH-14 is required-in-outcome (we must
                have income lines before Submit) but the AI chat below is
                an equally valid capture path, so the badge softens from
                red "(required)" to amber "(or capture by chat)". The
                canRunDraft gate is unchanged; this is UX copy only. */}
            {isRequired && slot.code === "PCH-14" ? (
              <span className="ml-2 text-xs text-amber-700">(required, or capture by chat)</span>
            ) : isRequired ? (
              <span className="ml-2 text-xs text-red-600">(required)</span>
            ) : (
              <span className="ml-2 text-xs text-slate-500">({slot.required_rule})</span>
            )}
          </div>
          {slot.why_we_need_it && (
            <div className="text-xs text-slate-500 mt-1">{slot.why_we_need_it}</div>
          )}
          <div className="text-xs text-slate-400 mt-1">
            Accepts: {slot.accepted_formats}
            {slot.allow_multiple ? " · multiple files OK" : null}
            {canEdit ? " · drag and drop here too" : null}
          </div>
          {slot.code === "PCH-14" && uploaded.length === 0 && canEdit ? (
            <div className="mt-2 rounded border border-indigo-200 bg-indigo-50 p-2 text-xs text-indigo-900">
              No bank statement to hand? Scroll down to section 3 and
              capture your income by chat instead. The chat and the upload
              both end up in the same place; use whichever is easier.
            </div>
          ) : null}
        </div>
        <div className="text-right text-xs">
          <span className={
            effectiveStatus === "Uploaded" ? "font-semibold text-emerald-700"
            : effectiveStatus === "Not applicable" ? "text-slate-500"
            : effectiveStatus === "Awaiting accountant" ? "font-semibold text-indigo-700"
            : "text-amber-700"
          }>
            {effectiveStatus === "Awaiting accountant" ? "Awaiting your accountant" : effectiveStatus}
          </span>
        </div>
      </div>
      {uploaded.length > 0 && (
        <ul className="mt-2 text-xs text-slate-600 space-y-1">
          {uploaded.map((u) => (
            <li key={u.id}>• {u.file_name} ({new Date(u.uploaded_at).toLocaleDateString()})</li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <input
          id={inputId}
          type="file"
          multiple={slot.allow_multiple}
          accept={
            slot.code === "PCH-14"
              // Bank statement accept list (Phase 7 Slice 7.1): PDF/CSV/XLSX
              // as before, plus JPG/PNG/WebP for photographed paper
              // statements. HEIC is intentionally excluded, the Claude
              // vision parser does not accept it and the server rejects
              // it with a specific re-export error.
              ? ".pdf,.csv,.xlsx,.xls,.jpg,.jpeg,.png,.webp,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,image/jpeg,image/png,image/webp"
              : ".pdf,.jpg,.jpeg,.png,.heic,.webp,application/pdf,image/*"
          }
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            uploadMany(slot.allow_multiple ? files : files.slice(0, 1));
            e.target.value = "";
          }}
        />
        <label htmlFor={inputId}
          className={"inline-block cursor-pointer rounded border border-slate-300 bg-white px-3 py-1 hover:bg-slate-50 " + (busy ? "opacity-50 cursor-not-allowed" : "")}>
          {busy
            ? (progress ? `Uploading ${progress.done}/${progress.total}...` : "Uploading...")
            : (slot.allow_multiple ? "Choose files" : "Upload")}
        </label>
        {imageSlot && canEdit && (
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            disabled={busy}
            className="rounded border border-slate-300 bg-white px-3 py-1 hover:bg-slate-50 disabled:opacity-50"
          >
            Take photo
          </button>
        )}
        {helpAvailable && !helpOpen && (
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            disabled={busy}
            className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1 text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
          >
            I don&apos;t have this document
          </button>
        )}
        {!isRequired && effectiveStatus !== "Not applicable" && (
          <button type="button" onClick={markNA} disabled={busy}
            className="rounded border border-slate-300 bg-white px-3 py-1 hover:bg-slate-50 disabled:opacity-50">
            Mark not applicable
          </button>
        )}
        {err && <span className="text-red-600">{err}</span>}
      </div>
      <CameraCaptureModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => { setCameraOpen(false); uploadMany([file]); }}
      />
      {helpAvailable && helpOpen ? (
        <AccountantHelpPrompt
          caseId={caseId}
          slotCode={slot.code}
          slotLabel={slot.display_name}
          onClose={() => setHelpOpen(false)}
          onRequested={() => setLocalStatus("Awaiting accountant")}
        />
      ) : null}
      {extractions.length > 0 ? (
        <div className="space-y-2">
          {extractions.map((ext) => (
            <ExtractionReview key={ext.id} ext={ext} canEdit={canEdit} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// -------------------- Photo ID (PCH-24, Slice 8.3) --------------------
// Replaces the generic DocRow for the Photo ID slot. The client picks
// passport or driving licence up-front; passport gets one upload, licence
// gets two labelled sub-slots (Front, Back). Each upload posts
// `photo_id_side` to the server so the vision prompt knows what to
// expect (DOB on licence back, address on licence front, both on
// passport data page).
function PhotoIdSection({
  caseId, slot, status, uploaded, extractions, canEdit, photoIdKind: initialPhotoIdKind, onChanged,
  onIdentityFieldApplied,
}: {
  caseId: string; slot: Slot; status: DocStatus | undefined;
  uploaded: UploadedDoc[]; extractions: ExtractionReviewPayload[];
  canEdit: boolean;
  photoIdKind: "passport" | "licence" | null;
  onChanged: () => void;
  onIdentityFieldApplied?: (patch: Partial<IdentityHead>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Task #14: no reload. setPchPhotoIdKindAction just writes one field
  // (passport vs licence), no AI extraction involved, so we track it
  // locally the instant it succeeds instead of reloading the page.
  const [photoIdKind, setPhotoIdKind] = useState(initialPhotoIdKind);
  const [, startActionTransition] = useTransition();
  const isRequired = /^Required/i.test(slot.required_rule);
  const effectiveStatus =
    status?.status ?? (uploaded.length ? "Uploaded" : "Awaiting");

  const pickKind = (next: "passport" | "licence") => {
    if (!canEdit || busy) return;
    startActionTransition(async () => {
      setBusy(true); setErr(null);
      // Fire before the request goes out: see the matching comment in
      // extraction-review.tsx's run() for why marking only on success
      // can lose the race against this write's own realtime push on
      // pch_cases, a watched table.
      markLocalMutation();
      const r = await setPchPhotoIdKindAction(caseId, next);
      // Refresh the mark now that the write is confirmed: see the
      // matching comment on SubmitForReviewSection's submit().
      markLocalMutation();
      setBusy(false);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setPhotoIdKind(next);
    });
  };

  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm">
            <span className="font-mono text-xs text-slate-500 mr-2">{slot.code}</span>
            {slot.display_name}
            {isRequired && <span className="ml-2 text-xs text-red-600">(required)</span>}
          </div>
          {slot.why_we_need_it && (
            <div className="text-xs text-slate-500 mt-1">{slot.why_we_need_it}</div>
          )}
        </div>
        <div className="text-right text-xs">
          <span className={
            effectiveStatus === "Uploaded" ? "font-semibold text-emerald-700"
            : effectiveStatus === "Not applicable" ? "text-slate-500"
            : "text-amber-700"
          }>
            {effectiveStatus}
          </span>
        </div>
      </div>

      {photoIdKind === null ? (
        <div className="mt-3">
          <div className="text-xs font-semibold text-slate-700">Which type of ID do you have?</div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => pickKind("passport")}
              disabled={!canEdit || busy}
              className="rounded border border-slate-300 bg-white px-3 py-3 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              <div className="font-semibold text-slate-900">Passport</div>
              <div className="text-xs text-slate-500 mt-0.5">One photo of the data page.</div>
            </button>
            <button
              type="button"
              onClick={() => pickKind("licence")}
              disabled={!canEdit || busy}
              className="rounded border border-slate-300 bg-white px-3 py-3 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              <div className="font-semibold text-slate-900">UK driving licence</div>
              <div className="text-xs text-slate-500 mt-0.5">Two photos: front and back.</div>
            </button>
          </div>
        </div>
      ) : (
        <PhotoIdSlots
          caseId={caseId}
          kind={photoIdKind}
          uploaded={uploaded}
          extractions={extractions}
          canEdit={canEdit}
          onChanged={onChanged}
          onSwitch={() => pickKind(photoIdKind === "passport" ? "licence" : "passport")}
          switching={busy}
          onIdentityFieldApplied={onIdentityFieldApplied}
        />
      )}

      {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
    </div>
  );
}

function PhotoIdSlots({
  caseId, kind, uploaded, extractions, canEdit, onChanged, onSwitch, switching,
  onIdentityFieldApplied,
}: {
  caseId: string;
  kind: "passport" | "licence";
  uploaded: UploadedDoc[];
  extractions: ExtractionReviewPayload[];
  canEdit: boolean;
  onChanged: () => void;
  onSwitch: () => void;
  switching: boolean;
  onIdentityFieldApplied?: (patch: Partial<IdentityHead>) => void;
}) {
  const switchLabel = kind === "passport"
    ? "I have a driving licence instead"
    : "I have a passport instead";
  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-700">
          {kind === "passport"
            ? "Upload a clear photo of the data page (the one with your photo and personal details)."
            : "Upload both sides of your licence. The front has your name, DOB and address; the back is just for our records."}
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={onSwitch}
            disabled={switching}
            className="text-xs text-sky-700 underline disabled:opacity-50"
          >
            {switchLabel}
          </button>
        ) : null}
      </div>

      {kind === "passport" ? (
        <PhotoIdUploadTile
          caseId={caseId}
          label="Passport data page"
          side={null}
          uploaded={uploaded.find((u) => (u.photo_id_side ?? null) === null) ?? null}
          extraction={extractions.find((e) => e.photoIdSide === null) ?? null}
          canEdit={canEdit}
          onChanged={onChanged}
          onIdentityFieldApplied={onIdentityFieldApplied}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <PhotoIdUploadTile
            caseId={caseId}
            label="Front of licence"
            side="front"
            uploaded={uploaded.find((u) => u.photo_id_side === "front") ?? null}
            extraction={extractions.find((e) => e.photoIdSide === "front") ?? null}
            canEdit={canEdit}
            onChanged={onChanged}
            onIdentityFieldApplied={onIdentityFieldApplied}
          />
          <PhotoIdUploadTile
            caseId={caseId}
            label="Back of licence"
            side="back"
            uploaded={uploaded.find((u) => u.photo_id_side === "back") ?? null}
            extraction={extractions.find((e) => e.photoIdSide === "back") ?? null}
            canEdit={canEdit}
            onChanged={onChanged}
            onIdentityFieldApplied={onIdentityFieldApplied}
          />
        </div>
      )}
    </div>
  );
}

function PhotoIdUploadTile({
  caseId, label, side, uploaded, extraction, canEdit, onChanged,
  onIdentityFieldApplied,
}: {
  caseId: string;
  label: string;
  side: "front" | "back" | null;
  uploaded: UploadedDoc | null;
  extraction: ExtractionReviewPayload | null;
  canEdit: boolean;
  onChanged: () => void;
  onIdentityFieldApplied?: (patch: Partial<IdentityHead>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Task #14: show the just-uploaded file immediately from the action's
  // own return value (id/file_name/uploaded_at, all known the moment the
  // insert succeeds) instead of waiting out the debounced reload (see
  // scheduleReload in DocSection). Front and back are two independent
  // tiles; without this, each sat on its old "Not uploaded yet" state
  // for the ~1s reload delay, which read as the upload having failed.
  const [localUploaded, setLocalUploaded] = useState<UploadedDoc | null>(uploaded);
  // See DocRow's matching comment: wrap in a transition so the uploaded
  // doc's refreshed page actually reaches the screen without a manual
  // reload.
  const [, startActionTransition] = useTransition();
  const inputId = `up-pch24-${side ?? "passport"}`;
  const effectiveUploaded = localUploaded ?? uploaded;

  const upload = (file: File) => {
    startActionTransition(async () => {
      setBusy(true); setErr(null);
      const fd = new FormData();
      fd.set("file", file);
      if (side) fd.set("photo_id_side", side);
      try {
        const r = await uploadPchDocumentAction(caseId, "PCH-24", fd);
        if (!r.ok) {
          setErr(r.error);
        } else {
          markLocalMutation();
          setLocalUploaded({
            id: r.id,
            file_name: r.file_name,
            uploaded_at: r.uploaded_at,
            requirement_key: "PCH-24",
            photo_id_side: side,
          });
        }
      } catch (e) {
        setErr(e instanceof Error ? "Upload failed: " + e.message : "Upload failed. Try again.");
      } finally {
        setBusy(false);
        onChanged();
      }
    });
  };

  return (
    <div className="rounded border border-slate-200 bg-slate-50/40 p-3">
      <div className="text-xs font-semibold text-slate-800">{label}</div>
      {effectiveUploaded ? (
        <div className="mt-1 text-xs text-slate-600">
          <span className="text-emerald-700 font-medium">Uploaded:</span> {effectiveUploaded.file_name}
          {" "}
          <span className="text-slate-400">({new Date(effectiveUploaded.uploaded_at).toLocaleDateString()})</span>
        </div>
      ) : (
        <div className="mt-1 text-xs text-amber-700">Not uploaded yet.</div>
      )}
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <input
          id={inputId}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,application/pdf,image/*"
          className="hidden"
          disabled={!canEdit || busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
        <label
          htmlFor={inputId}
          className={
            "inline-block cursor-pointer rounded border border-slate-300 bg-white px-3 py-1 hover:bg-slate-50 "
            + (busy || !canEdit ? "opacity-50 cursor-not-allowed" : "")
          }
        >
          {busy ? "Uploading..." : effectiveUploaded ? "Replace" : "Upload"}
        </label>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            disabled={busy}
            className="rounded border border-slate-300 bg-white px-3 py-1 hover:bg-slate-50 disabled:opacity-50"
          >
            Take photo
          </button>
        ) : null}
      </div>
      {err ? <div className="mt-2 text-xs text-rose-700">{err}</div> : null}
      <CameraCaptureModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => { setCameraOpen(false); upload(file); }}
      />
      {extraction ? (
        <div className="mt-2">
          <ExtractionReview ext={extraction} canEdit={canEdit} onIdentityFieldApplied={onIdentityFieldApplied} />
        </div>
      ) : null}
    </div>
  );
}

// -------------------- Tab 1 Identity (Phase 6 Slice 1) ---------------
// Narrows the loose head bag into the typed shape IdentitySection
// consumes. Only the six fields the section actually renders.

function headToIdentity(h: Head): IdentityHead {
  const str = (k: string): string | null => {
    const v = h[k];
    return typeof v === "string" ? v : v == null ? null : String(v);
  };
  return {
    cl_name: str("cl_name"),
    cl_dob: str("cl_dob"),
    cl_address: str("cl_address"),
    cl_postcode: str("cl_postcode"),
    cl_utr: str("cl_utr"),
    cl_nino: str("cl_nino"),
  };
}

function vehicleToSummary(v: Vehicle | null): VehicleSummary | null {
  if (!v) return null;
  const str = (k: string): string | null => {
    const x = v[k];
    return typeof x === "string" ? x : x == null ? null : String(x);
  };
  const num = (k: string): number | null => {
    const x = v[k];
    if (x == null) return null;
    const n = typeof x === "number" ? x : Number(x);
    return Number.isFinite(n) ? n : null;
  };
  return {
    status: str("status"),
    fuel: str("fuel"),
    make_model: str("make_model"),
    registration: str("registration"),
    co2_gpkm: num("co2_gpkm"),
    purchase_date: str("purchase_date"),
    purchase_price_pence: num("purchase_price_pence"),
    new_or_used: str("new_or_used"),
    business_pct_override: num("business_pct_override"),
    disposed: v.disposed === true || v.disposed === "true",
    disposal_proceeds_pence: num("disposal_proceeds_pence"),
    disposal_date: str("disposal_date"),
  };
}


function SnapshotTable({ s }: { s: TaxEngineOutput }) {
  const money = (n: number) =>
    "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const row = (label: string, v: string | number) => (
    <tr><td className="py-1 pr-4 text-slate-600">{label}</td>
      <td className="py-1 font-medium text-right">{typeof v === "number" ? money(v) : v}</td></tr>
  );
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
      <div>
        <h4 className="text-sm font-bold mb-2">Tax &amp; NIC</h4>
        <table className="w-full text-sm">
          <tbody>
            {row("Income tax", s.tax.incomeTax)}
            {row("Class 4 NIC", s.tax.class4)}
            {row("Total due", s.tax.totalTaxAndNic)}
            {row("Balancing payment (31 Jan)", s.tax.balancingPayment)}
            {row("POA each (next year)", s.tax.poaForNextYear)}
            {row("MTD status", s.mtd.status)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Final sign-off control. Only rendered when the parent has confirmed
// status is client_approval and a snapshot exists; both guards also
// enforced server-side by recordClientApprovalAction.
function ApprovalSection({
  caseId, snapshotAt, approvalAt, approvalName,
}: {
  caseId: string; snapshotAt: string | null;
  approvalAt: string | null; approvalName: string | null;
}) {
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  // Task #14: no reload. recordClientApprovalAction only writes
  // client_approval_name/client_approval_at (see actions.ts); it doesn't
  // touch cases.status, so we already know exactly what to show.
  const [localApproval, setLocalApproval] = useState<{ at: string; name: string } | null>(
    approvalAt && approvalName ? { at: approvalAt, name: approvalName } : null,
  );
  void snapshotAt;

  if (localApproval) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
        <p className="text-sm">
          <strong>Figures approved</strong> by {localApproval.name} on{" "}
          {new Date(localApproval.at).toLocaleString()}. Your accountant will prepare the
          final accounts pack next.
        </p>
      </div>
    );
  }
  const submit = () => start(async () => {
    // Fire before the request goes out: see the matching comment in
    // extraction-review.tsx's run() for why marking only on success
    // can lose the race against this write's own realtime push on
    // cases/pch_cases, both watched tables.
    markLocalMutation();
    const trimmed = name.trim();
    const r = await recordClientApprovalAction(caseId, trimmed);
    // Refresh the mark now that the write is confirmed: see the
    // matching comment on SubmitForReviewSection's submit().
    markLocalMutation();
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setErr(null);
    setLocalApproval({ at: new Date().toISOString(), name: trimmed });
  });
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <p className="text-sm text-slate-700">
        By typing your name below I approve the attached Profit and Loss Account for the year
        ended 5 April 2026 and authorise my accountant to prepare the final accounts pack for
        filing on this basis. Your accountant will send a final pack for you to confirm before
        anything goes to HMRC.
      </p>
      <div className="flex items-center gap-3">
        <input
          className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
          placeholder="Type your full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="button" onClick={submit} disabled={pending || name.trim().length < 2}
          className="rounded bg-slate-900 px-4 py-1.5 text-white text-sm disabled:opacity-50">
          {pending ? "Approving..." : "Approve figures"}
        </button>
      </div>
      {err && <p className="text-red-600 text-xs">{err}</p>}
    </div>
  );
}
