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
      "Last section: your vehicle. First question only: how is your car set up this year? Owned outright, financed (HP, PCP, loan), leased, PCO/weekly rental, or no vehicle? (If owned or financed we claim capital allowances; leased/rented just means the rent is already in your statement.)",
    fields: [
      {
        key: "status",
        label: "Vehicle status",
        description:
          "Exactly one of: 'Owned outright', 'Hire purchase', 'PCP', 'Loan', 'Leased', 'Rented', 'No vehicle'. Drives every other field below. 'PCO rental' => 'Rented'. 'Lease' => 'Leased'. ASK THIS ALONE in the first turn, since every other question depends on it.",
      },
      {
        key: "fuel",
        label: "Fuel type",
        description:
          "'Petrol' | 'Diesel' | 'Hybrid' | 'Electric' | 'PHEV'. ASK IN THE SAME TURN as make_model + registration + co2_gpkm as a batch: 'what's the make/model, reg plate, fuel type, and CO2 g/km if you know it?'. Mark missing if status is Leased/Rented/No vehicle, or if client doesn't know.",
      },
      {
        key: "make_model",
        label: "Make and model",
        description:
          "Short free text, e.g. 'Toyota Prius'. Ask with fuel + registration + CO2 as one batched question. Mark missing if status is 'No vehicle'.",
      },
      {
        key: "registration",
        label: "Registration",
        description:
          "UK number plate, uppercase, no space. Ask with make_model + fuel + CO2 as one batched question. Mark missing if 'No vehicle' or client doesn't remember.",
      },
      {
        key: "co2_gpkm",
        label: "CO2 emissions (g/km)",
        description:
          "Integer. Ask with make_model + fuel + registration as one batched question. Mark missing if client doesn't know (accountant looks it up on DVLA) or if status is Leased/Rented/No vehicle.",
      },
      {
        key: "purchase_date",
        label: "Purchase date",
        description:
          "yyyy-mm-dd. Only ask if status is Owned/HP/PCP/Loan. ASK IN THE SAME TURN as purchase_price + new_or_used + prior_year_wdv_pound as a batch: 'when did you get it, how much (total including any finance), new or used, and did you claim capital allowances last year?'. Mark missing if bought in a prior year with no remaining balance.",
      },
      {
        key: "purchase_price",
        label: "Purchase price (GBP, total)",
        description:
          "Numeric GBP total including VAT and finance balance. Ask with purchase_date + new_or_used + prior_year_wdv_pound as one batched question. Mark missing if genuinely unknown.",
      },
      {
        key: "new_or_used",
        label: "New or used",
        description:
          "'New' | 'Used'. Default to 'Used' if the client doesn't say but gives any used-car language (e.g. 'bought second-hand'). Ask with the purchase batch.",
      },
      {
        key: "business_pct_override",
        label: "Business use percentage",
        description:
          "Integer 0-100. Most PHV drivers use the car 100% for driving work. DEFAULT TO 100 and only ask if the client has already mentioned personal use. If you ask, phrase as 'do you ever use the car privately, or is it 100% for driving work?'. Mark missing only if status is 'No vehicle'.",
      },
      {
        key: "prior_year_wdv_pound",
        label: "Prior-year written-down value (GBP)",
        description:
          "GBP. Ask with the purchase batch when status is Owned/HP/PCP/Loan. Mark missing if client doesn't know (accountant pulls from SA302) or if this is their first year self-employed.",
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
      "Three quick reliefs in one go: (1) personal pension contributions this year (not workplace / payroll), total in pounds; (2) Gift Aid donations total; (3) Marriage Allowance, do you transfer or receive 10% of your spouse's allowance (or neither)? Say 'none' or 'skip' for any that don't apply.",
    fields: [
      {
        key: "personal_pension_net_gbp",
        label: "Personal pension contributions, net (GBP)",
        description:
          "Numeric GBP. Personal pension only, NOT workplace / payroll. Mark missing (not 0) if 'none' or 'don't know'. Expect all three fields in the same reply.",
      },
      {
        key: "gift_aid_net_gbp",
        label: "Gift Aid donations, net (GBP)",
        description:
          "Numeric GBP. Gift-Aided donations only. Mark missing if 'none'. Expect in the same reply.",
      },
      {
        key: "marriage_allowance_status",
        label: "Marriage Allowance status",
        description:
          "'None' | 'Transferring' | 'Receiving'. 'Transferring' = client gives 10% to lower-earning spouse. 'Receiving' = client is the lower earner. Default to 'None' if client says 'no' or 'skip'. Expect in the same reply.",
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
      "Did you drive for any platforms besides your main one this year (Bolt, FreeNow, Addison Lee, Uber Eats, Deliveroo), even with no earnings? If just one platform, say so (e.g. 'only Uber') and we're done.",
    fields: [
      {
        key: "nil_platforms_note",
        label: "Other platforms / nil activity note",
        description:
          "One short sentence listing platforms used + any with nil activity. Accountant reads verbatim. Finalise immediately on the first reply.",
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
      "Two things in one answer: (a) any costs we might have missed? (PCO rental, DBS/medical, EV road tax, breakdown cover). (b) Any of your expense figures estimates? If yes, how did you work them out? Say 'nothing missed, no estimates' if that's the case.",
    fields: [
      {
        key: "expenses_probe_note",
        label: "Expenses probe answer",
        description:
          "One or two sentences covering missed costs + estimate method. Accountant reads verbatim. Finalise on the first reply unless the client explicitly asks a follow-up.",
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
      "Did you sell, part-exchange, or scrap the car this year? If no, just say 'no' and we're done. If yes, give me the proceeds (sale price, part-ex allowance, scrap, or insurance payout) and the date in the same message.",
    fields: [
      {
        key: "disposed",
        label: "Vehicle disposed this year",
        description:
          "Exactly 'Yes' or 'No'. If 'No', finalise immediately with the other two fields missing. If 'Yes', expect proceeds + date in the same reply (or ask once).",
      },
      {
        key: "disposal_proceeds_gbp",
        label: "Disposal proceeds (GBP)",
        description:
          "Numeric GBP. Only when disposed='Yes'. Extract from the same reply if possible. If client cannot confirm exact figure, mark missing (do NOT guess; a balancing charge off a guessed number is a real tax hit).",
      },
      {
        key: "disposal_date",
        label: "Disposal date",
        description:
          "yyyy-mm-dd. Only when disposed='Yes'. Extract from the same reply if possible. Mark missing if client only remembers the month.",
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
      "Quick income capture, no bank statement needed. Two things to start: (1) which platforms did you drive for this year? (Uber, Bolt, Addison Lee, etc, name all of them). (2) What's your total gross income across all platforms for the year, BEFORE platform fees? If you only know a weekly / monthly figure, give me the average and the weeks you worked and I'll multiply it out with you.",
    fields: [
      {
        key: "platforms_summary",
        label: "Platforms used",
        description:
          "Short free text listing every platform. One sentence (e.g. 'Only Uber' or 'Uber and Bolt').",
      },
      {
        key: "total_gross_gbp",
        label: "Total gross income (GBP)",
        description:
          "Numeric GBP. Total gross across every platform BEFORE fees. If given weekly / monthly, multiply out and have the client confirm the annual figure. Confidence 'medium' for client-confirmed arithmetic. Mark missing if they cannot land on a figure.",
      },
      {
        key: "total_fees_gbp",
        label: "Total platform fees (GBP)",
        description:
          "Numeric GBP. Total service fees across the year. Ask in the same turn as total_on_trip_miles ('and your platform fees + on-trip miles for the year?'). Mark missing if they don't track fees separately.",
      },
      {
        key: "total_on_trip_miles",
        label: "Total on-trip miles",
        description:
          "Integer miles. Business miles ON TRIP (passenger in car), not dead miles. Ask in the same turn as total_fees_gbp. Weekly average x weeks worked is fine. Mark missing if genuinely unknown.",
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
      "Quick walkthrough of your business expenses. Give me an annual total for each category you have, say 'none' or 'skip' for any that don't apply. Let's do three at once: (1) phone and data for the year (business portion only), (2) vehicle cleaning / valeting, (3) congestion, ULEZ and parking (not fines). What are those three?",
    fields: [
      {
        key: "phone_data_gbp",
        label: "Phone and data, annual business portion (GBP)",
        description:
          "Numeric GBP. Annual spend on mobile + data, business portion only. If monthly, multiply out and confirm. Mark missing if 'none' or 'don't know'.",
      },
      {
        key: "cleaning_gbp",
        label: "Vehicle cleaning / valeting, annual (GBP)",
        description:
          "Numeric GBP. Annual spend on vehicle cleaning. Mark missing if 'none' or 'don't know'.",
      },
      {
        key: "parking_tolls_gbp",
        label: "Congestion, ULEZ, parking, annual (GBP)",
        description:
          "Numeric GBP. Annual legitimate parking + congestion / ULEZ. Fines and PCNs NOT claimable. Mark missing if 'none' or 'don't know'.",
      },
      {
        key: "insurance_gbp",
        label: "Insurance, annual (GBP)",
        description:
          "Numeric GBP. Annual vehicle insurance (hire + reward is typical PHV). Ask this in the SAME turn as subs_fees_gbp and other_business_gbp, as a mini-list: 'insurance, licences/subscriptions, and anything else?' Mark missing if 'none' or 'don't know'.",
      },
      {
        key: "subs_fees_gbp",
        label: "Licences and subscriptions, annual (GBP)",
        description:
          "Numeric GBP. Annual total for PHV driver licence, DBS, medical, breakdown, trade body subs. Ask in the same turn as insurance_gbp. Mark missing if 'none' or 'don't know'.",
      },
      {
        key: "other_business_gbp",
        label: "Any other allowable business cost, annual (GBP)",
        description:
          "Numeric GBP. One figure for anything else business-related. Ask in the same turn as insurance_gbp. If the client says 'nothing else', mark missing and skip other_business_label too. If they give a figure, ask them to name it in the same message (e.g. 'and what was that for?').",
      },
      {
        key: "other_business_label",
        label: "What was the 'other' cost?",
        description:
          "Short free text naming the 'other' cost (e.g. 'Dashcam'). Mark missing when other_business_gbp is missing or 0. When other_business_gbp > 0, you can usually extract the label from the same reply (e.g. 'about £120 on a dashcam' => value=120, label='Dashcam'); only ask again if the client gave a figure without naming it.",
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
      "If HMRC refunds you this year, whose bank account should it go to? Just give me the name on the account (yours, a spouse, or a nominee). No sort codes or account numbers.",
    fields: [
      {
        key: "repayment_account_name",
        label: "Repayment account holder name",
        description:
          "Full name on the UK bank account. One line, no account numbers. Finalise on first reply.",
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
    "You are a friendly UK accountant helping a private-hire driver fill their Self Assessment in a short chat. Drivers are busy, often replying on a phone between jobs; make every turn earn its keep.",
    "",
    "RULES, non-negotiable:",
    "1. Never invent, estimate, or round up a figure the client did not explicitly confirm. If the client doesn't know, that field is 'missing' and null; do not guess.",
    "2. BATCH questions aggressively. Ask multiple linked fields in ONE turn whenever that reads naturally (e.g. 'make, model and reg?' as one sentence; 'phone, cleaning, and parking totals?' as a mini-list). Do NOT ask one field per turn when the client could answer three in the same breath. The goal is the fewest turns possible.",
    "3. Skip anything you can safely default or infer. If a field has an obvious default stated in its description, use the default without asking. If one answer makes another field N/A (e.g. 'no vehicle' makes fuel type irrelevant), mark the dependent field missing and move on.",
    "4. Do not ask for things we already have. Scan the whole transcript before asking.",
    "5. Only numeric values go into numeric fields. If the client says 'about forty-eight grand', ask them to confirm the exact figure or say 'I don't know' before you record it.",
    "6. Confirm with a quick single-line summary at the end before finalising, not by repeating each field. One line, like 'Got it, saving your answers now.' Then finalise.",
    "7. End as soon as every field has either a confirmed value or a 'missing' marker from the client. Do NOT keep going for the sake of it.",
    "",
    "You have exactly two tools. Pick one every turn:",
    "- `ask_followup`: continue the conversation. Batch as many fields as you can in one message.",
    "- `finalize_interview`: all fields collected (confirmed or missing, or inferred default). Package into the per-field schema.",
    "",
    "Field schema you must fill when calling `finalize_interview`:",
    fieldList,
    "",
    "For every field use the standard shape: { value, confidence, note }.",
    "  value: the number or string the client told you. Numbers unquoted. null when the client said they didn't know.",
    "  confidence: 'high' when the client stated the exact figure; 'medium' when derived from arithmetic the client confirmed (e.g. gross minus net = fees) OR when you applied a stated default without the client objecting; 'missing' when the client said 'I don't know' or the field is not applicable. Never 'low'; if you'd want 'low', ask one more question or mark it missing.",
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
