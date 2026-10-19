// Type definitions for the UK tax engine. Shapes mirror the input
// tabs (1 Client / 2 Income / 3 Expenses / 4 Vehicle) and output tabs
// (5 Draft P&L / 6 Tax / 6b Zero-Tax / 7 VAT / 8 SA Boxes) of the PCH
// Uber Tax Pack workbook.
//
// Service-agnostic: the Delivery, Sole trader and Landlord pipelines
// reuse these same shapes; only the per-service input validation and
// UI differ.

// ----- Rate pack -------------------------------------------------------

export type UkTaxYearRates = {
  taxYear: string;
  personalAllowance: number;
  personalAllowanceTaperStart: number;
  basicRateBand: number;
  additionalRateThreshold: number;
  basicRate: number;
  higherRate: number;
  additionalRate: number;
  personalSavingsAllowanceBasic: number;
  personalSavingsAllowanceHigher: number;
  marriageAllowance: number;
  class4LowerProfitsLimit: number;
  class4UpperProfitsLimit: number;
  class4MainRate: number;
  class4AdditionalRate: number;
  class2SmallProfitsThreshold: number;
  class2VoluntaryAnnual: number;
  poaThreshold: number;
  mileageRateFirst10k: number;
  mileageRateAbove10k: number;
  vatFrsLimitedCostRate: number;
  vatFrsTransportRate: number;
  vatFrsFirstYearDiscount: number;
  mtdThresholdFirst: number;
  mtdThresholdSecond: number;
  mtdThresholdThird: number;
};

// ----- Inputs (shape mirrors workbook tabs 1-4) ------------------------

// Which Marriage Allowance role, if any, the client takes.
export type MarriageAllowanceStatus = "None" | "Transferring" | "Receiving";

export type ClientInputs = {
  // Other income (per workbook tab 1 column B).
  employmentIncome: number; // P60 gross pay
  paye: number;             // Tax taken off that pay
  rentalProfit: number;     // After expenses
  bankInterest: number;
  // Reliefs
  personalPensionNet: number;      // amount actually paid (grossed up ×1.25)
  giftAidNet: number;              // amount actually paid
  marriageAllowanceStatus: MarriageAllowanceStatus;
  // Payments on account (set by the previous year)
  poa1Due: number;  // 1st instalment, 31 Jan of this tax year
  poa2Due: number;  // 2nd instalment, 31 Jul
  poa1Paid: number; // What the client actually paid
  poa2Paid: number;
  // MTD inputs
  lastYearQualifyingIncome: number; // turnover + gross rent on last year's return
  grossRentReceived: number;
};

// A single income line (one platform or payment stream).
export type IncomeLine = {
  grossTakings: number;      // Before platform cut
  platformFee: number;       // Commission / fee the platform retained
  onTripMiles: number;
  deadMiles: number;
  type: "Fares" | "Other" | "VAT"; // routes to Inc_Fares / Inc_Other / Inc_VAT
};

// A single expense line (one spend category).
// Mirrors tab 3 row structure: amount paid, car-cost flag, evidence
// status drives estimate-reliance. category is the P&L heading
// (10 fixed options), sa103sBox is the SA103S short-return box.
export type ExpenseLine = {
  // Human label (free text, e.g. "Fuel", "ULEZ"), informational only,
  // computations use category + carCost + box.
  label: string;
  amountPaid: number;
  evidence: string; // "Receipts", "Bank statement", "Estimate (E2)" etc.
  carCost: "Yes" | "No" | "Phone"; // drives business-use % lookup
  category:
    | "Vehicle running costs"
    | "Vehicle hire, lease & finance"
    | "Congestion, ULEZ, tolls & parking"
    | "Licences & compliance"
    | "Phone & technology"
    | "Platform & card fees"
    | "Finance & bank charges"
    | "Accountancy & insurance"
    | "Other expenses"
    | "VAT paid (Flat Rate Scheme)";
  sa103sBox: 12 | 14 | 16 | 17 | 18 | 19;
};

