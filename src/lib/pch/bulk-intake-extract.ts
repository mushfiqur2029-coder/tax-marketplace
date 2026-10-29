import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  EXPENSE_FIXED_SLOTS,
  INCOME_FIXED_SLOTS,
} from "./intake-slots";

// Phase B of the PCH intake redesign: pull every distinct
// transaction / line item out of a client-uploaded bank statement,
// receipt or invoice and classify each as income or expense,
// against the same fixed-slot taxonomy the manual grid uses.
//
// Deliberately separate from ai-extract.ts (the ID-document pipeline
// for PCH-24). That file is one-shot schema extraction - one document
// per fixed field set. This file is many-rows-per-document, so the
// tool schema is a bounded array and the system prompt lists every
// slot label as the only valid value for suggestedSlot when the
// model is confident.
//
// Single tool-use call per document, model forced to call the tool.
// If stop_reason indicates truncation (max_tokens hit) or no
// tool_use block comes back, throw a clear "too many lines, split
// the file" error - do NOT silently return a partial list.

const MODEL_SONNET = "claude-sonnet-4-6";
const MAX_TOKENS = 8192;
const MAX_ITEMS = 300;

export type BulkExtractedItem = {
  kind: "income" | "expense";
  // Free-text description, e.g. "Tesco fuel" or "Parking fine - TfL".
  label: string;
  // Must exactly match a label from INCOME_FIXED_SLOTS or
  // EXPENSE_FIXED_SLOTS if confident, else null.
  suggestedSlot: string | null;
  // True when this line is clearly not related to the driver's
  // taxi work (a personal transfer, a non-driving subscription, an
  // unrelated salary credit). Only meaningful when suggestedSlot is
  // null; ignored otherwise. Used by the review UI to route the
  // line into a collapsed "Skipped as personal" tray instead of the
  // main review list.
  likelyPersonal: boolean;
  amountPounds: number;
  // yyyy-mm-dd if visible on the document.
  date: string | null;
  confidence: "high" | "medium" | "low";
  // One sentence pointer, e.g. "Line 14 of statement, 12 Apr".
  note: string;
};

export type BulkIntakeDocument = {
  bytes: Uint8Array;
  mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
};

export type BulkExtractionResult = {
  items: BulkExtractedItem[];
  documentSummary: string;
};

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Bulk intake extraction is disabled.",
    );
  }
  return new Anthropic({ apiKey });
}

// Slot label lists for the system prompt. These must stay in sync
// with the taxonomy in intake-slots.ts: using the shared arrays
// directly means a new slot is picked up automatically with no
// prompt rewrite needed. "Other income" / "Other expense" are
// deliberately NOT suggestedSlot candidates: those are catch-all
// buckets, and the model should set suggestedSlot=null for anything
// that doesn't match a specific labelled slot (so the UI shows it
// as a visible, individually-editable extra row rather than silently
// rolling it into the "Other" fixed slot).
const INCOME_SLOT_LABELS = INCOME_FIXED_SLOTS
  .map((s) => s.label)
  .filter((l) => l !== "Others income");
const EXPENSE_SLOT_LABELS = EXPENSE_FIXED_SLOTS
  .map((s) => s.label)
  .filter((l) => l !== "Other expense");

