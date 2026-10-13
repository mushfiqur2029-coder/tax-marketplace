"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { SLButton } from "@/components/sl-button";
import type { ActionResult } from "@/lib/action-result";

type Accountant = { id: string; name: string | null; email: string };

type Props = {
  enquiryId: string;
  accountants: Accountant[];
  createCase: (
    enquiryId: string,
    feeGbp: number,
    depositGbp: number,
    commissionGbp: number,
    accountantId: string,
    note: string | null,
  ) => Promise<ActionResult<{ caseId: string }>>;
};

// Admin-side form on the enquiry card. Captures a whole-£ total fee +
// a whole-£ deposit + a whole-£ accountant commission + an accountant
// + an optional note, then calls createBespokeCaseFromEnquiryAction.
// Deposit is paid upfront via Stripe before work starts; the balance
// (total - deposit) is billed at approval. Commission is the direct £
// amount the accountant earns for this engagement on completion -
// NOT a percentage of anything, admin decides it per engagement.
// Fees are whole £ only per the product constraint; the server
// stores them as pence.
export function BespokeCaseForm({ enquiryId, accountants, createCase }: Props) {
  const [fee, setFee] = useState<string>("");
  const [deposit, setDeposit] = useState<string>("");
  const [commission, setCommission] = useState<string>("");
  const [accountantId, setAccountantId] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ caseId: string } | null>(null);
  const [pending, start] = useTransition();
  // Confirmation step. Create button opens a modal; admin has to
  // re-type the deal summary (£total / £deposit / £commission) to
  // enable the final confirm. Matches the type-to-confirm pattern
  // in RemoveAdminButton. Reason: the form's own copy warns the
  // numbers can't be edited after creation, but it still submitted
  // on a single click - this closes the gap for muscle-memory
  // mistypes and double-clicks.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");

  if (accountants.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-dashed border-line bg-cloud/40 p-4 text-sm text-slate">
        No approved accountants yet. Approve one before quoting bespoke cases.
      </div>
    );
  }

  if (success) {
    return (
      <div
        className="mt-4 rounded-xl border p-4 text-sm"
        style={{
          borderColor: "rgba(19, 217, 160, 0.4)",
          background: "rgba(19, 217, 160, 0.08)",
        }}
      >
        <div className="font-semibold text-ink">
          Case created and sent to the client.
        </div>
        <div className="mt-1 text-slate">
          The client sees the quote in their bell and lands on the engagement
          letter from the dashboard.
        </div>
        <Link
          href={`/admin/cases/${success.caseId}`}
          className="mt-2 inline-block text-xs font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
        >
          Open case
        </Link>
      </div>
    );
  }

  const feeNum = Number(fee);
  const depositNum = Number(deposit);
  const commissionNum = Number(commission);
  // Fee + deposit: both whole £ > 0, deposit strictly less than total
  // so the balance is at least £1. Commission: whole £ > 0, must not
  // exceed total (accountant can't earn more than the client pays) -
  // but is otherwise a free admin figure, not tied to any formula.
  // Server re-enforces every rule.
  const feeValid =
    Number.isInteger(feeNum) && feeNum > 0;
  const depositValid =
    Number.isInteger(depositNum) && depositNum > 0;
  const commissionValid =
    Number.isInteger(commissionNum) && commissionNum > 0;
  const splitValid = feeValid && depositValid && depositNum < feeNum;
  const commissionWithinFee =
    feeValid && commissionValid && commissionNum <= feeNum;
  const allValid = splitValid && commissionWithinFee;
  const canSubmit = accountantId !== "" && allValid && !pending;
  const balancePreview = splitValid ? feeNum - depositNum : null;

  // Deal summary used as the type-to-confirm string. Admin has to
  // re-type this exactly so the numbers are read a second time -
  // if they fat-fingered a zero on fee or deposit, it shows here.
  const confirmPhrase = `£${feeNum} / £${depositNum} / £${commissionNum}`;
  const typedMatches =
    typed.trim().replace(/\s+/g, " ") === confirmPhrase;

  const onConfirm = () => {
    setError(null);
    start(async () => {
      const res = await createCase(
        enquiryId,
        feeNum,
        depositNum,
        commissionNum,
        accountantId,
        note.trim() || null,
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConfirmOpen(false);
      setSuccess({ caseId: res.data.caseId });
    });
  };

  return (
    <div className="mt-4 rounded-xl border border-line bg-paper p-4">
      <div
        className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Create case from this enquiry
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span
            className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Total fee (whole £)
          </span>
          <input
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            placeholder="e.g. 1500"
            className="input-sl"
          />
        </label>
        <label className="block">
          <span
            className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Deposit (whole £, payable now)
          </span>
          <input
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
            placeholder="e.g. 500"
            className="input-sl"
            aria-describedby="bespoke-balance-preview"
          />
        </label>
        <label className="block">
          <span
            className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Accountant commission (whole £)
          </span>
          <input
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
            placeholder="e.g. 800"
            className="input-sl"
            aria-describedby="bespoke-commission-note"
          />
        </label>
        <label className="block">
          <span
            className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Accountant
          </span>
          <select
            value={accountantId}
            onChange={(e) => setAccountantId(e.target.value)}
            className="input-sl"
          >
            <option value="">Pick an accountant.</option>
            {accountants.map((a) => (
              <option key={a.id} value={a.id}>
                {(a.name?.trim() || a.email) + ` <${a.email}>`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p
        id="bespoke-balance-preview"
        className="mt-2 text-xs text-slate"
      >
        {balancePreview !== null ? (
          <>
            Balance on approval:{" "}
            <strong className="text-ink">
              £{balancePreview.toLocaleString("en-GB")}
            </strong>
          </>
        ) : feeValid && depositValid && depositNum >= feeNum ? (
          <span className="font-medium text-red-700">
            Deposit must be less than total so there&rsquo;s a balance to collect at approval.
          </span>
        ) : (
          "Deposit charged on sign; balance charged automatically when the client approves the prepared work."
        )}
      </p>
      <p
        id="bespoke-commission-note"
        className="mt-1 text-xs text-slate"
      >
        {commissionValid && feeValid && commissionNum > feeNum ? (
          <span className="font-medium text-red-700">
            Commission can&rsquo;t exceed the total fee the client pays.
          </span>
        ) : (
          "Flat payout to the accountant on case complete. Not a percentage of the fee; set it per engagement."
        )}
      </p>
      <label className="mt-3 block">
        <span
          className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Note for client (optional)
        </span>
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Appears in the client's notification."
          className="input-sl"
        />
      </label>
      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg px-3 py-2 text-sm font-medium text-red-700"
          style={{ background: "rgba(220,38,38,0.08)" }}
        >
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <SLButton
          type="button"
          variant="primary"
          disabled={!canSubmit}
          onClick={() => {
            setTyped("");
            setError(null);
            setConfirmOpen(true);
          }}
          className="w-full sm:w-auto"
        >
          Create case
        </SLButton>
        <span className="text-xs text-slate">
          Enquiry auto-closes. Fee split can&rsquo;t be edited after creation. Cancel
          and re-create if the numbers are wrong.
        </span>
      </div>

      {confirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{
            background: "rgba(15,30,77,0.45)",
            backdropFilter: "blur(2px)",
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="bespoke-confirm-heading"
        >
          <div className="card-sl w-full max-w-md p-6 sm:p-7">
            <h3
              id="bespoke-confirm-heading"
              className="text-lg font-semibold text-ink"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Confirm bespoke case numbers?
            </h3>
            <p className="mt-2 text-sm text-slate">
              Once created, the fee split can&rsquo;t be edited. The client is
              billed from these numbers, the accountant is paid the commission
              on complete, and the audit log records the exact figures.
            </p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate">Total fee</dt>
              <dd className="font-semibold text-ink">
                £{feeNum.toLocaleString("en-GB")}
              </dd>
              <dt className="text-slate">Deposit (payable now)</dt>
              <dd className="font-semibold text-ink">
                £{depositNum.toLocaleString("en-GB")}
              </dd>
              <dt className="text-slate">Balance (on approval)</dt>
              <dd className="font-semibold text-ink">
                £{(feeNum - depositNum).toLocaleString("en-GB")}
              </dd>
              <dt className="text-slate">Accountant commission</dt>
              <dd className="font-semibold text-ink">
                £{commissionNum.toLocaleString("en-GB")}
              </dd>
            </dl>
            <label className="mt-4 block">
              <span
                className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Type <code>{confirmPhrase}</code> to confirm
              </span>
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={confirmPhrase}
                autoComplete="off"
                className="input-sl"
                autoFocus
              />
            </label>
            {error ? (
              <p
                role="alert"
                className="mt-3 rounded-lg px-3 py-2 text-sm font-medium text-red-700"
                style={{ background: "rgba(220,38,38,0.08)" }}
              >
                {error}
              </p>
            ) : null}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end sm:gap-3">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={pending}
                className="rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink hover:border-sky/50 disabled:opacity-60"
              >
                Cancel
              </button>
              <SLButton
                type="button"
                variant="primary"
                disabled={!typedMatches || pending}
                onClick={onConfirm}
              >
                {pending ? "Creating…" : "Create case"}
              </SLButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Compact row shown instead of the form when a case has already been
// created from this enquiry.
export function BespokeCaseExistingLink({
  caseId,
  feePence,
}: {
  caseId: string;
  feePence: number;
}) {
  return (
    <div
      className="mt-4 rounded-xl border p-4 text-sm"
      style={{
        borderColor: "rgba(25,156,217,0.4)",
        background: "rgba(25,156,217,0.04)",
      }}
    >
      <div className="font-semibold text-ink">
        Case already created for £{(feePence / 100).toLocaleString("en-GB")}.
      </div>
      <Link
        href={`/admin/cases/${caseId}`}
        className="mt-1 inline-block text-xs font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
      >
        Open case
      </Link>
    </div>
  );
}
