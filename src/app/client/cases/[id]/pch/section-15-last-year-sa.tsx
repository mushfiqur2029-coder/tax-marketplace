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

import { useEffect, useState } from "react";
import {
  savePchHeadFieldAction,
  uploadPchSectionEvidenceAction,
} from "@/app/client/pch/intake-actions";
import { useOptionalIntakeProgress } from "./intake-progress-context";
import { isSection15Complete } from "./intake-completion";
import { UploadControl } from "./upload-dropzone";

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

  const { setSectionDone } = useOptionalIntakeProgress();
  useEffect(() => {
    setSectionDone("lastYearSa", isSection15Complete({
      last_year_sa_status: status,
      last_year_sa_paid: paid,
      last_year_sa302_evidence: sa302Path,
    }));
  }, [status, paid, sa302Path, setSectionDone]);

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

  const uploadSa302 = async (file: File) => {
    setErr(null);
    const fd = new FormData();
    fd.append("file", file);
    const r = await uploadPchSectionEvidenceAction(caseId, "last_year_sa302_evidence", fd);
    if (!r.ok) setErr(r.error);
    else setSa302Path(r.path);
  };

  const base =
    "flex-1 rounded-lg border px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ";

  return (
    <section id="pch-section-last-year-sa" className="mb-8 scroll-mt-24">
      <h2 className="mb-1 text-lg font-bold">16. Last year's Self Assessment</h2>
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

            <div>
              <p className="mb-2 text-xs text-slate-600">
                Have your SA302 handy? Drop it in and we save your
                accountant looking it up. HMRC has it in your personal
                tax account too.
              </p>
              <UploadControl
                disabled={!editable}
                heading="Last year's SA302 (optional)"
                idleLabel="Upload SA302"
                replaceLabel="Replace SA302"
                current={!!sa302Path}
                successText="SA302 uploaded. Drop another to replace it."
                onFile={uploadSa302}
              />
            </div>
          </div>
        ) : null}

        {err ? <p className="mt-2 text-xs text-rose-700">{err}</p> : null}
      </div>
    </section>
  );
}
