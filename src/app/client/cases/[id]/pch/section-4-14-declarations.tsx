"use client";

// Sections 5 to 15: eleven declaration cards (file name kept as
// section-4-14-declarations.tsx from an earlier numbering; Vehicle
// was promoted to its own top-level Section 4 in Phase J which
// pushed everything here forward by one). Each card has its own
// Applicable / Not applicable toggle at the top; "Not applicable"
// collapses the body and records that answer on
// cl_declaration_status jsonb. "Applicable" opens an amount input
// (where the item has one) + optional evidence upload.
//
// Gift Aid (section 11) is a repeatable mini-list: charity name,
// donation date, amount per entry. Each row saves independently.
//
// Phase J also merged the "Income from another job" card into
// Section 5 (P11D) as a second amount+upload pair, so the P11D
// card now carries both employment income (P60 / payslip) and
// P11D benefits in a single applicable/not_applicable gate.
//
// All eleven cards follow the same card shape to keep this
// mobile-first and reduce decision fatigue; branded consistently
// with sections 1 to 4 so the client can scroll a single column
// top to bottom.

import { useEffect, useRef, useState } from "react";
import {
  deletePchGiftAidEntryAction,
  savePchHeadFieldAction,
  setDeclarationStatusAction,
  upsertPchGiftAidEntryAction,
  uploadPchSectionEvidenceAction,
} from "@/app/client/pch/intake-actions";
import { useDebouncedSave } from "@/lib/hooks/use-debounced-save";
import { useOptionalIntakeProgress } from "./intake-progress-context";
import { areDeclarationsComplete } from "./intake-completion";
import { UploadControl } from "./upload-dropzone";

export type DeclarationKey =
  | "p11d"
  | "interest"
  | "dividend"
  | "capital_gains"
  | "rental"
  | "pension"
  | "gift_aid"
  | "child_benefit"
  | "overseas"
  | "student_loan"
  | "anything_else";
// Phase F -> H: "other_employment" was a 12th declaration card for
// another PAYE job. Phase H relocated it to the Vehicle section as a
// free-form Personal allowance pair (amount + optional supporting
// doc) and dropped it from the Declarations completion gate. The
// server-side status key is still accepted by setDeclarationStatus
// Action so historic cases that answered it do not fail.

export type DeclarationStatus = "applicable" | "not_applicable" | null;

export type DeclarationsInitial = {
  // Per-section applicable/not-applicable state (missing = unanswered).
  statuses: Partial<Record<DeclarationKey, DeclarationStatus>>;
  // Head fields the cards write into (null-safe).
  p11d_pence: number | null;
  benefits_note: string | null;
  bank_interest_pence: number | null;
  dividend_income_pence: number | null;
  capital_gains_pence: number | null;
  capital_gains_note: string | null;
  rental_profit_pence: number | null;
  gross_rent_received_pence: number | null;
  personal_pension_net_pence: number | null;
  child_benefit_pence: number | null;
  overseas_income_pence: number | null;
  overseas_tax_paid_pence: number | null;
  student_loan_plan: string | null;
  anything_else_note: string | null;
  // Evidence storage paths (null = not uploaded).
  p11d_evidence: string | null;
  interest_evidence: string | null;
  dividend_evidence: string | null;
  capital_gains_evidence: string | null;
  rental_evidence: string | null;
  pension_evidence: string | null;
  child_benefit_evidence: string | null;
  overseas_evidence: string | null;
  student_loan_evidence: string | null;
  // Phase J: employment income + its evidence are back here, merged
  // into the P11D card as a second amount+upload pair.
  employment_income_pence: number | null;
  other_employment_evidence: string | null;
};

export type GiftAidEntry = {
  id: string;
  charity_name: string | null;
  donation_date: string | null;
  amount_pence: number;
};

const STUDENT_LOAN_PLANS = ["None", "Plan 1", "Plan 2", "Plan 4", "Plan 5", "Postgraduate"];

