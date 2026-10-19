// Core tax engine. Port of the formulas in "3 Uber PCH Tax Pack 2025-26"
// workbook, tabs 1 Client through 8 SA Boxes plus the 6b Zero-Tax Check
// compliance aid. Named-range references in comments cite the workbook
// cell (e.g. "B33 Veh_BusPct") so the port can be audited against the
// authoritative source.
//
// Service-agnostic:
//   - PCH drivers set carCost="Yes" + vehicle method as per their
//     ownership status.
//   - Delivery / Sole trader / Freelancer use the same shapes but with
//     their own business-use % and expense categories.
//   - Landlord will swap the vehicle-method block for property allowances
//     when that service's inputs land.

import type {
  TaxEngineInputs,
  TaxEngineOutput,
  IncomeTotals,
  ExpenseTotals,
  VehicleOutputs,
  ProfitAndLoss,
  TaxComputation,
  MtdStatus,
  Sa103sBoxes,
  ZeroTaxCheck,
  ExpenseLine,
} from "./types";

// ------------------------------------------------------------------
// Income (tab 2)
// ------------------------------------------------------------------
export function computeIncome(lines: TaxEngineInputs["income"]): IncomeTotals {
  let fares = 0, otherTrading = 0, vatReceived = 0;
  let fees = 0, onTripMiles = 0, deadMiles = 0;
  for (const l of lines) {
    if (l.type === "Fares") fares += l.grossTakings;
    else if (l.type === "Other") otherTrading += l.grossTakings;
    else if (l.type === "VAT") vatReceived += l.grossTakings;
    fees += l.platformFee;
    onTripMiles += l.onTripMiles;
    deadMiles += l.deadMiles;
  }
  return {
    fares,                 // Inc_Fares (B23)
    otherTrading,          // Inc_Other (B24)
    vatReceived,           // Inc_VAT (B25)
    totalTurnover: fares + otherTrading + vatReceived,
    platformFeesTotal: fees,  // Inc_Fees
    onTripMilesTotal: onTripMiles,
    deadMilesTotal: deadMiles,
  };
}

