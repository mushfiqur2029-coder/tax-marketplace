import { describe, it, expect } from "vitest";
import {
  computeAll,
  computeTax,
  computeIncome,
  computeVehicle,
  computeExpenses,
  buildPL,
} from "./compute";
import { UK_TAX_RATES_2024_25 } from "./rates/uk-2024-25";
import { UK_TAX_RATES_2025_26 } from "./rates/uk-2025-26";
import type { TaxEngineInputs, ExpenseLine, VehicleInputs } from "./types";

// Synthetic client used throughout: a simple PCH driver who owns their
// car outright, no other income, no reliefs, no payments on account.
function baseInput(overrides: Partial<TaxEngineInputs> = {}): TaxEngineInputs {
  const rates = overrides.rates ?? UK_TAX_RATES_2025_26;
  const vehicle: VehicleInputs = {
    status: "Owned outright",
    fuel: "Petrol",
    co2Gpkm: 120,
    boughtThisYear: "No",
    disposed: "No",
    odoStart: 20000,
    odoEnd: 60000,                   // 40,000 total miles
    otherBusinessMiles: 0,
    phoneBusinessPct: 0.8,
    wdvBroughtForward: 0,
    previousMethod: "Simplified mileage",
    privateUseAmount: 0,
  };
  return {
    rates,
    client: {
      employmentIncome: 0,
      paye: 0,
      rentalProfit: 0,
      bankInterest: 0,
      personalPensionNet: 0,
      giftAidNet: 0,
      marriageAllowanceStatus: "None",
      poa1Due: 0, poa2Due: 0, poa1Paid: 0, poa2Paid: 0,
      lastYearQualifyingIncome: 0,
      grossRentReceived: 0,
    },
    income: [
      {
        grossTakings: 40000, platformFee: 10000,
        onTripMiles: 18000, deadMiles: 12000, type: "Fares",
      },
    ],
    expenses: [
      {
        label: "Fuel", amountPaid: 6000, evidence: "Bank statement",
        carCost: "Yes", category: "Vehicle running costs", sa103sBox: 12,
      },
      {
        label: "Insurance", amountPaid: 1200, evidence: "Receipt",
        carCost: "Yes", category: "Vehicle running costs", sa103sBox: 12,
      },
      {
        label: "PHV licence", amountPaid: 300, evidence: "Receipt",
        carCost: "No", category: "Licences & compliance", sa103sBox: 19,
      },
    ],
    vehicle,
    ...overrides,
  };
}

describe("computeIncome", () => {
  it("splits gross by Type and sums platform fees + miles", () => {
    const out = computeIncome([
      { grossTakings: 10000, platformFee: 2500, onTripMiles: 5000, deadMiles: 1500, type: "Fares" },
      { grossTakings: 500, platformFee: 0, onTripMiles: 0, deadMiles: 0, type: "Other" },
    ]);
    expect(out.fares).toBe(10000);
    expect(out.otherTrading).toBe(500);
    expect(out.vatReceived).toBe(0);
    expect(out.totalTurnover).toBe(10500);
    expect(out.platformFeesTotal).toBe(2500);
    expect(out.onTripMilesTotal).toBe(5000);
    expect(out.deadMilesTotal).toBe(1500);
  });
});

