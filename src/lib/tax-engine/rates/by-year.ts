// Rate-pack selector keyed on UK tax-year label.
//
// Add new years here as rate packs land. Years without a pack throw
// so the caller surfaces "contact support" to the client instead of
// silently falling back to the wrong year.

import type { UkTaxYear, UkTaxYearRates } from "../types";
import { UK_TAX_RATES_2024_25 } from "./uk-2024-25";
import { UK_TAX_RATES_2025_26 } from "./uk-2025-26";

const PACKS: Partial<Record<UkTaxYear, UkTaxYearRates>> = {
  "2024/25": UK_TAX_RATES_2024_25,
  "2025/26": UK_TAX_RATES_2025_26,
};

export const SUPPORTED_TAX_YEARS: UkTaxYear[] = Object.keys(PACKS) as UkTaxYear[];

export function hasRatePackFor(taxYear: UkTaxYear): boolean {
  return PACKS[taxYear] !== undefined;
}

export function getRatePackFor(taxYear: UkTaxYear): UkTaxYearRates {
  const pack = PACKS[taxYear];
  if (!pack) {
    throw new Error(
      "No rate pack for tax year " + taxYear + ". Supported: " + SUPPORTED_TAX_YEARS.join(", "),
    );
  }
  return pack;
}
