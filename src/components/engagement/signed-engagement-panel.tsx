"use client";

import { useEffect, useState, useTransition } from "react";
import { formatDateTime } from "@/lib/format";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  signedAt: string;
  // Server actions bound by the parent page to the case id. Returns a
  // short-lived signed URL to the stored PDF or signature image.
  getPdfUrl: () => Promise<ActionResult<string>>;
  getSignatureUrl: () => Promise<ActionResult<string>>;
};

// Admin + accountant case-detail panel for the signed engagement letter.
// Opens the PDF in a new tab on click; the signature image is fetched
// once on mount so the thumbnail renders inline without a user action.
// Both URLs are 60-second signed URLs minted on the server, so this
// component itself is harmless as HTML (no permanent URLs embedded).
export function SignedEngagementPanel({
  signedAt,
  getPdfUrl,
  getSignatureUrl,
}: Props) {
  const [sigUrl, setSigUrl] = useState<string | null>(null);
  const [sigError, setSigError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getSignatureUrl();
      if (cancelled) return;
      if (res.ok) setSigUrl(res.data);
      else setSigError(res.error);
    })();
    return () => {
      cancelled = true;
    };
    // Bind once per mount; the server action is bound to this case by the
    // parent and doesn't change across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openPdf = () => {
    setPdfError(null);
    start(async () => {
      const res = await getPdfUrl();
      if (res.ok) window.open(res.data, "_blank", "noopener");
      else setPdfError(res.error);
    });
  };

  return (
    <div className="rounded-xl border border-line bg-paper p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-ink">
            Engagement letter signed
          </div>
          <div className="text-xs text-slate">
            {formatDateTime(signedAt)}
          </div>
        </div>
        <button
          type="button"
          onClick={openPdf}
          disabled={pending}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-navy-deep transition hover:bg-sky/10 disabled:opacity-50"
        >
          {pending ? "Opening…" : "View signed PDF"}
        </button>
      </div>
      {pdfError ? (
        <p className="mt-2 text-xs font-medium text-red-700" role="alert">
          {pdfError}
        </p>
      ) : null}
      <div className="mt-3 border-t border-line pt-3">
        <div
          className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Signature
        </div>
        {sigUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={sigUrl}
            alt="Client signature"
            className="h-20 w-auto max-w-[240px] rounded border border-line bg-white p-1"
          />
        ) : sigError ? (
          <p className="text-xs text-slate">
            Could not load signature image: {sigError}
          </p>
        ) : (
          <p className="text-xs text-slate">Loading signature…</p>
        )}
      </div>
    </div>
  );
}
