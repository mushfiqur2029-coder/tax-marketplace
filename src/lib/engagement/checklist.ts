import type { TierId } from "@/lib/plans";

// Onboarding checklist schema for both flows.
//
// Limited Company uses Sections A/B/C (+ D for VAT); Personal uses the
// single Section P with a flat 16-field list sourced from the P1
// restructure spec. Source of truth for both the client-facing form
// and the server-side "all required fields present" validation.
//
// Field flavours:
//   text, free text input
//   select, dropdown from `options`, optional `showOtherOn` triggers a
//              freetext "other" field with id={id}_other
//   date. HTML date input, stored as YYYY-MM-DD
//   upload, one or more files uploaded to case_documents with
//              requirement_key = id. multi=true permits several files.
//
// requiredFor:
//   lists the TierIds that MUST have this field completed. For a tier not
//   in the list, the field is still shown but marked optional. An empty
//   array = optional for everyone.

export type ChecklistSection = "A" | "B" | "C" | "D" | "P";

// Admin-created bespoke LC engagements reuse the vat_reg checklist
// shape verbatim (Sections A/B/C/D, same required/optional split,
// same period-docs). Rather than threading the new tier id through
// every `requiredFor` array in CHECKLIST_FIELDS below, we map it to
// vat_reg at the entry point of every exported function. One touch,
// no risk of a field being added later for vat_reg but forgetting
// to add it to the bespoke tier.
function aliasChecklistTier(tier: TierId): TierId {
  if (tier === "vat_plus_accounts_bespoke") return "vat_reg";
  return tier;
}

// Tier id groupings. Keeping these local to checklist.ts because
// PLAN_TIERS imports would be circular, the lists live on paper here
// instead of being generated from plans.ts. If plans.ts ever adds a
// tier that should take onboarding, both lists need updating.
const LC_TIER_IDS: TierId[] = ["dormant", "non_vat_reg", "vat_reg"];

// Personal tier catalogue is split by document-requirement profile.
// Group A (the seven "straightforward" tiers) carry full upload
// requirements including P60/P45, P11D, pension / Gift Aid / child
// benefit / student loan statements. Group B (non-resident landlord
// + complex international) drops P11D, child benefit, student loan,
// and demands a Passport only, no driving-licence option. Sections
// above (A/B/C/D) are Limited Company only; Personal uses Section P
// with per-field requirements driven by these groups via `requiredFor`
// + `hiddenForTiers`.
const PERSONAL_GROUP_A_TIER_IDS: TierId[] = [
  "uber_driver",
  "cis_subcontractor",
  "sole_trader",
  "landlord_small",
  "gig_worker",
  "freelancer_consultant",
  "landlord_multi",
];
const PERSONAL_GROUP_B_TIER_IDS: TierId[] = [
  "non_resident_landlord",
  "complex_international",
];
const PERSONAL_TIER_IDS: TierId[] = [
  ...PERSONAL_GROUP_A_TIER_IDS,
  ...PERSONAL_GROUP_B_TIER_IDS,
];

/**
 * Visibility gate. When set, the field only renders (and only counts
 * toward required-field validation) when `answers[fieldId] === equals`.
 * Used for the Section B ID-type branching (Passport vs Driving licence)
 * and anywhere else we want to toggle fields on by a sibling's answer.
 */
export type ShowWhen = { fieldId: string; equals: string };

// Tier-level visibility flags shared across every field variant.
// Kept outside the discriminated union so adding a new kind doesn't
// require re-declaring them each time.
//
//   hiddenForTiers, hard-hide for these tiers regardless of
//                              showWhen. Used for Group B dropping
//                              items 2/9/11, and for driving-licence
//                              uploads vanishing from Group B entirely.
//   showWhenBypassForTiers, ignore the showWhen gate for these
//                              tiers (field renders unconditionally).
//                              Used so Group B's passport upload is
//                              always visible even though sa_id_type
//                              is hidden for Group B.
type TierVisibility = {
  hiddenForTiers?: TierId[];
  showWhenBypassForTiers?: TierId[];
};

