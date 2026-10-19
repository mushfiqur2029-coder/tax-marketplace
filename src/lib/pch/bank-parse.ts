import "server-only";
import * as XLSX from "xlsx";
import Anthropic from "@anthropic-ai/sdk";

// Phase 6 Slice 2: parse a client-uploaded bank statement into a flat
// list of transactions. Three input routes:
//
//   PDF  -> Claude vision call with a tool-use schema returning rows.
//   CSV  -> native parse; column detection by header name OR position.
//   XLSX -> same as CSV via the `xlsx` library's sheet_to_json output.
//
// Returned shape is deliberately raw: date, description, amount in
// pence (signed; positive = money in). Categorisation + aggregation
// happen in later stages. If a field cannot be read (missing header,
// garbled row, etc.) the row is skipped rather than guessed; the AI
// categoriser will only run against clean rows.

export type RawTransaction = {
  txnDate: string | null;      // yyyy-mm-dd when parseable, else null
  description: string;         // raw text, trimmed
  amountPence: number;         // signed integer; +in / -out
  balancePence: number | null; // running balance if the statement provides it
};

export type ParseResult = {
  transactions: RawTransaction[];
  // One-line note on what the parser did (e.g. "Parsed 72 rows from
  // XLSX sheet 'Statement'"), surfaced in the UI + stored on the
  // parent extraction row for audit.
  note: string;
  // Low-signal flag so the caller can decide whether to retry via a
  // different route (e.g. PDF via vision if XLSX had zero rows).
  warnings: string[];
};

export type BankInput = {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
};

// ---------- public entry point ----------------------------------------

export async function parseBankStatement(input: BankInput): Promise<ParseResult> {
  const mt = (input.mimeType || "").toLowerCase();
  const name = (input.fileName || "").toLowerCase();
  if (mt.includes("csv") || name.endsWith(".csv")) {
    return parseCsv(input);
  }
  if (
    mt.includes("spreadsheet")
    || mt.includes("excel")
    || name.endsWith(".xlsx")
    || name.endsWith(".xls")
  ) {
    return parseXlsx(input);
  }
  if (mt === "application/pdf" || name.endsWith(".pdf")) {
    return parsePdf(input);
  }
  // Phase 7 Slice 7.1: a photo of a paper statement goes through the
  // same Claude vision tool-use as PDFs. HEIC is rejected explicitly
  // because Anthropic's API accepts JPEG/PNG/WebP only; we handle that
  // at the server-action layer with a clear re-export message, but the
  // guard below is a defensive second line (if a client somehow bypasses
  // the UI, they get the error here instead of a cryptic 400 from the model).
  if (/\.heic$/i.test(name) || mt === "image/heic" || mt === "image/heif") {
    throw new Error(
      "HEIC isn't supported for bank statements. Change your iPhone's Camera > Formats to 'Most Compatible', or export the photo as JPEG and re-upload.",
    );
  }
  if (
    mt === "image/jpeg" || mt === "image/png" || mt === "image/webp"
    || /\.(jpe?g|png|webp)$/.test(name)
  ) {
    return parseImage(input);
  }
  throw new Error(
    "Unsupported bank statement format: " + (input.mimeType || "unknown"),
  );
}

// ---------- CSV -------------------------------------------------------

function parseCsv(input: BankInput): ParseResult {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(input.bytes);
  const rows = splitCsvRows(text);
  if (rows.length === 0) {
    return { transactions: [], note: "CSV was empty.", warnings: ["csv-empty"] };
  }
  const header = rows[0].map((c) => c.trim());
  const idx = detectColumns(header);
  const warnings: string[] = [];
  const parsed: RawTransaction[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 0 || r.every((c) => c.trim().length === 0)) continue;
    const txn = rowToTransaction(r, idx);
    if (!txn) {
      warnings.push("row-" + i + "-unparseable");
      continue;
    }
    parsed.push(txn);
  }
  return {
    transactions: parsed,
    note: `Parsed ${parsed.length} rows from CSV.`,
    warnings,
  };
}

