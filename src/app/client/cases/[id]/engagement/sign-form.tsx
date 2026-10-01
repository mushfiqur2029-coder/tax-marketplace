"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SLButton } from "@/components/sl-button";
import { SignaturePad } from "@/components/engagement/signature-pad";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  sign: (signatureDataUrl: string) => Promise<ActionResult>;
  fee: string;
};

export function EngagementSignForm({ sign, fee }: Props) {
  const router = useRouter();
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !!signatureDataUrl && accepted && !pending;

  return (
    <form
      action={() => {
        setError(null);
        if (!signatureDataUrl) {
          setError("Please draw your signature first.");
          return;
        }
        if (!accepted) {
          setError("Please tick the acceptance box.");
          return;
        }
        start(async () => {
          const res = await sign(signatureDataUrl);
          if (!res.ok) {
            setError(res.error);
            return;
          }
          // Server stamped engagement_signed_at; the page's own guard
          // redirects on refresh. Jump straight to checkout.
          router.push(
            window.location.pathname.replace(
              /\/engagement\/?$/,
              "/checkout",
            ),
          );
        });
      }}
      className="space-y-5"
    >
      <div>
        <span
          className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Your signature
        </span>
        <SignaturePad
          onChange={({ dataUrl }) => setSignatureDataUrl(dataUrl)}
        />
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-line bg-paper p-3">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0"
        />
        <span className="text-sm text-ink">
          I have read and accept the Engagement Letter, Terms and
          Conditions, Refund Policy, and Privacy Policy. I authorise the
          one-time payment of <strong>{fee}</strong> for my selected
          service.
        </span>
      </label>

      {error ? (
        <p
          className="rounded-lg px-3 py-2 text-sm font-medium text-red-700"
          role="alert"
          style={{ background: "rgba(220,38,38,0.08)" }}
        >
          {error}
        </p>
      ) : null}

      <SLButton type="submit" variant="primary" block disabled={!canSubmit}>
        {pending ? "Signing…" : `Sign and continue to pay ${fee}`}
      </SLButton>
      <p className="text-[11px] text-slate">
        You can clear the signature and redraw until you&apos;re happy.
        We&apos;ll start work only after payment.
      </p>
    </form>
  );
}
