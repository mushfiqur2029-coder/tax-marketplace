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
  "PCH-23": { mode: "skip", title: "Signed approval of draft accounts", prompt: "" },

  // Phase 6 Slice 1: PCH-24 moves from skip to a full vision pass.
  // We read the printed name, DOB, and address off the ID and write
  // them straight into pch_cases head columns via SLOT_APPLY_MAPS. The
  // client confirms or edits each extracted value in the review UI;
  // UTR and NI are collected separately on the identity card (they are
  // not on either document).
  "PCH-24": {
    mode: "extract",
    title: "Photo ID (passport or driving licence)",
    prompt:
      "This is a UK Photo ID uploaded for anti-money-laundering + personal-data capture. Extract the holder's printed name, date of birth, residential address, and postcode. For a UK driving licence the address is on the front; for a passport there is no address, mark it missing. Return the document type exactly as 'UK passport' or 'UK driving licence'; anything else sets overallConfidence='low' so the client is prompted to re-upload.",
    toolName: "extract_photo_id",
    toolDescription: "Extract name, DOB, address, postcode from a UK Photo ID.",
    model: MODEL_SONNET,
    schema: schemaWith(
      {
        documentNumber: fieldSchema(
          "Passport number or driving-licence number as printed. Keep spaces and punctuation as shown.",
        ),
        fullName: fieldSchema(
          "Holder's full name as printed. Preserve middle names and any suffix.",
        ),
        dateOfBirth: fieldSchema(
          "Date of birth, yyyy-mm-dd. UK driving licences print it as DD-MM-YYYY on the front; convert.",
        ),
        address: fieldSchema(
          "Residential address lines joined by commas, excluding the postcode (which goes in its own field). UK driving licence shows this on the front. Passports do not carry an address; mark missing.",
        ),
        postcode: fieldSchema(
          "UK postcode as printed, uppercase, one space between the outward and inward parts (e.g. 'SW1A 2AA'). Missing on passports.",
        ),
      },
      [
        "documentNumber",
        "fullName",
        "dateOfBirth",
        "address",
        "postcode",
      ],
    ),
  },
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
