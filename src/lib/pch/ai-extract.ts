import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// AI document extraction for PCH automated cases.
//
// Each client-uploaded document is handed to Claude Sonnet with a
// per-slot tool-use schema that pins the model to a strict JSON shape.
// The response includes a confidence rating per field so the client UI
// can flag anything the model wasn't sure about: those fields never
// auto-fill, the client enters them by hand (or re-uploads a clearer
// scan).
//
// NEVER AUTO-SUBMIT. Every extracted value lands in a "proposed"
// state until the client confirms or edits it. The intake tables stay
// the source of truth; this file only produces suggestions.

export type ExtractionConfidence = "high" | "medium" | "low" | "missing";

export type ExtractedField = {
  value: string | number | null;
  confidence: ExtractionConfidence;
  // Short human reason for the confidence rating, surfaced in the
  // review UI so the client knows what to double-check. Example:
  // "Found 'Total earnings £47,912.44' on page 2" (high) or
  // "No annual total labelled; summed weekly rows" (medium) or
  // "Could not locate on-trip miles in this document" (missing).
  note: string;
};

export type ExtractionResult<T = Record<string, unknown>> = {
  fields: T;
  overallConfidence: ExtractionConfidence;
  documentType: string;
  rawJson: unknown;
};

export type DocumentInput = {
  bytes: Uint8Array;
  mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
};

// Not every slot needs structured extraction. The three groups:
//   extract   - run the AI, pre-fill proposed fields
//   flag      - run the AI only to detect anomalies worth flagging to
//               the accountant; nothing pre-filled on the client side
//   skip      - no AI pass (final approval doc, identity scan, etc.)
export type SlotExtractionMode = "extract" | "flag" | "skip";

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Document extraction is disabled.");
  }
  return new Anthropic({ apiKey });
}

// Shared "ExtractedField" schema. Every tool-call schema reuses this.
function fieldSchema(description: string) {
  return {
    type: "object",
    properties: {
      value: {
        oneOf: [{ type: "string" }, { type: "number" }, { type: "null" }],
        description,
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low", "missing"],
        description:
          "high = value clearly labelled in the document. " +
          "medium = inferred from context or calculated from visible rows. " +
          "low = guessed, needs human check. " +
          "missing = not present in this document, value must be null.",
      },
      note: {
        type: "string",
        description:
          "One sentence explaining where you found the value or why it's missing. Keep under 100 characters.",
      },
    },
    required: ["value", "confidence", "note"],
    additionalProperties: false,
  };
}

function docLevelFields() {
  return {
    overallConfidence: {
      type: "string",
      enum: ["high", "medium", "low", "missing"],
      description:
        "Your confidence that this is a genuine document of the expected type and the values are reliable. Low or missing means the client should re-upload.",
    },
    documentType: {
      type: "string",
      description: "One-line description of what you see.",
    },
  };
}

// Wraps a repeating-row shape (e.g. multiple fuel receipts, multiple
// expense items) so the client UI can let the user accept/edit each
// row individually.
function arrayFieldSchema(itemSchema: Record<string, unknown>, description: string) {
  return {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: itemSchema,
        description,
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low", "missing"],
      },
      note: { type: "string" },
    },
    required: ["items", "confidence", "note"],
    additionalProperties: false,
  };
}

// -------------------------------------------------------------------
// Slot registry. Keys are PCH-01..24. Each entry describes:
//   mode    - whether to run AI at all
//   title   - short label used in prompts
//   prompt  - what the model should look for in that doc
//   schema  - tool-call input schema (only for mode = "extract" / "flag")
//   model   - which Claude model handles it (default sonnet-4-6)
//
// All schemas share the docLevelFields() prelude so the result shape is
// predictable across slots.
// -------------------------------------------------------------------

type SlotDefinition = {
  mode: SlotExtractionMode;
  title: string;
  prompt: string;
  model?: string;
  toolName?: string;
  toolDescription?: string;
  schema?: Record<string, unknown>;
};

const MODEL_SONNET = "claude-sonnet-4-6";

