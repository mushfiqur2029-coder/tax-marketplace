// Per-slot mapping of extracted field keys to intake-table columns.
// The review UI reads this registry to render friendly field labels;
// applyPchExtractionAction reads it to write accepted values into the
// right pch_cases / pch_income_lines / pch_expense_lines / pch_vehicle
// row. New slot? Add an entry here; no UI code change required.
//
// NEVER WRITES AUTOMATICALLY. applyPchExtractionAction runs only when
// the client clicks "Apply confirmed fields" in the review UI, and
// only writes fields whose per-field status is 'accepted' or 'edited'.

export type ApplyTarget =
  | { table: "pch_cases"; column: string; transform?: ValueTransform }
  | { table: "pch_vehicle"; column: string; transform?: ValueTransform }
  | { table: "pch_income_lines"; row: "primary_platform" | "cash" | "weekly"; column: string; transform?: ValueTransform }
  | { table: "pch_expense_lines"; row: string; column: string; transform?: ValueTransform }
  // "none" means the extracted field is informational only (e.g.
  // sanity-check totals, document type) and never writes anywhere.
  | { table: "none" };

type ValueTransform = "pounds_to_pence" | "integer" | "yes_no_boolean";

export type SlotApplyMap = {
  // Human label used in the client review UI. Falls back to the raw
  // field key when absent, so the mapping stays optional for a new
  // slot in development.
  label: Partial<Record<string, string>>;
  // Where each extracted field key should land.
  targets: Record<string, ApplyTarget>;
};