export type ChecklistField =
  | ({
      id: string;
      section: ChecklistSection;
      label: string;
      hint?: string;
      kind: "text" | "date";
      requiredFor: TierId[];
      /** Optional server-side regex. If present, the raw value must match. */
      pattern?: { regex: string; message: string };
      showWhen?: ShowWhen;
    } & TierVisibility)
  | ({
      id: string;
      section: ChecklistSection;
      label: string;
      hint?: string;
      kind: "select";
      requiredFor: TierId[];
      options: string[];
      /** When the user picks this option, surface a freetext id={id}_other. */
      showOtherOn?: string;
      showWhen?: ShowWhen;
    } & TierVisibility)
  | ({
      id: string;
      section: ChecklistSection;
      label: string;
      hint?: string;
      kind: "upload";
      requiredFor: TierId[];
      multi?: boolean;
      showWhen?: ShowWhen;
    } & TierVisibility);

export type ChecklistSectionDef = {
  key: ChecklistSection;
  title: string;
  subtitle?: string;
  showForTiers?: TierId[]; // if omitted, show for all three
};

export const CHECKLIST_SECTIONS: ChecklistSectionDef[] = [
  {
    key: "A",
    title: "Company Details",
    showForTiers: LC_TIER_IDS,
  },
  {
    key: "B",
    title: "Director's Details",
    showForTiers: LC_TIER_IDS,
  },
  {
    key: "C",
    title: "Registration Service",
    showForTiers: LC_TIER_IDS,
  },
  {
    key: "D",
    title: "VAT Details",
    showForTiers: ["vat_reg"],
  },
  {
    // Personal, single flat section used by all nine Personal tiers.
    // Form renders this without the "Section P , " prefix.
    key: "P",
    title: "Your Self Assessment documents",
    showForTiers: PERSONAL_TIER_IDS,
  },
];