// Vehicle + mileage inputs (populated by the VEHICLE_CA interview).
export type VehicleInputs = {
  status: "Owned outright" | "Bought on HP / loan" | "Rented weekly (PCO hire)" | "Leased";
  fuel: "Petrol" | "Diesel" | "Hybrid" | "Electric";
  co2Gpkm?: number;
  boughtThisYear: "Yes" | "No";
  purchasePrice?: number;        // Full price including HP balance
  newOrUsed?: "New" | "Used";
  disposed?: "Yes" | "No";
  disposalProceeds?: number;
  odoStart?: number; // Odometer around 6 April (year start)
  odoEnd?: number;   // Odometer around 5 April (year end)
  otherBusinessMiles: number;    // Not in app summaries
  phoneBusinessPct: number;      // 0..1
  // Accountant fills
  wdvBroughtForward: number;     // Capital allowance pool c/f from last year
  previousMethod: "Simplified mileage" | "Actual costs (capital allowances claimed)" | "First year";
  businessPctOverride?: number;  // Blank = compute from mileage; 0..1
  capitalAllowanceRateOverride?: number;
  methodChoice?: "Simplified mileage" | "Actual costs"; // Blank = recommended
  realMpg?: number;              // For E2 fuel-estimate reasonableness check
  fuelPricePerLitre?: number;    // Defaults handled per rate pack
};

// The full computation input bundle.
export type TaxEngineInputs = {
  rates: UkTaxYearRates;
  client: ClientInputs;
  income: IncomeLine[];
  expenses: ExpenseLine[];
  vehicle: VehicleInputs;
};

// ----- Outputs (shape mirrors workbook tabs 5-8) -----------------------

export type IncomeTotals = {
  fares: number;                    // Inc_Fares
  otherTrading: number;             // Inc_Other
  vatReceived: number;              // Inc_VAT
  totalTurnover: number;            // PL_Turnover
  platformFeesTotal: number;        // Inc_Fees (flows into expense row 34)
  onTripMilesTotal: number;         // Inc_Miles
  deadMilesTotal: number;           // Inc_DeadMiles
};

export type ExpenseTotals = {
  byCategory: Record<ExpenseLine["category"], number>;
  bySa103sBox: Record<number, number>;
  allowableTotal: number;           // Exp_AllowTotal
  paidTotal: number;                // Row 46 column C
  estimatesTotal: number;           // Est_Total
  estimatesPct: number;             // Est_Pct
  estimateFlag: string;             // Est_Flag (compliance message)
};

export type VehicleOutputs = {
  totalMiles: number;               // Miles_Total
  businessMiles: number;            // Miles_Business
  businessPctFromMileage: number | null;  // Veh_BusPctCalc (null if no odo)
  businessPct: number;              // Veh_BusPct (final; override or default or calc)
  caEligible: boolean;              // CA_Eligible
  caAddition: number;               // CA_Addition
  caFyaQualifies: boolean;          // CA_FYAQual
  caRate: number;                   // CA_Rate (0.06 or 0.18 or override)
  caFya: number;                    // CA_FYA (first-year allowance, 100%)
  caPool: number;                   // CA_Pool
  caWda: number;                    // CA_WDA (writing-down allowance)
  caBalancing: number;              // CA_Bal (balancing on disposal)
  caFull: number;                   // CA_Full (FYA + WDA + Bal, before private use)
  caClaim: number;                  // CA_Claim (after business use %)
  wdvCarriedForward: number;        // For next year
  mileageAllowance: number;         // Mileage_Allow (if mileage method)
  actualVehicleCosts: number;       // Actual_Veh (sum of car-cost expenses × bus%)
  recommendedMethod: "Simplified mileage" | "Actual costs";
  methodUsed: "Simplified mileage" | "Actual costs";
  mileageUsedInPL: number;          // Mileage_Used (= Mileage_Allow if mileage method, else 0)
};

export type ProfitAndLoss = {
  turnover: number;                 // PL_Turnover
  expensesTotal: number;            // PL_Expenses
  netProfit: number;                // PL_NetProfit
  capitalAllowances: number;        // CA_Claim
  taxableProfit: number;            // PL_Taxable
  // Per-row breakdown for the P&L statement
  rows: {
    fares: number;
    otherTrading: number;
    vatReceived: number;
    vehicleRunningCosts: number;
    vehicleHireLeaseFinance: number;
    mileageAllowance: number;
    congestionUlezTollsParking: number;
    licencesCompliance: number;
    phoneTechnology: number;
    platformCardFees: number;
    financeBankCharges: number;
    accountancyInsurance: number;
    otherExpenses: number;
    vatPaidFrs: number;
  };
};