describe("computeVehicle", () => {
  it("picks the simplified-mileage recommendation when it beats actuals", () => {
    const input = baseInput();
    const income = computeIncome(input.income);
    const v = computeVehicle(input.vehicle, income, input.rates, input.expenses);
    // 40k total miles, 30k business miles (18k + 12k), so bus% = 0.75
    expect(v.totalMiles).toBe(40000);
    expect(v.businessMiles).toBe(30000);
    expect(v.businessPct).toBeCloseTo(0.75, 5);
    // Mileage: 10000 * 0.45 + 20000 * 0.25 = 4500 + 5000 = 9500
    expect(v.mileageAllowance).toBe(9500);
    // Actuals: car-cost expenses (6000 fuel + 1200 insurance) * 0.75 = 5400
    expect(v.actualVehicleCosts).toBeCloseTo(5400, 2);
    // 9500 mileage > 5400 actual → recommended "Simplified mileage"
    expect(v.recommendedMethod).toBe("Simplified mileage");
    expect(v.methodUsed).toBe("Simplified mileage");
    expect(v.mileageUsedInPL).toBe(9500);
    expect(v.caClaim).toBe(0);
  });
  it("recommends actual costs when the previous year used CAs", () => {
    const input = baseInput({
      vehicle: {
        ...baseInput().vehicle,
        previousMethod: "Actual costs (capital allowances claimed)",
        wdvBroughtForward: 5000,
      },
    });
    const income = computeIncome(input.income);
    const v = computeVehicle(input.vehicle, income, input.rates, input.expenses);
    expect(v.recommendedMethod).toBe("Actual costs");
    expect(v.methodUsed).toBe("Actual costs");
    // CA: pool = 5000, rate = 0.06 (petrol, no CO2 ≤ 50) → WDA = 300
    // Full = 300 (no FYA, no disposal), × bus% 0.75 → claim 225
    expect(v.caWda).toBeCloseTo(300, 2);
    expect(v.caClaim).toBeCloseTo(225, 2);
    expect(v.mileageUsedInPL).toBe(0);
  });
  it("gives 100% FYA for a new zero-emission car bought this year", () => {
    const input = baseInput({
      vehicle: {
        ...baseInput().vehicle,
        fuel: "Electric",
        boughtThisYear: "Yes",
        newOrUsed: "New",
        purchasePrice: 30000,
        previousMethod: "First year",
      },
    });
    const income = computeIncome(input.income);
    const v = computeVehicle(input.vehicle, income, input.rates, input.expenses);
    expect(v.caFyaQualifies).toBe(true);
    expect(v.caFya).toBe(30000);
    // Pool after FYA removed = 0, so no WDA
    expect(v.caWda).toBe(0);
    // Claim = 30000 × bus% 0.75 (actual-costs method triggered because
    // 30000 × 0.75 = 22500 >> 9500 mileage)
    expect(v.methodUsed).toBe("Actual costs");
    expect(v.caClaim).toBeCloseTo(22500, 2);
  });
});