// All three services share Sections A, B, C. Section D is appended only
// when the chosen service is vat_reg. The order below is the order
// rendered to the client.
export const CHECKLIST_FIELDS: ChecklistField[] = [
  // ---------------- Section A: Company Details ----------------
  {
    id: "company_name",
    section: "A",
    label: "Company Name",
    hint: "Exactly as it appears on the Companies House register.",
    kind: "text",
    requiredFor: ["dormant", "non_vat_reg", "vat_reg"],
  },
  {
    id: "company_number",
    section: "A",
    label: "Company Number",
    hint: "8 characters from Companies House. Either 8 digits or 2 letters + 6 digits (e.g. SC123456).",
    kind: "text",
    requiredFor: ["dormant", "non_vat_reg", "vat_reg"],
    pattern: {
      regex: "^(?:\\d{8}|[A-Za-z]{2}\\d{6})$",
      message:
        "Company number must be 8 digits, or 2 letters followed by 6 digits (e.g. SC123456).",
    },
  },
  {
    id: "company_auth_code",
    section: "A",
    label: "Company Authentication Code",
    hint: "Without this we cannot make any changes or submit to Companies House.",
    kind: "text",
    requiredFor: ["dormant", "non_vat_reg", "vat_reg"],
  },
  {
    // Gates company_utr. If the client isn't registered yet (brand
    // new company that hasn't received the HMRC welcome letter) we
    // don't block the engagement on the UTR, the accountant can
    // guide them through registration later.
    id: "company_utr_registered",
    section: "A",
    label: "Are you registered for a Company UTR yet?",
    hint: "HMRC posts the 10-digit UTR about 14 days after Companies House incorporation.",
    kind: "select",
    options: ["Yes", "No"],
    requiredFor: ["dormant", "non_vat_reg", "vat_reg"],
  },
  {
    id: "company_utr",
    section: "A",
    label: "Company UTR letter",
    hint: "Upload the HMRC letter showing your 10-digit Unique Taxpayer Reference (your corporation tax welcome letter).",
    kind: "upload",
    requiredFor: ["dormant", "non_vat_reg", "vat_reg"],
    showWhen: { fieldId: "company_utr_registered", equals: "Yes" },
  },
  {
    id: "vat_registration_certificate",
    section: "A",
    label: "VAT Registration Certificate",
    hint: "Required if VAT registered; optional otherwise.",
    kind: "upload",
    requiredFor: ["vat_reg"],
  },
  {
    id: "paye_certificate",
    section: "A",
    label: "PAYE Certificate",
    hint: "Only if PAYE registered.",
    kind: "upload",
    requiredFor: [],
  },
  {
    id: "hmrc_letters",
    section: "A",
    label: "HMRC letters",
    hint: "Any recent HMRC correspondence. Multiple allowed.",
    kind: "upload",
    requiredFor: [],
    multi: true,
  },
  {
    id: "companies_house_notices",
    section: "A",
    label: "Companies House notices",
    hint: "Any recent Companies House correspondence. Multiple allowed.",
    kind: "upload",
    requiredFor: [],
    multi: true,
  },
  {
    id: "previous_accountant_name",
    section: "A",
    label: "Previous accountant's name",
    hint: "For professional clearance, if you had one.",
    kind: "text",
    requiredFor: [],
  },
  {
    id: "previous_accountant_email",
    section: "A",
    label: "Previous accountant's email",
    kind: "text",
    requiredFor: [],
  },

  // ---------------- Section B: Director's Details ----------------
  //
  // Identity document is a choice between Passport (one upload) and
  // Driving licence (front + back uploads). The select below gates
  // which upload slots appear via `showWhen`. The old flow required
  // *both* a passport AND a driving licence, this change makes it one
  // or the other.
  //
  // We keep the `director_passport` id so test cases that already
  // uploaded under it map straight onto the new Passport slot without
  // orphaning data. There's no equivalent for the old
  // `director_driving_licence` single slot because the new path has
  // two uploads; legacy single-slot driving-licence docs are rendered
  // as a read-only "previously uploaded" row in the form and panel
  // views (see onboarding-form.tsx + onboarding-answers-panel.tsx).
  {
    id: "director_id_type",
    section: "B",
    label: "Which ID are you providing?",
    kind: "select",
    options: ["Passport", "Driving licence"],
    requiredFor: ["dormant", "non_vat_reg", "vat_reg"],
  },
  {
    id: "director_passport",
    section: "B",
    label: "Passport (main photo page)",
    kind: "upload",
    requiredFor: ["dormant", "non_vat_reg", "vat_reg"],
    showWhen: { fieldId: "director_id_type", equals: "Passport" },
  },
  {
    id: "director_driving_licence_front",
    section: "B",
    label: "Driving licence (front)",
    kind: "upload",
    requiredFor: ["dormant", "non_vat_reg", "vat_reg"],
    showWhen: { fieldId: "director_id_type", equals: "Driving licence" },
  },
  {
    id: "director_driving_licence_back",
    section: "B",
    label: "Driving licence (back)",
    kind: "upload",
    requiredFor: ["dormant", "non_vat_reg", "vat_reg"],
    showWhen: { fieldId: "director_id_type", equals: "Driving licence" },
  },
  {
    id: "director_proof_of_address_2",
    section: "B",
    label: "Bank statement or utility bill",
    hint: "2nd proof of address, dated within the last 3 months.",
    kind: "upload",
    requiredFor: ["dormant", "non_vat_reg", "vat_reg"],
  },
  {
    id: "director_ni_proof",
    section: "B",
    label: "National Insurance number",
    hint: "Upload your NI card or an official letter showing your NI Number.",
    kind: "upload",
    requiredFor: ["dormant", "non_vat_reg", "vat_reg"],
  },
  {
    id: "director_personal_utr",
    section: "B",
    label: "Personal UTR",
    hint: "Optional. If you file Self Assessment.",
    kind: "text",
    requiredFor: [],
  },

  // ---------------- Section C: Registration Service ----------------
  {
    id: "needs_paye_registration",
    section: "C",
    label: "Do you need PAYE registration and monthly payslips?",
    kind: "select",
    options: ["Yes", "No"],
    requiredFor: ["dormant", "non_vat_reg", "vat_reg"],
  },

  // ---------------- Section D: VAT Details (vat_reg only) ----------------
  {
    id: "vat_number",
    section: "D",
    label: "VAT Registration Number",
    hint: "Exactly 9 digits, no spaces or prefix.",
    kind: "text",
    requiredFor: ["vat_reg"],
    pattern: {
      regex: "^\\d{9}$",
      message: "VAT number must be exactly 9 digits.",
    },
  },
  {
    id: "vat_effective_date",
    section: "D",
    label: "VAT Effective Date",
    hint: "The date your VAT registration took effect.",
    kind: "date",
    requiredFor: ["vat_reg"],
  },
  {
    id: "vat_approval_letter",
    section: "D",
    label: "Letter of VAT approval from HMRC",
    kind: "upload",
    requiredFor: ["vat_reg"],
  },
  {
    id: "vat_return_frequency",
    section: "D",
    label: "VAT return frequency",
    hint: "If you're not sure, pick 'I don't know'. Your accountant will confirm it when they enter your first period end date.",
    kind: "select",
    options: ["Monthly", "Quarterly", "Annually", "I don't know"],
    requiredFor: ["vat_reg"],
  },
  {
    id: "vat_scheme",
    section: "D",
    label: "VAT scheme",
    hint: "Choose Other to specify a scheme not listed, or 'I don't know' if you're unsure. Your accountant will confirm it.",
    kind: "select",
    options: ["Flat Rate", "Standard", "Other", "I don't know"],
    showOtherOn: "Other",
    requiredFor: ["vat_reg"],
  },

  // ---------------- Section P: Personal Self Assessment ----------------
  //
  // Two groups:
  //   Group A, the seven "straightforward" tiers. Full upload set.
  //             Identity: Passport OR Driving licence (branched).
  //   Group B, non-resident landlord + complex international. Drops
  //             P11D, child benefit, and student loan. Identity:
  //             Passport only, always visible (no select).
  //
  // Every document request is upload-or-"I don't have this": no free-
  // text input. The "I don't have this" flag is written to a sibling
  // key `{fieldId}_not_available` in intake_answers so required-
  // missing calculations skip the field. See src/components/case/
  // document-uploader.tsx for the UI.

  // -- UTR gating sibling (item 1): mirror of company_utr_registered.
  {
    id: "sa_utr_registered",
    section: "P",
    label: "Are you registered for Self Assessment yet?",
    hint: "HMRC assigns a 10-digit UTR after you register. New filers can take 2-4 weeks.",
    kind: "select",
    options: ["Yes", "No"],
    requiredFor: PERSONAL_TIER_IDS,
  },
  {
    id: "sa_utr",
    section: "P",
    label: "Personal UTR letter",
    hint: "Upload your HMRC Self Assessment letter showing your 10-digit Unique Taxpayer Reference.",
    kind: "upload",
    requiredFor: PERSONAL_TIER_IDS,
    showWhen: { fieldId: "sa_utr_registered", equals: "Yes" },
  },
  {
    id: "sa_ni_proof",
    section: "P",
    label: "National Insurance proof",
    hint: "Your NI card, letter, or a payslip clearly showing your NI Number.",
    kind: "upload",
    requiredFor: PERSONAL_TIER_IDS,
  },

  // -- Identity: Group A uses a Passport/Driving licence branch;
  //    Group B is Passport only (sa_id_type + driving-licence slots
  //    hidden entirely, sa_passport always visible via
  //    showWhenBypassForTiers).
  {
    id: "sa_id_type",
    section: "P",
    label: "Which ID are you providing?",
    kind: "select",
    options: ["Passport", "Driving licence"],
    requiredFor: PERSONAL_GROUP_A_TIER_IDS,
    hiddenForTiers: PERSONAL_GROUP_B_TIER_IDS,
  },
  {
    id: "sa_passport",
    section: "P",
    label: "Passport (main photo page)",
    kind: "upload",
    requiredFor: PERSONAL_TIER_IDS,
    showWhen: { fieldId: "sa_id_type", equals: "Passport" },
    // For Group B tiers, sa_id_type doesn't render, the showWhen
    // can never resolve. Bypass makes passport always visible for
    // those tiers.
    showWhenBypassForTiers: PERSONAL_GROUP_B_TIER_IDS,
  },
  {
    id: "sa_driving_licence_front",
    section: "P",
    label: "Driving licence (front)",
    kind: "upload",
    requiredFor: PERSONAL_GROUP_A_TIER_IDS,
    showWhen: { fieldId: "sa_id_type", equals: "Driving licence" },
    hiddenForTiers: PERSONAL_GROUP_B_TIER_IDS,
  },
  {
    id: "sa_driving_licence_back",
    section: "P",
    label: "Driving licence (back)",
    kind: "upload",
    requiredFor: PERSONAL_GROUP_A_TIER_IDS,
    showWhen: { fieldId: "sa_id_type", equals: "Driving licence" },
    hiddenForTiers: PERSONAL_GROUP_B_TIER_IDS,
  },

  // -- Income + supporting documents.
  {
    id: "sa_last_year_return",
    section: "P",
    label: "Last year's tax return",
    hint: "If you filed last year, uploading a copy helps us pick up where it left off.",
    kind: "upload",
    requiredFor: PERSONAL_TIER_IDS,
  },
  {
    id: "sa_was_employed",
    section: "P",
    label: "Were you employed this tax year?",
    hint: "Tells us whether to expect a P60 / P45.",
    kind: "select",
    options: ["Yes", "No"],
    requiredFor: PERSONAL_TIER_IDS,
  },
  {
    id: "sa_p60_p45",
    section: "P",
    label: "P60 and / or P45",
    hint: "P60 is the year-end summary from an employer; P45 is issued when you leave a job. Upload whichever applies.",
    kind: "upload",
    requiredFor: PERSONAL_TIER_IDS,
    multi: true,
    showWhen: { fieldId: "sa_was_employed", equals: "Yes" },
  },
  {
    id: "sa_p11d",
    section: "P",
    label: "P11D (benefits in kind)",
    hint: "If your employer issues one for company car, medical, etc.",
    kind: "upload",
    requiredFor: PERSONAL_GROUP_A_TIER_IDS,
    hiddenForTiers: PERSONAL_GROUP_B_TIER_IDS,
  },
  {
    id: "sa_interest_certificates",
    section: "P",
    label: "Bank interest certificates",
    hint: "Certificates or statements showing taxable interest earned.",
    kind: "upload",
    requiredFor: PERSONAL_TIER_IDS,
    multi: true,
  },
  {
    id: "sa_dividend_vouchers",
    section: "P",
    label: "Dividend vouchers",
    hint: "Vouchers or statements for any dividends received.",
    kind: "upload",
    requiredFor: PERSONAL_TIER_IDS,
    multi: true,
  },
  {
    id: "sa_capital_gains",
    section: "P",
    label: "Capital gains documents",
    hint: "Broker statements, completion statements, or crypto exchange CSVs for any disposals.",
    kind: "upload",
    requiredFor: PERSONAL_TIER_IDS,
    multi: true,
  },
  {
    id: "sa_rental_docs",
    section: "P",
    label: "Rental income, expenses & mortgage statements",
    hint: "Rental statements, expenses receipts, and mortgage interest certificates for any let property.",
    kind: "upload",
    requiredFor: PERSONAL_TIER_IDS,
    multi: true,
  },
  {
    id: "sa_private_pension",
    section: "P",
    label: "Private pension statement",
    hint: "Pension provider's annual statement or contribution certificate.",
    kind: "upload",
    requiredFor: PERSONAL_TIER_IDS,
  },
  {
    id: "sa_gift_aid",
    section: "P",
    label: "Gift Aid certificates",
    hint: "Charity receipts or year-end summaries for donations where you ticked Gift Aid.",
    kind: "upload",
    requiredFor: PERSONAL_TIER_IDS,
    multi: true,
  },
  {
    id: "sa_child_benefit",
    section: "P",
    label: "Child benefit award letter",
    hint: "The HMRC award letter or an official document confirming the amount.",
    kind: "upload",
    requiredFor: PERSONAL_GROUP_A_TIER_IDS,
    hiddenForTiers: PERSONAL_GROUP_B_TIER_IDS,
  },
  {
    id: "sa_overseas",
    section: "P",
    label: "Overseas income and tax paid",
    hint: "Foreign income statements and foreign tax paid certificates.",
    kind: "upload",
    requiredFor: PERSONAL_TIER_IDS,
    multi: true,
  },
  {
    id: "sa_student_loan",
    section: "P",
    label: "Student loan statement",
    hint: "The Student Loans Company annual statement.",
    kind: "upload",
    requiredFor: PERSONAL_GROUP_A_TIER_IDS,
    hiddenForTiers: PERSONAL_GROUP_B_TIER_IDS,
  },
  {
    id: "sa_anything_else",
    section: "P",
    label: "Anything else relevant",
    hint: "Any additional document that might affect your return. Optional.",
    kind: "upload",
    requiredFor: [],
    multi: true,
  },
];