function schemaWith(fields: Record<string, unknown>, required: string[]) {
  return {
    type: "object",
    properties: { ...docLevelFields(), ...fields },
    required: ["overallConfidence", "documentType", ...required],
    additionalProperties: false,
  };
}

export const SLOT_DEFINITIONS: Record<string, SlotDefinition> = {
  // --- Income ------------------------------------------------------
  "PCH-01": {
    mode: "extract",
    title: "Platform annual tax summary",
    prompt:
      "This document is uploaded as the client's annual platform tax summary (Uber, Bolt, FreeNow, Addison Lee or similar). Extract the fields per the tool schema. Values must be numbers, dates yyyy-mm-dd.",
    toolName: "extract_platform_annual_summary",
    toolDescription: "Extract from a UK ride-hailing platform annual tax summary.",
    model: MODEL_SONNET,
    schema: schemaWith(
      {
        platform: fieldSchema("Platform name as printed. Uber, Bolt, FreeNow, Addison Lee, etc."),
        periodFrom: fieldSchema("Start of the period, yyyy-mm-dd. Prefer UK tax year 6 April to 5 April."),
        periodTo: fieldSchema("End of the period, yyyy-mm-dd."),
        grossFares: fieldSchema("Total gross fares in GBP before platform fees. Numeric only."),
        platformFees: fieldSchema("Total platform commission + booking fees in GBP."),
        onTripMiles: fieldSchema("Total miles with a passenger on board. Integer."),
        deadMiles: fieldSchema("Dead/offline miles between trips. Integer. Often absent."),
      },
      ["platform", "periodFrom", "periodTo", "grossFares", "platformFees", "onTripMiles", "deadMiles"],
    ),
  },

  "PCH-02": {
    mode: "extract",
    title: "Weekly or monthly platform statements",
    prompt:
      "This document shows weekly or monthly statements for a UK ride-hailing driver, used when no single annual summary is available. Return one row per statement period PLUS a top-level aggregated total. Values in GBP, miles as integers.",
    toolName: "extract_weekly_statements",
    toolDescription: "Extract per-period rows from weekly or monthly platform statements.",
    schema: schemaWith(
      {
        platform: fieldSchema("Platform name as printed on the statements."),
        aggregateFrom: fieldSchema("Earliest period start across all rows, yyyy-mm-dd."),
        aggregateTo: fieldSchema("Latest period end across all rows, yyyy-mm-dd."),
        aggregateGrossFares: fieldSchema("Sum of gross fares across all rows. GBP."),
        aggregatePlatformFees: fieldSchema("Sum of platform fees across all rows. GBP."),
        aggregateOnTripMiles: fieldSchema("Sum of on-trip miles. Integer."),
        rows: arrayFieldSchema(
          {
            type: "object",
            properties: {
              periodFrom: { type: "string", description: "yyyy-mm-dd" },
              periodTo: { type: "string", description: "yyyy-mm-dd" },
              grossFares: { type: "number", description: "GBP, numeric only." },
              platformFees: { type: "number", description: "GBP." },
              onTripMiles: { type: "number", description: "Integer. 0 if not shown." },
            },
            required: ["periodFrom", "periodTo", "grossFares", "platformFees", "onTripMiles"],
            additionalProperties: false,
          },
          "One entry per statement period visible in the document.",
        ),
      },
      ["platform", "aggregateFrom", "aggregateTo", "aggregateGrossFares", "aggregatePlatformFees", "aggregateOnTripMiles", "rows"],
    ),
  },

  "PCH-03": {
    mode: "extract",
    title: "Cash or account-work log",
    prompt:
      "This is a client's log of cash work and account hire that didn't go through a ride-hailing app. Return the total gross income across the tax year and, where possible, per-period rows.",
    toolName: "extract_cash_log",
    toolDescription: "Extract gross cash income from a driver's manual log, spreadsheet or notebook photo.",
    schema: schemaWith(
      {
        aggregateGrossIncome: fieldSchema("Total cash + account-work gross income across the period. GBP."),
        periodFrom: fieldSchema("Earliest entry date, yyyy-mm-dd. Guess from context if dates are implicit."),
        periodTo: fieldSchema("Latest entry date, yyyy-mm-dd."),
        rows: arrayFieldSchema(
          {
            type: "object",
            properties: {
              date: { type: "string", description: "yyyy-mm-dd" },
              amount: { type: "number", description: "GBP" },
              note: { type: "string" },
            },
            required: ["date", "amount"],
            additionalProperties: false,
          },
          "One entry per row in the log. Omit the array (confidence = missing) if too freeform.",
        ),
      },
      ["aggregateGrossIncome", "periodFrom", "periodTo", "rows"],
    ),
  },

  // --- Vehicle -----------------------------------------------------
  "PCH-04": {
    mode: "extract",
    title: "Vehicle insurance schedule (hire & reward)",
    prompt:
      "This is a UK private-hire 'hire and reward' insurance schedule. Extract the policy details and the annual premium. The premium is the single expense line we need; split by instalment is not needed.",
    toolName: "extract_insurance_schedule",
    toolDescription: "Extract policy details and annual premium from a UK private-hire insurance schedule.",
    schema: schemaWith(
      {
        insurer: fieldSchema("Insurance company name."),
        policyNumber: fieldSchema("Policy number as printed."),
        policyStart: fieldSchema("Policy start date, yyyy-mm-dd."),
        policyEnd: fieldSchema("Policy end date, yyyy-mm-dd."),
        annualPremium: fieldSchema("Total annual premium in GBP including IPT and fees. Numeric only."),
        vehicleReg: fieldSchema("Vehicle registration number as printed on the schedule."),
      },
      ["insurer", "policyNumber", "policyStart", "policyEnd", "annualPremium", "vehicleReg"],
    ),
  },

  // PCH-05 (V5C logbook) is deliberately not pre-filled by AI.
  // It's an optional upload, so the accountant may ask for it on
  // a specific case; when they do, they read it themselves rather
  // than letting the model propose values the client would then
  // need to review from a sensitive document.
  "PCH-05": { mode: "skip", title: "V5C vehicle logbook", prompt: "" },

  "PCH-06": {
    mode: "extract",
    title: "Vehicle purchase invoice or HP/PCP finance statement",
    prompt:
      "This is a vehicle purchase invoice or an HP/PCP finance statement. Extract the purchase price (ex VAT if a VAT-registered dealer, else total paid) and any finance interest charged within the tax year.",
    toolName: "extract_vehicle_finance",
    toolDescription: "Extract purchase price and finance interest from a vehicle invoice or HP/PCP statement.",
    schema: schemaWith(
      {
        purchaseDate: fieldSchema("Date of purchase, yyyy-mm-dd."),
        purchasePrice: fieldSchema("Total vehicle cost in GBP (deposit + finance balance where applicable)."),
        financeInterestInPeriod: fieldSchema("Interest charged on the finance during the tax year. GBP. 0 or 'missing' for cash purchases."),
        agreementType: fieldSchema("'Cash purchase' | 'HP' | 'PCP' | 'Loan'."),
      },
      ["purchaseDate", "purchasePrice", "financeInterestInPeriod", "agreementType"],
    ),
  },

  "PCH-07": {
    mode: "extract",
    title: "Car rental or PCO hire agreement + payments",
    prompt:
      "This is a weekly PCO/private-hire vehicle rental agreement plus payment history. Extract the weekly rental amount and the total paid within the tax year.",
    toolName: "extract_rental_agreement",
    toolDescription: "Extract rental cost from a PCO hire agreement.",
    schema: schemaWith(
      {
        weeklyRental: fieldSchema("Weekly rental amount in GBP."),
        totalPaidInPeriod: fieldSchema("Total rental payments across the tax year. GBP."),
        rentalCompany: fieldSchema("Rental company name."),
        periodFrom: fieldSchema("First payment date in the tax year, yyyy-mm-dd."),
        periodTo: fieldSchema("Last payment date in the tax year, yyyy-mm-dd."),
      },
      ["weeklyRental", "totalPaidInPeriod", "rentalCompany", "periodFrom", "periodTo"],
    ),
  },

  "PCH-08": {
    mode: "extract",
    title: "MOT history / GOV.UK odometer readings",
    prompt:
      "This is a GOV.UK MOT history screenshot showing odometer readings on each test. Return the two readings bracketing the UK tax year (6 April to 5 April) so we can compute business miles.",
    toolName: "extract_mot_odometer",
    toolDescription: "Extract odometer readings bracketing the tax year from an MOT history.",
    schema: schemaWith(
      {
        odoAtStartDate: fieldSchema("Odometer reading at the test closest to (but before) 6 April of the tax year. Integer miles."),
        odoStartTestDate: fieldSchema("Date of that MOT test, yyyy-mm-dd."),
        odoAtEndDate: fieldSchema("Odometer reading at the test closest to (but after) 5 April of the following year. Integer miles."),
        odoEndTestDate: fieldSchema("Date of that MOT test, yyyy-mm-dd."),
      },
      ["odoAtStartDate", "odoStartTestDate", "odoAtEndDate", "odoEndTestDate"],
    ),
  },

  // --- Running costs ----------------------------------------------
  "PCH-09": {
    mode: "extract",
    title: "Fuel or charging receipts and bank lines",
    prompt:
      "This is one or more fuel or EV-charging receipts, or highlighted lines from a bank statement showing fuel/charging payments. Return the total spend across the period and, where visible, per-receipt rows.",
    toolName: "extract_fuel_spend",
    toolDescription: "Extract total fuel/charging spend from receipts or statement lines.",
    schema: schemaWith(
      {
        totalFuelSpend: fieldSchema("Total fuel/charging spend across the tax year, GBP."),
        periodFrom: fieldSchema("Earliest receipt date, yyyy-mm-dd."),
        periodTo: fieldSchema("Latest receipt date, yyyy-mm-dd."),
        receiptCount: fieldSchema("Number of distinct receipts visible. Integer."),
      },
      ["totalFuelSpend", "periodFrom", "periodTo", "receiptCount"],
    ),
  },

  "PCH-10": {
    mode: "extract",
    title: "Repairs, servicing, tyres, MOT, road tax receipts",
    prompt:
      "These are receipts for vehicle repairs, servicing, tyres, MOT tests and road tax (VED). Sum the total spend across the tax year.",
    toolName: "extract_repair_spend",
    toolDescription: "Extract total repair/servicing/MOT/VED spend from receipts.",
    schema: schemaWith(
      {
        totalRepairSpend: fieldSchema("Total spend across all receipts in the period, GBP."),
        receiptCount: fieldSchema("Number of distinct receipts. Integer."),
        majorItems: arrayFieldSchema(
          {
            type: "object",
            properties: {
              date: { type: "string" },
              description: { type: "string" },
              amount: { type: "number" },
            },
            required: ["date", "description", "amount"],
            additionalProperties: false,
          },
          "Items over £100 individually, for the accountant to spot-check.",
        ),
      },
      ["totalRepairSpend", "receiptCount", "majorItems"],
    ),
  },

  "PCH-11": {
    mode: "extract",
    title: "Congestion charge, ULEZ and parking receipts",
    prompt:
      "This is a Transport for London (TfL) account export or a set of parking/congestion/ULEZ receipts. Sum the allowable charges across the tax year. EXCLUDE fines or penalty charge notices (PCNs).",
    toolName: "extract_tfl_charges",
    toolDescription: "Extract allowable TfL/parking charges, excluding fines.",
    schema: schemaWith(
      {
        totalAllowableCharges: fieldSchema("Total congestion + ULEZ + parking charges across the period. GBP. EXCLUDE fines/PCNs."),
        finesSeenButExcluded: fieldSchema("Total of any fines or PCNs you SPOTTED but excluded, GBP. Lets the accountant verify the exclusion."),
      },
      ["totalAllowableCharges", "finesSeenButExcluded"],
    ),
  },

  // --- Licences ---------------------------------------------------
  "PCH-12": {
    mode: "extract",
    title: "PHV driver and vehicle licence fees",
    prompt:
      "This is a Transport for London (or local council) private-hire driver or vehicle licence receipt. Extract the fee amount and whether it is for the driver's own licence or the vehicle plate.",
    toolName: "extract_licence_fee",
    toolDescription: "Extract licence fee amount and type.",
    schema: schemaWith(
      {
        licenceType: fieldSchema("'Driver' | 'Vehicle' | 'Both'."),
        feePaid: fieldSchema("Fee amount paid, GBP."),
        issuingAuthority: fieldSchema("TfL, local council name, etc."),
        paymentDate: fieldSchema("Date paid, yyyy-mm-dd."),
      },
      ["licenceType", "feePaid", "issuingAuthority", "paymentDate"],
    ),
  },

  // --- Other costs ------------------------------------------------
  "PCH-13": {
    mode: "extract",
    title: "Mobile phone bill",
    prompt:
      "This is a mobile phone contract bill. Extract the total annual spend across the tax year. The client separately tells us the business-use percentage; we only need the TOTAL here.",
    toolName: "extract_phone_bill",
    toolDescription: "Extract total mobile spend.",
    schema: schemaWith(
      {
        totalAnnualSpend: fieldSchema("Total mobile cost across the tax year, GBP."),
        periodFrom: fieldSchema("First invoice date, yyyy-mm-dd."),
        periodTo: fieldSchema("Last invoice date, yyyy-mm-dd."),
      },
      ["totalAnnualSpend", "periodFrom", "periodTo"],
    ),
  },

  // --- Bank -------------------------------------------------------
  "PCH-14": {
    mode: "flag",
    title: "Bank statements for the account receiving platform payouts",
    prompt:
      "This is a bank statement for the account that receives ride-hailing platform payouts. Do NOT extract transactions; the client enters income from platform summaries instead. Instead, flag anomalies: large unexplained deposits, overdraft fees that look like finance interest, direct debits for insurance/rental, and any pattern suggesting cash deposits (regular round-number cash paid in).",
    toolName: "flag_bank_statement_anomalies",
    toolDescription: "Flag items on a bank statement that the accountant should spot-check.",
    schema: schemaWith(
      {
        totalDepositsSeen: fieldSchema("Total credits across the statements. GBP. Sanity-check for the accountant."),
        unexplainedLargeDeposits: fieldSchema("One-line summary of any deposit over £500 that doesn't look like a platform payout."),
        cashDepositsSeen: fieldSchema("'Yes' | 'No' | 'Unsure' for cash-paid-in transactions."),
        insuranceOrRentalDebits: fieldSchema("Any direct debits identifiable as insurance / rental payments. One-line summary."),
      },
      ["totalDepositsSeen", "unexplainedLargeDeposits", "cashDepositsSeen", "insuranceOrRentalDebits"],
    ),
  },

  // --- VAT --------------------------------------------------------
  "PCH-15": {
    mode: "extract",
    title: "Uber VAT statements (VAT-registered TfL drivers)",
    prompt:
      "This is an Uber VAT statement given to VAT-registered TfL private-hire drivers under HMRC's special rules. Extract the VAT top-up amount Uber paid the driver and the total VAT invoiced for the period.",
    toolName: "extract_uber_vat_statement",
    toolDescription: "Extract VAT figures from an Uber VAT statement.",
    schema: schemaWith(
      {
        vatPeriodFrom: fieldSchema("yyyy-mm-dd"),
        vatPeriodTo: fieldSchema("yyyy-mm-dd"),
        vatOnFaresCollectedByUber: fieldSchema("VAT Uber has collected on the driver's behalf. GBP."),
        vatTopUpPaidToDriver: fieldSchema("VAT top-up Uber paid to the driver. GBP."),
      },
      ["vatPeriodFrom", "vatPeriodTo", "vatOnFaresCollectedByUber", "vatTopUpPaidToDriver"],
    ),
  },

  // --- Employment income ------------------------------------------
  "PCH-16": {
    mode: "extract",
    title: "P60 for every job held at 5 April",
    prompt:
      "This is a UK P60 end-of-year certificate for a job held at 5 April. Extract gross pay and tax deducted for the tax year.",
    toolName: "extract_p60",
    toolDescription: "Extract gross pay and tax deducted from a P60.",
    schema: schemaWith(
      {
        employerName: fieldSchema("Employer name as printed on the P60."),
        taxYear: fieldSchema("Tax year labelled on the form, e.g. '2025-2026'."),
        grossPay: fieldSchema("Gross pay in this employment for the tax year. GBP."),
        taxDeducted: fieldSchema("Income tax deducted in this employment for the tax year. GBP."),
      },
      ["employerName", "taxYear", "grossPay", "taxDeducted"],
    ),
  },

  "PCH-17": {
    mode: "extract",
    title: "P45 for any job that ended in the year",
    prompt:
      "This is a UK P45 leaving certificate. Extract pay and tax up to the leaving date.",
    toolName: "extract_p45",
    toolDescription: "Extract pay and tax from a P45.",
    schema: schemaWith(
      {
        employerName: fieldSchema("Employer name."),
        leavingDate: fieldSchema("Leaving date, yyyy-mm-dd."),
        payToDate: fieldSchema("Gross pay in this employment up to the leaving date. GBP."),
        taxToDate: fieldSchema("Tax deducted up to the leaving date. GBP."),
      },
      ["employerName", "leavingDate", "payToDate", "taxToDate"],
    ),
  },

  // --- Other income -----------------------------------------------
  "PCH-18": {
    mode: "extract",
    title: "Bank or building society interest certificate",
    prompt:
      "This is a UK bank/BS interest certificate for a tax year. Extract the total untaxed interest paid.",
    toolName: "extract_interest_certificate",
    toolDescription: "Extract untaxed interest total from a bank/BS certificate.",
    schema: schemaWith(
      {
        provider: fieldSchema("Bank or building society name."),
        taxYear: fieldSchema("Tax year on the certificate."),
        untaxedInterest: fieldSchema("Total gross interest paid in the tax year. GBP."),
      },
      ["provider", "taxYear", "untaxedInterest"],
    ),
  },

  "PCH-19": {
    mode: "extract",
    title: "Student loan statement or plan type",
    prompt:
      "This is a Student Loans Company statement or account screenshot. Extract the plan type (Plan 1/2/4/5 or Postgraduate) and whether the balance is still outstanding.",
    toolName: "extract_student_loan",
    toolDescription: "Extract plan type and outstanding balance from an SLC statement.",
    schema: schemaWith(
      {
        planType: fieldSchema("'Plan 1' | 'Plan 2' | 'Plan 4' | 'Plan 5' | 'Postgraduate' | 'None'."),
        balanceOutstanding: fieldSchema("'Yes' | 'No'. 'No' means fully repaid before 6 April."),
      },
      ["planType", "balanceOutstanding"],
    ),
  },

  // --- HMRC history -----------------------------------------------
  "PCH-20": {
    mode: "extract",
    title: "Last year's SA302 / tax calculation",
    prompt:
      "This is a prior-year SA302 or HMRC tax calculation. Extract the two 2025/26 payments on account that it generated: half of 2024/25's income tax plus Class 4, each due 31 Jan 2026 and 31 Jul 2026.",
    toolName: "extract_last_year_sa302",
    toolDescription: "Extract payments-on-account figures from a prior-year SA302.",
    schema: schemaWith(
      {
        priorYearTaxableProfit: fieldSchema("Last year's taxable profit, GBP."),
        priorYearTotalDue: fieldSchema("Last year's total tax + NIC due, GBP."),
        poa1Due: fieldSchema("First payment on account for the current tax year due 31 Jan, GBP."),
        poa2Due: fieldSchema("Second payment on account due 31 Jul, GBP."),
      },
      ["priorYearTaxableProfit", "priorYearTotalDue", "poa1Due", "poa2Due"],
    ),
  },

  "PCH-21": {
    mode: "extract",
    title: "Proof of HMRC payments made",
    prompt:
      "This is proof of payments made to HMRC against the current tax year's liability (bank transfer confirmations or an HMRC statement). Extract the first POA paid and the second POA paid.",
    toolName: "extract_hmrc_payments",
    toolDescription: "Extract POA payments actually made.",
    schema: schemaWith(
      {
        poa1Paid: fieldSchema("First payment on account actually paid, GBP."),
        poa1PaidDate: fieldSchema("Date of first POA payment, yyyy-mm-dd."),
        poa2Paid: fieldSchema("Second payment on account actually paid, GBP."),
        poa2PaidDate: fieldSchema("Date of second POA payment, yyyy-mm-dd."),
      },
      ["poa1Paid", "poa1PaidDate", "poa2Paid", "poa2PaidDate"],
    ),
  },

  "PCH-22": {
    mode: "flag",
    title: "HMRC letters (compliance, nudge, coding)",
    prompt:
      "This is correspondence from HMRC. Summarise the subject and flag any open enquiry, compliance check, nudge letter or coding notice that the accountant needs to know about.",
    toolName: "flag_hmrc_letter",
    toolDescription: "Summarise and flag an HMRC letter.",
    schema: schemaWith(
      {
        letterType: fieldSchema("'Nudge' | 'Compliance check' | 'Coding notice' | 'Statement' | 'Other'."),
        letterDate: fieldSchema("yyyy-mm-dd"),
        subject: fieldSchema("One-line subject or heading of the letter."),
        actionRequired: fieldSchema("One-line summary of any action HMRC wants from the client."),
        deadline: fieldSchema("yyyy-mm-dd if any deadline is stated."),
      },
      ["letterType", "letterDate", "subject", "actionRequired", "deadline"],
    ),
  },

  // --- Workflow docs (no AI pass) ---------------------------------
  "PCH-23": { mode: "skip", title: "Signed approval of draft accounts", prompt: "" },
  "PCH-24": { mode: "skip", title: "Photo ID and proof of address", prompt: "" },
};