// ------------------------------------------------------------------
// Vehicle + capital allowances + mileage vs actual decision
// ------------------------------------------------------------------
export function computeVehicle(
  v: TaxEngineInputs["vehicle"],
  income: IncomeTotals,
  rates: TaxEngineInputs["rates"],
  // Needed for the "actual costs" leg (sum of car-cost expenses × bus%)
  expenses: ExpenseLine[],
): VehicleOutputs {
  // --- Mileage totals (B30, B31, B32) ---
  const odoStart = v.odoStart ?? 0;
  const odoEnd = v.odoEnd ?? 0;
  const totalMiles = Math.max(0, odoEnd - odoStart);
  const businessMilesRaw =
    income.onTripMilesTotal + income.deadMilesTotal + v.otherBusinessMiles;
  const businessMiles = totalMiles > 0
    ? Math.min(businessMilesRaw, totalMiles)
    : businessMilesRaw;
  const businessPctFromMileage = totalMiles > 0
    ? businessMiles / totalMiles
    : null;
  // Veh_BusPct (B33): override, else computed from mileage, else 0.9 default
  const businessPct = v.businessPctOverride !== undefined
    ? v.businessPctOverride
    : businessPctFromMileage ?? 0.9;

  // --- Capital allowances (B35..B45) ---
  const caEligible = v.status === "Owned outright" || v.status === "Bought on HP / loan";
  const caAddition = caEligible && v.boughtThisYear === "Yes"
    ? (v.purchasePrice ?? 0)
    : 0;
  const caFyaQualifies = v.fuel === "Electric"
    && v.newOrUsed === "New"
    && v.boughtThisYear === "Yes";
  // CA_Rate: override, else 18% for electric or CO2 ≤ 50, else 6%
  const caRate = v.capitalAllowanceRateOverride !== undefined
    ? v.capitalAllowanceRateOverride
    : (v.fuel === "Electric" || (v.co2Gpkm !== undefined && v.co2Gpkm <= 50))
      ? 0.18
      : 0.06;
  const caFya = caFyaQualifies ? caAddition : 0;
  const disposed = v.disposed === "Yes";
  const proceeds = v.disposalProceeds ?? 0;
  const caPool = caEligible
    ? v.wdvBroughtForward + caAddition - caFya - (disposed ? proceeds : 0)
    : 0;
  const caWda = caEligible && !disposed ? Math.max(0, caPool) * caRate : 0;
  const caBalancing = caEligible && disposed ? caPool : 0; // Can be negative (balancing charge)
  const caFull = caFya + caWda + caBalancing;
  const wdvCarriedForward = disposed ? 0 : Math.max(0, caPool - caWda);

  // --- Mileage vs actual decision (B49, B50, B51, B52) ---
  const mileageAllowance =
    Math.min(businessMiles, 10000) * rates.mileageRateFirst10k
    + Math.max(0, businessMiles - 10000) * rates.mileageRateAbove10k;
  // Actual_Veh (B50): Σ (car-cost expense × business %) + CA_Full × business %
  const actualVehicleCosts = expenses.reduce((sum, e) => {
    return sum + (e.carCost === "Yes" ? e.amountPaid * businessPct : 0);
  }, 0) + caFull * businessPct;
  // Recommended: locked to actual if previously claimed CAs; otherwise
  // choose whichever yields a bigger deduction.
  const recommendedMethod: "Simplified mileage" | "Actual costs" =
    v.previousMethod === "Actual costs (capital allowances claimed)"
      ? "Actual costs"
      : mileageAllowance > actualVehicleCosts
        ? "Simplified mileage"
        : "Actual costs";
  const methodUsed = v.methodChoice ?? recommendedMethod;

  // CA_Claim (B44): no CA if mileage method, else CA_Full × bus%
  const caClaim = methodUsed === "Simplified mileage" ? 0 : caFull * businessPct;
  // Mileage_Used (B56): mileage allowance only if that method is used
  const mileageUsedInPL = methodUsed === "Simplified mileage" ? mileageAllowance : 0;

  return {
    totalMiles,
    businessMiles,
    businessPctFromMileage,
    businessPct,
    caEligible,
    caAddition,
    caFyaQualifies,
    caRate,
    caFya,
    caPool,
    caWda,
    caBalancing,
    caFull,
    caClaim,
    wdvCarriedForward,
    mileageAllowance,
    actualVehicleCosts,
    recommendedMethod,
    methodUsed,
    mileageUsedInPL,
  };
}

// ------------------------------------------------------------------
// Expenses (tab 3), allowable per-line + totals + estimate flag
// ------------------------------------------------------------------
function allowablePerLine(
  e: ExpenseLine,
  vehicle: VehicleOutputs,
  v: TaxEngineInputs["vehicle"],
): number {
  // F column: business-use % per line
  const pct = e.carCost === "Yes"
    ? vehicle.businessPct
    : e.carCost === "Phone"
      ? v.phoneBusinessPct
      : 1;
  // G column: allowable; zero for car costs when simplified mileage is in use
  if (vehicle.methodUsed === "Simplified mileage" && e.carCost === "Yes") return 0;
  return e.amountPaid * pct;
}

