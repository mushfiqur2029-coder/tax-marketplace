import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  BANK_CATEGORIES,
  isValidCategoryKey,
  type CategoryDef,
} from "./bank-categories";

// Phase 6 Slice 2: AI categorisation of parsed bank transactions.
//
// Called after bank-parse returns raw rows. Batches transactions and
// asks Claude to pick exactly one category key from BANK_CATEGORIES
// for each, with a per-row confidence and a short reason.
//
// NEVER AUTO-WRITES. The caller (bank-trigger) persists the output to
// pch_bank_transactions.category / .category_confidence / .category_note
// in a single update per batch; the aggregate pass then rolls the
// categorised rows into pch_income_lines + pch_expense_lines.
//
// Hard rule the AI operates under: if the category is unclear, pick
// "uncategorized" rather than guessing. The Slice 3 clarification chat
// will walk the client through the uncategorised rows.

export type CategorizableInput = {
  // Stable id the caller correlates to a DB row.
  id: string;
  txnDate: string | null;
  description: string;
  // Signed pence. Positive = money in, negative = money out.
  amountPence: number;
};

export type CategorizedOutput = {
  id: string;
  categoryKey: string;
  confidence: "high" | "medium" | "low" | "missing";
  note: string;
};

const MODEL = "claude-sonnet-4-6";
// Keep per-request transaction count low enough that the model's output
// fits comfortably inside max_tokens. 50 rows at ~40 output tokens each
// = ~2k tokens, well under max_tokens=4096.
const BATCH_SIZE = 50;

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Bank-transaction categorisation is disabled.",
    );
  }
  return new Anthropic({ apiKey });
}

function categoryListForPrompt(): string {
  return BANK_CATEGORIES
    .map((c: CategoryDef) => "  - " + c.key + " : " + c.label)
    .join("\n");
}

const systemPrompt = `You are a UK accountant categorising bank transactions for a private-hire driver's Self Assessment.

For every transaction you must pick EXACTLY ONE category key from the list below. Never invent a key. If the description is ambiguous and you are not confident, pick 'uncategorized' and the client will clarify in chat.

Rules:
- Only business-side rows count toward the P&L. Transfers between the client's own accounts, personal spend, HMRC payments, and fines are all 'excluded'-direction categories; still categorise them so the audit shows what was skipped.
- A single ride-hailing payout from Uber / Bolt / FreeNow / Addison Lee is 'platform_fares'. Cash paid in (round amounts, "CASH" in the description) is 'cash_fares'. Other taxable business income (airport contracts, chauffeur work) is 'other_income'.
- Fuel includes BP, Shell, Esso, Tesco Petrol, Sainsbury's Petrol, ESSO, EV charging networks (Pod Point, BP Pulse, Shell Recharge, GRIDSERVE).
- Vehicle insurance for private hire: Zego, Coverzen, Cuvva, Hastings PH, iGO4, Admiral private hire, etc.
- Transport for London = TfL licensing (if it's for driver/vehicle licence) OR tolls_parking (congestion / ULEZ).
- Fines (PCN, parking fine, speeding, bus-lane) are 'fine' (never allowable).
- Confidence: 'high' when the merchant and amount are unambiguous; 'medium' when the merchant is a plausible match but not certain; 'low' when you have a reasonable hunch; 'missing' only alongside the 'uncategorized' category.
- Per-row note: one short sentence (max 80 chars) explaining the pick. Say what in the description drove the call.

Categories:
${categoryListForPrompt()}
`;

export async function categorizeBankTransactions(
  rows: CategorizableInput[],
): Promise<CategorizedOutput[]> {
  if (rows.length === 0) return [];
  const anthropic = client();
  const results: CategorizedOutput[] = [];
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const batchResults = await categorizeBatch(anthropic, batch);
    results.push(...batchResults);
  }
  return results;
}

async function categorizeBatch(
  anthropic: Anthropic,
  batch: CategorizableInput[],
): Promise<CategorizedOutput[]> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    tools: [
      {
        name: "categorise_transactions",
        description:
          "Return the chosen category for every transaction in the input batch, in the same order.",
        input_schema: {
          type: "object",
          properties: {
            categorisations: {
              type: "array",
              description:
                "One entry per input transaction, same order. Must have the same length as the input.",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Transaction id, copy from the input." },
                  categoryKey: {
                    type: "string",
                    enum: BANK_CATEGORIES.map((c) => c.key),
                    description: "The chosen category key.",
                  },
                  confidence: {
                    type: "string",
                    enum: ["high", "medium", "low", "missing"],
                  },
                  note: {
                    type: "string",
                    description: "Max 80 chars; what in the description drove this pick.",
                  },
                },
                required: ["id", "categoryKey", "confidence", "note"],
                additionalProperties: false,
              },
            },
          },
          required: ["categorisations"],
          additionalProperties: false,
        } as unknown as Anthropic.Tool["input_schema"],
      },
    ],
    tool_choice: { type: "tool", name: "categorise_transactions" },
    messages: [
      {
        role: "user",
        content:
          "Categorise these transactions. Return one entry per input in the same order.\n\n"
          + JSON.stringify(batch, null, 2),
      },
    ],
  });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(
      "Model did not return a tool call for categorisation (stop_reason="
      + response.stop_reason + ").",
    );
  }
  const payload = toolUse.input as {
    categorisations?: Array<{
      id?: unknown;
      categoryKey?: unknown;
      confidence?: unknown;
      note?: unknown;
    }>;
  };
  const list = payload.categorisations ?? [];
  const out: CategorizedOutput[] = [];
  for (const entry of list) {
    const id = typeof entry.id === "string" ? entry.id : null;
    const key = typeof entry.categoryKey === "string" ? entry.categoryKey : null;
    const confidence = entry.confidence;
    const note = typeof entry.note === "string" ? entry.note.slice(0, 120) : "";
    if (!id || !key || !isValidCategoryKey(key)) continue;
    const normalisedConfidence: CategorizedOutput["confidence"] =
      confidence === "high" || confidence === "medium" || confidence === "low" || confidence === "missing"
        ? confidence
        : "medium";
    out.push({ id, categoryKey: key, confidence: normalisedConfidence, note });
  }
  return out;
}