// The one field whose answer is never stored in the plain intake_answers
// JSONB. Encrypted via pgcrypto RPC and read back only by admin + the
// assigned accountant. The client form writes it as a normal field; the
// server action detects it by id and routes to set_company_auth_code.
export const ENCRYPTED_FIELD_ID = "company_auth_code";

export function sectionsForTier(tier: TierId): ChecklistSectionDef[] {
  const t = aliasChecklistTier(tier);
  return CHECKLIST_SECTIONS.filter(
    (s) => !s.showForTiers || s.showForTiers.includes(t),
  );
}

export function fieldsForTier(tier: TierId): ChecklistField[] {
  const t = aliasChecklistTier(tier);
  const visibleSections = new Set(sectionsForTier(tier).map((s) => s.key));
  return CHECKLIST_FIELDS.filter((f) => {
    if (!visibleSections.has(f.section)) return false;
    // Field-level tier hard-hide (new in migration 0063 era for the
    // Group B Personal split. P11D / child benefit / student loan
    // vanish for Group B tiers, and the driving-licence slots vanish
    // for Group B's Passport-only identity path).
    if (f.hiddenForTiers?.includes(t)) return false;
    return true;
  });
}

// Which fields in the visible-for-this-tier set are required for this
// particular tier. Used by both the client submit guard and the server
// validator, single source of truth. Does NOT filter by showWhen: a
// field with a showWhen that doesn't match is simply hidden and so
// never counts as missing. See `requiredFieldsForTierGiven` for the
// visibility-aware version.
export function requiredFieldsForTier(tier: TierId): ChecklistField[] {
  const t = aliasChecklistTier(tier);
  return fieldsForTier(tier).filter((f) => f.requiredFor.includes(t));
}

