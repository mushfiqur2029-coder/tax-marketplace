// Shared by the extra-income / extra-expense review lists: groups
// repeat extracted bank-statement lines for the same real-world
// payee even when the AI worded each occurrence quite differently
// (different word order, a different legal suffix, extra transaction
// -type words like "faster payment", "BGC", "own transfer", scattered
// anywhere in the label, not just as a trailing clause).
//
// Approach: strip any money amount, then strip every word that's a
// known transaction-direction / transaction-type / banking-jargon
// word (a fixed list below), then strip a trailing legal-entity
// suffix (PLC, LTD, ...) from what's left. Whatever words survive are
// treated as the payee's identity and used as the group key, so two
// differently-worded lines for the same real payee collapse into one
// group as long as the payee's own name/words are unchanged.
//
// Deliberately conservative about what it strips: only a fixed list
// of generic transaction words, never anything that looks like a
// name. A person's or company's actual name - including short
// initials like "S A S AHMED" - is always kept, so two genuinely
// different payees never collapse into one group.
//
// Examples this is built to merge:
//   "Whitbread Group PL - salary/wages payment (BGC)"
//   "Whitbread Group PLC salary/wages credit"
//   "Payment in from Munchies Original"
//   "Munchies Original payment in"
//   "ALTAB HUSSAIN FPO - outgoing transfer to self"
//   "Altab Hussain own transfer / personal withdrawal"
//   all collapse to "WHITBREAD GROUP", "MUNCHIES ORIGINAL" and
//   "ALTAB HUSSAIN" respectively.
//
// Examples this must NOT merge (distinct payees keep their own name):
//   "MAHBUB AHMED - Faster Payment Out (personal transfer)" stays
//   "MAHBUB AHMED", never folded into "ALTAB HUSSAIN".

const LEGAL_SUFFIXES = [
  "PLC", "PL", "LTD", "LIMITED", "LLP", "LP", "INC", "CORP", "CORPORATION", "CO",
];

// Generic transaction-direction / transaction-type / banking-jargon
// words that never identify a specific payee, wherever they appear
// in the label. Stripping these (and nothing else) is what lets
// differently-worded occurrences of the same real payee collapse
// into one group.
const NOISE_WORDS = new Set([
  "TRANSFER", "TRANSFERS", "PAYMENT", "PAYMENTS", "PAY", "PAID", "PAYOUT", "PAYOUTS",
  "IN", "OUT", "OWN", "SELF", "TO", "FROM",
  "INCOMING", "OUTGOING", "OUTWARD", "INWARD", "FASTER",
  "STANDING", "ORDER", "DIRECT", "DEBIT", "CREDIT", "DEPOSIT", "WITHDRAWAL",
  "PERSONAL", "COUNTER", "CASH",
  "SALARY", "WAGE", "WAGES",
  "PLATFORM", "THIRD", "PARTY", "MONEY",
  "FOOD", "DELIVERY", "WEEKLY", "MONTHLY", "EARNINGS", "INCOME",
  "BGC", "FPO", "FPI", "BACS", "CHAPS",
]);

export function normalizeLabelCore(label: string): string {
  let s = label.trim();
  if (s.length === 0) return "";

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

  // Strip a trailing legal-entity suffix word (PLC, LTD, and so on)
  // from whatever identity words are left, one token at a time, in
  // case more than one was appended.
  while (kept.length > 1 && LEGAL_SUFFIXES.includes(kept[kept.length - 1])) {
    kept.pop();
  }

  if (kept.length === 0) {
    // Nothing identifying survived (a purely generic description,
    // e.g. "Payment in"). Fall back to the cleaned original words
    // rather than an empty key, so lines like this don't all
    // collapse into a single catch-all group.
    return words.map((w) => w.toUpperCase()).join(" ");
  }
  return kept.join(" ");
}
