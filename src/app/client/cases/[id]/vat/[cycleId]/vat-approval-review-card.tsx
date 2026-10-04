"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";
import { formatDateTime } from "@/lib/format";
import type { ActionResult } from "@/lib/action-result";
import {
  BOX_5_NEUTRAL_OR_REFUND_COPY,
  box5Mode,
  type VatApprovalPayload,
} from "@/lib/vat/cycle";

type ReturnDoc = {
  id: string;
  file_name: string;
  file_url: string;
  uploaded_at: string;
};

type Props = {
  payload: VatApprovalPayload;
  periodLabel: string;
  hmrcDueDate: string;
  vatRegistrationNumber: string | null;
  returnDocs: ReturnDoc[];
  getDocUrl: (path: string) => Promise<ActionResult<string>>;
  approve: () => Promise<{ ok: true } | { ok: false; error: string }>;
  disabled?: boolean;
};

// Full VAT approval review. Box 5 drives the headline amount + the
// zero/refund conditional copy (mirrors Batch 4's CT pattern). HMRC
// payment reference is the client's own 9-digit VAT number from
// Section D, surfaced here read-only.
export function VatApprovalReviewCard({
  payload,
  periodLabel,
  hmrcDueDate,
  vatRegistrationNumber,
  returnDocs,
  getDocUrl,
  approve,
  disabled,
}: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const mode = box5Mode(payload.box_5_pence);
  const payPounds = (payload.box_5_pence / 100).toFixed(2);
  const refundPounds =
    payload.box_5_pence < 0
      ? (Math.abs(payload.box_5_pence) / 100).toFixed(2)
      : "0.00";

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
        Your VAT return is ready for {periodLabel}
      </h3>
      {payload.prepared_at ? (
        <p className="mt-0.5 text-xs text-slate">
          Prepared {formatDateTime(payload.prepared_at)}
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-paper p-4">
          <span
            className="text-[10px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {mode === "pay" ? "Net VAT to pay" : "Net VAT position"}
          </span>
          <p className="mt-1 text-xl font-bold text-ink">
            {mode === "pay"
              ? `£${payPounds}`
              : payload.box_5_pence < 0
                ? `Refund £${refundPounds}`
                : "£0.00"}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper p-4">
          <span
            className="text-[10px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            HMRC payment reference
          </span>
          <p className="mt-1 break-all text-sm font-semibold text-ink">
            {vatRegistrationNumber ?? (
              <span className="italic text-slate">(VAT number not set)</span>
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-slate">
            Your 9-digit VAT Registration Number is HMRC&apos;s reference
            for this payment.
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper p-4 sm:col-span-2">
          <span
            className="text-[10px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Due to HMRC
          </span>
          <p className="mt-1 text-sm font-semibold text-ink">
            {hmrcDueDate}
          </p>
        </div>
      </div>

      {mode === "neutral_or_refund" ? (
        <p className="mt-4 rounded-xl border border-line bg-paper p-4 text-sm text-ink">
          {BOX_5_NEUTRAL_OR_REFUND_COPY}
        </p>
      ) : null}

      <div className="mt-5 rounded-xl border border-line bg-paper p-4">
        <h4
          className="text-[10px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          VAT100 breakdown
        </h4>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          {[
            ["Box 1", payload.box_1_pence, "VAT due on sales"],
            [
              "Box 2",
              payload.box_2_pence,
              "VAT due on EU acquisitions",
            ],
            ["Box 3", payload.box_3_pence, "Total VAT due"],
            [
              "Box 4",
              payload.box_4_pence,
              "VAT reclaimed on purchases",
            ],
            ["Box 5", payload.box_5_pence, "Net VAT"],
            ["Box 6", payload.box_6_pence, "Total sales ex VAT"],
            [
              "Box 7",
              payload.box_7_pence,
              "Total purchases ex VAT",
            ],
            ["Box 8", payload.box_8_pence, "EU sales ex VAT"],
            [
              "Box 9",
              payload.box_9_pence,
              "EU acquisitions ex VAT",
            ],
          ].map(([label, pence, hint]) => (
            <div
              key={label as string}
              className="flex items-baseline justify-between gap-3 border-b border-line pb-1 last:border-0"
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold text-ink">
                  {label}
                </div>
                <div className="text-[11px] text-slate">{hint}</div>
              </div>
              <div className="shrink-0 text-sm font-semibold text-ink">
                £{((pence as number) / 100).toFixed(2)}
              </div>
            </div>
          ))}
        </dl>
      </div>

      {payload.note ? (
        <div className="mt-4 rounded-xl border border-line bg-paper p-4 text-sm text-ink">
          <span
            className="text-[10px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Note from your accountant
          </span>
          <p className="mt-1 whitespace-pre-wrap">{payload.note}</p>
        </div>
      ) : null}

      <div className="mt-5">
        <h4
          className="text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          VAT return document
        </h4>
        {returnDocs.length === 0 ? (
          <p className="mt-1 text-xs italic text-slate">(not provided)</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {returnDocs.map((d) => (
              <ReturnDocLink key={d.id} doc={d} getDocUrl={getDocUrl} />
            ))}
          </ul>
        )}
      </div>

      {mode === "pay" ? (
        <p className="mt-4 text-xs text-slate">
          Pay HMRC at{" "}
          <a
            href="https://www.gov.uk/pay-vat"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
          >
            gov.uk/pay-vat
          </a>{" "}
          using your VAT Registration Number as the reference.
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
        Nothing is filed with HMRC until you click Approve.
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

function ReturnDocLink({
  doc,
  getDocUrl,
}: {
  doc: ReturnDoc;
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