// Canonical "is this field required for this tier?" check. Every
// UI label ("Required" / "Optional") and every server submit guard
// must route through here so the tier aliasing stays in lockstep.
// Direct `field.requiredFor.includes(tier)` reads silently skip the
// alias, the bespoke tier would read as not-required even though
// the server validator treats it as required, which produced the
// label-versus-validator mismatch on Section D.
export function isFieldRequired(
  tier: TierId,
  field: Pick<ChecklistField, "requiredFor">,
): boolean {
  return field.requiredFor.includes(aliasChecklistTier(tier));
}

// Visibility gate on a single field for a given set of answers.
// A field with no `showWhen` is always visible. A field whose
// `showWhen` references an unanswered question is hidden until that
// question is answered, which is the right default for conditional
// branches like Section B's ID type.
//
// Tier parameter is optional for back-compat with existing callers;
// when provided, `showWhenBypassForTiers` can override the showWhen
// gate (Group B passport is always visible regardless of sa_id_type,
// which itself is hidden for Group B).
export function fieldIsVisible(
  field: ChecklistField,
  answers: Record<string, string> | null | undefined,
  tier?: TierId,
): boolean {
  if (!field.showWhen) return true;
  if (tier && field.showWhenBypassForTiers) {
    const t = aliasChecklistTier(tier);
    if (field.showWhenBypassForTiers.includes(t)) return true;
  }
  const current = answers?.[field.showWhen.fieldId];
  return current === field.showWhen.equals;
}

