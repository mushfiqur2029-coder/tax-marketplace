import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  ExtractedField,
  ExtractionConfidence,
  ExtractionResult,
} from "./ai-extract";

// AI-driven conversational income reconstruction for the PCH automated
// flow. When a client doesn't have the document for a given slot (today
// PCH-01; Slice 4 extends to PCH-02, PCH-03), this module runs a guided
// chat that asks for the figures one or two questions at a time, the way
// a human accountant would walk the client through it on a call.
//
// Strict rules the model operates under:
//   - Never invent or estimate a number the client did not confirm.
//   - If the client says "I don't know", mark the field confidence as
//     "missing" and move on. The accountant gets a proactive signal
//     (new 'Awaiting accountant' slot status) rather than hunting
//     through a review UI.
//   - End the interview as soon as every schema field has either a
//     value from the client or a "don't know".
//
// Output shape MATCHES the document extraction schema exactly, so the
// existing extraction-review UI + extraction-apply pipeline can consume
// an interview-sourced row with no additional branching. The only
// difference stored on pch_doc_extractions is `source = 'ai_interview'`
// and `raw_json` holds the full transcript rather than a document
// response.

export type InterviewRole = "user" | "assistant";

export type InterviewMessage = {
  role: InterviewRole;
  content: string;
};

export type InterviewTurnResult =
  // Next thing the UI should display + whether we're expecting a user
  // reply after this.
  | { kind: "ask"; assistant: string }
  // Done. `fields` matches the per-slot extraction schema.
  | {
      kind: "done";
      fields: Record<string, ExtractedField>;
      overallConfidence: ExtractionConfidence;
      documentType: string;
    };

type FieldSpec = {
  key: string;             // matches the extraction schema field key
  label: string;           // short human label used in prompts
  description: string;     // precise definition the AI leans on
};

type InterviewFlow = {
  slotCode: string;
  title: string;
  // Short description shown as "documentType" on the resulting extraction.
  resultLabel: string;
  // Opening line the AI uses as its first message (deterministic so the
  // first turn doesn't burn a round-trip just to say hello).
  opener: string;
  // Ordered list of fields to collect. Order isn't strict; the AI may
  // batch 2-3 related questions in one turn if that reads naturally.
  // Keys MUST match the slot's extraction schema (ai-extract.ts) so
  // extraction-apply can route the values into the intake tables with
  // no additional mapping work.
  fields: FieldSpec[];
};

