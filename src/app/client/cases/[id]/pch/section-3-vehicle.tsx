"use client";

// Section 3 vehicle subsection: manual (NOT AI chat) form that writes
// to the existing pch_vehicle row. Minimum field set engine-snapshot
// .ts actually reads for the capital-allowances calc; nothing else is
// surfaced to the client. See src/lib/pch/engine-snapshot.ts for the
// full list - we expose exactly the inputs the CA calculation
// consumes, no more. Any accountant-tuning overrides stay on the
// accountant side.
//
// Fields the engine uses, surfaced here:
//   status                        (dropdown, required to run CA at all)
//   fuel                          (dropdown; only shown if status != No vehicle)
//   bought_this_year              (Yes/No; if Yes, the four below)
//     purchase_price_pence        (money)
//     registration                (text)
//     make_model                  (text)
//     new_or_used                 (New/Used)
//   odo_start                     (integer miles)
//   odo_end                       (integer miles)
//   other_business_miles          (integer miles)
//   previous_method               (dropdown)
//   wdv_brought_forward_pence     (money; only shown if previous_method = Actual costs)
//
// Fields with sensible engine defaults that we deliberately don't
// expose: co2_gpkm (defaults OK; CO2 cap only matters for non-electric
// cars >=50g/km, and V5C lookup is extra friction for most drivers),
// phone_business_pct (defaults to 0.8), method_choice (engine picks
// internally), real_mpg / fuel_price_per_litre (reconciliation),
// business_pct_override / ca_rate_override (accountant tuning),
// disposal_proceeds (rare mid-year, accountant adds on review),
// purchase_date (bought_this_year flag is enough for the engine).

import { useEffect, useState } from "react";
import { useDebouncedSave } from "@/lib/hooks/use-debounced-save";
import {
  savePchVehicleFieldAction,
  uploadPchVehicleEvidenceAction,
} from "@/app/client/pch/intake-actions";
import { useOptionalIntakeProgress } from "./intake-progress-context";
import { isVehicleComplete } from "./intake-completion";
import { UploadControl } from "./upload-dropzone";

export type VehicleInitial = {
  status: string | null;
  fuel: string | null;
  make_model: string | null;
  registration: string | null;
  bought_this_year: boolean | null;
  purchase_price_pence: number | null;
  new_or_used: "New" | "Used" | null;
  odo_start: number | null;
  odo_end: number | null;
  other_business_miles: number | null;
  previous_method: string | null;
  wdv_brought_forward_pence: number | null;
  // Phase F -> G: private-use estimate (migration 0115) + optional
  // supporting doc (migration 0117). The client no longer picks a
  // Yes/No; private_use_declared is derived server-side as
  // (amount > 0) in savePchVehicleFieldAction.
  private_use_amount_pence: number | null;
  private_use_evidence: string | null;
};

// Must match pch_vehicle.status check constraint exactly (migration
// 0103 - the Phase 8 slice-1 expansion from 4 to 7 values). "No
// vehicle" is still a valid DB value but Phase H lifts it out of the
// dropdown into the outer applicable/not_applicable toggle: picking
// Not applicable saves status="No vehicle" under the hood.
const STATUS_OPTIONS: Array<{ value: string; help?: string }> = [
  { value: "Owned outright" },
  { value: "Hire purchase", help: "Monthly HP payments, you own it at the end" },
  { value: "PCP", help: "Personal Contract Purchase" },
  { value: "Loan", help: "Any other car loan" },
  { value: "Leased", help: "Business lease or PCH, you hand it back" },
  { value: "Rented", help: "Weekly rental, PCO hire, Uber hire" },
];
const FUEL_OPTIONS = ["Petrol", "Diesel", "Hybrid", "Electric"];
const PREVIOUS_METHOD_OPTIONS = [
  "First year",                             // never claimed before
  "Simplified mileage",                     // 45p/25p per mile
  "Actual costs (capital allowances claimed)",
];