// Minimal RFC-4180-ish CSV splitter. Handles double-quoted fields with
// embedded commas and escaped quotes. Deliberately simple; banks that
// hand out exotic CSVs may need a dedicated adapter.
function splitCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { cur.push(field); field = ""; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

// Detects which columns hold which fields. Supports the common UK bank
// header conventions (Lloyds, Barclays, HSBC, Starling, Monzo CSV exports).
type ColumnMap = {
  date: number;
  description: number;
  debit: number | null;   // "Money out" column, positive when present
  credit: number | null;  // "Money in" column, positive when present
  amount: number | null;  // combined column, signed
  balance: number | null;
};

function detectColumns(header: string[]): ColumnMap {
  const lower = header.map((h) => h.toLowerCase().trim());
  const find = (patterns: string[]): number =>
    lower.findIndex((h) => patterns.some((p) => h === p || h.includes(p)));
  return {
    date: find(["transaction date", "date", "posted date", "posting date"]),
    description:
      find(["description", "details", "narrative", "reference", "payee", "transaction description"]),
    debit: nullIfNegative(find(["debit", "money out", "out", "paid out", "withdrawal"])),
    credit: nullIfNegative(find(["credit", "money in", "in", "paid in", "deposit"])),
    amount: nullIfNegative(find(["amount", "value", "transaction amount"])),
    balance: nullIfNegative(find(["balance", "running balance"])),
  };
}

function nullIfNegative(i: number): number | null {
  return i < 0 ? null : i;
}

function rowToTransaction(row: string[], idx: ColumnMap): RawTransaction | null {
  const dateRaw = idx.date >= 0 ? row[idx.date] ?? "" : "";
  const descRaw = idx.description >= 0 ? row[idx.description] ?? "" : "";
  const description = descRaw.trim();
  if (description.length === 0) return null;

  let amountPence = 0;
  if (idx.amount != null) {
    const n = parseAmount(row[idx.amount] ?? "");
    if (n === null) return null;
    amountPence = n;
  } else {
    const debit = idx.debit != null ? parseAmount(row[idx.debit] ?? "") : null;
    const credit = idx.credit != null ? parseAmount(row[idx.credit] ?? "") : null;
    if (debit == null && credit == null) return null;
    amountPence = (credit ?? 0) - (debit ?? 0);
  }
  if (amountPence === 0) return null;

  const balancePence = idx.balance != null ? parseAmount(row[idx.balance] ?? "") : null;

  return {
    txnDate: parseDate(dateRaw),
    description,
    amountPence,
    balancePence: balancePence ?? null,
  };
}

// ---------- XLSX -----------------------------------------------------

function parseXlsx(input: BankInput): ParseResult {
  const wb = XLSX.read(input.bytes, { type: "array", cellDates: true });
  if (wb.SheetNames.length === 0) {
    return { transactions: [], note: "Workbook had no sheets.", warnings: ["xlsx-empty"] };
  }
  // Prefer the first sheet. Multi-sheet statements are rare; if we hit
  // one, Slice 3's UI can prompt the client to re-export.
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
  if (rows.length === 0) {
    return {
      transactions: [],
      note: "XLSX sheet '" + wb.SheetNames[0] + "' had no rows.",
      warnings: ["xlsx-no-rows"],
    };
  }
  const headers = Object.keys(rows[0]);
  const idx = detectColumns(headers);
  const warnings: string[] = [];
  const parsed: RawTransaction[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const asArray = headers.map((h) => String(r[h] ?? ""));
    const txn = rowToTransaction(asArray, idx);
    if (!txn) {
      warnings.push("row-" + i + "-unparseable");
      continue;
    }
    parsed.push(txn);
  }
  return {
    transactions: parsed,
    note: `Parsed ${parsed.length} rows from XLSX sheet '${wb.SheetNames[0]}'.`,
    warnings,
  };
}

// ---------- PDF (Claude vision) --------------------------------------

const PDF_PARSE_MODEL = "claude-sonnet-4-6";

function anthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Bank PDF parsing is disabled.");
  }
  return new Anthropic({ apiKey });
}

// Tool-use schema shared by parsePdf and parseImage. Pulled out so both
// vision paths describe their expected output identically; keeps the
// server-side acceptance surface narrow.
const RETURN_TRANSACTIONS_TOOL: Anthropic.Tool = {
  name: "return_transactions",
  description: "Return every transaction row from the statement.",
  input_schema: {
    type: "object",
    properties: {
      pages: { type: "integer", description: "Number of pages you read." },
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string", description: "yyyy-mm-dd, or empty string if missing." },
            description: { type: "string", description: "Transaction description as printed. Trim whitespace. Preserve references." },
            amountPence: {
              type: "integer",
              description:
                "Signed integer in pence. Positive for money in (credit), negative for money out (debit).",
            },
            balancePence: {
              type: "integer",
              description:
                "Running balance in pence after this transaction, if printed. Omit if missing.",
            },
          },
          required: ["date", "description", "amountPence"],
          additionalProperties: false,
        },
      },
    },
    required: ["pages", "rows"],
    additionalProperties: false,
  } as unknown as Anthropic.Tool["input_schema"],
};

const BANK_PARSE_SYSTEM =
  "You are a precise bank-statement reader. The user uploads a UK bank statement; you return every transaction row as structured data. Do not categorise, do not guess merchants: just return date, description (as printed), signed amount in pence (positive for money in, negative for money out), and running balance in pence if the statement includes one. Skip rows that are headers, carry-forward totals, or interest summaries. Dates in yyyy-mm-dd.";

const BANK_PARSE_USER_PROMPT =
  "Extract every transaction from this UK bank statement. Return rows via the tool. Signed amountPence: positive = money in, negative = money out.";