const INTERVIEW_FLOWS: Record<string, InterviewFlow> = {
  // Phase 6 Slice 1 removed the PROFILE flow; Phase 6 Slice 7 removed
  // the PCH-01/02/03 slot-interview flows (clients now describe their
  // income by uploading a bank statement, not through a per-slot chat).
  // The only remaining flow is VEHICLE_CA. The runInterviewTurn /
  // openInterview harness stays general so future flows can be added
  // without a schema change.

  // ------------------------------------------------------------------
  // Phase 6 Slice 4: VEHICLE_CA flow.
  //
  // Replaces the long Tab 4 vehicle form with a conversational walk
  // through only the fields that apply, after the AI explains capital
  // allowances in plain English. Returns "Not applicable" for every
  // detail field when the client leases / rents / has no vehicle to
  // depreciate, rather than leaving a dead-end form.
  //
  // Fields match pch_vehicle columns so the finalize payload maps
  // cleanly in the commit action (vehicle-interview-actions.ts).
  // ------------------------------------------------------------------
  VEHICLE_CA: {
    slotCode: "VEHICLE_CA",
    title: "Vehicle and capital allowances",
    resultLabel: "AI interview: vehicle and capital allowances",
    opener:
      "Last stretch: your vehicle. HMRC lets you claim a chunk of what the vehicle cost you back against your profit over time, called capital allowances. If you own or finance the car, that's usually worth claiming. If you lease or rent it (like a PCO hire), the rent itself is already in your bank statement, so there's nothing extra to work out here. First: how is your vehicle set up this tax year? Owned outright, financed (HP or PCP), leased, PCO/weekly rental, or no vehicle this year?",
    fields: [
      {
        key: "status",
        label: "Vehicle status",
        description:
          "Exactly one of: 'Owned outright', 'Hire purchase', 'PCP', 'Loan', 'Leased', 'Rented', 'No vehicle'. Drives every other field below. If the client says 'rented' or 'PCO rental', use 'Rented'. If 'Lease' use 'Leased'.",
      },
      {
        key: "fuel",
        label: "Fuel type",
        description:
          "'Petrol' | 'Diesel' | 'Hybrid' | 'Electric' | 'PHEV'. Only ask if status is Owned/HP/PCP/Loan. Otherwise mark missing.",
      },
      {
        key: "make_model",
        label: "Make and model",
        description:
          "Short free text, e.g. 'Toyota Prius' or 'Tesla Model 3'. Only ask if status is not 'No vehicle'.",
      },
      {
        key: "registration",
        label: "Registration",
        description:
          "UK number plate as printed, uppercase, no space. Only ask if status is not 'No vehicle'. Mark missing if the client doesn't remember exactly.",
      },
      {
        key: "co2_gpkm",
        label: "CO2 emissions (g/km)",
        description:
          "Integer, from the V5C or the DVLA website. Only matters for owned / HP / PCP / Loan vehicles (sets the capital allowance rate). Mark missing if the client doesn't know; the accountant will look it up on DVLA.",
      },
      {
        key: "purchase_date",
        label: "Purchase date",
        description:
          "yyyy-mm-dd. Only ask if status is Owned/HP/PCP/Loan AND the purchase was in this tax year or still being paid off. Mark missing for cars bought in a prior year with no remaining balance.",
      },
      {
        key: "purchase_price",
        label: "Purchase price (GBP, total)",
        description:
          "Total price paid including VAT. Numeric GBP. Only ask for Owned/HP/PCP/Loan. For HP/PCP ask for the total price including the finance balance. Mark missing if the client genuinely does not know; the accountant will chase the invoice.",
      },
      {
        key: "new_or_used",
        label: "New or used",
        description:
          "'New' | 'Used'. Only ask for Owned/HP/PCP/Loan.",
      },
      {
        key: "business_pct_override",
        label: "Business use percentage",
        description:
          "Integer 0-100. If the client uses the car for both private trips and PHV work, what percentage of total mileage is PHV? Only ask if status is not 'No vehicle'. Default to 100 if the client confirms the car is only used for driving work.",
      },
      {
        key: "prior_year_wdv_pound",
        label: "Prior-year written-down value (GBP)",
        description:
          "The written-down value brought forward from last year's capital allowances pool. GBP. Only ask if the client has been self-employed as a driver for more than one tax year AND status is Owned/HP/PCP/Loan. Mark missing if they don't know; the accountant will pull it from last year's SA302.",
      },
    ],
  },

  // ------------------------------------------------------------------
  // Phase 7 Slice 7.6: RELIEFS, personal reliefs that can lower the
  // tax bill. Writes to existing pch_cases columns:
  //   personal_pension_net_pence, gift_aid_net_pence,
  //   marriage_allowance_status.
  // ------------------------------------------------------------------
  RELIEFS: {
    slotCode: "RELIEFS",
    title: "Reliefs and personal allowances",
    resultLabel: "AI interview: personal reliefs",
    opener:
      "Three quick questions about personal reliefs, these can lower your tax bill. First, did you pay into a personal pension this year (anything outside a workplace pension your employer runs)? If yes, how much in total? Numbers in pounds are fine, I'll handle the gross-up.",
    fields: [
      {
        key: "personal_pension_net_gbp",
        label: "Personal pension contributions, net (GBP)",
        description:
          "Numeric GBP. Total paid into a personal pension this tax year, net of basic-rate tax relief at source. Only workplace pension deducted via payroll does NOT count here. Mark missing (0 is fine) if the client paid nothing or doesn't know; the accountant can still ask them for an annual statement.",
      },
      {
        key: "gift_aid_net_gbp",
        label: "Gift Aid donations, net (GBP)",
        description:
          "Numeric GBP. Total charitable donations this tax year where the client ticked the Gift Aid box. Net of basic-rate tax relief (standard presentation). Mark missing (0 is fine) if no donations or client doesn't know.",
      },
      {
        key: "marriage_allowance_status",
        label: "Marriage Allowance status",
        description:
          "Exactly one of: 'None', 'Transferring', 'Receiving'. 'Transferring' means the client is transferring 10% of their personal allowance to a lower-earning spouse. 'Receiving' means the client is the lower earner receiving the transfer. 'None' means neither applies.",
      },
    ],
  },

  // ------------------------------------------------------------------
  // Phase 7 Slice 7.6: INCOME_PROBE, confirm nil activity on other
  // platforms. Writes to pch_cases.nil_platforms_note.
  // ------------------------------------------------------------------
  INCOME_PROBE: {
    slotCode: "INCOME_PROBE",
    title: "Any other income sources?",
    resultLabel: "AI interview: nil-platform confirmation",
    opener:
      "Quick check on income sources, we've picked up your main platform earnings from the bank statement. Did you drive for any other platforms this year (Bolt, FreeNow, Addison Lee, Uber Eats, Deliveroo, Just Eat), even if you earned nothing? If nothing else, just say 'only Uber' (or whichever platform you did use).",
    fields: [
      {
        key: "nil_platforms_note",
        label: "Other platforms / nil activity note",
        description:
          "Free-form client answer summarising what platforms they drove for and which (if any) had nil activity this year. Keep it short, one or two sentences; the accountant reads this verbatim.",
      },
    ],
  },

  // ------------------------------------------------------------------
  // Phase 7 Slice 7.6: EXPENSES_PROBE, often-missed costs + estimate
  // workings. Combines two conversational questions (checklist items
  // 11 and 27) into one flow. Writes to pch_cases.expenses_probe_note.
  // ------------------------------------------------------------------
  EXPENSES_PROBE: {
    slotCode: "EXPENSES_PROBE",
    title: "Any expenses we missed?",
    resultLabel: "AI interview: expenses probe",
    opener:
      "Two quick questions on expenses before you submit. First, did you have any costs we might have missed? These come up often but aren't always on your bank statement, PCO vehicle rental, DBS or medical check fees, VED (road tax) on an EV, or breakdown cover. Second, were any of your expense numbers estimates rather than exact figures (for example, 'about £40 a week on car cleaning')? If so, how did you work the estimate out?",
    fields: [
      {
        key: "expenses_probe_note",
        label: "Expenses probe answer",
        description:
          "Free-form client answer covering (a) any often-missed costs they want the accountant to add, and (b) the method behind any estimated figures. Keep it short, two or three sentences; the accountant reads this verbatim and decides whether to add expense lines.",
      },
    ],
  },

  // ------------------------------------------------------------------
  // Phase 7 Slice 7.6c: VEHICLE_CA_EXT, disposal follow-up to the main
  // VEHICLE_CA chat. Only shown when the client owns or finances the
  // vehicle (status in Owned outright / HP / PCP / Loan); leased /
  // rented / no-vehicle cases never surface a balancing event. Writes
  // pch_vehicle.{disposed, disposal_proceeds_pence, disposal_date} and
  // marks pch_check_status item 16 Done.
  //
  // WDV sanity: compute.ts fires caBalancing = wdvBroughtForward +
  // caAddition - caFya - proceeds the moment disposed='Yes', so a
  // disposal with proceeds but no WDV looks like a big one-liner
  // balancing charge. The prompt tells the client to mark proceeds
  // missing (not guess) if they can't confirm the figure or if they
  // don't know what the car was worth on last year's return; the
  // accountant then pulls WDV off the prior-year SA302.
  // ------------------------------------------------------------------
  VEHICLE_CA_EXT: {
    slotCode: "VEHICLE_CA_EXT",
    title: "Vehicle disposal",
    resultLabel: "AI interview: vehicle disposal",
    opener:
      "Quick follow-up on your vehicle. Did you sell, part-exchange, or scrap the car during this tax year? If you still have it, just say 'no' and we're done. If it left your hands, I'll ask for the proceeds and the date.",
    fields: [
      {
        key: "disposed",
        label: "Vehicle disposed this year",
        description:
          "Exactly 'Yes' or 'No'. 'Yes' means the client sold the car, part-exchanged it against another vehicle, scrapped it, or wrote it off through insurance during this tax year. 'No' means it is still owned at year end. If the client is unsure, treat as 'No' and the accountant can revisit.",
      },
      {
        key: "disposal_proceeds_gbp",
        label: "Disposal proceeds (GBP)",
        description:
          "Numeric GBP. Only ask when disposed='Yes'. Total received for the car: a sale price, a part-exchange allowance against a new car (even if no cash changed hands), scrap value, or insurance payout. If the client cannot confirm the exact figure, mark missing (do not guess); a balancing charge off a guessed number is a real tax hit. Mark missing if disposed='No'.",
      },
      {
        key: "disposal_date",
        label: "Disposal date",
        description:
          "Date in yyyy-mm-dd. Only ask when disposed='Yes'. The date ownership transferred (sale completion, part-exchange, scrap collection, insurance write-off). Must fall inside the tax year (6 April to 5 April). Mark missing if the client only remembers the month; the accountant will chase paperwork. Mark missing if disposed='No'.",
      },
    ],
  },

  // ------------------------------------------------------------------
  // Phase 8 Slice 8.5: INCOME_INTERVIEW, chat-based income capture for
  // drivers who don't have a bank statement to upload. Produces one
  // aggregated pch_income_lines row (gross, platform fees, on-trip
  // miles). Commit action lives in other-interview-actions.ts and uses
  // an "Interview: " source prefix for idempotent re-run (parallels
  // the "Bank: " prefix used by the bank-statement aggregator).
  // ------------------------------------------------------------------
  INCOME_INTERVIEW: {
    slotCode: "INCOME_INTERVIEW",
    title: "Capture your income by chat",
    resultLabel: "AI interview: income reconstruction",
    opener:
      "No bank statement to upload? No problem, we'll walk through your income together. First, which platforms did you drive for this tax year? Uber, Bolt, Addison Lee, FreeNow, Uber Eats, Deliveroo, something else? List every one you drove for, even if it was only a handful of jobs.",
    fields: [
      {
        key: "platforms_summary",
        label: "Platforms used",
        description:
          "Short free text listing every platform the driver worked for this tax year. One or two sentences; the accountant reads this verbatim and can split per-platform later. If only one platform, say so (e.g. 'Only Uber').",
      },
      {
        key: "total_gross_gbp",
        label: "Total gross income (GBP)",
        description:
          "Numeric GBP. Total gross income across every platform BEFORE any platform fees are deducted (the figure HMRC calls turnover). If the driver only remembers a weekly or monthly average, help them multiply out (e.g. '£650 a week x 48 weeks worked = £31,200') and ask them to confirm the annual figure before recording. Confidence 'medium' is correct for a calculation the client confirmed step by step. Mark missing if they genuinely cannot land on a figure.",
      },
      {
        key: "total_fees_gbp",
        label: "Total platform fees (GBP)",
        description:
          "Numeric GBP. Total service / commission fees charged by platforms across the tax year (the deduction before the net payout hits the bank). Mark missing if the driver doesn't track fees separately or doesn't know; the accountant will estimate or chase statements.",
      },
      {
        key: "total_on_trip_miles",
        label: "Total on-trip miles",
        description:
          "Integer miles. Total business miles driven ON TRIP (passenger in the car) across all platforms this tax year. Not dead miles. If the driver gives a weekly average, multiply out and confirm. Mark missing if they genuinely do not know; the accountant can estimate from gross earnings once they know the typical fare per mile.",
      },
    ],
  },

  // ------------------------------------------------------------------
  // EXPENSE_INTERVIEW (post Phase 8): chat-based non-vehicle allowable
  // expense capture for drivers without a bank statement. Companion to
  // INCOME_INTERVIEW. Vehicle running costs (fuel, repairs, finance,
  // depreciation) are deliberately NOT in scope here, VEHICLE_CA
  // handles the CA-eligible side and bank statements handle the
  // consumable side; this flow focuses on consumables that aren't
  // caught by either path for a no-bank client.
  //
  // Each category is skippable in-flow: client says "none" or
  // "don't know" and the AI records confidence='missing', value=null,
  // moves on. The commit action writes one pch_expense_lines row per
  // field that has a confirmed positive value; missing fields never
  // produce a row. Nothing in this flow blocks submission.
  //
  // Idempotency: all written rows carry a "Interview: " label prefix,
  // matching the bank aggregator's "Bank: " convention. Commit deletes
  // every row with that prefix before inserting fresh ones, so re-runs
  // never duplicate and never clobber manual or bank-origin rows.
  // ------------------------------------------------------------------
  EXPENSE_INTERVIEW: {
    slotCode: "EXPENSE_INTERVIEW",
    title: "Capture your business expenses by chat",
    resultLabel: "AI interview: expense reconstruction",
    opener:
      "We'll walk through your business expenses one at a time. For each category, give me the annual total you spent, or say 'none' or 'don't know' and we'll skip it. The six categories: phone and data (business portion), vehicle cleaning, parking and tolls (not fines), insurance, licences and subscriptions, and anything else. Starting with phone, what did you spend on your mobile bill for the year, business portion only? If your bill is 60 pounds a month and you use the phone 80 percent for driving, that's about 576 pounds for the year.",
    fields: [
      {
        key: "phone_data_gbp",
        label: "Phone and data, annual business portion (GBP)",
        description:
          "Numeric GBP. Annual spend on mobile phone + data, business portion only (not total household bill). If the client gives a monthly figure, help them multiply out and confirm the annual total before recording. Mark missing if the client says 'don't know', 'none', or doesn't use their phone for driving work.",
      },
      {
        key: "cleaning_gbp",
        label: "Vehicle cleaning / valeting, annual (GBP)",
        description:
          "Numeric GBP. Annual spend on vehicle cleaning or valeting (interior + exterior). Common weekly cost; help with weekly to annual multiplication if useful. Mark missing if the client says 'none' or 'don't know'.",
      },
      {
        key: "parking_tolls_gbp",
        label: "Congestion, ULEZ, parking, annual (GBP)",
        description:
          "Numeric GBP. Annual spend on congestion charge, ULEZ, and legitimate parking. Fines and PCNs are NOT claimable, exclude them from the figure. Mark missing if the client says 'none' or 'don't know'.",
      },
      {
        key: "insurance_gbp",
        label: "Insurance, annual (GBP)",
        description:
          "Numeric GBP. Annual vehicle insurance premium (hire + reward is the typical PHV policy). If the client has non-vehicle business insurance too, add it. Mark missing if the client says 'none' or 'don't know'.",
      },
      {
        key: "subs_fees_gbp",
        label: "Licences and subscriptions, annual (GBP)",
        description:
          "Numeric GBP. Annual total for the PHV driver and vehicle licence, DBS check, medical check, breakdown cover, trade body subscriptions, and similar recurring driver-side fees. Mark missing if the client says 'none' or 'don't know'.",
      },
      {
        key: "other_business_gbp",
        label: "Any other allowable business cost, annual (GBP)",
        description:
          "Numeric GBP. One figure for anything else the client wants to claim that wasn't covered above AND is strictly for the driving business. Mark missing if the client has nothing else to add.",
      },
      {
        key: "other_business_label",
        label: "What was the 'other' cost?",
        description:
          "Short free text naming the 'other' cost from the previous answer (e.g. 'Dashcam', 'Headrests', 'Air freshener subscription'). Only ask when other_business_gbp has a positive value; mark missing (null) when other_business_gbp is missing or 0.",
      },
    ],
  },

  // ------------------------------------------------------------------
  // Phase 7 Slice 7.6: FILING_DETAILS, repayment account name. Single
  // question. Writes to pch_cases.repayment_account_name.
  // ------------------------------------------------------------------
  FILING_DETAILS: {
    slotCode: "FILING_DETAILS",
    title: "Where should a refund go?",
    resultLabel: "AI interview: repayment account",
    opener:
      "Last quick question before you submit, when HMRC refunds you (if there's any refund due this year), whose bank account should it go to? Normally this is your own account; the name on the account must exactly match your HMRC-registered name. If you'd rather HMRC paid someone else (a 'nominee'), tell me their full name.",
    fields: [
      {
        key: "repayment_account_name",
        label: "Repayment account holder name",
        description:
          "Full name on the UK bank account where HMRC should send any refund. Must match the account's registered name exactly. Could be the client themselves, a spouse, or a nominee. One line, no account numbers or sort codes.",
      },
    ],
  },
};

