// Shared by the extra-income / extra-expense review lists: groups
// repeat extracted bank-statement lines for the same real-world
// payee even when the AI worded each occurrence quite differently
// (different word order, spelled-out vs abbreviated banking terms,
// a counter like "(1 of 3)", a date fragment like "(05 Jan)", hedge
// words like "likely", or the payee name appearing twice in one
// label because the AI kept both the raw bank code and a
// human-readable restatement).
//
// Approach: strip date/counter parentheticals and money amounts,
// then strip every word that's a known transaction-direction /
// transaction-type / banking-jargon / filler word (a fixed list
// below) from anywhere in the label, then strip a legal-entity
// suffix (PLC, LTD, ...) from anywhere in what's left, then collapse
// an exact repeated word sequence (the "JUST EAT ... JUST EAT" case).
// Whatever survives is the payee's identity and becomes the group
// key, so wording, order and repetition no longer matter - only the
// payee's own name/words do.
//
// Deliberately conservative about what it strips: only a fixed list
// of generic words, never anything that looks like a name. A
// person's own name - including short initials like "S A S AHMED" -
// is always kept, so two genuinely different payees never collapse
// into one group. In particular, short/common words that could
// plausibly be someone's initials ("A", "AN") are NOT stripped.

const LEGAL_SUFFIXES = [
  "PLC", "PL", "LTD", "LIMITED", "LIM", "LLP", "LP", "INC", "CORP", "CORPORATION", "CO",
];

// Generic transaction-direction / transaction-type / banking-jargon /
// AI-filler words that never identify a specific payee, wherever
// they appear in the label. Stripping these (and nothing else) is
// what lets differently-worded occurrences of the same real payee
// collapse into one group. Deliberately excludes short words that
// could plausibly be part of someone's name or initials (e.g. "A",
// "AN", "MAY", "WILL").
const NOISE_WORDS = new Set([
  "TRANSFER", "TRANSFERS", "PAYMENT", "PAYMENTS", "PAY", "PAID", "PAYOUT", "PAYOUTS",
  "IN", "OUT", "OWN", "SELF", "TO", "FROM", "AT",
  "INCOMING", "OUTGOING", "OUTWARD", "INWARD", "BACK", "RECEIVED",
  "FASTER", "STANDING", "ORDER", "DIRECT", "DEBIT", "CREDIT", "DEPOSIT", "WITHDRAWAL",
  "PERSONAL", "COUNTER", "CASH", "CARD",
  "SALARY", "WAGE", "WAGES", "EMPLOYER", "BANK", "GIRO",
  "PLATFORM", "THIRD", "PARTY", "MONEY",
  "FOOD", "DELIVERY", "WEEKLY", "MONTHLY", "EARNINGS", "INCOME",
  "STORE", "PURCHASE", "RETAIL", "CONVENIENCE", "GROCERY",
  "SUBSCRIPTION", "CHARGE", "SERVICE", "DIGITAL",
  "LIKELY", "AGGREGATOR", "UNKNOWN", "OR", "OTHER", "AND", "THE", "OF", "UK",
  "BGC", "FPO", "FPI", "BACS", "CHAPS",
]);

// A trailing date fragment the AI sometimes appends in parentheses,
// e.g. "(05 Jan)" or "(20 Jan, £156)". Carries no payee identity,
// so it's dropped whole rather than word by word (its month name
// would otherwise survive noise-word filtering and could coincide
// with a real surname, e.g. "May").
const DATE_PARENS = /\(\s*\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:\s*,\s*£?[\d,]+(?:\.\d+)?)?\s*\)/gi;

// A split-transaction counter the AI sometimes appends, e.g.
// "(1 of 3)" when one statement line got broken into several rows.
const COUNTER_PARENS = /\(\s*\d+\s+of\s+\d+\s*\)/gi;

export function normalizeLabelCore(label: string): string {
  let s = label.trim();
  if (s.length === 0) return "";

  s = s.replace(DATE_PARENS, " ");
  s = s.replace(COUNTER_PARENS, " ");

  // Drop money amounts (e.g. "£600.00") before punctuation stripping,
  // so a bare "600" or "00" left behind doesn't survive as a word.
  s = s.replace(/£\s*[\d,]+(\.\d+)?/g, " ");

  // Everything else that isn't a letter or digit becomes a space
  // (parentheses, dashes of every kind, slashes, commas, periods,
  // colons, ampersands), so word order and punctuation style never
  // affect the result.
  s = s.replace(/[^a-zA-Z0-9]+/g, " ");

  const words = s.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return "";

  const kept: string[] = [];
  for (const w of words) {
    const upper = w.toUpperCase();
    if (NOISE_WORDS.has(upper)) continue;
    if (/^\d+$/.test(upper)) continue; // bare numbers (refs, amounts, dates)
    kept.push(upper);
  }
  if (kept.length === 0) {
    // Nothing identifying survived (a purely generic description,
    // e.g. "Payment in"). Fall back to the cleaned original words
    // rather than an empty key, so lines like this don't all
    // collapse into a single catch-all group.
    return words.map((w) => w.toUpperCase()).join(" ");
  }

  // Drop a legal-entity suffix word (PLC, LTD, and so on) wherever it
  // appears, not just at the end - spelling out "Bank Giro Credit"
  // instead of "BGC" pushes other noise words after the suffix, so it
  // no longer trails once those are removed. Only drop suffix words
  // if something else survives; never blank the result out entirely.
  const withoutSuffixes = kept.filter((w) => !LEGAL_SUFFIXES.includes(w));
  const core = withoutSuffixes.length > 0 ? withoutSuffixes : kept;

  // Collapse an exact repeated sequence, e.g. a bank's raw payee code
  // followed by the AI's own human-readable restatement of the same
  // name ("Just Eat Co Uk Lim Just Eat" -> "Just Eat" once the
  // suffix/noise words between them are gone).
  if (core.length % 2 === 0) {
    const half = core.length / 2;
    const first = core.slice(0, half).join(" ");
    const second = core.slice(half).join(" ");
    if (first === second) return first;
  }

  return core.join(" ");
}