// Core vision call: takes an Anthropic content block (PDF document or
// image) and runs the shared tool-use parse. The label is used only
// for the dropped-row warning tag and the "Parsed from X" note so the
// operator can tell which path produced which result in the audit log.
async function runVisionParse(
  contentBlock: Anthropic.ContentBlockParam,
  label: "PDF" | "image",
): Promise<ParseResult> {
  const client = anthropic();
  const response = await client.messages.create({
    model: PDF_PARSE_MODEL,
    max_tokens: 8192,
    system: BANK_PARSE_SYSTEM,
    tools: [RETURN_TRANSACTIONS_TOOL],
    tool_choice: { type: "tool", name: "return_transactions" },
    messages: [
      {
        role: "user",
        content: [contentBlock, { type: "text", text: BANK_PARSE_USER_PROMPT }],
      },
    ],
  });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(
      `Model did not return a tool call for the ${label} parse (stop_reason=${response.stop_reason}).`,
    );
  }
  const payload = toolUse.input as {
    pages?: number;
    rows?: Array<{
      date?: unknown;
      description?: unknown;
      amountPence?: unknown;
      balancePence?: unknown;
    }>;
  };
  const warnings: string[] = [];
  const transactions: RawTransaction[] = [];
  const rows = payload.rows ?? [];
  const warnPrefix = label === "PDF" ? "pdf-row-" : "image-row-";
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const description = typeof r.description === "string" ? r.description.trim() : "";
    const amountPence =
      typeof r.amountPence === "number" && Number.isFinite(r.amountPence)
        ? Math.round(r.amountPence)
        : null;
    if (description.length === 0 || amountPence === null) {
      warnings.push(warnPrefix + i + "-dropped");
      continue;
    }
    const txnDate =
      typeof r.date === "string" && r.date.length > 0 ? r.date : null;
    const balancePence =
      typeof r.balancePence === "number" && Number.isFinite(r.balancePence)
        ? Math.round(r.balancePence)
        : null;
    transactions.push({ txnDate, description, amountPence, balancePence });
  }
  const pageText = label === "PDF" ? ` across ${payload.pages ?? "?"} page(s)` : "";
  return {
    transactions,
    note: `Parsed ${transactions.length} rows from ${label}${pageText}.`,
    warnings,
  };
}

async function parsePdf(input: BankInput): Promise<ParseResult> {
  const base64 = Buffer.from(input.bytes).toString("base64");
  return runVisionParse(
    {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64 },
    },
    "PDF",
  );
}

async function parseImage(input: BankInput): Promise<ParseResult> {
  const base64 = Buffer.from(input.bytes).toString("base64");
  const mt = (input.mimeType || "").toLowerCase();
  const name = (input.fileName || "").toLowerCase();
  // Pick the exact media type Anthropic needs. Default to image/jpeg
  // for ambiguous inputs because JPEG is by far the most common
  // phone-camera output; this only matters if the browser forgets to
  // set mimeType on upload.
  const mediaType: "image/jpeg" | "image/png" | "image/webp" =
    mt === "image/png" || name.endsWith(".png") ? "image/png"
    : mt === "image/webp" || name.endsWith(".webp") ? "image/webp"
    : "image/jpeg";
  return runVisionParse(
    {
      type: "image",
      source: { type: "base64", media_type: mediaType, data: base64 },
    },
    "image",
  );
}

// ---------- Shared number / date parsing -----------------------------

// Parses UK-style numeric strings into pence. Accepts:
//   "123.45", "-123.45", "123", "(123.45)" (brackets = negative),
//   "£1,234.56", "1 234,56" (continental), "" => null.
function parseAmount(raw: string): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (s.length === 0) return null;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  }
  s = s.replace(/[£$€¥\s]/g, "");
  // Continental "1.234,56" -> "1234.56"; else UK "1,234.56" -> "1234.56".
  if (/,\d{2}$/.test(s) && /\./.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const pence = Math.round(n * 100);
  return negative ? -pence : pence;
}

// Parses common UK date formats into yyyy-mm-dd. Accepts:
//   "2026-04-05", "05/04/2026", "05-04-2026", "5 Apr 2026", "Apr 5, 2026",
//   Date objects (XLSX cellDates=true returns Date), epoch numbers.
function parseDate(raw: unknown): string | null {
  if (raw == null) return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return iso(raw);
  }
  const s = String(raw).trim();
  if (s.length === 0) return null;
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Numeric epoch?
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) {
      // XLSX dates sometimes slip through as serial numbers if the sheet
      // didn't apply a date format. 44927 = 2023-01-01 in Excel's epoch.
      if (n > 10000 && n < 60000) {
        const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
        return iso(d);
      }
    }
  }
  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (dmy) {
    const dd = Number(dmy[1]);
    const mm = Number(dmy[2]);
    let yy = Number(dmy[3]);
    if (yy < 100) yy += yy >= 70 ? 1900 : 2000;
    const d = new Date(Date.UTC(yy, mm - 1, dd));
    if (!Number.isNaN(d.getTime())) return iso(d);
  }
  // Try Date.parse as a last resort (handles "5 Apr 2026", "Apr 5, 2026").
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return iso(parsed);
  return null;
}

function iso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
