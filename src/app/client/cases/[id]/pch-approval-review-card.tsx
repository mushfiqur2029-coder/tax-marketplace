"use client";

// Phase I.5 client-facing approval card for PCH cases at status =
// client_approval. Shown INSTEAD of the generic ApprovalReviewCard /
// ApproveAndFileButton on uber_phv_automated cases.
//
// Shape mirrors ApprovalReviewCard but with four doc blocks (SA
// Forwarding Letter, PCH Accounts, SA302, SA100) and a typed-name
// signature input the client has to fill before Approve enables. On
// submit the server action writes the signature + timestamp to pch_
// cases and flips cases.status client_approval -> filed via the
// shared helper.

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";
import type { ActionResult } from "@/lib/action-result";

type DocBlock = {
  label: string;
  path: string | null;
};

type Props = {
  docs: {
    saForwardingPdfPath: string | null;
    pchAccountsPdfPath: string | null;
    sa302UploadPath: string | null;
    sa100UploadPath: string | null;
  };
  sentAt: string | null;
  getDocUrl: (path: string) => Promise<ActionResult<string>>;
  approve: (signatureName: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  disabled?: boolean;
};

export function PchApprovalReviewCard({
  docs, sentAt, getDocUrl, approve, disabled,
}: Props) {
  const [signatureName, setSignatureName] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const docBlocks: DocBlock[] = [
    { label: "SA Tax Return forwarding letter", path: docs.saForwardingPdfPath },
    { label: "PCH Accounts", path: docs.pchAccountsPdfPath },
    { label: "SA302", path: docs.sa302UploadPath },
    { label: "SA100", path: docs.sa100UploadPath },
  ];

  const trimmedName = signatureName.trim();
  const canApprove = trimmedName.length >= 2 && !pending && !disabled;

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
      {sentAt ? (
        <p className="mt-0.5 text-xs text-slate">
          Sent for your approval {new Date(sentAt).toLocaleString("en-GB")}
        </p>
      ) : null}
      <p className="mt-3 text-sm text-slate">
        Open each document, check the figures and your details, then
        type your full name below to approve. Nothing is filed with
        HMRC until you approve.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {docBlocks.map((d) => (
          <PchDocBlock key={d.label} doc={d} getDocUrl={getDocUrl} />
        ))}
      </div>

      <form
        action={() => {
          setError(null);
          start(async () => {
            const res = await approve(trimmedName);
            if (res.ok) {
              // Mirrors the limited-company ApproveAndFileButton
              // behaviour: a reload is the honest way to show the
              // status flip from client_approval to filed on this
              // page, since the whole CTA + progress band changes.
              window.location.reload();
            } else {
              setError(res.error);
            }
          });
        }}
        className="mt-5 space-y-3"
      >
        <label className="block">
          <span
            className="text-[10px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Type your full name to sign
          </span>
          <input
            type="text"
            value={signatureName}
            onChange={(e) => setSignatureName(e.target.value)}
            placeholder="Full name"
            disabled={pending || disabled}
            autoComplete="name"
            className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
          />
          <span className="mt-1 block text-[11px] text-slate">
            Required. Treated as your signature on these documents.
          </span>
        </label>
        <SLButton type="submit" variant="primary" block disabled={!canApprove}>
          {pending ? "Approving." : "Approve and file"}
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

function PchDocBlock({
  doc, getDocUrl,
}: {
  doc: DocBlock;
  getDocUrl: (path: string) => Promise<ActionResult<string>>;
}) {
  const [opening, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const open = () => {
    if (!doc.path) return;
    setErr(null);
    start(async () => {
      const r = await getDocUrl(doc.path!);
      if (r.ok) {
        window.open(r.data, "_blank", "noopener,noreferrer");
      } else {
        setErr(r.error);
      }
    });
  };

  return (
    <div className="rounded-xl border border-line bg-paper p-4">
      <span
        className="text-[10px] font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {doc.label}
      </span>
      {doc.path ? (
        <button
          type="button"
          onClick={open}
          disabled={opening}
          className="mt-1 block text-left text-sm font-semibold text-navy-deep underline underline-offset-4 hover:text-sky disabled:opacity-50"
        >
          {opening ? "Opening." : "Open document"}
        </button>
      ) : (
        <p className="mt-1 text-sm italic text-slate">(not provided)</p>
      )}
      {err ? (
        <p className="mt-1 text-xs font-medium text-red-700" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}