// Phase J: Vehicle is now a top-level numbered section (4. Your
// vehicle), rendered as a sibling of Expenses in the workspace rather
// than nested inside it. The Personal allowance box that previously
// sat in this section is gone; its two fields (employment_income_
// pence + other_employment_evidence) have moved into the P11D
// declaration card.
export function Section4Vehicle({
  caseId,
  editable,
  initial,
}: {
  caseId: string;
  editable: boolean;
  initial: VehicleInitial;
}) {
  // Local mirror of the whole vehicle row so a dropdown change can
  // decide whether sub-questions appear (e.g. "did you buy a vehicle
  // this year? Yes" reveals purchase price). Each field saves
  // independently to pch_vehicle on debounce; the mirror is only for
  // conditional rendering + fallback display.
  const [v, setV] = useState<VehicleInitial>(initial);
  const patch = (p: Partial<VehicleInitial>) => setV((prev) => ({ ...prev, ...p }));

  // Phase H: outer applicable/not_applicable gate. UI state is tracked
  // locally so picking "Applicable" sticks visually even before the
  // client picks a real ownership mode from the dropdown. We seed it
  // from the stored status:
  //   null/empty  -> unanswered (amber)
  //   "No vehicle" -> not applicable
  //   anything else -> applicable
  const seedToggle = (): "applicable" | "not_applicable" | null => {
    if (initial.status === "No vehicle") return "not_applicable";
    if (initial.status && initial.status.trim().length > 0) return "applicable";
    return null;
  };
  const [applicable, setApplicable] = useState<"applicable" | "not_applicable" | null>(
    seedToggle,
  );
  const [togglePending, setTogglePending] = useState(false);
  const [toggleErr, setToggleErr] = useState<string | null>(null);

  const pickApplicable = async (next: "applicable" | "not_applicable") => {
    setTogglePending(true);
    setToggleErr(null);
    try {
      if (next === "not_applicable") {
        const r = await savePchVehicleFieldAction(caseId, "status", "No vehicle");
        if (!r.ok) { setToggleErr(r.error); return; }
        patch({ status: "No vehicle" });
        setApplicable("not_applicable");
      } else {
        // Clear status if we were previously on "No vehicle" so the
        // dropdown returns to an empty state for the client to pick.
        // Preserves any sub-fields they may have entered.
        if (v.status === "No vehicle") {
          const r = await savePchVehicleFieldAction(caseId, "status", null);
          if (!r.ok) { setToggleErr(r.error); return; }
          patch({ status: null });
        }
        setApplicable("applicable");
      }
    } finally {
      setTogglePending(false);
    }
  };

  const { setSectionDone } = useOptionalIntakeProgress();
  useEffect(() => {
    setSectionDone("vehicle", isVehicleComplete(v));
  }, [v, setSectionDone]);

  return (
    <section id="pch-section-vehicle" className="mb-8 scroll-mt-24">
      <h2 className="mb-1 text-lg font-bold">4. Your vehicle</h2>
      <p className="mb-4 text-xs text-slate-600">
        Did you use a vehicle for private-hire work this year? We need
        the details for the capital-allowances calculation if yes; skip
        it if not.
      </p>
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div
          className={
            "mb-4 flex items-center gap-3 "
            + (applicable === "applicable" ? "justify-end" : "justify-between")
          }
        >
          {applicable === null ? (
            <p className="text-sm text-slate-600">Choose one to continue.</p>
          ) : applicable === "not_applicable" ? (
            <p className="text-sm text-slate-600">
              No vehicle this year. Nothing more to fill in here.
            </p>
          ) : null}
          <OuterApplicableToggle
            status={applicable}
            pending={togglePending}
            editable={editable}
            onApplicable={() => pickApplicable("applicable")}
            onNotApplicable={() => pickApplicable("not_applicable")}
          />
        </div>
        {toggleErr ? (
          <p className="mb-2 text-xs text-rose-700">{toggleErr}</p>
        ) : null}

      {applicable === "applicable" ? (
        <>
          <SelectField
            caseId={caseId}
            field="status"
            label="How do you have the vehicle?"
            options={STATUS_OPTIONS}
            value={v.status}
            onSaved={(val) => patch({ status: val })}
            editable={editable}
            helpText={
              v.status
                ? STATUS_OPTIONS.find((o) => o.value === v.status)?.help
                : undefined
            }
          />

          <div className="mt-4">
            <SelectField
              caseId={caseId}
              field="fuel"
              label="Fuel type"
              options={FUEL_OPTIONS}
              value={v.fuel}
              onSaved={(val) => patch({ fuel: val })}
              editable={editable}
            />
          </div>

          <div className="mt-4">
            <SelectField
              caseId={caseId}
              field="previous_method"
              label="How was this vehicle claimed last year?"
              options={PREVIOUS_METHOD_OPTIONS}
              value={v.previous_method}
              onSaved={(val) => patch({ previous_method: val })}
              editable={editable}
              helpText="Never filed a return before? Pick First year."
            />
          </div>

          <div className="mt-4">
            <YesNoField
              caseId={caseId}
              field="bought_this_year"
              label="Did you buy a vehicle this tax year?"
              value={v.bought_this_year}
              onSaved={(val) => patch({ bought_this_year: val })}
              editable={editable}
            />
          </div>

          {v.bought_this_year === true ? (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <MoneyField
                caseId={caseId}
                field="purchase_price_pence"
                label="Purchase price"
                value={v.purchase_price_pence}
                onSaved={(val) => patch({ purchase_price_pence: val })}
                editable={editable}
              />
              <TextField
                caseId={caseId}
                field="registration"
                label="Registration number"
                value={v.registration}
                onSaved={(val) => patch({ registration: val })}
                editable={editable}
                autoCapitalize="characters"
                placeholder="e.g. AB12 CDE"
              />
              <TextField
                caseId={caseId}
                field="make_model"
                label="Make and model"
                value={v.make_model}
                onSaved={(val) => patch({ make_model: val })}
                editable={editable}
                placeholder="e.g. Toyota Prius"
                wide
              />
              <SelectField
                caseId={caseId}
                field="new_or_used"
                label="New or used?"
                options={["New", "Used"]}
                value={v.new_or_used}
                onSaved={(val) => patch({ new_or_used: val as "New" | "Used" })}
                editable={editable}
              />
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <IntegerField
              caseId={caseId}
              field="odo_start"
              label="Odometer at tax year start (6 April)"
              value={v.odo_start}
              onSaved={(val) => patch({ odo_start: val })}
              editable={editable}
            />
            <IntegerField
              caseId={caseId}
              field="odo_end"
              label="Odometer at tax year end (5 April)"
              value={v.odo_end}
              onSaved={(val) => patch({ odo_end: val })}
              editable={editable}
            />
          </div>

          <div className="mt-4">
            <IntegerField
              caseId={caseId}
              field="other_business_miles"
              label="Other business miles"
              value={v.other_business_miles}
              onSaved={(val) => patch({ other_business_miles: val })}
              editable={editable}
              helpText="Work-related miles that weren't on this car's odometer."
            />
          </div>

          {v.previous_method === "Actual costs (capital allowances claimed)" ? (
            <div className="mt-4">
              <MoneyField
                caseId={caseId}
                field="wdv_brought_forward_pence"
                label="Written-down value brought forward"
                value={v.wdv_brought_forward_pence}
                onSaved={(val) => patch({ wdv_brought_forward_pence: val })}
                editable={editable}
                helpText="The vehicle's remaining tax book value from last year's accounts. Ask your previous accountant if you don't have it."
              />
            </div>
          ) : null}
        </>
      ) : null}

        {applicable === "applicable" ? (
          <div className="mt-6 border-t border-slate-100 pt-5">
            <div className="mb-1 text-sm font-bold text-ink">Private use</div>
            <p className="mb-3 text-xs text-slate-600">
              Rough figure for the personal-use portion of the vehicle
              or anything else you're claiming as an expense. Leave
              blank if everything was for work.
            </p>
            <MoneyField
              caseId={caseId}
              field="private_use_amount_pence"
              label="Private use amount (if any)"
              value={v.private_use_amount_pence}
              onSaved={(val) => patch({ private_use_amount_pence: val })}
              editable={editable}
              helpText="Your estimate for the year. Your accountant factors it in on review."
            />
            <div className="mt-4">
              <PrivateUseEvidenceUpload
                caseId={caseId}
                editable={editable}
                current={v.private_use_evidence}
                onUploaded={(path) => patch({ private_use_evidence: path })}
              />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// Outer applicable/not_applicable toggle for the Vehicle section.
// Visually matches the toggle on the 12 declaration cards.
function OuterApplicableToggle({
  status, pending, editable, onApplicable, onNotApplicable,
}: {
  status: "applicable" | "not_applicable" | null;
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

type SelectOption = string | { value: string; help?: string };

function SelectField({
  caseId, field, label, options, value, onSaved, editable, helpText,
}: {
  caseId: string;
  field: string;
  label: string;
  options: SelectOption[];
  value: string | null;
  onSaved: (v: string | null) => void;
  editable: boolean;
  helpText?: string;
}) {
  const { value: v, onChange, status, error } = useDebouncedSave<string>({
    initial: value ?? "",
    debounceMs: 0,
    save: async (next) => {
      const r = await savePchVehicleFieldAction(
        caseId,
        field,
        next === "" ? null : next,
      );
      if (!r.ok) throw new Error(r.error);
      onSaved(next === "" ? null : next);
    },
  });
  const normalised = options.map((o) =>
    typeof o === "string" ? { value: o, help: undefined } : o,
  );
  return (
    <label>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
        <span>{label}</span>
        <SaveStatusPill status={status} error={error} />
      </div>
      <select
        value={v}
        onChange={(e) => onChange(e.target.value)}
        disabled={!editable}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
      >
        <option value="">Pick one...</option>
        {normalised.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.value}
          </option>
        ))}
      </select>
      {helpText ? <p className="mt-1 text-[11px] text-slate-500">{helpText}</p> : null}
    </label>
  );
}

function TextField({
  caseId, field, label, value, onSaved, editable, placeholder, autoCapitalize, wide,
}: {
  caseId: string;
  field: string;
  label: string;
  value: string | null;
  onSaved: (v: string | null) => void;
  editable: boolean;
  placeholder?: string;
  autoCapitalize?: "off" | "characters" | "words" | "sentences" | "none";
  wide?: boolean;
}) {
  const { value: v, onChange, status, error } = useDebouncedSave<string>({
    initial: value ?? "",
    save: async (next) => {
      const trimmed = next.trim();
      const r = await savePchVehicleFieldAction(
        caseId, field, trimmed === "" ? null : trimmed,
      );
      if (!r.ok) throw new Error(r.error);
      onSaved(trimmed === "" ? null : trimmed);
    },
  });
  return (
    <label className={wide ? "sm:col-span-2" : undefined}>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
        <span>{label}</span>
        <SaveStatusPill status={status} error={error} />
      </div>
      <input
        type="text"
        autoCapitalize={autoCapitalize}
        value={v}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={!editable}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
      />
    </label>
  );
}

function MoneyField({
  caseId, field, label, value, onSaved, editable, helpText,
}: {
  caseId: string;
  field: string;
  label: string;
  value: number | null;
  onSaved: (v: number | null) => void;
  editable: boolean;
  helpText?: string;
}) {
  const { value: v, onChange, status, error } = useDebouncedSave<string>({
    initial: value && value > 0 ? (value / 100).toString() : "",
    save: async (next) => {
      const clean = next.replace(/[^0-9.]/g, "");
      const pounds = clean === "" ? null : Number(clean);
      if (pounds !== null && (!Number.isFinite(pounds) || pounds < 0)) {
        throw new Error("Must be zero or more.");
      }
      const pence = pounds === null ? null : Math.round(pounds * 100);
      const r = await savePchVehicleFieldAction(caseId, field, pence);
      if (!r.ok) throw new Error(r.error);
      onSaved(pence);
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
          value={v}
          onChange={(e) => {
            const stripped = e.target.value.replace(/[^0-9.]/g, "");
            const parts = stripped.split(".");
            const cleaned = parts.length <= 1 ? stripped : parts[0] + "." + parts.slice(1).join("");
            onChange(cleaned);
          }}
          placeholder="0.00"
          disabled={!editable}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
        />
      </div>
      {helpText ? <p className="mt-1 text-[11px] text-slate-500">{helpText}</p> : null}
    </label>
  );
}

function IntegerField({
  caseId, field, label, value, onSaved, editable, helpText,
}: {
  caseId: string;
  field: string;
  label: string;
  value: number | null;
  onSaved: (v: number | null) => void;
  editable: boolean;
  helpText?: string;
}) {
  const { value: v, onChange, status, error } = useDebouncedSave<string>({
    initial: value === null ? "" : String(value),
    save: async (next) => {
      const clean = next.replace(/[^0-9]/g, "");
      const n = clean === "" ? null : Number(clean);
      const r = await savePchVehicleFieldAction(caseId, field, n);
      if (!r.ok) throw new Error(r.error);
      onSaved(n);
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
        inputMode="numeric"
        value={v}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
        placeholder="miles"
        disabled={!editable}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
      />
      {helpText ? <p className="mt-1 text-[11px] text-slate-500">{helpText}</p> : null}
    </label>
  );
}

function YesNoField({
  caseId, field, label, value, onSaved, editable,
}: {
  caseId: string;
  field: string;
  label: string;
  value: boolean | null;
  onSaved: (v: boolean | null) => void;
  editable: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = async (next: boolean | null) => {
    setPending(true);
    setErr(null);
    try {
      const r = await savePchVehicleFieldAction(caseId, field, next);
      if (!r.ok) setErr(r.error);
      else onSaved(next);
    } finally {
      setPending(false);
    }
  };
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
        <span>{label}</span>
        {pending ? <span className="text-[11px] text-slate-500">Saving...</span> : null}
      </div>
      <div className="flex gap-2">
        <YesNoButton
          selected={value === true}
          onClick={() => pick(true)}
          disabled={!editable || pending}
          label="Yes"
        />
        <YesNoButton
          selected={value === false}
          onClick={() => pick(false)}
          disabled={!editable || pending}
          label="No"
        />
      </div>
      {err ? <p className="mt-1 text-xs text-rose-700">{err}</p> : null}
    </div>
  );
}

function YesNoButton({
  selected, onClick, disabled, label,
}: {
  selected: boolean;
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "flex-1 rounded-lg border px-4 py-2 text-sm font-semibold transition disabled:opacity-50 "
        + (selected
          ? "border-sky bg-sky/10 text-sky"
          : "border-slate-300 bg-white text-slate-700 hover:border-sky hover:text-sky")
      }
    >
      {label}
    </button>
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

// Phase G -> H: optional supporting-doc upload for the vehicle
// private-use amount. Writes to pch_vehicle.private_use_evidence
// (migration 0117) via its own server action because the column lives
// on pch_vehicle not pch_cases; everything else is handled by the
// shared UploadControl.
function PrivateUseEvidenceUpload({
  caseId, editable, current, onUploaded,
}: {
  caseId: string;
  editable: boolean;
  current: string | null;
  onUploaded: (path: string) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const upload = async (file: File) => {
    setErr(null);
    const fd = new FormData();
    fd.append("file", file);
    const r = await uploadPchVehicleEvidenceAction(caseId, "private_use_evidence", fd);
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
