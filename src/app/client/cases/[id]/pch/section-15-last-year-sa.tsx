"use client";

// Section 15: last year's Self Assessment tax liability.
//
// Three choices: Yes (did you have one), No (nothing owed last year),
// Not applicable (this is your first return). "Yes" opens a Paid /
// Not paid sub-toggle + an optional SA302 upload. All three write
// against pch_cases columns added in migration 0113:
//   last_year_sa_status enum        (yes | no | not_applicable)
//   last_year_sa_paid boolean       (only meaningful when status=yes)
//   last_year_sa302_evidence text   (storage path to the SA302 PDF)

import { useRef, useState } from "react";
import {
  savePchHeadFieldAction,
  uploadPchSectionEvidenceAction,
} from "@/app/client/pch/intake-actions";

export type Section15Initial = {
  last_year_sa_status: "yes" | "no" | "not_applicable" | null;
  last_year_sa_paid: boolean | null;
  last_year_sa302_evidence: string | null;
};

export function Section15LastYearSA({
  caseId,
  editable,
  initial,
}: {
  caseId: string;
  editable: boolean;
  initial: Section15Initial;
}) {
  const [status, setStatus] = useState(initial.last_year_sa_status);
  const [paid, setPaid] = useState(initial.last_year_sa_paid);
  const [sa302Path, setSa302Path] = useState(initial.last_year_sa302_evidence);
  const [err, setErr] = useState<string | null>(null);

  const pickStatus = async (next: "yes" | "no" | "not_applicable") => {
    setStatus(next);
    setErr(null);
    const r = await savePchHeadFieldAction(caseId, "last_year_sa_status", next);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    if (next !== "yes") {
      // Clear the paid flag when it no longer applies.
      await savePchHeadFieldAction(caseId, "last_year_sa_paid", null);
      setPaid(null);
    }
  };

  const pickPaid = async (next: boolean) => {
    setPaid(next);
    setErr(null);
    const r = await savePchHeadFieldAction(caseId, "last_year_sa_paid", next);
    if (!r.ok) setErr(r.error);
  };

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const openPicker = () => fileRef.current?.click();
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await uploadPchSectionEvidenceAction(caseId, "last_year_sa302_evidence", fd);
      if (!r.ok) setErr(r.error);
      else setSa302Path(r.path);
    } finally {
      setUploading(false);
    }
  };

  const base =
    "flex-1 rounded-lg border px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ";

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-lg font-bold">15. Last year&apos;s Self Assessment</h2>
      <p className="mb-4 text-xs text-slate-600">
        Did you have a Self Assessment tax liability last year? We ask
        so we can line up payments on account correctly for this year.
      </p>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => pickStatus("yes")}
            disabled={!editable}
            className={
              base
              + (status === "yes"
                ? "border-sky bg-sky/10 text-sky"
                : "border-slate-300 bg-white text-slate-700 hover:border-sky hover:text-sky")
            }
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => pickStatus("no")}
            disabled={!editable}
            className={
              base
              + (status === "no"
                ? "border-sky bg-sky/10 text-sky"
                : "border-slate-300 bg-white text-slate-700 hover:border-sky hover:text-sky")
            }
          >
            No
          </button>
          <button
            type="button"
            onClick={() => pickStatus("not_applicable")}
            disabled={!editable}
            className={
              base
              + (status === "not_applicable"
                ? "border-slate-500 bg-slate-100 text-slate-800"
                : "border-slate-300 bg-white text-slate-700 hover:border-slate-500")
            }
          >
            Not applicable (first return)
          </button>
        </div>

        {status === "yes" ? (
          <div className="mt-4 space-y-4">
            <div>
              <div className="mb-1 text-xs font-semibold text-slate-700">
                Have you paid it?
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => pickPaid(true)}
                  disabled={!editable}
                  className={
                    "flex-1 rounded-lg border px-4 py-2 text-sm font-semibold transition disabled:opacity-50 "
                    + (paid === true
                      ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                      : "border-slate-300 bg-white text-slate-700 hover:border-emerald-500")
                  }
                >
                  Paid
                </button>
                <button
                  type="button"
                  onClick={() => pickPaid(false)}
                  disabled={!editable}
                  className={
                    "flex-1 rounded-lg border px-4 py-2 text-sm font-semibold transition disabled:opacity-50 "
                    + (paid === false
                      ? "border-amber-500 bg-amber-50 text-amber-800"
                      : "border-slate-300 bg-white text-slate-700 hover:border-amber-500")
                  }
                >
                  Not paid
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-700">
                Last year&apos;s SA302 (optional)
              </div>
              <p className="mb-2 text-xs text-slate-600">
                Upload if you have one; it saves your accountant looking it
                up. HMRC has it in your personal tax account.
              </p>
              {sa302Path ? (
                <p className="mb-2 text-xs text-emerald-700">
                  SA302 uploaded. Pick another to replace it.
                </p>
              ) : null}
              <button
                type="button"
                onClick={openPicker}
                disabled={!editable || uploading}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-sky hover:text-sky disabled:opacity-50"
              >
                {uploading ? "Uploading..." : sa302Path ? "Replace SA302" : "Upload SA302"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={onFile}
                className="hidden"
              />
            </div>
          </div>
        ) : null}

        {err ? <p className="mt-2 text-xs text-rose-700">{err}</p> : null}
      </div>
    </section>
  );
}