const TOOL_NAME = "report_lines";
const TOOL_SCHEMA = {
  type: "object",
  properties: {
    documentSummary: {
      type: "string",
      description:
        "One line describing what this document is, e.g. 'Barclays current account statement, April 2024' or 'Shell petrol receipt, 12 Apr'. Used to confirm the model actually read the file.",
    },
    items: {
      type: "array",
      maxItems: MAX_ITEMS,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["income", "expense"] },
          label: {
            type: "string",
            description:
              "Short free-text description of this one transaction, e.g. 'Tesco fuel' or 'Uber payout week 14'. Keep under 80 characters.",
          },
          suggestedSlot: {
            type: ["string", "null"],
            description:
              "Exact match of one of the fixed slot labels listed in the system prompt, OR null if this line doesn't cleanly map to one.",
          },
          likelyPersonal: {
            type: "boolean",
            description:
              "True only when this line is clearly personal and not related to the driver's taxi work (see system prompt). False whenever unsure.",
          },
          amountPounds: {
            type: "number",
            description: "Pounds (not pence), always positive. 0 or negative is a bug - skip the item instead.",
          },
          date: {
            type: ["string", "null"],
            description: "yyyy-mm-dd if visible on the document, null otherwise.",
          },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          note: {
            type: "string",
            description: "One sentence pointer back to this specific line on the document, e.g. 'Line 14 of statement, 12 Apr' or 'Total on receipt'. Under 120 characters.",
          },
        },
        required: ["kind", "label", "suggestedSlot", "likelyPersonal", "amountPounds", "confidence", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["documentSummary", "items"],
  additionalProperties: false,
};

function buildSystemPrompt(): string {
  const incomeList = INCOME_SLOT_LABELS.join(", ");
  const expenseList = EXPENSE_SLOT_LABELS.join(", ");
  return (
    "This is for a UK private-hire driver's Self Assessment. "
    + "The attached document is a bank statement, receipt, invoice or similar supporting document the driver has uploaded for their tax return. "
    + "Read every distinct transaction / line on the document. "
    + "For a multi-page bank statement that means every row, not just a summary total. "
    + "Treat near-identical consecutive entries as separate transactions unless clearly a duplicate scan of the same page. "
    + "\n\n"
    + "For each line, decide if it's income or an expense from the driver's perspective (fares paid in, deposits from platforms = income; costs they paid out, including subscriptions, running costs and fees = expense), "
    + "and set the suggestedSlot field as follows: "
    + "\n\n"
    + "If a line clearly matches one of these income categories: "
    + incomeList
    + ". Or one of these expense categories: "
    + expenseList
    + ". Set suggestedSlot to that EXACT label (case-sensitive, no paraphrasing). "
    + "\n\n"
    + "Otherwise set suggestedSlot to null and describe the line plainly in the label field; the client will see it as its own editable row and can decide what to do with it. "
    + "\n\n"
    + "When suggestedSlot is null, also set likelyPersonal. Set likelyPersonal to true only when the line is clearly not related to the driver's taxi work: a transfer to or from a named individual with no fuel, platform, repair or business keyword, a subscription unrelated to driving (for example Apple, Netflix or Spotify), a salary or wages credit from an employer that is not a private hire platform, or a cash deposit with no stated business purpose. Set likelyPersonal to false for anything you are not confident is personal, anything with a plausible business purpose, or any larger amount where guessing wrong would hide a real cost or fare from the tax return. When genuinely unsure, prefer false so the driver sees the line rather than it being hidden. When suggestedSlot is NOT null, set likelyPersonal to false. "
    + "\n\n"
    + "amountPounds is always a positive number in pounds (not pence). "
    + "Skip any transaction where you can't read a clear amount, rather than guessing a value or returning 0. "
    + "\n\n"
    + "Report confidence honestly: 'high' only when both the amount AND the category are clearly stated on the line itself; 'medium' when one of the two is inferred; 'low' when either is a judgement call. "
    + "If the uploaded file isn't a legible financial document at all, return items: [] and set documentSummary to describe what the file actually is."
  );
}

export async function extractBulkIntakeDocument(
  doc: BulkIntakeDocument,
): Promise<BulkExtractionResult> {
  const anthropic = client();
  const base64 = Buffer.from(doc.bytes).toString("base64");

  const docContent: Anthropic.ContentBlockParam =
    doc.mimeType === "application/pdf"
      ? {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
        }
      : {
          type: "image",
          source: { type: "base64", media_type: doc.mimeType, data: base64 },
        };

  const response = await anthropic.messages.create({
    model: MODEL_SONNET,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(),
    tools: [
      {
        name: TOOL_NAME,
        description:
          "Return every distinct income or expense line visible on the uploaded document. One object per line, categorised against the fixed slot taxonomy where possible.",
        input_schema: TOOL_SCHEMA as unknown as Anthropic.Tool["input_schema"],
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          docContent,
          {
            type: "text",
            text: "List every income and expense line visible on this document for the Self Assessment return.",
          },
        ],
      },
    ],
  });

  // Truncation guard: max_tokens hit means the tool_use JSON is almost
  // certainly cut off mid-array. Rather than silently return whatever
  // the SDK managed to parse (if anything), surface a clear error so
  // the client knows to split the file.
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "Document produced too many lines to read in one pass, try splitting it into smaller files.",
    );
  }

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(
      "Document could not be read (stop_reason=" + response.stop_reason + ").",
    );
  }

  const input = toolUse.input as {
    documentSummary?: string;
    items?: BulkExtractedItem[];
  };
  const documentSummary = (input.documentSummary ?? "").trim();
  const rawItems = Array.isArray(input.items) ? input.items : [];

  // Model-side amountPounds <= 0 / non-finite / wrong-shape items are
  // dropped here as the single enforcement point before the trigger
  // tries to persist them. The trigger also skips <= 0 to match this,
  // belt and braces.
  const items: BulkExtractedItem[] = [];
  for (const r of rawItems) {
    if (!r || typeof r !== "object") continue;
    if (r.kind !== "income" && r.kind !== "expense") continue;
    const amount = Number(r.amountPounds);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const label = (r.label ?? "").toString().trim();
    if (label.length === 0) continue;
    const confidence =
      r.confidence === "high" || r.confidence === "medium" || r.confidence === "low"
        ? r.confidence
        : "low";
    const suggestedSlot =
      typeof r.suggestedSlot === "string" && r.suggestedSlot.length > 0
        ? r.suggestedSlot
        : null;
    // A matched slot is a known business category by definition, so
    // likelyPersonal is forced false regardless of what the model
    // returned for it. This enforces the prompt's own rule server
    // side rather than trusting the model to have followed it.
    const likelyPersonal = suggestedSlot === null && r.likelyPersonal === true;
    items.push({
      kind: r.kind,
      label: label.slice(0, 80),
      suggestedSlot,
      likelyPersonal,
      amountPounds: amount,
      date: typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date)
        ? r.date
        : null,
      confidence,
      note: (r.note ?? "").toString().slice(0, 120),
    });
  }

  return { items, documentSummary };
}