export function computeExpenses(
  input: TaxEngineInputs,
  vehicle: VehicleOutputs,
  income: IncomeTotals,
): ExpenseTotals {
  // The "Platform fees / commission (from tab 2)" row (row 34 in the
  // workbook) auto-fills from tab 2. For engines, callers may either
  // provide it as an explicit expense line OR we auto-inject it here
  // when no line of that label exists. We prefer explicit, callers
  // own the data, but we DO add the implicit platform-fees line when
  // the caller provided income with platform fees but no corresponding
  // expense line of category Platform & card fees.
  const expensesWithPlatformFees: ExpenseLine[] = [...input.expenses];
  const hasPlatformFeesLine = input.expenses.some(
    (e) => e.category === "Platform & card fees"
      && /platform/i.test(e.label)
  );
  if (!hasPlatformFeesLine && income.platformFeesTotal > 0) {
    expensesWithPlatformFees.push({
      label: "Platform fees / commission (auto from tab 2)",
      amountPaid: income.platformFeesTotal,
      evidence: "Platform annual summary",
      carCost: "No",
      category: "Platform & card fees",
      sa103sBox: 19,
    });
  }

  const byCategory: Record<ExpenseLine["category"], number> = {
    "Vehicle running costs": 0,
    "Vehicle hire, lease & finance": 0,
    "Congestion, ULEZ, tolls & parking": 0,
    "Licences & compliance": 0,
    "Phone & technology": 0,
    "Platform & card fees": 0,
    "Finance & bank charges": 0,
    "Accountancy & insurance": 0,
    "Other expenses": 0,
    "VAT paid (Flat Rate Scheme)": 0,
  };
  const bySa103sBox: Record<number, number> = {};
  let allowableTotal = 0;
  let paidTotal = 0;
  let estimatesTotal = 0;

  for (const e of expensesWithPlatformFees) {
    paidTotal += e.amountPaid;
    const allowable = allowablePerLine(e, vehicle, input.vehicle);
    allowableTotal += allowable;
    byCategory[e.category] += allowable;
    bySa103sBox[e.sa103sBox] = (bySa103sBox[e.sa103sBox] ?? 0) + allowable;
    if (/^estimate/i.test(e.evidence)) estimatesTotal += allowable;
  }

  const estimatesPct = allowableTotal === 0 ? 0 : estimatesTotal / allowableTotal;
  // Est_Flag (G49), compliance message
  const estimateFlag = estimatesPct > 0.3
    ? "HIGH: " + Math.round(estimatesPct * 100) + "% of expenses are estimates, get bank statements / third-party records or consider simplified mileage"
    : estimatesPct > 0
      ? Math.round(estimatesPct * 100) + "% estimated, method code and client confirmation on file?"
      : "All expenses evidenced";

  return {
    byCategory,
    bySa103sBox,
    allowableTotal,
    paidTotal,
    estimatesTotal,
    estimatesPct,
    estimateFlag,
  };
}

// ------------------------------------------------------------------
// P&L (tab 5)
// ------------------------------------------------------------------
export function buildPL(
  income: IncomeTotals,
  expenses: ExpenseTotals,
  vehicle: VehicleOutputs,
): ProfitAndLoss {
  const turnover = income.totalTurnover;
  // PL_Expenses = sum of all category totals + the mileage allowance row
  // (which is OUTSIDE the by-category SUMIF). The workbook sums rows 11..21
  // where row 13 is Mileage_Used; we add it here equivalently.
  const expensesTotal =
    expenses.byCategory["Vehicle running costs"]
    + expenses.byCategory["Vehicle hire, lease & finance"]
    + vehicle.mileageUsedInPL
    + expenses.byCategory["Congestion, ULEZ, tolls & parking"]
    + expenses.byCategory["Licences & compliance"]
    + expenses.byCategory["Phone & technology"]
    + expenses.byCategory["Platform & card fees"]
    + expenses.byCategory["Finance & bank charges"]
    + expenses.byCategory["Accountancy & insurance"]
    + expenses.byCategory["Other expenses"]
    + expenses.byCategory["VAT paid (Flat Rate Scheme)"];
  const netProfit = turnover - expensesTotal;
  const capitalAllowances = vehicle.caClaim;
  const taxableProfit = netProfit - capitalAllowances;

  return {
    turnover,
    expensesTotal,
    netProfit,
    capitalAllowances,
    taxableProfit,
    rows: {
      fares: income.fares,
      otherTrading: income.otherTrading,
      vatReceived: income.vatReceived,
      vehicleRunningCosts: expenses.byCategory["Vehicle running costs"],
      vehicleHireLeaseFinance: expenses.byCategory["Vehicle hire, lease & finance"],
      mileageAllowance: vehicle.mileageUsedInPL,
      congestionUlezTollsParking: expenses.byCategory["Congestion, ULEZ, tolls & parking"],
      licencesCompliance: expenses.byCategory["Licences & compliance"],
      phoneTechnology: expenses.byCategory["Phone & technology"],
      platformCardFees: expenses.byCategory["Platform & card fees"],
      financeBankCharges: expenses.byCategory["Finance & bank charges"],
      accountancyInsurance: expenses.byCategory["Accountancy & insurance"],
      otherExpenses: expenses.byCategory["Other expenses"],
      vatPaidFrs: expenses.byCategory["VAT paid (Flat Rate Scheme)"],
    },
  };
}

