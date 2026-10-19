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
  "PCH-01": {
    slotCode: "PCH-01",
    title: "Platform annual tax summary",
    resultLabel: "AI interview: platform annual income reconstruction",
    opener:
      "No worries, we can walk through your platform income together. " +
      "First, which app did you drive on the most this tax year " +
      "(6 April 2025 to 5 April 2026)? Uber, Bolt, FreeNow, Addison Lee, or something else?",
    fields: [
      {
        key: "platform",
        label: "Platform name",
        description:
          "The ride-hailing platform the driver used (Uber, Bolt, FreeNow, Addison Lee, etc.). If they used multiple, take the primary one.",
      },
      {
        key: "periodFrom",
        label: "Period start",
        description:
          "Start of the tax year this covers, yyyy-mm-dd. For UK Self Assessment this is almost always 2025-04-06.",
      },
      {
        key: "periodTo",
        label: "Period end",
        description:
          "End of the tax year, yyyy-mm-dd. Almost always 2026-04-05.",
      },
      {
        key: "grossFares",
        label: "Gross fares",
        description:
          "Total gross fares in GBP for the tax year BEFORE platform commission or booking fees are deducted. Numeric only.",
      },
      {
        key: "platformFees",
        label: "Platform fees",
        description:
          "Total platform commission + booking fees for the tax year, GBP. Numeric only. If the client only knows the net amount they received, ask for both the net and gross so we can compute the fee as (gross - net).",
      },
      {
        key: "onTripMiles",
        label: "On-trip miles",
        description:
          "Total miles with a passenger on board, integer. If the client doesn't know, ask whether they have an MOT history or Uber monthly summary; if neither, mark missing.",
      },
      {
        key: "deadMiles",
        label: "Dead miles",
        description:
          "Dead / between-trip miles. Integer. Often unknown; it's fine to mark missing if the client has no way to estimate reliably.",
      },
    ],
  },

  "PCH-02": {
    slotCode: "PCH-02",
    title: "Weekly or monthly platform statements",
    resultLabel: "AI interview: aggregated weekly or monthly platform income",
    opener:
      "No problem, we can rebuild the year from what you remember. " +
      "First, which app were these statements from (Uber, Bolt, FreeNow, Addison Lee, something else)? " +
      "And were you looking at weekly statements or monthly ones?",
    // Deliberately NO per-week `rows` field here: asking a client to recite
    // per-week numbers in chat would be miserable and if they had that
    // granularity they'd be uploading the statements themselves. We only
    // collect the aggregates the apply-map actually writes, plus the
    // period dates for context in the review UI.
    fields: [
      {
        key: "platform",
        label: "Platform name",
        description:
          "The ride-hailing platform (Uber, Bolt, FreeNow, Addison Lee, etc.). Primary platform if multiple.",
      },
      {
        key: "aggregateFrom",
        label: "Earliest statement date",
        description:
          "The earliest statement date the client has to hand, yyyy-mm-dd. If they only remember the tax year, 2025-04-06 is the standard start.",
      },
      {
        key: "aggregateTo",
        label: "Latest statement date",
        description:
          "The latest statement date, yyyy-mm-dd. 2026-04-05 if they covered the full tax year.",
      },
      {
        key: "aggregateGrossFares",
        label: "Total gross fares",
        description:
          "Sum of gross fares across all statements in the period, GBP, BEFORE platform fees. If they only know a weekly or monthly figure, ask them to confirm it covers the whole period before you record a total.",
      },
      {
        key: "aggregatePlatformFees",
        label: "Total platform fees",
        description:
          "Sum of commission + booking fees across the period, GBP. Same net-vs-gross guidance as PCH-01: if the client only knows net income, work out fees from (gross - net) with their confirmation.",
      },
      {
        key: "aggregateOnTripMiles",
        label: "Total on-trip miles",
        description:
          "Sum of on-trip miles across the period, integer. Often unknown from statements; it's fine to mark missing.",
      },
    ],
  },

  "PCH-03": {
    slotCode: "PCH-03",
    title: "Cash and account-work log",
    resultLabel: "AI interview: cash and off-app income",
    opener:
      "No worries, we can capture your cash and account work in a short chat. " +
      "Roughly how much cash or account-work income did you take during the tax year " +
      "(6 April 2025 to 5 April 2026) that didn't go through a ride-hailing app?",
    // Same reasoning as PCH-02: skip the per-entry `rows` array; collect
    // the aggregate and the period context. Cash income is often the one
    // area where clients only have a rough number from memory; the system
    // prompt still forbids rounding without confirmation.
    fields: [
      {
        key: "aggregateGrossIncome",
        label: "Total cash and account-work income",
        description:
          "Total gross cash + off-app account-work income across the tax year, GBP. Must be a figure the client confirms, not a guess. If they can only estimate within a wide range, mark missing and move on.",
      },
      {
        key: "periodFrom",
        label: "Period from",
        description:
          "Earliest date their cash work started in the tax year, yyyy-mm-dd. Default to 2025-04-06 if they drove all year.",
      },
      {
        key: "periodTo",
        label: "Period to",
        description:
          "Latest date in the period, yyyy-mm-dd. Default to 2026-04-05 if they drove all year.",
      },
    ],
  },

  // Phase 6 Slice 1 removed the PROFILE flow (DOB/UTR/NI/licensing/
  // MA/pension/Gift Aid). DOB + address now come from the Photo ID
  // vision pass (PCH-24); UTR + NI are collected on a compact manual
  // card next to the ID upload; the other reliefs are deferred to the
  // bank-statement AI pass + accountant confirmation.

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
