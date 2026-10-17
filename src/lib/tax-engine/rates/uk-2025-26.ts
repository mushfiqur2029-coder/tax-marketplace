// UK personal-tax rate pack for the 2025/26 tax year (6 Apr 2025 to
// 5 Apr 2026). Figures mirror the "6 Tax 2025-26" tab of the PCH Uber
// Tax Pack workbook, which cites gov.uk as the source for every value.
//
// Engine is service-agnostic: Delivery, Sole trader, Landlord pipelines
// use the same rate pack. Only tax year selection changes.
//
// NEVER mutate at runtime. Rates are a config, treat as read-only.

import type { UkTaxYearRates } from "../types";

export const UK_TAX_RATES_2025_26: UkTaxYearRates = {
  taxYear: "2025/26",
  // Income tax
  personalAllowance: 12570,
  personalAllowanceTaperStart: 100000, // allowance tapers £1 per £2 over this
  basicRateBand: 37700,                // on top of personal allowance
  additionalRateThreshold: 125140,
  basicRate: 0.20,
  higherRate: 0.40,
  additionalRate: 0.45,
  personalSavingsAllowanceBasic: 1000,
  personalSavingsAllowanceHigher: 500,
  // Marriage allowance (transfer amount)
  marriageAllowance: 1260,
  // Class 4 NIC
  class4LowerProfitsLimit: 12570,
  class4UpperProfitsLimit: 50270,
  class4MainRate: 0.06,
  class4AdditionalRate: 0.02,
  // Class 2 (small profits threshold + voluntary)
  class2SmallProfitsThreshold: 6845,
  class2VoluntaryAnnual: 182, // £3.50 × 52
  // Payments on account kick in when liability >= this
  poaThreshold: 1000,
  // Simplified mileage rates (business miles)
  mileageRateFirst10k: 0.45,
  mileageRateAbove10k: 0.25,
  // VAT (Flat Rate Scheme, limited-cost trader)
  vatFrsLimitedCostRate: 0.165,
  vatFrsTransportRate: 0.10, // 10% for taxis / PHV
  vatFrsFirstYearDiscount: 0.01,
  // MTD for Income Tax thresholds (based on prior year qualifying income)
  mtdThresholdFirst: 50000,  // mandatory from Apr 2026 if 2024/25 QI > £50k
  mtdThresholdSecond: 30000, // mandatory from Apr 2027 if 2025/26 QI > £30k
  mtdThresholdThird: 20000,  // likely mandatory from Apr 2028
};