// ------------------------------------------------------------------
// Tax computation (tab 6)
// ------------------------------------------------------------------
export function computeTax(
  pl: ProfitAndLoss,
  client: TaxEngineInputs["client"],
  rates: TaxEngineInputs["rates"],
): TaxComputation {
  const X_SE = pl.taxableProfit;
  const X_Emp = client.employmentIncome;
  const X_Rent = client.rentalProfit;
  const X_Int = client.bankInterest;
  const X_Total = Math.max(0, X_SE) + X_Emp + X_Rent + X_Int;

  const X_PenGross = client.personalPensionNet / 0.8;
  const X_GAGross = client.giftAidNet / 0.8;
  const X_ANI = X_Total - X_PenGross - X_GAGross;

  // Personal allowance: tapered £1 for every £2 over £100k; also halved
  // by Marriage Allowance transferred OUT.
  const taperReduction = Math.max(0, (X_ANI - rates.personalAllowanceTaperStart) / 2);
  const maTransfer = client.marriageAllowanceStatus === "Transferring"
    ? rates.marriageAllowance : 0;
  const X_PA = Math.max(0, rates.personalAllowance - maTransfer - taperReduction);

  // Personal savings allowance (basic-rate band assumed; higher-rate
  // taxpayers would use £500. Workbook defaults to £1000).
  const X_PSA = Math.min(X_Int, rates.personalSavingsAllowanceBasic);

  const X_Taxable = Math.max(0, X_Total - X_PA - X_PSA);

  // Band thresholds extended by gross pension and gift aid
  const X_Band = rates.basicRateBand + X_PenGross + X_GAGross;
  const X_BRTax = Math.min(X_Taxable, X_Band) * rates.basicRate;
  const X_HRTax =
    Math.max(0, Math.min(X_Taxable, rates.additionalRateThreshold + X_PenGross + X_GAGross) - X_Band)
    * rates.higherRate;
  const X_ARTax =
    Math.max(0, X_Taxable - (rates.additionalRateThreshold + X_PenGross + X_GAGross))
    * rates.additionalRate;
  const X_MARed = client.marriageAllowanceStatus === "Receiving"
    ? -Math.min(rates.marriageAllowance * rates.basicRate, X_BRTax + X_HRTax + X_ARTax)
    : 0;
  const X_IT = X_BRTax + X_HRTax + X_ARTax + X_MARed;
  const X_PAYE = -client.paye; // Credit

  const X_C4 =
    Math.max(0, Math.min(X_SE, rates.class4UpperProfitsLimit) - rates.class4LowerProfitsLimit) * rates.class4MainRate
    + Math.max(0, X_SE - rates.class4UpperProfitsLimit) * rates.class4AdditionalRate;

  const class2Suggestion = X_SE < rates.class2SmallProfitsThreshold
    ? "Profit below £" + rates.class2SmallProfitsThreshold.toLocaleString()
      + " ,  consider paying £" + rates.class2VoluntaryAnnual + " voluntary Class 2 to protect State Pension"
    : "Not payable. NI year credited automatically";

  // Totals (workbook: X_IT + X_PAYE + X_C4. PAYE already negative)
  const totalTaxAndNic = X_IT + X_PAYE + X_C4;

  // POA
  const poaDueTotal = client.poa1Due + client.poa2Due;
  const poaPaidTotal = client.poa1Paid + client.poa2Paid;
  const poaCheck = poaDueTotal - poaPaidTotal > 0.5
    ? "£" + (poaDueTotal - poaPaidTotal).toFixed(2) + " unpaid, included in balancing payment; HMRC interest from original due date"
    : "All paid";
  const X_Liab = totalTaxAndNic; // after PAYE credit
  const poaGap = poaDueTotal === 0
    ? "No payments on account were due"
    : poaDueTotal > X_Liab + 0.5
      ? "Too high by £" + (poaDueTotal - X_Liab).toFixed(2) + " ,  refund or credit due"
      : poaDueTotal < X_Liab - 0.5
        ? "Bill is £" + (X_Liab - poaDueTotal).toFixed(2) + " above payments on account"
        : "Matched";
  const balancingPayment = X_Liab + (-poaPaidTotal); // X_Liab − poaPaidTotal
  // POA for NEXT year: triggers only when liability ≥ £1000 AND less
  // than 80% of total tax came from PAYE. (Workbook condition.)
  const poaTriggered = X_Liab >= rates.poaThreshold
    && -X_PAYE < 0.8 * (X_IT + X_C4);
  const poaForNextYear = poaTriggered ? Math.round(X_Liab / 2 * 100) / 100 : 0;
  const dueBy31Jan = Math.max(0, balancingPayment) + poaForNextYear;
  const dueBy31Jul = poaForNextYear;

  // Planning signals
  const effectiveRateOnSE = X_SE <= 0 ? null : (X_IT + X_C4) / X_Total;
  // "Tax saved per extra £100 of allowable expense" (B61)
  const marginalPenceSavedPer100 = X_Taxable <= 0
    ? (X_SE > rates.class4LowerProfitsLimit ? 6 : 0)
    : (X_Taxable <= X_Band ? 20 : X_Taxable <= rates.additionalRateThreshold ? 40 : 45)
      + (X_SE > rates.class4UpperProfitsLimit ? 2 : X_SE > rates.class4LowerProfitsLimit ? 6 : 0);
  const incomeAboveHigherRate = Math.max(0, X_Taxable - X_Band);
  const incomeAbove100k = Math.max(0, X_ANI - rates.personalAllowanceTaperStart);

  return {
    selfEmploymentProfit: X_SE,
    employmentIncome: X_Emp,
    rentalProfit: X_Rent,
    savingsInterest: X_Int,
    totalIncome: X_Total,
    pensionGross: X_PenGross,
    giftAidGross: X_GAGross,
    adjustedNetIncome: X_ANI,
    personalAllowance: X_PA,
    personalSavingsAllowance: X_PSA,
    taxableIncome: X_Taxable,
    basicBand: X_Band,
    basicRateTax: X_BRTax,
    higherRateTax: X_HRTax,
    additionalRateTax: X_ARTax,
    marriageAllowanceReduction: X_MARed,
    incomeTax: X_IT,
    paye: X_PAYE,
    class4: X_C4,
    class2Suggestion,
    totalTaxAndNic,
    poaDueTotal,
    poaPaidTotal,
    poaCheck,
    poaGap,
    balancingPayment,
    poaForNextYear,
    dueBy31Jan,
    dueBy31Jul,
    effectiveRateOnSE,
    marginalPenceSavedPer100,
    incomeAboveHigherRate,
    incomeAbove100k,
  };
}