export type TaxComputation = {
  // Inputs restated
  selfEmploymentProfit: number;     // X_SE
  employmentIncome: number;         // X_Emp
  rentalProfit: number;             // X_Rent
  savingsInterest: number;          // X_Int
  totalIncome: number;              // X_Total
  // Reliefs
  pensionGross: number;             // X_PenGross
  giftAidGross: number;             // X_GAGross
  adjustedNetIncome: number;        // X_ANI
  personalAllowance: number;        // X_PA (after taper + MA transfer)
  personalSavingsAllowance: number; // X_PSA
  taxableIncome: number;            // X_Taxable
  // Bands
  basicBand: number;                // X_Band (37700 + pension + gift aid)
  // Tax
  basicRateTax: number;             // X_BRTax
  higherRateTax: number;            // X_HRTax
  additionalRateTax: number;        // X_ARTax
  marriageAllowanceReduction: number; // X_MARed (negative)
  incomeTax: number;                // X_IT
  paye: number;                     // X_PAYE (negative, credits)
  // NIC
  class4: number;                   // X_C4
  class2Suggestion: string;         // Compliance note
  // Totals
  totalTaxAndNic: number;           // X_IT + |X_PAYE| + X_C4; workbook: X_IT + X_PAYE + X_C4
  // POA
  poaDueTotal: number;              // X_POADue
  poaPaidTotal: number;             // X_POAPaidTot
  poaCheck: string;                 // X_POACheck
  poaGap: string;                   // X_POAGap
  balancingPayment: number;         // X_Balancing (due 31 Jan next year)
  poaForNextYear: number;           // X_POA (each)
  dueBy31Jan: number;               // Total due 31 Jan: Balancing + POA
  dueBy31Jul: number;               // X_POA
  // Planning signals
  effectiveRateOnSE: number | null; // X_IT + X_C4 over total income
  marginalPenceSavedPer100: number; // X_Marg
  incomeAboveHigherRate: number;
  incomeAbove100k: number;
};

export type MtdStatus = {
  qualifyingIncome: number;
  status:
    | "IN_MTD_NOW"
    | "MANDATORY_APR_2027"
    | "LIKELY_MANDATORY_APR_2028"
    | "BELOW_THRESHOLDS";
  message: string;
};

export type Sa103sBoxes = {
  box1_description: string;              // "Private hire car driver"
  box9_turnover: number;
  box12_carVanTravel: number;            // includes mileage allowance
  box14_rentRatesPowerInsurance: number;
  box16_accountancyLegalProf: number;
  box17_interestBankCardCharges: number;
  box18_phoneAndOfficeCosts: number;
  box19_otherAllowable: number;
  box20_totalAllowable: number;
  box21_netProfit: number;
  box24_1_zeroEmissionCarFya: number;
  box25_otherCapitalAllowances: number;
  box26_balancingCharges: number;
  box31_totalTaxableProfits: number;
  box36_voluntaryClass2: string;         // "Ask client, tick to pay £182" / "Leave blank"
};

// Zero-tax reverse check (tab 6b), compliance aid.
export type ZeroTaxCheck = {
  turnover: number;
  expenses: number;
  capitalAllowances: number;
  profitNow: number;
  taxAndNicNow: number;
  taxFreeIncome: number;             // PA ± MA
  maxProfitZeroIT: number;
  maxProfitZeroNI: number;
  targetTaxableProfit: number;
  profitReductionNeeded: number;
  totalExpensesNeeded: number;
  expensesPctNow: number;
  expensesPctNeeded: number;
  ceilingForClient: number;          // 0.65 for rented, 0.50 for owned
  verdict: string;
  turnoverAtWhichTaxIsNaturallyNil: number;
};

// Returns-owed helper (service-agnostic).
export type UkTaxYear = string; // e.g. "2024/25"

export type ReturnOwedForYear = {
  taxYear: UkTaxYear;
  yearStart: Date;
  yearEnd: Date;
  registrationDeadline: Date;        // 5 Oct of the following tax year
  registrationDeadlinePassed: boolean;
  filingDeadline: Date;              // 31 Jan of the following calendar year
  filingOverdue: boolean;
  paymentDeadline: Date;             // Same as filing deadline for balancing
  // Already filed? Omitted from the output when true.
};

export type ReturnsOwed = {
  years: ReturnOwedForYear[];        // Years NOT already filed
  oldestOutstandingYear: UkTaxYear | null;
  anyOverdue: boolean;
  anyRegistrationDeadlineMissed: boolean;
};

// ----- Top-level output ------------------------------------------------

export type TaxEngineOutput = {
  income: IncomeTotals;
  expenses: ExpenseTotals;
  vehicle: VehicleOutputs;
  pl: ProfitAndLoss;
  tax: TaxComputation;
  mtd: MtdStatus;
  sa103s: Sa103sBoxes;
  zeroTaxCheck: ZeroTaxCheck;
};