export function getInterviewFlow(slotCode: string): InterviewFlow | null {
  return INTERVIEW_FLOWS[slotCode] ?? null;
}

export function hasInterviewFor(slotCode: string): boolean {
  return slotCode in INTERVIEW_FLOWS;
}


// Opening message. For the PCH-01..03 slot flows this is the flow's
// static `opener` string. For PROFILE (and future slots that need a
// contextual opener) the caller passes `overrideOpener` built from
// current head-row state.
export function openInterview(
  slotCode: string,
  overrideOpener?: string,
): InterviewMessage {
  const flow = INTERVIEW_FLOWS[slotCode];
  if (!flow) throw new Error("No interview flow for slot " + slotCode);
  const content =
    typeof overrideOpener === "string" && overrideOpener.trim().length > 0
      ? overrideOpener.trim()
      : flow.opener;
  return { role: "assistant", content };
}

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. AI interview is disabled.",
    );
  }
  return new Anthropic({ apiKey });
}

const MODEL_SONNET = "claude-sonnet-4-6";

// System prompt describing the model's job + the two-tool contract.
function systemPrompt(flow: InterviewFlow): string {
  const fieldList = flow.fields
    .map((f) => `  - "${f.key}" (${f.label}): ${f.description}`)
    .join("\n");
  return [
    "You are a friendly UK accountant helping a private-hire driver reconstruct their income for Self Assessment, in a short back-and-forth conversation.",
    "",
    "RULES, non-negotiable:",
    "1. Never invent, estimate, or round up a figure the client did not explicitly confirm. If the client doesn't know, that field is 'missing' and null; do not guess.",
    "2. Keep each message short (one or at most two linked questions). The driver may be replying on a phone between jobs.",
    "3. Do not ask for things we already have. Scan the whole transcript before asking.",
    "4. Only numeric values go into numeric fields. If the client says 'about forty-eight grand', ask them to confirm the exact figure or say 'I don't know' before you record it.",
    "5. End as soon as every field has either a confirmed value or a 'missing' marker from the client.",
    "",
    "You have exactly two tools. Pick one every turn:",
    "- `ask_followup`: continue the conversation with one more question.",
    "- `finalize_interview`: all fields collected (confirmed or missing). Package into the per-field schema.",
    "",
    "Field schema you must fill when calling `finalize_interview`:",
    fieldList,
    "",
    "For every field use the standard shape: { value, confidence, note }.",
    "  value: the number or string the client told you. Numbers unquoted. null when the client said they didn't know.",
    "  confidence: 'high' when the client stated the exact figure; 'medium' when derived from arithmetic the client confirmed (e.g. gross minus net = fees); 'missing' when the client said 'I don't know' or you did not reach the question. Never 'low'; if you'd want 'low', ask one more question or mark it missing.",
    "  note: a one-sentence record of what the client said, so the accountant knows the provenance. Max 100 chars.",
    "",
    "overallConfidence: 'high' if every field is high; 'medium' if any field is medium; 'missing' if any field is missing; 'low' never.",
  ].join("\n");
}