export function Section4to14Declarations({
  caseId,
  editable,
  initial,
  giftAidEntries,
}: {
  caseId: string;
  editable: boolean;
  initial: DeclarationsInitial;
  giftAidEntries: GiftAidEntry[];
}) {
  // Phase G: aggregated statuses mirrored at the section level so the
  // progress bar flips amber -> green the moment any card is answered,
  // without each card having to reach into the context itself.
  const [statuses, setStatuses] = useState<DeclarationsInitial["statuses"]>(
    () => ({ ...initial.statuses }),
  );
  const noteStatus = (key: DeclarationKey, next: DeclarationStatus) => {
    setStatuses((prev) =>
      prev[key] === next ? prev : { ...prev, [key]: next ?? undefined },
    );
  };

  const { setSectionDone } = useOptionalIntakeProgress();
  useEffect(() => {
    setSectionDone("declarations", areDeclarationsComplete(statuses));
  }, [statuses, setSectionDone]);

  return (
    <section id="pch-section-declarations" className="mb-8 scroll-mt-24">
      <h2 className="mb-1 text-lg font-bold">5-15. Other declarations</h2>
      <p className="mb-4 text-xs text-slate-600">
        Each card asks about something that might apply to your return.
        Tap "Not applicable" if it doesn't; otherwise fill in the
        figure or upload the document.
      </p>

      <div className="space-y-3">
        <DeclarationCard
          caseId={caseId}
          editable={editable}
          sectionKey="p11d"
          number={5}
          title="Employment income and P11D benefits"
          subtitle="Had a PAYE job alongside your driving work this year? Drop a P60 or last payslip and we'll lift the figures off it on review. If your employer also gave you benefits like a company car, medical insurance or interest-free loan that weren't payrolled, we need the P11D figure and form too. Rough numbers are fine; skip the whole thing if neither applies."
          initialStatus={initial.statuses.p11d ?? null}
          onStatusChange={(s) => noteStatus("p11d", s)}
          moneyFieldsWithUpload={[
            {
              field: "employment_income_pence",
              label: "Employment income (gross for the year)",
              value: initial.employment_income_pence,
              help: "Gross pay before tax, box 1 on your P60.",
              evidenceColumn: "other_employment_evidence",
              evidencePath: initial.other_employment_evidence,
              successText: "P60 or payslip uploaded. Drop another to replace it.",
            },
            {
              field: "p11d_pence",
              label: "P11D benefits (total cash equivalent)",
              value: initial.p11d_pence,
              help: "The P11D's total figure, box N or the summary line.",
              evidenceColumn: "p11d_evidence",
              evidencePath: initial.p11d_evidence,
              successText: "P11D form uploaded. Drop another to replace it.",
            },
          ]}
          headTextField={{
            field: "benefits_note",
            label: "Short summary (type of benefits)",
            value: initial.benefits_note,
            placeholder: "e.g. Company car + private medical",
          }}
        />

        <DeclarationCard
          caseId={caseId}
          editable={editable}
          sectionKey="interest"
          number={6}
          title="Interest income"
          subtitle="Interest from UK bank or building society accounts in the tax year. Get it off the annual certificate of interest."
          initialStatus={initial.statuses.interest ?? null}
          onStatusChange={(s) => noteStatus("interest", s)}
          moneyField={{
            field: "bank_interest_pence",
            label: "Total interest for the year",
            value: initial.bank_interest_pence,
          }}
          evidenceColumn="interest_evidence"
          evidencePath={initial.interest_evidence}
        />

        <DeclarationCard
          caseId={caseId}
          editable={editable}
          sectionKey="dividend"
          number={7}
          title="Dividend income"
          subtitle="UK or overseas dividends you received. Get the figures off your dividend vouchers or portfolio year-end summary."
          initialStatus={initial.statuses.dividend ?? null}
          onStatusChange={(s) => noteStatus("dividend", s)}
          moneyField={{
            field: "dividend_income_pence",
            label: "Total dividends for the year",
            value: initial.dividend_income_pence,
          }}
          evidenceColumn="dividend_evidence"
          evidencePath={initial.dividend_evidence}
        />

        <DeclarationCard
          caseId={caseId}
          editable={editable}
          sectionKey="capital_gains"
          number={8}
          title="Capital gains for the year"
          subtitle="If you sold shares, crypto, a second property or any other asset at a gain. Upload any supporting documents."
          initialStatus={initial.statuses.capital_gains ?? null}
          onStatusChange={(s) => noteStatus("capital_gains", s)}
          moneyField={{
            field: "capital_gains_pence",
            label: "Approximate total gain",
            value: initial.capital_gains_pence,
          }}
          noteField={{
            field: "capital_gains_note",
            label: "What was sold?",
            value: initial.capital_gains_note,
            placeholder: "e.g. 500 Tesla shares sold Oct 2025; crypto; buy-to-let flat",
          }}
          evidenceColumn="capital_gains_evidence"
          evidencePath={initial.capital_gains_evidence}
        />

        <DeclarationCard
          caseId={caseId}
          editable={editable}
          sectionKey="rental"
          number={9}
          title="Rental income (UK or overseas)"
          subtitle="If you let out a property. Upload the income and expenditure summary plus any mortgage statement."
          initialStatus={initial.statuses.rental ?? null}
          onStatusChange={(s) => noteStatus("rental", s)}
          moneyFields={[
            {
              field: "gross_rent_received_pence",
              label: "Gross rent received",
              value: initial.gross_rent_received_pence,
            },
            {
              field: "rental_profit_pence",
              label: "Net rental profit",
              value: initial.rental_profit_pence,
              help: "After allowable expenses (mortgage interest, repairs, agent fees).",
            },
          ]}
          evidenceColumn="rental_evidence"
          evidencePath={initial.rental_evidence}
        />

        <DeclarationCard
          caseId={caseId}
          editable={editable}
          sectionKey="pension"
          number={10}
          title="Private pension contributions"
          subtitle="A SIPP or private pension you paid into yourself. NOT the workplace pension that comes out of a salary before tax."
          initialStatus={initial.statuses.pension ?? null}
          onStatusChange={(s) => noteStatus("pension", s)}
          moneyField={{
            field: "personal_pension_net_pence",
            label: "Net amount paid for the year",
            value: initial.personal_pension_net_pence,
            help: "What you actually paid in (we gross it up for tax relief).",
          }}
          evidenceColumn="pension_evidence"
          evidencePath={initial.pension_evidence}
        />

        <GiftAidCard
          caseId={caseId}
          editable={editable}
          initialStatus={initial.statuses.gift_aid ?? null}
          onStatusChange={(s) => noteStatus("gift_aid", s)}
          entries={giftAidEntries}
        />

        <DeclarationCard
          caseId={caseId}
          editable={editable}
          sectionKey="child_benefit"
          number={12}
          title="Child benefit received"
          subtitle="If you (or your partner) claimed Child Benefit this tax year. HMRC uses it to calculate the High Income Child Benefit Charge."
          initialStatus={initial.statuses.child_benefit ?? null}
          onStatusChange={(s) => noteStatus("child_benefit", s)}
          moneyField={{
            field: "child_benefit_pence",
            label: "Total received for the year",
            value: initial.child_benefit_pence,
          }}
          evidenceColumn="child_benefit_evidence"
          evidencePath={initial.child_benefit_evidence}
        />

        <DeclarationCard
          caseId={caseId}
          editable={editable}
          sectionKey="overseas"
          number={13}
          title="Overseas income and overseas tax paid"
          subtitle="Any income from outside the UK, plus any tax you already paid overseas on it (double-tax relief)."
          initialStatus={initial.statuses.overseas ?? null}
          onStatusChange={(s) => noteStatus("overseas", s)}
          moneyFields={[
            {
              field: "overseas_income_pence",
              label: "Overseas income (gross)",
              value: initial.overseas_income_pence,
            },
            {
              field: "overseas_tax_paid_pence",
              label: "Overseas tax already paid",
              value: initial.overseas_tax_paid_pence,
            },
          ]}
          evidenceColumn="overseas_evidence"
          evidencePath={initial.overseas_evidence}
        />

        <DeclarationCard
          caseId={caseId}
          editable={editable}
          sectionKey="student_loan"
          number={14}
          title="Student loan plan"
          subtitle="If you have a UK student or postgraduate loan. HMRC collects repayments through Self Assessment."
          initialStatus={initial.statuses.student_loan ?? null}
          onStatusChange={(s) => noteStatus("student_loan", s)}
          enumField={{
            field: "student_loan_plan",
            label: "Which plan?",
            value: initial.student_loan_plan,
            options: STUDENT_LOAN_PLANS,
          }}
          evidenceColumn="student_loan_evidence"
          evidencePath={initial.student_loan_evidence}
        />

        <DeclarationCard
          caseId={caseId}
          editable={editable}
          sectionKey="anything_else"
          number={15}
          title="Anything else relevant"
          subtitle="Anything we haven't asked about. Just leave a note; your accountant will follow up if it matters."
          initialStatus={initial.statuses.anything_else ?? null}
          onStatusChange={(s) => noteStatus("anything_else", s)}
          longTextField={{
            field: "anything_else_note",
            label: "Note",
            value: initial.anything_else_note,
            placeholder: "e.g. Started a new side-business in February; sold a flat; moved abroad in July...",
          }}
        />

        {/*
          Phase H: Personal allowance (previously "Income from another
          job (PAYE)") moved into the Vehicle section. The server
          actions and head columns stay the same; only the rendering
          location changed. See section-3-vehicle.tsx PersonalAllowance
          Card.
        */}
      </div>
    </section>
  );
}

