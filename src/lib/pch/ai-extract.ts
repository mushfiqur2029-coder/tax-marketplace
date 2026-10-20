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

// Caller-supplied context for the extraction run. Lets per-case
// metadata (e.g. the client's up-front "passport vs licence" choice and
// which side of a licence we're currently reading) flow into the slot
// prompt without baking the branching into the generic SlotDefinition
// shape.
export type ExtractionContext = {
  idKind?: "passport" | "licence";
  idSide?: "front" | "back";
};

type SlotDefinition = {
  mode: SlotExtractionMode;
  title: string;
  // Either a static prompt string, or a factory that builds a prompt
  // from the per-case context. Slots that don't need context stay on
  // the static form.
  prompt: string | ((ctx: ExtractionContext) => string);
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

  // Phase 6 Slice 1 / Phase 8 Slice 8.3: PCH-24 is a full vision pass.
  // The client declares up-front whether they have a passport or a UK
  // driving licence, and licence uploads are split into Front and Back.
  // The prompt is generated per-image from that context so the model
  // knows exactly which fields to expect (DOB on licence back, address
  // on licence front, both on passport data page).
  "PCH-24": {
    mode: "extract",
    title: "Photo ID (passport or driving licence)",
    prompt: (ctx) => photoIdPrompt(ctx),
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
  ctx: ExtractionContext = {},
): Promise<ExtractionResult | null> {
  const def = SLOT_DEFINITIONS[slotCode];
  if (!def) throw new Error("Unknown slot code: " + slotCode);
  if (def.mode === "skip") return null;
  if (!def.schema || !def.toolName) {
    throw new Error("Slot " + slotCode + " is not configured for AI extraction.");
  }
  return runExtraction(def, doc, ctx);
}

async function runExtraction(
  def: SlotDefinition,
  doc: DocumentInput,
  ctx: ExtractionContext,
): Promise<ExtractionResult> {
  const anthropic = client();
  const base64 = Buffer.from(doc.bytes).toString("base64");

  const docContent: Anthropic.ContentBlockParam =
    doc.mimeType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: doc.mimeType, data: base64 } };

  const prompt = typeof def.prompt === "function" ? def.prompt(ctx) : def.prompt;
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
        content: [docContent, { type: "text", text: prompt }],
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

// -------------------------------------------------------------------
// PCH-24 prompt factory. The client picks passport vs licence up-front
// on the identity card, and licence uploads are split into Front/Back,
// so we always know what the model is looking at. Tell it exactly which
// fields to expect and which must be reported missing (DOB on licence
// front, address on licence back and passport, etc.) so a legitimate
// absent field isn't downgraded as "low confidence".
// -------------------------------------------------------------------
function photoIdPrompt(ctx: ExtractionContext): string {
  const base =
    "This is a UK Photo ID uploaded for anti-money-laundering + personal-data capture. " +
    "Return the document type exactly as 'UK passport' or 'UK driving licence' (front or back as applicable); " +
    "anything else sets overallConfidence='low' so the client is prompted to re-upload. " +
    "Dates must be returned as yyyy-mm-dd; UK driving licences print DOB as DD-MM-YYYY, convert. " +
    "UK postcodes must be returned uppercase with one space between the outward and inward parts (e.g. 'SW1A 2AA').";

  if (ctx.idKind === "passport") {
    return (
      base +
      " This image should be the passport data (photo) page. Extract the printed full name " +
      "(preserving middle names and suffixes), date of birth, and the passport number as documentNumber. " +
      "Passports do not carry a residential address: set address and postcode to null with confidence='missing' " +
      "and a short note explaining they aren't printed on passports."
    );
  }
  if (ctx.idKind === "licence" && ctx.idSide === "front") {
    return (
      base +
      " This image should be the FRONT of a UK driving licence. The front shows the holder's full name, " +
      "date of birth, and the driver number printed under field 5 (return it as documentNumber). " +
      "The residential address is on the BACK of the licence, not here: set address and postcode to null with " +
      "confidence='missing' and a note explaining they live on the back of the card."
    );
  }
  if (ctx.idKind === "licence" && ctx.idSide === "back") {
    return (
      base +
      " This image should be the BACK of a UK driving licence. The back shows the residential address " +
      "(extract the address lines joined by commas, excluding the postcode which goes in its own field, " +
      "and the postcode itself). The driver's printed name and date of birth are on the FRONT of the licence, " +
      "not here: set fullName and dateOfBirth to null with confidence='missing' and a note explaining they " +
      "live on the front of the card. The driver number printed as documentNumber is on the front; mark it missing too."
    );
  }

  // No kind declared yet (legacy upload path before the 8.3 split).
  // Fall back to the pre-8.3 generic prompt so single-document uploads
  // still work.
  return (
    base +
    " Extract the holder's printed name, date of birth, residential address, and postcode. " +
    "For a UK driving licence the address is on the front; for a passport there is no address, mark it missing."
  );
}