// ------------------------------------------------------------------
// MTD status (tab 6, B66)
// ------------------------------------------------------------------
export function computeMtdStatus(
  pl: ProfitAndLoss,
  client: TaxEngineInputs["client"],
  rates: TaxEngineInputs["rates"],
): MtdStatus {
  const qi = pl.turnover + client.grossRentReceived;
  if (client.lastYearQualifyingIncome > rates.mtdThresholdFirst) {
    return {
      qualifyingIncome: qi,
      status: "IN_MTD_NOW",
      message: "IN MTD NOW: 2024/25 income over £"
        + rates.mtdThresholdFirst.toLocaleString()
        + " ,  signed up from 6 Apr 2026; quarterly updates 7 Aug 2026, 7 Nov 2026, 7 Feb 2027, 7 May 2027",
    };
  }
  if (qi > rates.mtdThresholdFirst) {
    return {
      qualifyingIncome: qi,
      status: "MANDATORY_APR_2027",
      message: "OVER £" + rates.mtdThresholdFirst.toLocaleString() + ": MTD from 6 Apr 2027, set up software and digital records now",
    };
  }
  if (qi > rates.mtdThresholdSecond) {
    return {
      qualifyingIncome: qi,
      status: "MANDATORY_APR_2027",
      message: "OVER £" + rates.mtdThresholdSecond.toLocaleString() + ": MTD from 6 Apr 2027, set up software before April",
    };
  }
  if (qi > rates.mtdThresholdThird) {
    return {
      qualifyingIncome: qi,
      status: "LIKELY_MANDATORY_APR_2028",
      message: "£" + rates.mtdThresholdThird.toLocaleString() + ", £" + rates.mtdThresholdSecond.toLocaleString() + ": likely MTD from 6 Apr 2028 (decided by 2026/27 income)",
    };
  }
  return {
    qualifyingIncome: qi,
    status: "BELOW_THRESHOLDS",
    message: "Below MTD thresholds for now",
  };
}