// -------------------------------------------------------------------
// Public entry point. Returns null for skip-mode slots so callers can
// quickly decide whether to invoke the model at all.
// -------------------------------------------------------------------

export async function extractForSlot(
  slotCode: string,
  doc: DocumentInput,
): Promise<ExtractionResult | null> {
  const def = SLOT_DEFINITIONS[slotCode];
  if (!def) throw new Error("Unknown slot code: " + slotCode);
  if (def.mode === "skip") return null;
  if (!def.schema || !def.toolName) {
    throw new Error("Slot " + slotCode + " is not configured for AI extraction.");
  }
  return runExtraction(def, doc);
}

async function runExtraction(def: SlotDefinition, doc: DocumentInput): Promise<ExtractionResult> {
  const anthropic = client();
  const base64 = Buffer.from(doc.bytes).toString("base64");

  const docContent: Anthropic.ContentBlockParam =
    doc.mimeType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: doc.mimeType, data: base64 } };

  const response = await anthropic.messages.create({
    model: def.model ?? MODEL_SONNET,
    max_tokens: 3072,
    system:
      "You read UK Self Assessment supporting documents for a private-hire driver and extract strict structured values. Report confidence honestly: 'missing' and null is always better than a guess. Document type sanity check: if the uploaded file is not the expected '" + def.title + "', set overallConfidence='low' and documentType to what you actually see so the client is prompted to re-upload.",
    tools: [
      {
        name: def.toolName!,
        description: def.toolDescription ?? "Extract structured values from the uploaded document.",
        input_schema: def.schema as Anthropic.Tool["input_schema"],
      },
    ],
    tool_choice: { type: "tool", name: def.toolName! },
    messages: [
      {
        role: "user",
        content: [docContent, { type: "text", text: def.prompt }],
      },
    ],
  });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return a tool call (stop_reason=" + response.stop_reason + ").");
  }
  const input = toolUse.input as Record<string, unknown>;
  const overallConfidence = (input.overallConfidence as ExtractionConfidence) ?? "low";
  const documentType = (input.documentType as string) ?? "";
  const { overallConfidence: _oc, documentType: _dt, ...fields } = input;
  void _oc; void _dt;
  return { fields, overallConfidence, documentType, rawJson: input };
}
