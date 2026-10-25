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

import { useState } from "react";
import { useDebouncedSave } from "@/lib/hooks/use-debounced-save";
import { savePchVehicleFieldAction } from "@/app/client/pch/intake-actions";

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
};

const STATUS_OPTIONS = [
  "Owned outright",
  "Bought on HP / loan",
  "Rented weekly (PCO hire)",
  "Leased",
  "No vehicle",
];
const FUEL_OPTIONS = ["Petrol", "Diesel", "Hybrid", "Electric"];
const PREVIOUS_METHOD_OPTIONS = [
  "First year",                             // never claimed before
  "Simplified mileage",                     // 45p/25p per mile
  "Actual costs (capital allowances claimed)",
];

export function Section3Vehicle({
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

  const noVehicle = v.status === "No vehicle";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="mb-3">
        <div className="text-sm font-bold text-ink">Your vehicle</div>
        <p className="mt-1 text-xs text-slate-600">
          A few quick questions about the vehicle you used for private-
          hire work this year. We use these to work out capital
          allowances on the tax side.
        </p>
      </div>

      <SelectField
        caseId={caseId}
        field="status"
        label="How do you have the vehicle?"
        options={STATUS_OPTIONS}
        value={v.status}
        onSaved={(val) => patch({ status: val })}
        editable={editable}
      />

      {!noVehicle ? (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              caseId={caseId}
              field="fuel"
              label="Fuel type"
              options={FUEL_OPTIONS}
              value={v.fuel}
              onSaved={(val) => patch({ fuel: val })}
              editable={editable}
            />
            <SelectField
              caseId={caseId}
              field="previous_method"
              label="How was this vehicle claimed last year?"
              options={PREVIOUS_METHOD_OPTIONS}
              value={v.previous_method}
              onSaved={(val) => patch({ previous_method: val })}
              editable={editable}
              helpText="If you&apos;ve never filed a return before, pick First year."
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
                helpText="The vehicle&apos;s remaining tax book value from last year&apos;s accounts. Ask your previous accountant if you don&apos;t have it."
              />
            </div>
          ) : null}

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

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <IntegerField
              caseId={caseId}
              field="odo_start"
              label="Odometer at tax year start"
              value={v.odo_start}
              onSaved={(val) => patch({ odo_start: val })}
              editable={editable}
              helpText="6 April"
            />
            <IntegerField
              caseId={caseId}
              field="odo_end"
              label="Odometer at tax year end"
              value={v.odo_end}
              onSaved={(val) => patch({ odo_end: val })}
              editable={editable}
              helpText="5 April"
            />
            <IntegerField
              caseId={caseId}
              field="other_business_miles"
              label="Other business miles"
              value={v.other_business_miles}
              onSaved={(val) => patch({ other_business_miles: val })}
              editable={editable}
              helpText="If any work-related miles weren't on this car's odometer."
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function SelectField({
  caseId, field, label, options, value, onSaved, editable, helpText,
}: {
  caseId: string;
  field: string;
  label: string;
  options: string[];
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
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
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
