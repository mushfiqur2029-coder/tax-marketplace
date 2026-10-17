// Entry point for the UK personal-tax engine. Service-agnostic; drives
// the PCH Uber flow today, with Delivery / Sole trader / Freelancer /
// Landlord to follow using the same shapes and the same rate packs.

export * from "./types";
export { UK_TAX_RATES_2025_26 } from "./rates/uk-2025-26";
export { UK_TAX_RATES_2024_25 } from "./rates/uk-2024-25";
export {
  computeAll,
  computeIncome,
  computeExpenses,
  computeVehicle,
  buildPL,
  computeTax,
  computeMtdStatus,
  buildSa103sBoxes,
  computeZeroTaxCheck,
} from "./compute";
export { computeReturnsOwed, dateToTaxYear, taxYearBounds } from "./returns-owed";
