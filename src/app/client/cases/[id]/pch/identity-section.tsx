"use client";

// Phase 6 Slice 1: identity capture.
//
// Replaces Phase 5's ProfilePanel + PROFILE AI interview. The surface
// is deliberately tiny:
//
//   1. One row for the Photo ID slot. Reuses DocRow + the existing
//      extraction/review pipeline so the client confirms the AI's
//      reading of name, DOB, address, and postcode. On confirm those
//      flow into pch_cases via SLOT_APPLY_MAPS["PCH-24"]. Edits to
//      address/postcode happen on that review card too; this section
//      only owns the HMRC references.
//
//   2. Two inputs for the fields that can't be read off any ID: UTR
//      and NI. Validation mirrors the server-side check.
//
// Nothing else lives in Tab 1 anymore. The old 30-field grid, the
// seven-question profile interview, and the "N of M fields captured"
// summary are gone with the Phase 6 bookkeeping redesign.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePchIdentityFieldsAction } from "@/app/client/pch/actions";
import { validateUtr, validateNino } from "@/lib/pch/validation";

export type IdentityHead = {
  cl_name: string | null;
  cl_dob: string | null;
  cl_address: string | null;
  cl_postcode: string | null;
  cl_utr: string | null;
  cl_nino: string | null;
};

type Props = {
  caseId: string;
  head: IdentityHead;
  editable?: boolean;
};

export function IdentitySection({ caseId, head, editable = true }: Props) {
  const router = useRouter();
  const [utr, setUtr] = useState(head.cl_utr ?? "");
  const [nino, setNino] = useState(head.cl_nino ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const utrErr = useMemo(() => (utr.trim().length === 0 ? null : validateUtr(utr.trim())), [utr]);
  const ninoErr = useMemo(() => (nino.trim().length === 0 ? null : validateNino(nino.trim())), [nino]);

  const utrChanged = (utr.trim() || null) !== (head.cl_utr || null);
  const ninoChanged = (nino.trim().toUpperCase() || null) !== (head.cl_nino || null);
  const anyChange = utrChanged || ninoChanged;
  const canSave = editable && anyChange && !utrErr && !ninoErr;

  const save = () => start(async () => {
    setMsg(null);
    const r = await savePchIdentityFieldsAction(caseId, {
      cl_utr: utrChanged ? utr : undefined,
      cl_nino: ninoChanged ? nino : undefined,
    });
    if (r.ok) {
      setMsg("Saved");
      router.refresh();
    } else {
      setMsg(r.error);
    }
  });

  return (
    <div className="space-y-4">
      <IdentitySummary head={head} />
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">HMRC references</h3>
        <p className="mt-1 text-xs text-slate-600">
          UTR and NI aren&apos;t on your ID, so type them here.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">UTR (10 digits)</span>
            <input
              className={
                "mt-1 w-full rounded border px-2 py-1 text-sm " +
                (utrErr ? "border-rose-400" : "border-slate-300")
              }
              value={utr}
              onChange={(e) => setUtr(e.target.value)}
              placeholder="1234567890"
              inputMode="numeric"
              autoComplete="off"
              disabled={!editable || pending}
            />
            {utrErr ? (
              <span className="mt-1 block text-xs text-rose-700">{utrErr}</span>
            ) : null}
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">
              NI number (AB123456C)
            </span>
            <input
              className={
                "mt-1 w-full rounded border px-2 py-1 text-sm " +
                (ninoErr ? "border-rose-400" : "border-slate-300")
              }
              value={nino}
              onChange={(e) => setNino(e.target.value.toUpperCase())}
              placeholder="AB123456C"
              autoComplete="off"
              disabled={!editable || pending}
            />
            {ninoErr ? (
              <span className="mt-1 block text-xs text-rose-700">{ninoErr}</span>
            ) : null}
          </label>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={!canSave || pending}
            className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {pending ? "Saving..." : "Save"}
          </button>
          {msg ? (
            <span
              className={
                "text-xs " + (msg === "Saved" ? "text-emerald-700" : "text-rose-700")
              }
            >
              {msg}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Compact read-only summary of what the Photo ID extraction already
// captured (if anything). Shown above the HMRC references card. Blank
// state is a short nudge pointing at the Photo ID slot in Documents.
function IdentitySummary({ head }: { head: IdentityHead }) {
  const rows: { label: string; value: string | null }[] = [
    { label: "Full name", value: head.cl_name },
    { label: "Date of birth", value: fmtDate(head.cl_dob) },
    { label: "Address", value: head.cl_address },
    { label: "Postcode", value: head.cl_postcode },
  ];
  const anyFilled = rows.some((r) => r.value && r.value.trim().length > 0);
  if (!anyFilled) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-600">
        Upload your Photo ID in the Documents section above and we&apos;ll fill
        in your name, date of birth, and address here automatically. Review
        and edit anything that didn&apos;t read correctly on the Photo ID
        review card.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">From your Photo ID</h3>
      <p className="mt-1 text-xs text-slate-600">
        Confirmed from your uploaded ID. To correct any of these, use the
        review card on the Photo ID slot above.
      </p>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li
            key={r.label}
            className="rounded border border-slate-100 bg-slate-50/60 p-2"
          >
            <div className="text-xs font-medium text-slate-700">{r.label}</div>
            <div className="mt-1 text-sm text-slate-900">
              {r.value && r.value.length > 0 ? r.value : "Not captured yet"}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function fmtDate(d: string | null): string | null {
  if (!d) return null;
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
