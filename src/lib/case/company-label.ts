// Shared helper for surfacing the company name on limited-company cases.
// A single source of truth so the eyebrow string is consistent across
// client / accountant / admin case detail pages and never drifts.
//
// The field lives in cases.intake_answers (populated at engagement sign).
// Returns null for personal-tax segments, legacy LC cases without the
// capture, or any case where the value is empty/whitespace.

export function companyNameFromAnswers(
  answers: Record<string, string> | null | undefined,
  segment: string,
): string | null {
  if (segment !== "limited_company_vat") return null;
  const raw = answers?.company_name;
  if (!raw) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function companyNumberFromAnswers(
  answers: Record<string, string> | null | undefined,
  segment: string,
): string | null {
  if (segment !== "limited_company_vat") return null;
  const raw = answers?.company_number;
  if (!raw) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Build the eyebrow string for a case detail header. When a company
// name is known, it leads so a client/accountant with multiple cases
// can disambiguate at a glance.
export function caseEyebrow(input: {
  segmentTitle: string;
  tierTitle: string;
  companyName: string | null;
}): string {
  const base = `${input.segmentTitle} · ${input.tierTitle}`;
  if (!input.companyName) return base;
  return `${input.companyName} · ${base}`;
}