describe("computeTax (2025/26)", () => {
  it("basic driver, SE profit 30k, no other income", () => {
    // SE profit 30000, no reliefs, no other income
    const result = computeAll(baseInput());
    // From the engine: tax = basic rate on (30k - 12,570 PA) over mileage method
    // taxable profit = 40000 turnover - 9500 mileage - 10000 platform fees (auto-injected) - 300 licence = 20200
    // 20200 - 12570 = 7630 at 20% = 1526
    // C4: (20200 - 12570) × 0.06 = 457.80
    expect(result.pl.turnover).toBe(40000);
    expect(result.pl.taxableProfit).toBe(20200);
    expect(result.tax.incomeTax).toBe(1526);
    expect(result.tax.class4).toBeCloseTo(457.8, 2);
    // No POA since the brief liability < £1000? No: 1526 + 457.8 = 1983.80 ≥ 1000 and no PAYE
    expect(result.tax.poaForNextYear).toBeGreaterThan(0);
  });

  it("pensions extend the basic rate band", () => {
    // Setup: SE profit of 60k, £5000 net pension → gross £6250
    const r = UK_TAX_RATES_2025_26;
    const basic = computeTax(
      {
        turnover: 0, expensesTotal: 0, netProfit: 60000,
        capitalAllowances: 0, privateUseAmount: 0, taxableProfit: 60000, rows: {} as never,
      },
      {
        employmentIncome: 0, paye: 0, rentalProfit: 0, bankInterest: 0,
        personalPensionNet: 0, giftAidNet: 0,
        marriageAllowanceStatus: "None",
        poa1Due: 0, poa2Due: 0, poa1Paid: 0, poa2Paid: 0,
        lastYearQualifyingIncome: 0, grossRentReceived: 0,
      },
      r,
    );
    const withPension = computeTax(
      {
        turnover: 0, expensesTotal: 0, netProfit: 60000,
        capitalAllowances: 0, privateUseAmount: 0, taxableProfit: 60000, rows: {} as never,
      },
      {
        employmentIncome: 0, paye: 0, rentalProfit: 0, bankInterest: 0,
        personalPensionNet: 5000, giftAidNet: 0,
        marriageAllowanceStatus: "None",
        poa1Due: 0, poa2Due: 0, poa1Paid: 0, poa2Paid: 0,
        lastYearQualifyingIncome: 0, grossRentReceived: 0,
      },
      r,
    );
    // Basic: Taxable income = 60000 - 12570 = 47430. Basic band = 37700.
    // BR tax = 37700 * 0.20 = 7540. HR tax = (47430 - 37700) * 0.40 = 3892.
    expect(basic.incomeTax).toBeCloseTo(7540 + 3892, 2);
    // With pension (gross 6250): extended basic band = 37700 + 6250 = 43950
    // BR tax = 43950 * 0.20 = 8790. HR tax = (47430 - 43950) * 0.40 = 1392.
    expect(withPension.incomeTax).toBeCloseTo(8790 + 1392, 2);
    // Should save (7540 + 3892) - (8790 + 1392) = 1250
    expect(basic.incomeTax - withPension.incomeTax).toBeCloseTo(1250, 2);
  });

  it("personal allowance tapers above £100k adjusted net income", () => {
    const r = UK_TAX_RATES_2025_26;
    // SE profit 120k, no other income/relief → ANI = 120k. Taper = (120k-100k)/2 = 10k.
    // PA = max(0, 12570 - 10000) = 2570.
    const result = computeTax(
      {
        turnover: 0, expensesTotal: 0, netProfit: 120000,
        capitalAllowances: 0, privateUseAmount: 0, taxableProfit: 120000, rows: {} as never,
      },
      {
        employmentIncome: 0, paye: 0, rentalProfit: 0, bankInterest: 0,
        personalPensionNet: 0, giftAidNet: 0,
        marriageAllowanceStatus: "None",
        poa1Due: 0, poa2Due: 0, poa1Paid: 0, poa2Paid: 0,
        lastYearQualifyingIncome: 0, grossRentReceived: 0,
      },
      r,
    );
    expect(result.personalAllowance).toBe(2570);
  });

  it("marriage allowance received reduces tax by up to £252", () => {
    const r = UK_TAX_RATES_2025_26;
    const result = computeTax(
      {
        turnover: 0, expensesTotal: 0, netProfit: 30000,
        capitalAllowances: 0, privateUseAmount: 0, taxableProfit: 30000, rows: {} as never,
      },
      {
        employmentIncome: 0, paye: 0, rentalProfit: 0, bankInterest: 0,
        personalPensionNet: 0, giftAidNet: 0,
        marriageAllowanceStatus: "Receiving",
        poa1Due: 0, poa2Due: 0, poa1Paid: 0, poa2Paid: 0,
        lastYearQualifyingIncome: 0, grossRentReceived: 0,
      },
      r,
    );
    // Taxable income = 30000 - 12570 = 17430. BR tax = 17430 * 0.20 = 3486.
    // MA reduction = 1260 * 0.20 = 252.
    expect(result.marriageAllowanceReduction).toBeCloseTo(-252, 2);
    expect(result.incomeTax).toBeCloseTo(3486 - 252, 2);
  });

  it("Class 4 NIC: 6% between 12,570 and 50,270, 2% above", () => {
    const r = UK_TAX_RATES_2025_26;
    const low = computeTax(
      { turnover: 0, expensesTotal: 0, netProfit: 40000, capitalAllowances: 0, privateUseAmount: 0, taxableProfit: 40000, rows: {} as never },
      { employmentIncome: 0, paye: 0, rentalProfit: 0, bankInterest: 0, personalPensionNet: 0, giftAidNet: 0, marriageAllowanceStatus: "None", poa1Due: 0, poa2Due: 0, poa1Paid: 0, poa2Paid: 0, lastYearQualifyingIncome: 0, grossRentReceived: 0 },
      r,
    );
    // (40000 - 12570) * 0.06 = 1645.80
    expect(low.class4).toBeCloseTo(1645.8, 2);
    const high = computeTax(
      { turnover: 0, expensesTotal: 0, netProfit: 70000, capitalAllowances: 0, privateUseAmount: 0, taxableProfit: 70000, rows: {} as never },
      { employmentIncome: 0, paye: 0, rentalProfit: 0, bankInterest: 0, personalPensionNet: 0, giftAidNet: 0, marriageAllowanceStatus: "None", poa1Due: 0, poa2Due: 0, poa1Paid: 0, poa2Paid: 0, lastYearQualifyingIncome: 0, grossRentReceived: 0 },
      r,
    );
    // (50270 - 12570) * 0.06 = 2262 + (70000 - 50270) * 0.02 = 394.60 → 2656.60
    expect(high.class4).toBeCloseTo(2656.6, 2);
  });
});

describe("computeAll integration", () => {
  it("produces a self-consistent output across all tabs", () => {
    const out = computeAll(baseInput());
    // P&L arithmetic
    expect(out.pl.turnover - out.pl.expensesTotal).toBeCloseTo(out.pl.netProfit, 2);
    expect(out.pl.netProfit - out.pl.capitalAllowances).toBeCloseTo(out.pl.taxableProfit, 2);
    // SA103S box 31 = total taxable profit (rounded) ≈ engine's taxable
    expect(Math.abs(out.sa103s.box31_totalTaxableProfits - out.pl.taxableProfit))
      .toBeLessThan(2);
    // Turnover 40k with no last-year QI → MTD mandatory from Apr 2027
    // (over the £30k second threshold).
    expect(out.mtd.status).toBe("MANDATORY_APR_2027");
  });
});