// A document-style field counts as "resolved" when the client either
// uploaded one or ticked "I don't have this". The latter writes a
// sibling flag `{fieldId}_not_available: "true"` into intake_answers
// ,  see src/components/case/document-uploader.tsx + the onboarding
// server actions. This helper centralises the check so both the
// client-facing missing-count math and the admin/accountant red-flag
// badge agree.
export function isFieldMarkedNotAvailable(
  fieldId: string,
  answers: Record<string, string> | null | undefined,
): boolean {
  return (answers?.[`${fieldId}_not_available`] ?? "") === "true";
}

// Fields visible for this tier *and* for the given answers. Use this
// in the client form when rendering + in required-count math so a
// conditional branch toggle re-counts correctly.
export function visibleFieldsForTier(
  tier: TierId,
  answers: Record<string, string> | null | undefined,
): ChecklistField[] {
  return fieldsForTier(tier).filter((f) => fieldIsVisible(f, answers, tier));
}

// Is a single field "resolved" for the purposes of the per-field
// red/green indicator on the client form AND the per-section badge
// math below? A field is resolved when:
//   - upload: at least one case_documents row at this requirement_key, OR
//     the client ticked "I don't have this"
//   - encrypted auth code: the encrypted blob is set on the case row
//   - text/select/date: a non-empty answer, OR "I don't have this"/
//     "I don't know" ticked
// Not-required fields always count as resolved (there's no red state
// to signal). Mirrors the inner loop of missingRequiredBySection, kept
// as a standalone helper so client-form row components can show the
// same per-field green check / red dot without re-deriving the rule.
export function isFieldResolved(opts: {
  field: ChecklistField;
  tier: TierId;
  answers: Record<string, string> | null | undefined;
  uploadedKeysForSection: Set<string> | undefined;
  authCodeSet: boolean;
}): boolean {
  const { field, tier, answers, uploadedKeysForSection, authCodeSet } = opts;
  if (!isFieldRequired(tier, field)) return true;
  if (isFieldMarkedNotAvailable(field.id, answers)) return true;
  if (field.kind === "upload") {
    return uploadedKeysForSection?.has(field.id) ?? false;
  }
  if (field.id === ENCRYPTED_FIELD_ID) return authCodeSet;
  const v = answers?.[field.id];
  return !!v && v.trim().length > 0;
}