export const SLOT_APPLY_MAPS: Record<string, SlotApplyMap> = {
  // ----- Income ---------------------------------------------------
  "PCH-01": {
    label: {
      platform: "Platform",
      periodFrom: "Period from",
      periodTo: "Period to",
      grossFares: "Gross fares (£)",
      platformFees: "Platform fees (£)",
      onTripMiles: "On-trip miles",
      deadMiles: "Dead miles",
    },
    targets: {
      platform: { table: "pch_income_lines", row: "primary_platform", column: "source" },
      grossFares: { table: "pch_income_lines", row: "primary_platform", column: "gross_takings_pence", transform: "pounds_to_pence" },
      platformFees: { table: "pch_income_lines", row: "primary_platform", column: "platform_fee_pence", transform: "pounds_to_pence" },
      onTripMiles: { table: "pch_income_lines", row: "primary_platform", column: "on_trip_miles", transform: "integer" },
      deadMiles: { table: "pch_income_lines", row: "primary_platform", column: "dead_miles", transform: "integer" },
      periodFrom: { table: "none" },
      periodTo: { table: "none" },
    },
  },

  "PCH-02": {
    label: {
      platform: "Platform",
      aggregateFrom: "Period from",
      aggregateTo: "Period to",
      aggregateGrossFares: "Gross fares (£)",
      aggregatePlatformFees: "Platform fees (£)",
      aggregateOnTripMiles: "On-trip miles",
      rows: "Weekly rows (informational)",
    },
    targets: {
      platform: { table: "pch_income_lines", row: "weekly", column: "source" },
      aggregateGrossFares: { table: "pch_income_lines", row: "weekly", column: "gross_takings_pence", transform: "pounds_to_pence" },
      aggregatePlatformFees: { table: "pch_income_lines", row: "weekly", column: "platform_fee_pence", transform: "pounds_to_pence" },
      aggregateOnTripMiles: { table: "pch_income_lines", row: "weekly", column: "on_trip_miles", transform: "integer" },
      aggregateFrom: { table: "none" },
      aggregateTo: { table: "none" },
      rows: { table: "none" },
    },
  },

  "PCH-03": {
    label: {
      aggregateGrossIncome: "Cash + account-work income (£)",
      periodFrom: "Period from",
      periodTo: "Period to",
      rows: "Individual entries (informational)",
    },
    targets: {
      aggregateGrossIncome: { table: "pch_income_lines", row: "cash", column: "gross_takings_pence", transform: "pounds_to_pence" },
      periodFrom: { table: "none" },
      periodTo: { table: "none" },
      rows: { table: "none" },
    },
  },

  // ----- Vehicle --------------------------------------------------
  "PCH-04": {
    label: {
      insurer: "Insurer",
      policyNumber: "Policy number",
      policyStart: "Policy start",
      policyEnd: "Policy end",
      annualPremium: "Annual premium (£)",
      vehicleReg: "Vehicle registration",
    },
    targets: {
      annualPremium: { table: "pch_expense_lines", row: "insurance", column: "amount_paid_pence", transform: "pounds_to_pence" },
      insurer: { table: "none" },
      policyNumber: { table: "none" },
      policyStart: { table: "none" },
      policyEnd: { table: "none" },
      vehicleReg: { table: "pch_vehicle", column: "registration" },
    },
  },

  // PCH-05 (V5C logbook) is skip-mode in the extractor registry; no
  // apply map because it never produces extracted fields.

  "PCH-06": {
    label: {
      purchaseDate: "Purchase date",
      purchasePrice: "Purchase price (£)",
      financeInterestInPeriod: "Finance interest in year (£)",
      agreementType: "Agreement type",
    },
    targets: {
      purchaseDate: { table: "pch_vehicle", column: "purchase_date" },
      purchasePrice: { table: "pch_vehicle", column: "purchase_price_pence", transform: "pounds_to_pence" },
      financeInterestInPeriod: { table: "pch_expense_lines", row: "finance_interest", column: "amount_paid_pence", transform: "pounds_to_pence" },
      agreementType: { table: "none" },
    },
  },

  "PCH-07": {
    label: {
      weeklyRental: "Weekly rental (£)",
      totalPaidInPeriod: "Total paid in year (£)",
      rentalCompany: "Rental company",
      periodFrom: "Period from",
      periodTo: "Period to",
    },
    targets: {
      totalPaidInPeriod: { table: "pch_expense_lines", row: "rental", column: "amount_paid_pence", transform: "pounds_to_pence" },
      weeklyRental: { table: "none" },
      rentalCompany: { table: "none" },
      periodFrom: { table: "none" },
      periodTo: { table: "none" },
    },
  },

  "PCH-08": {
    label: {
      odoAtStartDate: "Odometer at tax year start",
      odoStartTestDate: "MOT date (start)",
      odoAtEndDate: "Odometer at tax year end",
      odoEndTestDate: "MOT date (end)",
    },
    targets: {
      odoAtStartDate: { table: "pch_vehicle", column: "odo_start", transform: "integer" },
      odoAtEndDate: { table: "pch_vehicle", column: "odo_end", transform: "integer" },
      odoStartTestDate: { table: "none" },
      odoEndTestDate: { table: "none" },
    },
  },

  // ----- Running costs --------------------------------------------
  "PCH-09": {
    label: {
      totalFuelSpend: "Total fuel/charging (£)",
      periodFrom: "First receipt date",
      periodTo: "Last receipt date",
      receiptCount: "Receipts seen",
    },
    targets: {
      totalFuelSpend: { table: "pch_expense_lines", row: "fuel", column: "amount_paid_pence", transform: "pounds_to_pence" },
      periodFrom: { table: "none" },
      periodTo: { table: "none" },
      receiptCount: { table: "none" },
    },
  },

  "PCH-10": {
    label: {
      totalRepairSpend: "Total repairs/MOT/VED (£)",
      receiptCount: "Receipts seen",
      majorItems: "Items over £100 (informational)",
    },
    targets: {
      totalRepairSpend: { table: "pch_expense_lines", row: "repairs", column: "amount_paid_pence", transform: "pounds_to_pence" },
      receiptCount: { table: "none" },
      majorItems: { table: "none" },
    },
  },

  "PCH-11": {
    label: {
      totalAllowableCharges: "TfL / parking charges (£)",
      finesSeenButExcluded: "Fines excluded (£)",
    },
    targets: {
      totalAllowableCharges: { table: "pch_expense_lines", row: "tolls_parking", column: "amount_paid_pence", transform: "pounds_to_pence" },
      finesSeenButExcluded: { table: "none" },
    },
  },

  "PCH-12": {
    label: {
      licenceType: "Licence type",
      feePaid: "Fee paid (£)",
      issuingAuthority: "Issuing authority",
      paymentDate: "Payment date",
    },
    targets: {
      feePaid: { table: "pch_expense_lines", row: "licence", column: "amount_paid_pence", transform: "pounds_to_pence" },
      licenceType: { table: "none" },
      issuingAuthority: { table: "pch_cases", column: "cl_licensing_authority" },
      paymentDate: { table: "none" },
    },
  },

  "PCH-13": {
    label: {
      totalAnnualSpend: "Total mobile spend (£)",
      periodFrom: "First invoice date",
      periodTo: "Last invoice date",
    },
    targets: {
      totalAnnualSpend: { table: "pch_expense_lines", row: "phone", column: "amount_paid_pence", transform: "pounds_to_pence" },
      periodFrom: { table: "none" },
      periodTo: { table: "none" },
    },
  },

  "PCH-14": {
    label: {
      totalDepositsSeen: "Total deposits seen (sanity)",
      unexplainedLargeDeposits: "Large unexplained deposits",
      cashDepositsSeen: "Cash deposits spotted?",
      insuranceOrRentalDebits: "Insurance / rental DDs seen",
    },
    targets: {
      totalDepositsSeen: { table: "none" },
      unexplainedLargeDeposits: { table: "none" },
      cashDepositsSeen: { table: "none" },
      insuranceOrRentalDebits: { table: "none" },
    },
  },

  // ----- VAT ------------------------------------------------------
  "PCH-15": {
    label: {
      vatPeriodFrom: "VAT period from",
      vatPeriodTo: "VAT period to",
      vatOnFaresCollectedByUber: "VAT collected (£)",
      vatTopUpPaidToDriver: "VAT top-up paid (£)",
    },
    targets: {
      vatPeriodFrom: { table: "none" },
      vatPeriodTo: { table: "none" },
      vatOnFaresCollectedByUber: { table: "none" },
      vatTopUpPaidToDriver: { table: "none" },
    },
  },

  // ----- Employment income ----------------------------------------
  "PCH-16": {
    label: {
      employerName: "Employer",
      taxYear: "Tax year",
      grossPay: "Gross pay (£)",
      taxDeducted: "Tax deducted (£)",
    },
    targets: {
      grossPay: { table: "pch_cases", column: "employment_income_pence", transform: "pounds_to_pence" },
      taxDeducted: { table: "pch_cases", column: "paye_pence", transform: "pounds_to_pence" },
      employerName: { table: "none" },
      taxYear: { table: "none" },
    },
  },

  "PCH-17": {
    label: {
      employerName: "Employer",
      leavingDate: "Leaving date",
      payToDate: "Pay to leaving date (£)",
      taxToDate: "Tax to leaving date (£)",
    },
    targets: {
      payToDate: { table: "pch_cases", column: "employment_income_pence", transform: "pounds_to_pence" },
      taxToDate: { table: "pch_cases", column: "paye_pence", transform: "pounds_to_pence" },
      employerName: { table: "none" },
      leavingDate: { table: "none" },
    },
  },

  // ----- Other income ---------------------------------------------
  "PCH-18": {
    label: {
      provider: "Provider",
      taxYear: "Tax year",
      untaxedInterest: "Untaxed interest (£)",
    },
    targets: {
      untaxedInterest: { table: "pch_cases", column: "bank_interest_pence", transform: "pounds_to_pence" },
      provider: { table: "none" },
      taxYear: { table: "none" },
    },
  },

  "PCH-19": {
    label: {
      planType: "Plan type",
      balanceOutstanding: "Balance outstanding?",
    },
    targets: {
      planType: { table: "pch_cases", column: "student_loan_plan" },
      balanceOutstanding: { table: "none" },
    },
  },

  // ----- HMRC history ---------------------------------------------
  "PCH-20": {
    label: {
      priorYearTaxableProfit: "Last year's taxable profit (£)",
      priorYearTotalDue: "Last year's total due (£)",
      poa1Due: "POA 1 due 31 Jan (£)",
      poa2Due: "POA 2 due 31 Jul (£)",
    },
    targets: {
      poa1Due: { table: "pch_cases", column: "poa1_due_pence", transform: "pounds_to_pence" },
      poa2Due: { table: "pch_cases", column: "poa2_due_pence", transform: "pounds_to_pence" },
      priorYearTaxableProfit: { table: "none" },
      priorYearTotalDue: { table: "none" },
    },
  },

  "PCH-21": {
    label: {
      poa1Paid: "POA 1 paid (£)",
      poa1PaidDate: "POA 1 payment date",
      poa2Paid: "POA 2 paid (£)",
      poa2PaidDate: "POA 2 payment date",
    },
    targets: {
      poa1Paid: { table: "pch_cases", column: "poa1_paid_pence", transform: "pounds_to_pence" },
      poa2Paid: { table: "pch_cases", column: "poa2_paid_pence", transform: "pounds_to_pence" },
      poa1PaidDate: { table: "none" },
      poa2PaidDate: { table: "none" },
    },
  },

  "PCH-22": {
    label: {
      letterType: "Letter type",
      letterDate: "Letter date",
      subject: "Subject",
      actionRequired: "Action required",
      deadline: "Deadline",
    },
    targets: {
      letterType: { table: "none" },
      letterDate: { table: "none" },
      subject: { table: "none" },
      actionRequired: { table: "none" },
      deadline: { table: "none" },
    },
  },

  // ----- Identity (Phase 6 Slice 1) -------------------------------
  "PCH-24": {
    label: {
      documentNumber: "ID document number",
      fullName: "Full name",
      dateOfBirth: "Date of birth",
      address: "Address",
      postcode: "Postcode",
    },
    targets: {
      // documentNumber is kept for the audit trail only (we never need
      // to re-print it; passport/licence numbers are PII we shouldn't
      // store in a header column).
      documentNumber: { table: "none" },
      fullName: { table: "pch_cases", column: "cl_name" },
      dateOfBirth: { table: "pch_cases", column: "cl_dob" },
      address: { table: "pch_cases", column: "cl_address" },
      postcode: { table: "pch_cases", column: "cl_postcode" },
    },
  },
};

// Transforms applied just before the DB write.
export function coerceValueForTarget(value: unknown, transform: ValueTransform | undefined): unknown {
  if (value === null || value === undefined || value === "") return null;
  if (!transform) return value;
  switch (transform) {
    case "pounds_to_pence": {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      return Math.round(n * 100);
    }
    case "integer": {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      return Math.round(n);
    }
    case "yes_no_boolean": {
      const s = String(value).toLowerCase();
      return s === "yes" || s === "true";
    }
  }
}
