// Shared by the extra-income / extra-expense review lists: groups
// repeat extracted bank-statement lines for the same real-world
// payee even when the AI worded two occurrences slightly
// differently (a different legal suffix, a trailing transaction-type
// descriptor clause). Deliberately conservative: only strips a fixed
// list of known legal-entity suffixes and known transaction-type
// descriptor words, never a payee's own name, so two genuinely
// different payees never collapse into one group.
//
// Examples this is built to merge:
//   "WHITBREAD GROUP PL - Bank Giro Credit (employer/salary payment)"
//   "Whitbread Group PLC - salary/wages payment"
//   both normalize to "WHITBREAD GROUP".
//
// Examples this must NOT merge (a person's name in parens is kept):
//   "Transfer to self (ALTAB HUSSAIN) - faster payment out"
//   normalizes to "TRANSFER TO SELF (ALTAB HUSSAIN)", distinct from
//   any other payee.

const LEGAL_SUFFIXES = [
  "PLC", "PL", "LTD", "LIMITED", "LLP", "LP", "INC", "CORP", "CORPORATION", "CO",
];

// A trailing parenthetical is only dropped when its content is one of
// these known transaction-type words, not when it looks like a name.
const DESCRIPTOR_PARENS_KEYWORDS = [
  "PAYMENT", "FASTER", "BGC", "FPO", "FPI", "DEPOSIT", "CREDIT", "DEBIT",
  "TRANSFER", "STANDING", "ORDER", "DIRECT",
];

export function normalizeLabelCore(label: string): string {
  let s = label.trim();
  if (s.length === 0) return "";

  // Drop a trailing " - descriptor" clause (the AI's own common
  // "PAYEE - what kind of transaction" pattern), whichever dash it
  // used. Built from char codes rather than literal dash glyphs so
  // this file itself stays clean of them.
  const dashChars = ["-", String.fromCharCode(0x2013), String.fromCharCode(0x2014)];
  const cutIndex = dashChars
    .map((d) => s.indexOf(d))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];
  if (cutIndex !== undefined) s = s.slice(0, cutIndex);

  // Drop a trailing parenthetical only when its content is a known
  // transaction-type descriptor rather than a name.
  s = s.replace(/\(([^()]*)\)\s*$/, (whole, inner: string) => {
    const upperInner = inner.toUpperCase();
    const isDescriptor = DESCRIPTOR_PARENS_KEYWORDS.some((w) => upperInner.includes(w));
    return isDescriptor ? "" : whole;
  });

  // Strip punctuation, collapse whitespace, uppercase.
  s = s.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  if (s.length === 0) return "";

  // Strip a trailing legal-entity suffix word (PLC, LTD, and so on),
  // one token at a time, in case more than one was appended.
  const words = s.split(" ");
  while (words.length > 1 && LEGAL_SUFFIXES.includes(words[words.length - 1])) {
    words.pop();
  }
  return words.join(" ");
}