// Per-section missing-required count. Admin / accountant case views
// render a red "incomplete" badge when a section has any required
// field still unresolved (no upload, no non-empty answer, and the
// client hasn't ticked "I don't have this"). Fields marked
// not-available are considered resolved, the badge is for the
// client's active to-do list, not for admin's chase list (admin sees
// the not-available flag separately as a "flagged as unavailable"
// state on the field).
export function missingRequiredBySection(
  tier: TierId,
  answers: Record<string, string> | null | undefined,
  uploadedKeysBySection: Record<string, Set<string>>,
  authCodeSet: boolean,
): Record<ChecklistSection, number> {
  const out: Record<ChecklistSection, number> = {
    A: 0,
    B: 0,
    C: 0,
    D: 0,
    P: 0,
  };
  for (const f of requiredFieldsForTierGiven(tier, answers)) {
    let resolved = false;
    if (f.kind === "upload") {
      resolved = uploadedKeysBySection[f.section]?.has(f.id) ?? false;
    } else if (f.id === ENCRYPTED_FIELD_ID) {
      resolved = authCodeSet;
    } else {
      const v = answers?.[f.id];
      resolved = !!v && v.trim().length > 0;
    }
    if (!resolved) out[f.section] += 1;
  }
  return out;
}

// Required subset of visible fields. The onboarding submit guard calls
// this with the current intake_answers so a Passport-only path doesn't
// demand driving-licence uploads, and vice versa. Fields the client
// has marked "I don't have this" are excluded, they're resolved, not
// missing (see isFieldMarkedNotAvailable).
export function requiredFieldsForTierGiven(
  tier: TierId,
  answers: Record<string, string> | null | undefined,
): ChecklistField[] {
  const t = aliasChecklistTier(tier);
  return visibleFieldsForTier(tier, answers).filter((f) => {
    if (!f.requiredFor.includes(t)) return false;
    if (isFieldMarkedNotAvailable(f.id, answers)) return false;
    return true;
  });
}

// Legacy driving-licence upload key. Before the Passport/Driving-licence
// branch was introduced, Section B had a single "Driving licence"
// upload at this key. New flow splits it into front + back under
// `director_driving_licence_front` / `_back`. We keep this constant
// exported so the form and panel views can surface any legacy uploads
// as a read-only "previously uploaded" row, the data is still in
// storage, we just don't want it to vanish from the UI.
export const LEGACY_DRIVING_LICENCE_ID = "director_driving_licence";

export const CHECKLIST_FOOTER_NOTE =
  "Please provide all the information requested. Missing information will delay your onboarding. Please also tell us as soon as possible if you have any overdue Accounts, VAT, CIS or PAYE returns, so we can help you avoid HMRC late filing penalties.";

export const CHECKLIST_FOOTER_NOTE_PERSONAL =
  "The above list is not exhaustive. If you're unsure whether something is relevant, contact us to clarify.";

// Pick the correct footer for the tier group. Personal gets a shorter
// "not exhaustive, ask us" note; LC keeps the compliance-heavy footer.
export function footerForTier(tier: TierId): string {
  return (PERSONAL_TIER_IDS as readonly TierId[]).includes(tier)
    ? CHECKLIST_FOOTER_NOTE_PERSONAL
    : CHECKLIST_FOOTER_NOTE;
}