type MoneyFieldConfig = {
  field: string;
  label: string;
  value: number | null;
  help?: string;
};
type MoneyFieldWithUploadConfig = MoneyFieldConfig & {
  // Phase J: paired upload under the amount input, same visual
  // treatment as the single evidenceColumn below. Enables cards like
  // P11D that collect two distinct amount+doc pairs.
  evidenceColumn: string;
  evidencePath: string | null;
  successText?: string;
};
type TextFieldConfig = {
  field: string;
  label: string;
  value: string | null;
  placeholder?: string;
};
type EnumFieldConfig = {
  field: string;
  label: string;
  value: string | null;
  options: string[];
};

function DeclarationCard({
  caseId, editable, sectionKey, number, numberLabel, title, subtitle, initialStatus,
  moneyField, moneyFields, moneyFieldsWithUpload,
  headTextField, noteField, longTextField, enumField,
  evidenceColumn, evidencePath, onStatusChange,
}: {
  caseId: string;
  editable: boolean;
  sectionKey: DeclarationKey;
  number?: number;
  numberLabel?: string;
  title: string;
  subtitle: string;
  initialStatus: DeclarationStatus;
  moneyField?: MoneyFieldConfig;
  moneyFields?: MoneyFieldConfig[];
  moneyFieldsWithUpload?: MoneyFieldWithUploadConfig[];
  headTextField?: TextFieldConfig;
  noteField?: TextFieldConfig;
  longTextField?: TextFieldConfig;
  enumField?: EnumFieldConfig;
  evidenceColumn?: string;
  evidencePath?: string | null;
  onStatusChange?: (next: DeclarationStatus) => void;
}) {
  const [status, setStatus] = useState<DeclarationStatus>(initialStatus);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [statusPending, setStatusPending] = useState(false);

  const pick = async (next: "applicable" | "not_applicable") => {
    setStatusPending(true);
    setStatusErr(null);
    try {
      const r = await setDeclarationStatusAction(caseId, sectionKey, next);
      if (!r.ok) setStatusErr(r.error);
      else {
        setStatus(next);
        onStatusChange?.(next);
      }
    } finally {
      setStatusPending(false);
    }
  };

  const [evPath, setEvPath] = useState<string | null>(evidencePath ?? null);
  const expanded = status === "applicable";

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div
              className="text-[10px] font-semibold uppercase tracking-widest text-slate-500"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Section {numberLabel ?? number}
            </div>
            <StatusPill status={status} />
          </div>
          <div className="mt-0.5 text-sm font-bold text-ink">{title}</div>
          <p className="mt-1 text-xs text-slate-600">{subtitle}</p>
        </div>
        <ApplicableToggle
          status={status}
          pending={statusPending}
          editable={editable}
          onApplicable={() => pick("applicable")}
          onNotApplicable={() => pick("not_applicable")}
        />
      </header>
      {statusErr ? (
        <p className="mt-2 text-xs text-rose-700">{statusErr}</p>
      ) : null}

      {expanded ? (
        <div className="mt-4 space-y-4">
          {moneyField ? (
            <MoneyInput
              caseId={caseId}
              editable={editable}
              field={moneyField.field}
              label={moneyField.label}
              initial={moneyField.value}
              help={moneyField.help}
            />
          ) : null}
          {moneyFields
            ? moneyFields.map((f) => (
                <MoneyInput
                  key={f.field}
                  caseId={caseId}
                  editable={editable}
                  field={f.field}
                  label={f.label}
                  initial={f.value}
                  help={f.help}
                />
              ))
            : null}
          {moneyFieldsWithUpload
            ? moneyFieldsWithUpload.map((f) => (
                <MoneyWithUpload
                  key={f.field}
                  caseId={caseId}
                  editable={editable}
                  config={f}
                />
              ))
            : null}
          {enumField ? (
            <EnumInput
              caseId={caseId}
              editable={editable}
              field={enumField.field}
              label={enumField.label}
              initial={enumField.value}
              options={enumField.options}
            />
          ) : null}
          {headTextField ? (
            <TextInput
              caseId={caseId}
              editable={editable}
              field={headTextField.field}
              label={headTextField.label}
              initial={headTextField.value}
              placeholder={headTextField.placeholder}
            />
          ) : null}
          {noteField ? (
            <TextInput
              caseId={caseId}
              editable={editable}
              field={noteField.field}
              label={noteField.label}
              initial={noteField.value}
              placeholder={noteField.placeholder}
            />
          ) : null}
          {longTextField ? (
            <LongTextInput
              caseId={caseId}
              editable={editable}
              field={longTextField.field}
              label={longTextField.label}
              initial={longTextField.value}
              placeholder={longTextField.placeholder}
            />
          ) : null}
          {evidenceColumn ? (
            <EvidenceUpload
              caseId={caseId}
              editable={editable}
              column={evidenceColumn}
              current={evPath}
              onUploaded={(path) => setEvPath(path)}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

// Phase G: amber-when-unanswered / green-when-answered pill, same
// visual grammar as the progress bar at the top. The two toggle
// buttons still carry the action, this just gives a persistent
// at-a-glance read of where each card is in the sweep.
function StatusPill({ status }: { status: DeclarationStatus }) {
  if (status === null) {
    return (
      <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-900">
        Needs answer
      </span>
    );
  }
  return (
    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
      ✓ Answered
    </span>
  );
}

function ApplicableToggle({
  status, pending, editable, onApplicable, onNotApplicable,
}: {
  status: DeclarationStatus;
  pending: boolean;
  editable: boolean;
  onApplicable: () => void;
  onNotApplicable: () => void;
}) {
  const base =
    "rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ";
  const yesActive = status === "applicable";
  const noActive = status === "not_applicable";
  return (
    <div className="flex shrink-0 gap-2">
      <button
        type="button"
        onClick={onApplicable}
        disabled={!editable || pending}
        className={
          base
          + (yesActive
            ? "border border-sky bg-sky/10 text-sky"
            : "border border-slate-300 bg-white text-slate-700 hover:border-sky hover:text-sky")
        }
      >
        Applicable
      </button>
      <button
        type="button"
        onClick={onNotApplicable}
        disabled={!editable || pending}
        className={
          base
          + (noActive
            ? "border border-slate-500 bg-slate-100 text-slate-800"
            : "border border-slate-300 bg-white text-slate-700 hover:border-slate-500")
        }
      >
        Not applicable
      </button>
    </div>
  );
}

function MoneyInput({
  caseId, editable, field, label, initial, help,
}: {
  caseId: string;
  editable: boolean;
  field: string;
  label: string;
  initial: number | null;
  help?: string;
}) {
  const { value, onChange, status, error } = useDebouncedSave<string>({
    initial: initial && initial > 0 ? (initial / 100).toString() : "",
    save: async (v) => {
      const clean = v.replace(/[^0-9.]/g, "");
      const pounds = clean === "" ? null : Number(clean);
      if (pounds !== null && (!Number.isFinite(pounds) || pounds < 0)) {
        throw new Error("Must be zero or more.");
      }
      const pence = pounds === null ? null : Math.round(pounds * 100);
      const r = await savePchHeadFieldAction(caseId, field, pence);
      if (!r.ok) throw new Error(r.error);
    },
  });
  return (
    <label>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
        <span>{label}</span>
        <SaveStatusPill status={status} error={error} />
      </div>
      <div className="flex items-center gap-1">
        <span className="text-sm text-slate-500">£</span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => {
            const stripped = e.target.value.replace(/[^0-9.]/g, "");
            const parts = stripped.split(".");
            const cleaned =
              parts.length <= 1 ? stripped : parts[0] + "." + parts.slice(1).join("");
            onChange(cleaned);
          }}
          placeholder="0.00"
          disabled={!editable}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
        />
      </div>
      {help ? <p className="mt-1 text-[11px] text-slate-500">{help}</p> : null}
    </label>
  );
}

function TextInput({
  caseId, editable, field, label, initial, placeholder,
}: {
  caseId: string;
  editable: boolean;
  field: string;
  label: string;
  initial: string | null;
  placeholder?: string;
}) {
  const { value, onChange, status, error } = useDebouncedSave<string>({
    initial: initial ?? "",
    save: async (v) => {
      const trimmed = v.trim();
      const r = await savePchHeadFieldAction(caseId, field, trimmed === "" ? null : trimmed);
      if (!r.ok) throw new Error(r.error);
    },
  });
  return (
    <label>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
        <span>{label}</span>
        <SaveStatusPill status={status} error={error} />
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={!editable}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
      />
    </label>
  );
}

function LongTextInput({
  caseId, editable, field, label, initial, placeholder,
}: {
  caseId: string;
  editable: boolean;
  field: string;
  label: string;
  initial: string | null;
  placeholder?: string;
}) {
  const { value, onChange, status, error } = useDebouncedSave<string>({
    initial: initial ?? "",
    save: async (v) => {
      const trimmed = v.trim();
      const r = await savePchHeadFieldAction(caseId, field, trimmed === "" ? null : trimmed);
      if (!r.ok) throw new Error(r.error);
    },
  });
  return (
    <label>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
        <span>{label}</span>
        <SaveStatusPill status={status} error={error} />
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={!editable}
        rows={4}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
      />
    </label>
  );
}

function EnumInput({
  caseId, editable, field, label, initial, options,
}: {
  caseId: string;
  editable: boolean;
  field: string;
  label: string;
  initial: string | null;
  options: string[];
}) {
  const { value, onChange, status, error } = useDebouncedSave<string>({
    initial: initial ?? "",
    debounceMs: 0,
    save: async (v) => {
      const r = await savePchHeadFieldAction(caseId, field, v === "" ? null : v);
      if (!r.ok) throw new Error(r.error);
    },
  });
  return (
    <label>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
        <span>{label}</span>
        <SaveStatusPill status={status} error={error} />
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!editable}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
      >
        <option value="">Pick one...</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function EvidenceUpload({
  caseId, editable, column, current, onUploaded,
}: {
  caseId: string;
  editable: boolean;
  column: string;
  current: string | null;
  onUploaded: (path: string) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const upload = async (file: File) => {
    setErr(null);
    const fd = new FormData();
    fd.append("file", file);
    const r = await uploadPchSectionEvidenceAction(caseId, column, fd);
    if (!r.ok) setErr(r.error);
    else onUploaded(r.path);
  };
  return (
    <UploadControl
      disabled={!editable}
      heading="Supporting document (optional)"
      current={!!current}
      onFile={upload}
      error={err}
    />
  );
}

// Phase J: money input + its own paired upload. Used by cards that
// collect multiple distinct amount+doc pairs, e.g. the P11D card now
// collects both employment income (P60/payslip) and P11D benefits.
function MoneyWithUpload({
  caseId, editable, config,
}: {
  caseId: string;
  editable: boolean;
  config: MoneyFieldWithUploadConfig;
}) {
  const [evPath, setEvPath] = useState<string | null>(config.evidencePath);
  const [err, setErr] = useState<string | null>(null);
  const upload = async (file: File) => {
    setErr(null);
    const fd = new FormData();
    fd.append("file", file);
    const r = await uploadPchSectionEvidenceAction(caseId, config.evidenceColumn, fd);
    if (!r.ok) setErr(r.error);
    else setEvPath(r.path);
  };
  return (
    <div className="space-y-2">
      <MoneyInput
        caseId={caseId}
        editable={editable}
        field={config.field}
        label={config.label}
        initial={config.value}
        help={config.help}
      />
      <UploadControl
        disabled={!editable}
        heading="Supporting document (optional)"
        current={!!evPath}
        successText={config.successText}
        onFile={upload}
        error={err}
      />
    </div>
  );
}

// -------------------------------------------------------------------
// Section 10 Gift Aid: repeatable mini-list (charity, date, amount)
// -------------------------------------------------------------------

function GiftAidCard({
  caseId, editable, initialStatus, entries, onStatusChange,
}: {
  caseId: string;
  editable: boolean;
  initialStatus: DeclarationStatus;
  entries: GiftAidEntry[];
  onStatusChange?: (next: DeclarationStatus) => void;
}) {
  const [status, setStatus] = useState<DeclarationStatus>(initialStatus);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [statusPending, setStatusPending] = useState(false);
  const pick = async (next: "applicable" | "not_applicable") => {
    setStatusPending(true);
    setStatusErr(null);
    try {
      const r = await setDeclarationStatusAction(caseId, "gift_aid", next);
      if (!r.ok) setStatusErr(r.error);
      else {
        setStatus(next);
        onStatusChange?.(next);
      }
    } finally {
      setStatusPending(false);
    }
  };

  type UiEntry = {
    key: string;
    id: string | null;
    charity_name: string;
    donation_date: string;
    amount_pence: number;
  };
  const [rows, setRows] = useState<UiEntry[]>(() =>
    entries.map((e) => ({
      key: e.id,
      id: e.id,
      charity_name: e.charity_name ?? "",
      donation_date: e.donation_date ?? "",
      amount_pence: e.amount_pence,
    })),
  );

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        key: "new-" + Math.random().toString(36).slice(2),
        id: null,
        charity_name: "",
        donation_date: "",
        amount_pence: 0,
      },
    ]);
  };
  const removeRow = async (key: string) => {
    const r = rows.find((x) => x.key === key);
    setRows((prev) => prev.filter((x) => x.key !== key));
    if (r?.id) await deletePchGiftAidEntryAction(caseId, r.id);
  };
  const patchRow = (key: string, patch: Partial<UiEntry>) => {
    setRows((prev) => prev.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  };

  const expanded = status === "applicable";
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div
              className="text-[10px] font-semibold uppercase tracking-widest text-slate-500"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Section 11
            </div>
            <StatusPill status={status} />
          </div>
          <div className="mt-0.5 text-sm font-bold text-ink">Gift Aid charitable donations</div>
          <p className="mt-1 text-xs text-slate-600">
            UK donations where you ticked the Gift Aid box. Add one row
            per charity you donated to; the total goes to HMRC for your
            relief.
          </p>
        </div>
        <ApplicableToggle
          status={status}
          pending={statusPending}
          editable={editable}
          onApplicable={() => pick("applicable")}
          onNotApplicable={() => pick("not_applicable")}
        />
      </header>
      {statusErr ? <p className="mt-2 text-xs text-rose-700">{statusErr}</p> : null}
      {expanded ? (
        <div className="mt-4 space-y-3">
          {rows.length === 0 ? (
            <p className="text-xs text-slate-600">
              No donations yet. Tap "Add donation" below.
            </p>
          ) : (
            rows.map((row) => (
              <GiftAidRow
                key={row.key}
                caseId={caseId}
                editable={editable}
                row={row}
                onPatch={(p) => patchRow(row.key, p)}
                onDelete={() => removeRow(row.key)}
              />
            ))
          )}
          <button
            type="button"
            onClick={addRow}
            disabled={!editable}
            className="rounded-lg border border-dashed border-slate-400 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-sky hover:text-sky disabled:opacity-50"
          >
            + Add donation
          </button>
        </div>
      ) : null}
    </article>
  );
}

function GiftAidRow({
  caseId, editable, row, onPatch, onDelete,
}: {
  caseId: string;
  editable: boolean;
  row: {
    key: string;
    id: string | null;
    charity_name: string;
    donation_date: string;
    amount_pence: number;
  };
  onPatch: (patch: Partial<typeof row>) => void;
  onDelete: () => void;
}) {
  const latestRef = useRef(row);
  useEffect(() => { latestRef.current = row; }, [row]);

  const flushAll = async (next: Partial<typeof row>) => {
    const r = await upsertPchGiftAidEntryAction(
      caseId,
      latestRef.current.id,
      {
        charity_name: next.charity_name ?? latestRef.current.charity_name,
        donation_date: next.donation_date ?? latestRef.current.donation_date,
        amount_pence:
          next.amount_pence ?? latestRef.current.amount_pence,
      },
    );
    if (!r.ok) throw new Error(r.error);
    if (!latestRef.current.id) onPatch({ id: r.id });
  };

  const charity = useDebouncedSave<string>({
    initial: row.charity_name,
    save: async (v) => {
      await flushAll({ charity_name: v });
      onPatch({ charity_name: v });
    },
  });
  const date = useDebouncedSave<string>({
    initial: row.donation_date,
    debounceMs: 0,
    save: async (v) => {
      await flushAll({ donation_date: v });
      onPatch({ donation_date: v });
    },
  });
  const amount = useDebouncedSave<string>({
    initial:
      row.amount_pence > 0
        ? (row.amount_pence / 100).toString()
        : "",
    save: async (v) => {
      const clean = v.replace(/[^0-9.]/g, "");
      const pounds = clean === "" ? 0 : Number(clean);
      const pence = Math.round(pounds * 100);
      await flushAll({ amount_pence: pence });
      onPatch({ amount_pence: pence });
    },
  });

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px_120px_auto]">
        <label>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
            <span>Charity</span>
            <SaveStatusPill status={charity.status} error={charity.error} />
          </div>
          <input
            type="text"
            value={charity.value}
            onChange={(e) => charity.onChange(e.target.value)}
            placeholder="e.g. British Red Cross"
            disabled={!editable}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
          />
        </label>
        <label>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
            <span>Date</span>
            <SaveStatusPill status={date.status} error={date.error} />
          </div>
          <input
            type="date"
            value={date.value}
            onChange={(e) => date.onChange(e.target.value)}
            disabled={!editable}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
          />
        </label>
        <label>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
            <span>Amount</span>
            <SaveStatusPill status={amount.status} error={amount.error} />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-sm text-slate-500">£</span>
            <input
              type="text"
              inputMode="decimal"
              value={amount.value}
              onChange={(e) => {
                const stripped = e.target.value.replace(/[^0-9.]/g, "");
                const parts = stripped.split(".");
                const cleaned =
                  parts.length <= 1 ? stripped : parts[0] + "." + parts.slice(1).join("");
                amount.onChange(cleaned);
              }}
              placeholder="0"
              disabled={!editable}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
            />
          </div>
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={onDelete}
            disabled={!editable}
            className="rounded-lg px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

function SaveStatusPill({
  status, error,
}: {
  status: "idle" | "saving" | "saved" | "error";
  error: string | null;
}) {
  if (status === "saving") return <span className="text-[11px] text-slate-500">Saving...</span>;
  if (status === "saved") return <span className="text-[11px] font-medium text-emerald-700">Saved</span>;
  if (status === "error") return <span className="text-[11px] font-medium text-rose-700">{error ?? "Save failed"}</span>;
  return null;
}