// ------------------------------------------------------------------
// SA103S boxes (tab 8)
// ------------------------------------------------------------------
export function buildSa103sBoxes(
  pl: ProfitAndLoss,
  expenses: ExpenseTotals,
  vehicle: VehicleOutputs,
  tax: TaxComputation,
  rates: TaxEngineInputs["rates"],
): Sa103sBoxes {
  const roundDown = (n: number) => Math.floor(n);
  const roundUp = (n: number) => Math.ceil(n);
  const box8 = roundDown(pl.turnover);
  // Box 12 includes car/van/travel expenses + mileage allowance
  const box12 = roundUp((expenses.bySa103sBox[12] ?? 0) + vehicle.mileageUsedInPL);
  const box14 = roundUp(expenses.bySa103sBox[14] ?? 0);
  const box16 = roundUp(expenses.bySa103sBox[16] ?? 0);
  const box17 = roundUp(expenses.bySa103sBox[17] ?? 0);
  const box18 = roundUp(expenses.bySa103sBox[18] ?? 0);
  const box19 = roundUp(expenses.bySa103sBox[19] ?? 0);
  const box20 = box12 + box14 + box16 + box17 + box18 + box19;
  const box21 = box8 - box20;
  const simplifiedOff = vehicle.methodUsed === "Simplified mileage" ? 0 : 1;
  const box24_1 = roundUp(vehicle.caFya * vehicle.businessPct * simplifiedOff);
  const box25 = roundUp(Math.max(0, vehicle.caClaim - vehicle.caFya * vehicle.businessPct * simplifiedOff));
  const box26 = roundDown(Math.max(0, -vehicle.caBalancing * vehicle.businessPct));
  const box31 = Math.max(0, box21 - box24_1 - box25 + box26);

  return {
    box1_description: "Private hire car driver",
    box9_turnover: box8,
    box12_carVanTravel: box12,
    box14_rentRatesPowerInsurance: box14,
    box16_accountancyLegalProf: box16,
    box17_interestBankCardCharges: box17,
    box18_phoneAndOfficeCosts: box18,
    box19_otherAllowable: box19,
    box20_totalAllowable: box20,
    box21_netProfit: box21,
    box24_1_zeroEmissionCarFya: box24_1,
    box25_otherCapitalAllowances: box25,
    box26_balancingCharges: box26,
    box31_totalTaxableProfits: box31,
    box36_voluntaryClass2: tax.selfEmploymentProfit < rates.class2SmallProfitsThreshold
      ? "Ask client, tick to pay £" + rates.class2VoluntaryAnnual
      : "Leave blank",
  };
}