// Field-shape schema reused by the finalize tool. Mirrors fieldSchema()
// in ai-extract.ts but accessible from this module so the tool-call
// contract doesn't drift between the two surfaces.
function interviewFieldSchema(description: string) {
  return {
    type: "object",
    properties: {
      value: {
        oneOf: [{ type: "string" }, { type: "number" }, { type: "null" }],
        description,
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "missing"],
        description:
          "high = client stated the exact figure. medium = calculated from arithmetic the client confirmed. missing = client said they don't know; value must be null.",
      },
      note: {
        type: "string",
        description:
          "One sentence recording what the client said. Keep under 100 chars.",
      },
    },
    required: ["value", "confidence", "note"],
    additionalProperties: false,
  };
}

function finalizeToolSchema(
  flow: InterviewFlow,
  focusFieldKeys?: readonly string[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    overallConfidence: {
      type: "string",
      enum: ["high", "medium", "missing"],
      description:
        "Combined confidence across all fields. 'missing' as soon as any single field is missing.",
    },
    documentType: {
      type: "string",
      description:
        "Short one-liner such as 'AI interview: platform annual income reconstruction'.",
    },
  };
  const required: string[] = ["overallConfidence", "documentType"];
  const focusSet = focusFieldKeys ? new Set(focusFieldKeys) : null;
  for (const f of flow.fields) {
    if (focusSet && !focusSet.has(f.key)) continue;
    properties[f.key] = interviewFieldSchema(f.description);
    required.push(f.key);
  }
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

const ASK_TOOL_SCHEMA = {
  type: "object",
  properties: {
    question: {
      type: "string",
      description:
        "Your next message to the client. One or two linked questions, under 60 words.",
    },
  },
  required: ["question"],
  additionalProperties: false,
} as const;

export async function runInterviewTurn(
  slotCode: string,
  transcript: InterviewMessage[],
  options?: { focusFieldKeys?: readonly string[] },
): Promise<InterviewTurnResult> {
  const flow = INTERVIEW_FLOWS[slotCode];
  if (!flow) throw new Error("No interview flow for slot " + slotCode);
  if (transcript.length === 0) {
    throw new Error(
      "Transcript must contain at least the opener. Call openInterview() first.",
    );
  }
  // Guard against pathological runaways: if the UI somehow loops without
  // ever reaching finalize, this stops the AI from asking the client the
  // same thing forever. 24 turns is well above a realistic interview.
  if (transcript.length > 24) {
    throw new Error(
      "Interview exceeded 24 turns without finalizing; aborting.",
    );
  }

  const focusFieldKeys = options?.focusFieldKeys;
  if (focusFieldKeys && focusFieldKeys.length === 0) {
    throw new Error(
      "focusFieldKeys was provided but empty; interview cannot narrow to zero fields.",
    );
  }
  const scopedFlow: InterviewFlow = focusFieldKeys
    ? {
        ...flow,
        fields: flow.fields.filter((f) =>
          focusFieldKeys.includes(f.key),
        ),
      }
    : flow;

  const anthropic = client();
  const response = await anthropic.messages.create({
    model: MODEL_SONNET,
    max_tokens: 1024,
    system: systemPrompt(scopedFlow),
    tools: [
      {
        name: "ask_followup",
        description:
          "Ask the client one or two more questions. Use this on every turn until every schema field has either a confirmed value or an explicit 'don't know' from the client.",
        input_schema: ASK_TOOL_SCHEMA as unknown as Anthropic.Tool["input_schema"],
      },
      {
        name: "finalize_interview",
        description:
          "Call this ONCE when every schema field has been confirmed or explicitly marked missing by the client. Package the per-field values. Never call this with a value the client did not confirm.",
        input_schema: finalizeToolSchema(scopedFlow, focusFieldKeys) as Anthropic.Tool["input_schema"],
      },
    ],
    // Let the model choose which tool to call per turn.
    tool_choice: { type: "any" },
    messages: transcript.map((m) => ({ role: m.role, content: m.content })),
  });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(
      "Model did not return a tool call (stop_reason=" + response.stop_reason + ").",
    );
  }

  if (toolUse.name === "ask_followup") {
    const input = toolUse.input as { question?: unknown };
    const q = typeof input.question === "string" ? input.question.trim() : "";
    if (!q) throw new Error("Model returned an empty follow-up question.");
    return { kind: "ask", assistant: q };
  }

  if (toolUse.name === "finalize_interview") {
    const input = toolUse.input as Record<string, unknown>;
    const overallConfidence =
      (input.overallConfidence as ExtractionConfidence) ?? "missing";
    const documentType =
      (input.documentType as string) ?? scopedFlow.resultLabel;
    const fields: Record<string, ExtractedField> = {};
    for (const spec of scopedFlow.fields) {
      const raw = input[spec.key] as
        | { value?: unknown; confidence?: unknown; note?: unknown }
        | undefined;
      if (!raw) {
        // Should not happen because the schema marks every field
        // required, but defensive: mark missing rather than throwing.
        fields[spec.key] = {
          value: null,
          confidence: "missing",
          note: "Not asked.",
        };
        continue;
      }
      const confidence = normalizeInterviewConfidence(raw.confidence);
      fields[spec.key] = {
        value: confidence === "missing" ? null : coerceValue(raw.value),
        confidence,
        note:
          typeof raw.note === "string" && raw.note.trim().length > 0
            ? raw.note.trim()
            : (confidence === "missing"
                ? "Client did not know."
                : "Confirmed by client."),
      };
    }
    return { kind: "done", fields, overallConfidence, documentType };
  }

  throw new Error("Model called an unknown tool: " + toolUse.name);
}

// Helpers ---------------------------------------------------------------

function normalizeInterviewConfidence(raw: unknown): ExtractionConfidence {
  if (raw === "high" || raw === "medium" || raw === "missing") return raw;
  // The model is forbidden from using 'low' in interview mode (ask one
  // more question or mark missing instead). Any slip-up is coerced to
  // 'missing' so a weak answer is never silently applied.
  return "missing";
}

function coerceValue(raw: unknown): string | number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  return null;
}

// Convenience type for the committed extraction shape, exported so
// server actions can keep their signatures narrow.
export type FinalizedInterview = Extract<InterviewTurnResult, { kind: "done" }>;

export function toExtractionResult(final: FinalizedInterview): ExtractionResult {
  return {
    fields: final.fields,
    overallConfidence: final.overallConfidence,
    documentType: final.documentType,
    rawJson: final.fields,
  };
}
