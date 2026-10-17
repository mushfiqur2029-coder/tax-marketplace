// UK personal-tax rate pack for the 2024/25 tax year (6 Apr 2024 to
// 5 Apr 2025). Needed to validate the engine against clients whose
// filed returns are for 2024/25 (the just-completed year); the 2025/26
// pack covers the current year.
//
// Values from gov.uk; frozen bands at the Personal Allowance and higher-
// rate threshold (same as 2025/26 for those). The Class 2 rules changed
// in April 2024, Class 2 is no longer compulsory for most self-employed;
// voluntary amount for 2024/25 shown. Class 4 main rate was 6% (down
// from 8% in 2023/24).

import type { UkTaxYearRates } from "../types";

export const UK_TAX_RATES_2024_25: UkTaxYearRates = {
  taxYear: "2024/25",
  personalAllowance: 12570,
  personalAllowanceTaperStart: 100000,
  basicRateBand: 37700,
  additionalRateThreshold: 125140,
  basicRate: 0.20,
  higherRate: 0.40,
  additionalRate: 0.45,
  personalSavingsAllowanceBasic: 1000,
  personalSavingsAllowanceHigher: 500,
  marriageAllowance: 1260,
  class4LowerProfitsLimit: 12570,
  class4UpperProfitsLimit: 50270,
  class4MainRate: 0.06,
  class4AdditionalRate: 0.02,
  class2SmallProfitsThreshold: 6725,
  class2VoluntaryAnnual: 179.40, // £3.45 × 52
  poaThreshold: 1000,
  mileageRateFirst10k: 0.45,
  mileageRateAbove10k: 0.25,
  vatFrsLimitedCostRate: 0.165,
  vatFrsTransportRate: 0.10,
  vatFrsFirstYearDiscount: 0.01,
  mtdThresholdFirst: 50000,
  mtdThresholdSecond: 30000,
  mtdThresholdThird: 20000,
};