// ------------------------------------------------------------------
// Zero-tax check (tab 6b, compliance aid)
// ------------------------------------------------------------------
export function computeZeroTaxCheck(
  pl: ProfitAndLoss,
  tax: TaxComputation,
  vehicle: TaxEngineInputs["vehicle"],
  rates: TaxEngineInputs["rates"],
  client: TaxEngineInputs["client"],
): ZeroTaxCheck {
  const turnover = pl.turnover;
  const otherIncome =
    tax.employmentIncome + tax.rentalProfit + tax.savingsInterest;
  const maEffect = client.marriageAllowanceStatus === "Receiving"
    ? rates.marriageAllowance
    : client.marriageAllowanceStatus === "Transferring"
      ? -rates.marriageAllowance
      : 0;
  const taxFreeIncome = rates.personalAllowance + maEffect;
  const maxProfitZeroIT = Math.max(0, taxFreeIncome - otherIncome);
  const maxProfitZeroNI = rates.class4LowerProfitsLimit;
  const targetTaxableProfit = Math.min(maxProfitZeroIT, maxProfitZeroNI);
  const profitReductionNeeded = Math.max(0, pl.taxableProfit - targetTaxableProfit);
  const totalExpensesNeeded = turnover - vehicle.wdvBroughtForward - targetTaxableProfit;
  const expensesPctNow = turnover === 0 ? 0 : pl.expensesTotal / turnover;
  const expensesPctNeeded = turnover === 0 ? 0 : (totalExpensesNeeded) / turnover;
  const ceilingForClient =
    vehicle.status === "Rented weekly (PCO hire)" || vehicle.status === "Leased"
      ? 0.65
      : 0.5;
  const gap = profitReductionNeeded;
  const verdict = gap === 0
    ? "Already nil, nothing to do"
    : expensesPctNeeded <= expensesPctNow + 0.05
      ? "Within reach, check every head on tab 3 is claimed in full"
      : expensesPctNeeded <= ceilingForClient
        ? "Possible only if genuine costs are missing, needs evidence for each extra £"
        : expensesPctNeeded <= ceilingForClient + 0.1
          ? "Unlikely, would sit above normal driver costs and attract HMRC questions"
          : "Not realistic, tax is genuinely due; do not force it";
  // Turnover at which tax is naturally nil at the current expense %
  const turnoverAtWhichTaxIsNaturallyNil = expensesPctNow >= 1
    ? 0
    : targetTaxableProfit / (1 - expensesPctNow);

  return {
    turnover,
    expenses: pl.expensesTotal,
    capitalAllowances: pl.capitalAllowances,
    profitNow: pl.taxableProfit,
    taxAndNicNow: tax.incomeTax + tax.class4,
    taxFreeIncome,
    maxProfitZeroIT,
    maxProfitZeroNI,
    targetTaxableProfit,
    profitReductionNeeded,
    totalExpensesNeeded,
    expensesPctNow,
    expensesPctNeeded,
    ceilingForClient,
    verdict,
    turnoverAtWhichTaxIsNaturallyNil,
  };
}

// ------------------------------------------------------------------
// Top-level: run every tab in one shot
// ------------------------------------------------------------------
export function computeAll(input: TaxEngineInputs): TaxEngineOutput {
  const income = computeIncome(input.income);
  const vehicle = computeVehicle(input.vehicle, income, input.rates, input.expenses);
  const expenses = computeExpenses(input, vehicle, income);
  const pl = buildPL(income, expenses, vehicle);
  const tax = computeTax(pl, input.client, input.rates);
  const mtd = computeMtdStatus(pl, input.client, input.rates);
  const sa103s = buildSa103sBoxes(pl, expenses, vehicle, tax, input.rates);
  const zeroTaxCheck = computeZeroTaxCheck(pl, tax, input.vehicle, input.rates, input.client);
  return { income, expenses, vehicle, pl, tax, mtd, sa103s, zeroTaxCheck };
}
