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

  // -----------------------------------------------------------------
  // Slice 6: the "PROFILE" flow replaces the raw Tab 1 form.
  //
  // Collects the handful of fields that cannot come from a document
  // extraction and are not already captured during registration:
  //   DOB, UTR, NI number, licensing authority, marriage allowance,
  //   personal pension (net), Gift Aid (net).
  //
  // The opener in this entry is a boilerplate fallback. The profile
  // start action overrides it with a context-aware opener that lists
  // the fields already captured and the fields still missing.
  // -----------------------------------------------------------------
  PROFILE: {
    slotCode: "PROFILE",
    title: "Personal profile completion",
    resultLabel: "AI interview: personal profile",
    opener:
      "Let's walk through the handful of personal details we still need. I'll ask one or two at a time.",
    fields: [
      {
        key: "cl_dob",
        label: "Date of birth",
        description:
          "Client's date of birth, yyyy-mm-dd. Required for HMRC Self Assessment. Confirm the exact date the client states; do not assume.",
      },
      {
        key: "cl_utr",
        label: "UTR",
        description:
          "10-digit HMRC Unique Taxpayer Reference. If the client doesn't have one, mark missing and the accountant will chase it; do not fabricate.",
      },
      {
        key: "cl_nino",
        label: "National Insurance number",
        description:
          "Format: 2 letters, 6 digits, 1 letter (e.g. AB123456C). If the client doesn't remember, mark missing.",
      },
      {
        key: "cl_licensing_authority",
        label: "Licensing authority",
        description:
          "Who issued the client's private-hire licence (TfL, Birmingham City Council, Manchester City Council, etc.).",
      },
      {
        key: "marriage_allowance_status",
        label: "Marriage Allowance",
        description:
          "Exactly one of 'None', 'Transferring' (giving part of their allowance to a spouse), or 'Receiving' (getting part from a spouse). Default to 'None' if the client doesn't know.",
      },
      {
        key: "personal_pension_net_pound",
        label: "Personal pension (net)",
        description:
          "Amount paid into a personal (private) pension in the tax year, NET of basic-rate relief at source. GBP numeric. Zero if none.",
      },
      {
        key: "gift_aid_net_pound",
        label: "Gift Aid (net)",
        description:
          "Amount given to charity under Gift Aid in the tax year. GBP numeric. Zero if none.",
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

// Keys the PROFILE flow collects. Exposed as a const so server actions
// and the profile panel share one source of truth for "which pch_cases
// columns are AI-interview candidates".
export const PROFILE_INTERVIEW_FIELD_KEYS = [
  "cl_dob",
  "cl_utr",
  "cl_nino",
  "cl_licensing_authority",
  "marriage_allowance_status",
  "personal_pension_net_pound",
  "gift_aid_net_pound",
] as const;

export type ProfileInterviewFieldKey = (typeof PROFILE_INTERVIEW_FIELD_KEYS)[number];

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
