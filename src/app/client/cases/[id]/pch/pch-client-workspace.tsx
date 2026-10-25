"use client";

import type { TaxEngineOutput } from "@/lib/tax-engine";
import { useLiveRow, useLiveList } from "@/lib/realtime-live-merge";
import { recordClientApprovalAction } from "@/app/client/pch/actions";
import { useState, useTransition } from "react";
import { startAddonCheckoutAction } from "@/app/client/actions";
import { AddonPayBanner } from "../addon-pay-banner";
import { FinalPackReview } from "./final-pack-review";
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
  engineSnapshot: TaxEngineOutput | null;
  engineSnapshotAt: string | null;
  approvalAt: string | null;
  approvalName: string | null;
  section1Initial: Section1InitialHead;
  licenceDocs: Section1LicenceDoc[];
  pch24Extractions: Section1Pch24Extraction[];
  incomeLines: IncomeLine[];
  expenseLines: ExpenseLine[];
  vehicleInitial: VehicleInitial;
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
        if (
          typeof id !== "string" || typeof description !== "string"
          || typeof amount_pence !== "number" || typeof addonStatus !== "string"
        ) return null;
        return { id, description, amount_pence, status: addonStatus };
      },
    },
  );
  const liveAddons = liveAddonsAll.filter((a) => a.status === "pending_payment");

  const editable =
    status === "submitted" || status === "in_review" || status === "prepared";
  const withAccountant = status === "in_review" || status === "prepared";
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
          approvalAt={liveHead.client_approval_at}
          approvalName={liveHead.client_approval_name}
        />
      ) : (
        <IntakeProgressProvider initial={initialCompletionFromProps(props)}>
          {withAccountant ? <WithAccountantBanner /> : null}

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

          <Section2Income
            caseId={props.caseId}
            editable={editable}
            initial={props.incomeLines}
          />

          <Section3Expenses
            caseId={props.caseId}
            editable={editable}
            initial={props.expenseLines}
            caseFeePence={props.caseFeePence}
          />

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
          />
        </IntakeProgressProvider>
      )}

      <div className="mt-10">{props.messagesPanel}</div>
    </main>
  );
}

// Submit for review: runs the engine server-side and parks the case
// in the shared accountant queue. Status flip to in_review happens
// on accountant pickup, not here. Only renders while the case is
// still at status='submitted'; after that the accountant has it
// and the submit path is irrelevant.
//
// Phase G: the button is disabled while any section is still amber
// in the progress bar. If a server-side rejection ever beats the
// client-side gate (stale state, race), highlightPending() paints
// the matching chips amber and we smooth-scroll back to the bar.
function SubmitForReviewSection({
  caseId, status,
}: {
  caseId: string;
  status: string;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<boolean>(status !== "submitted");
  const { pendingKeys, highlightPending } = useIntakeProgress();

  if (status !== "submitted" && !submitted) return null;

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
    setSubmitted(true);
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
        for your approval. You can keep editing until they pick it up.
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
  return (
    <section className="mb-6 rounded-xl border border-sky-200 bg-sky-50 p-5">
      <div
        className="text-[11px] font-semibold uppercase tracking-widest text-sky-900"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Your accountant is reviewing
      </div>
      <h2 className="mt-1 text-base font-semibold text-ink">
        We've got your return. No action needed right now.
      </h2>
      <p className="mt-2 text-sm text-slate-700">
        You can still add documents or correct a figure below if you spot
        something. We'll email you when the figures are ready to
        approve.
      </p>
    </section>
  );
}

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
          Review them, then approve to file. Message your accountant first
          if anything looks wrong.
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

function FiledView(props: {
  snapshot: TaxEngineOutput;
  approvalAt: string | null;
  approvalName: string | null;
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
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <SnapshotTable s={props.snapshot} />
      </div>
    </div>
  );
}

function SnapshotTable({ s }: { s: TaxEngineOutput }) {
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
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
          {new Date(localApproval.at).toLocaleString()}. Your accountant will prepare the
          final accounts pack next.
        </p>
      </div>
    );
  }
  const submit = () => start(async () => {
    markLocalMutation();
    const trimmed = name.trim();
    const r = await recordClientApprovalAction(caseId, trimmed);
    markLocalMutation();
    if (!r.ok) { setErr(r.error); return; }
    setErr(null);
    setLocalApproval({ at: new Date().toISOString(), name: trimmed });
  });
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <p className="text-sm text-slate-700">
        By typing your name below I approve the attached Profit and Loss
        Account for the year ended 5 April 2026 and authorise my
        accountant to prepare the final accounts pack for filing on this
        basis. Your accountant will send a final pack for you to confirm
        before anything goes to HMRC.
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
