// Prior-year anomaly detection. Given this case's engine snapshot and
// the snapshot from the same client's prior linked year, highlight the
// figures that have moved materially. The accountant sees this as a
// "worth a closer look" panel at the top of the workspace so sharp
// year-on-year swings get extra scrutiny before anything else is
// touched.
//
// Thresholds (deliberately conservative, we flag TOO MUCH rather than
// miss a real issue):
//   - sign flip (profit <-> loss): always severe
//   - absolute change >= 25% AND >= £1,000: notable
//   - absolute change >= 50%: severe
//   - mileage change >= 30% AND >= 2,000 miles: notable (big route
//     pattern changes often correlate with switching platforms)
// Fields with both years at zero are skipped (nothing to compare).

import type { TaxEngineOutput } from "@/lib/tax-engine";

export type AnomalySeverity = "notable" | "severe";

export type Anomaly = {
  key: string;
  label: string;
  current: number;
  prior: number;
  delta: number;         // current - prior
  pctChange: number;     // (current - prior) / prior, or Infinity when prior = 0
  severity: AnomalySeverity;
  note: string;          // One-line why-this-matters for the accountant
};

type FieldDef = {
  key: string;
  label: string;
  read: (s: TaxEngineOutput) => number;
  // Mileage uses an absolute floor of 2,000 and a 30% threshold; money
  // fields use a floor of £1,000 and a 25% / 50% notable/severe pair.
  kind: "money" | "miles";
};

const FIELDS: readonly FieldDef[] = [
  { key: "turnover", label: "Turnover", kind: "money", read: (s) => s.pl.turnover },
  { key: "expensesTotal", label: "Total expenses", kind: "money", read: (s) => s.pl.expensesTotal },
  { key: "netProfit", label: "Net profit", kind: "money", read: (s) => s.pl.netProfit },
  { key: "taxableProfit", label: "Taxable profit", kind: "money", read: (s) => s.pl.taxableProfit },
];

// Mileage lives on the vehicle inputs, not the engine output. We read
// it from the SA103S box 12 proxy (car/van/travel £) is tempting but
// that's cost, not miles. Instead the caller passes in the mileage
// pair directly so this file stays input-shape agnostic.
export type MileagePair = { current: number; prior: number };

export function computePriorYearAnomalies(
  current: TaxEngineOutput | null,
  prior: TaxEngineOutput | null,
  mileage?: MileagePair,
): Anomaly[] {
  if (!current || !prior) return [];
  const out: Anomaly[] = [];

  for (const f of FIELDS) {
    const curr = f.read(current);
    const prev = f.read(prior);
    if (curr === 0 && prev === 0) continue;
    const anomaly = classifyMoney(f.label, curr, prev);
    if (anomaly) out.push({ key: f.key, label: f.label, current: curr, prior: prev, ...anomaly });
  }

  if (mileage && !(mileage.current === 0 && mileage.prior === 0)) {
    const anomaly = classifyMiles(mileage.current, mileage.prior);
    if (anomaly) out.push({
      key: "businessMiles", label: "Business miles",
      current: mileage.current, prior: mileage.prior,
      ...anomaly,
    });
  }

  // Severe first, then by absolute percentage change descending.
  out.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "severe" ? -1 : 1;
    return Math.abs(b.pctChange) - Math.abs(a.pctChange);
  });
  return out;
}

function classifyMoney(
  label: string,
  current: number,
  prior: number,
): Omit<Anomaly, "key" | "label" | "current" | "prior"> | null {
  const delta = current - prior;
  const absDelta = Math.abs(delta);
  const pct = prior === 0 ? (current === 0 ? 0 : Infinity) : delta / prior;
  const absPct = Math.abs(pct);
  const signFlipped = (current > 0 && prior < 0) || (current < 0 && prior > 0);

  if (signFlipped) {
    return {
      delta, pctChange: pct, severity: "severe",
      note: current > 0
        ? `Flipped from loss to profit this year (${fmt(prior)} to ${fmt(current)}).`
        : `Flipped from profit to loss this year (${fmt(prior)} to ${fmt(current)}).`,
    };
  }
  if (absDelta < 1000) return null;             // Below the money floor, skip
  if (absPct >= 0.5) {
    return {
      delta, pctChange: pct, severity: "severe",
      note: `${label} moved ${(absPct * 100).toFixed(0)}% year-on-year (${fmt(prior)} to ${fmt(current)}).`,
    };
  }
  if (absPct >= 0.25) {
    return {
      delta, pctChange: pct, severity: "notable",
      note: `${label} moved ${(absPct * 100).toFixed(0)}% year-on-year (${fmt(prior)} to ${fmt(current)}).`,
    };
  }
  return null;
}

function classifyMiles(current: number, prior: number): Omit<Anomaly, "key" | "label" | "current" | "prior"> | null {
  const delta = current - prior;
  const absDelta = Math.abs(delta);
  const pct = prior === 0 ? (current === 0 ? 0 : Infinity) : delta / prior;
  const absPct = Math.abs(pct);
  if (absDelta < 2000) return null;
  if (absPct < 0.3) return null;
  return {
    delta, pctChange: pct,
    severity: absPct >= 0.5 ? "severe" : "notable",
    note: `Business miles moved ${(absPct * 100).toFixed(0)}% year-on-year (${Math.round(prior).toLocaleString()} to ${Math.round(current).toLocaleString()}).`,
  };
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  const s = "£" + Math.round(abs).toLocaleString("en-GB");
  return n < 0 ? "(" + s + ")" : s;
}
