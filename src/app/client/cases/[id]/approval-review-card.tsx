"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";
import { formatDateTime } from "@/lib/format";
import type { ActionResult } from "@/lib/action-result";

type AccountantDoc = {
  id: string;
  file_name: string;
  file_url: string;
  uploaded_at: string;
};

type Props = {
  ctLiabilityPence: number;
  hmrcPaymentReference: string | null;
  note: string | null;
  preparedAt: string | null;
  annualAccounts: AccountantDoc[];
  ct600: AccountantDoc[];
  getDocUrl: (path: string) => Promise<ActionResult<string>>;
  approve: () => Promise<{ ok: true } | { ok: false; error: string }>;
  disabled?: boolean;
};

// Full review payload: CT amount + HMRC reference + accountant note +
// clickable accountant uploads + Approve & file. Replaces the simpler
// ApproveAndFileButton banner for limited-company cases where the
// approval_payload is populated. Dormant / personal cases fall back to
// the plain button since there's no CT liability to show.
export function ApprovalReviewCard({
  ctLiabilityPence,
  hmrcPaymentReference,
  note,
  preparedAt,
  annualAccounts,
  ct600,
  getDocUrl,
  approve,
  disabled,
}: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pounds = (ctLiabilityPence / 100).toFixed(2);

  return (
    <div
      className="mb-8 rounded-2xl border p-5 sm:p-6"
      style={{
        background:
          "linear-gradient(135deg, rgba(25,156,217,0.08), rgba(19,217,160,0.10))",
        borderColor: "rgba(25,156,217,0.35)",
      }}
    >
      <p
        className="text-[11px] font-bold uppercase tracking-widest text-navy-deep"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Awaiting your approval
      </p>
      <h3 className="mt-1 text-base font-semibold text-ink">
        Your accountant has prepared your return
      </h3>
      {preparedAt ? (
        <p className="mt-0.5 text-xs text-slate">
          Prepared {formatDateTime(preparedAt)}
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-paper p-4">
          <span
            className="text-[10px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Corporation Tax due
          </span>
          <p className="mt-1 text-xl font-bold text-ink">£{pounds}</p>
        </div>
        <div className="rounded-xl border border-line bg-paper p-4">
          <span
            className="text-[10px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            HMRC payment reference
          </span>
          <p className="mt-1 break-all text-sm font-semibold text-ink">
            {hmrcPaymentReference ?? (
              <span className="italic text-slate">(not provided)</span>
            )}
          </p>
        </div>
      </div>

      {note ? (
        <div className="mt-4 rounded-xl border border-line bg-paper p-4 text-sm text-ink">
          <span
            className="text-[10px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Note from your accountant
          </span>
          <p className="mt-1 whitespace-pre-wrap">{note}</p>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <AccountantDocBlock
          label="Annual Accounts"
          docs={annualAccounts}
          getDocUrl={getDocUrl}
        />
        <AccountantDocBlock
          label="CT600"
          docs={ct600}
          getDocUrl={getDocUrl}
        />
      </div>

      {hmrcPaymentReference ? (
        <p className="mt-4 text-xs text-slate">
          Pay Corporation Tax to HMRC at{" "}
          <a
            href="https://www.gov.uk/pay-corporation-tax"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
          >
            gov.uk/pay-corporation-tax
          </a>{" "}
          using the reference above.
        </p>
      ) : null}

      <form
        action={() => {
          setError(null);
          start(async () => {
            const res = await approve();
            if (!res.ok) setError(res.error);
          });
        }}
        className="mt-5"
      >
        <SLButton
          type="submit"
          variant="primary"
          block
          disabled={pending || disabled}
        >
          {pending ? "Approving…" : "Approve and file"}
        </SLButton>
      </form>
      <p className="mt-2 text-center text-xs text-slate">
        Nothing is filed with HMRC or Companies House until you click
        Approve.
      </p>

      {error ? (
        <p
          className="mt-3 rounded-lg px-3 py-2 text-sm font-medium text-red-700"
          role="alert"
          style={{ background: "rgba(220,38,38,0.08)" }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function AccountantDocBlock({
  label,
  docs,
  getDocUrl,
}: {
  label: string;
  docs: AccountantDoc[];
  getDocUrl: (path: string) => Promise<ActionResult<string>>;
}) {
  return (
    <div className="rounded-xl border border-line bg-paper p-4">
      <span
        className="text-[10px] font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </span>
      {docs.length === 0 ? (
        <p className="mt-1 text-sm italic text-slate">(not provided)</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {docs.map((d) => (
            <DocLink key={d.id} doc={d} getDocUrl={getDocUrl} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DocLink({
  doc,
  getDocUrl,
}: {
  doc: AccountantDoc;
  getDocUrl: (path: string) => Promise<ActionResult<string>>;
}) {
  const [opening, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleOpen = () => {
    setError(null);
    start(async () => {
      const res = await getDocUrl(doc.file_url);
      if (res.ok) {
        window.open(res.data, "_blank", "noopener,noreferrer");
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <li>
      <button
        type="button"
        onClick={handleOpen}
        disabled={opening}
        className="truncate text-left text-sm font-semibold text-navy-deep underline underline-offset-4 hover:text-sky disabled:opacity-50"
      >
        {opening ? "Opening…" : doc.file_name}
      </button>
      {error ? (
        <p className="text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
