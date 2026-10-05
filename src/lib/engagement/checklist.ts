import type { TierId } from "@/lib/plans";

// Onboarding checklist schema for both flows.
//
// Limited Company uses Sections A/B/C (+ D for VAT); Personal uses the
// single Section P with a flat 16-field list sourced from the P1
// restructure spec. Source of truth for both the client-facing form
// and the server-side "all required fields present" validation.
//
// Field flavours:
//   text     — free text input
//   select   — dropdown from `options`, optional `showOtherOn` triggers a
//              freetext "other" field with id={id}_other
//   date     — HTML date input, stored as YYYY-MM-DD
//   upload   — one or more files uploaded to case_documents with
//              requirement_key = id. multi=true permits several files.
//
// requiredFor:
//   lists the TierIds that MUST have this field completed. For a tier not
//   in the list, the field is still shown but marked optional. An empty
//   array = optional for everyone.

export type ChecklistSection = "A" | "B" | "C" | "D" | "P";

// Tier id groupings. Keeping these local to checklist.ts because
// PLAN_TIERS imports would be circular — the lists live on paper here
// instead of being generated from plans.ts. If plans.ts ever adds a
// tier that should take onboarding, both lists need updating.
const LC_TIER_IDS: TierId[] = ["dormant", "non_vat_reg", "vat_reg"];
const PERSONAL_TIER_IDS: TierId[] = [
  "uber_driver",
  "cis_subcontractor",
  "sole_trader",
  "landlord_small",
  "non_resident_landlord",
  "gig_worker",
  "freelancer_consultant",
  "landlord_multi",
  "complex_international",
];

/**
 * Visibility gate. When set, the field only renders (and only counts
 * toward required-field validation) when `answers[fieldId] === equals`.
 * Used for the Section B ID-type branching (Passport vs Driving licence)
 * and anywhere else we want to toggle fields on by a sibling's answer.
 */
export type ShowWhen = { fieldId: string; equals: string };

export type ChecklistField =
  | {
      id: string;
      section: ChecklistSection;
      label: string;
      hint?: string;
      kind: "text" | "date";
      requiredFor: TierId[];
      /** Optional server-side regex. If present, the raw value must match. */
      pattern?: { regex: string; message: string };
      showWhen?: ShowWhen;
    }
  | {
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
    }
  | {
      id: string;
      section: ChecklistSection;
      label: string;
      hint?: string;
      kind: "upload";
      requiredFor: TierId[];
      multi?: boolean;
      showWhen?: ShowWhen;
    };

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
    // Personal — single flat section used by all nine Personal tiers.
    // Form renders this without the "Section P —" prefix.
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
    hint: "8 characters from Companies House — either 8 digits or 2 letters + 6 digits (e.g. SC123456).",
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
    id: "company_utr",
    section: "A",
    label: "Company UTR (from HMRC)",
    hint: "10-digit Unique Taxpayer Reference, on your corporation tax letters.",
    kind: "text",
    requiredFor: ["dormant", "non_vat_reg", "vat_reg"],
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
  // *both* a passport AND a driving licence — this change makes it one
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
    hint: "Upload your NI card or an official letter showing your NI number.",
    kind: "upload",
    requiredFor: ["dormant", "non_vat_reg", "vat_reg"],
  },
  {
    id: "director_personal_utr",
    section: "B",
    label: "Personal UTR",
    hint: "Optional — if you file Self Assessment.",
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
    hint: "If you're not sure, pick 'I don't know' — your accountant will confirm it when they enter your first period end date.",
    kind: "select",
    options: ["Monthly", "Quarterly", "Annually", "I don't know"],
    requiredFor: ["vat_reg"],
  },
  {
    id: "vat_scheme",
    section: "D",
    label: "VAT scheme",
    hint: "Choose Other to specify a scheme not listed, or 'I don't know' if you're unsure — your accountant will confirm it.",
    kind: "select",
    options: ["Flat Rate", "Standard", "Other", "I don't know"],
    showOtherOn: "Other",
    requiredFor: ["vat_reg"],
  },

  // ---------------- Section P: Personal Self Assessment ----------------
  //
  // Flat list shared by all nine Personal tiers. UTR and NI proof are
  // the only required items; everything else is optional. P60/P45 is
  // visible only when the client answers "Were you employed?" with
  // "Yes" — same showWhen mechanic used by Section B's ID branch.
  {
    id: "sa_utr",
    section: "P",
    label: "Personal UTR (from HMRC)",
    hint: "10-digit Unique Taxpayer Reference, on your Self Assessment correspondence. Required to file your return.",
    kind: "text",
    requiredFor: PERSONAL_TIER_IDS,
    pattern: {
      regex: "^\\d{10}$",
      message: "UTR must be exactly 10 digits, no spaces.",
    },
  },
  {
    id: "sa_ni_proof",
    section: "P",
    label: "National Insurance proof",
    hint: "Upload your NI card, letter, or payslip clearly showing your NI number.",
    kind: "upload",
    requiredFor: PERSONAL_TIER_IDS,
  },
  {
    id: "sa_last_year_return",
    section: "P",
    label: "Last year's tax return",
    hint: "Optional — if you filed last year, uploading a copy helps us pick up where it left off.",
    kind: "upload",
    requiredFor: [],
  },
  {
    id: "sa_was_employed",
    section: "P",
    label: "Were you employed this tax year?",
    hint: "Optional — tells us whether to expect a P60 / P45. You can leave blank if neither applies.",
    kind: "select",
    options: ["Yes", "No"],
    requiredFor: [],
  },
  {
    id: "sa_p60_p45",
    section: "P",
    label: "P60 and / or P45",
    hint: "P60 is the year-end summary from an employer; P45 is issued when you leave a job. Upload whichever applies — multiple allowed.",
    kind: "upload",
    requiredFor: [],
    multi: true,
    showWhen: { fieldId: "sa_was_employed", equals: "Yes" },
  },
  {
    id: "sa_p11d",
    section: "P",
    label: "P11D (benefits in kind)",
    hint: "Optional — only if your employer issues one for company car, medical, etc.",
    kind: "upload",
    requiredFor: [],
  },
  {
    id: "sa_interest_certificates",
    section: "P",
    label: "Bank interest certificates",
    hint: "Optional — certificates or statements showing taxable interest earned. Multiple allowed.",
    kind: "upload",
    requiredFor: [],
    multi: true,
  },
  {
    id: "sa_dividend_vouchers",
    section: "P",
    label: "Dividend vouchers",
    hint: "Optional — vouchers or statements for any dividends received. Multiple allowed.",
    kind: "upload",
    requiredFor: [],
    multi: true,
  },
  {
    id: "sa_capital_gains",
    section: "P",
    label: "Capital gains documents",
    hint: "Optional — broker statements, completion statements, or crypto exchange CSVs for any disposals. Multiple allowed.",
    kind: "upload",
    requiredFor: [],
    multi: true,
  },
  {
    id: "sa_rental_docs",
    section: "P",
    label: "Rental income, expenses & mortgage statements",
    hint: "Optional — upload rental statements, expenses receipts, and mortgage interest certificates for any let property. Multiple allowed.",
    kind: "upload",
    requiredFor: [],
    multi: true,
  },
  {
    id: "sa_private_pension",
    section: "P",
    label: "Private pension contributions",
    hint: "Optional — amount contributed personally this year and the provider (e.g. Vanguard SIPP, £6,000).",
    kind: "text",
    requiredFor: [],
  },
  {
    id: "sa_gift_aid",
    section: "P",
    label: "Charitable donations (Gift Aid)",
    hint: "Optional — annual total of donations where you ticked Gift Aid. We'll claim the higher-rate top-up for you.",
    kind: "text",
    requiredFor: [],
  },
  {
    id: "sa_child_benefit",
    section: "P",
    label: "Child benefit received",
    hint: "Optional — e.g. \"Yes, £X per month\" or \"No\". Needed for the High Income Child Benefit Charge if either partner earns over £60k.",
    kind: "text",
    requiredFor: [],
  },
  {
    id: "sa_overseas",
    section: "P",
    label: "Overseas income and tax paid",
    hint: "Optional — upload any foreign income statements and foreign tax paid certificates. Multiple allowed.",
    kind: "upload",
    requiredFor: [],
    multi: true,
  },
  {
    id: "sa_student_loan",
    section: "P",
    label: "Student loan position",
    hint: "Optional — e.g. \"Plan 2, approx £18k outstanding\" or \"paid off\".",
    kind: "text",
    requiredFor: [],
  },
  {
    id: "sa_anything_else",
    section: "P",
    label: "Anything else we should know?",
    hint: "Optional — one-off events, major life changes, or anything you're unsure about.",
    kind: "text",
    requiredFor: [],
  },
];

// The one field whose answer is never stored in the plain intake_answers
// JSONB. Encrypted via pgcrypto RPC and read back only by admin + the
// assigned accountant. The client form writes it as a normal field; the
// server action detects it by id and routes to set_company_auth_code.
export const ENCRYPTED_FIELD_ID = "company_auth_code";

export function sectionsForTier(tier: TierId): ChecklistSectionDef[] {
  return CHECKLIST_SECTIONS.filter(
    (s) => !s.showForTiers || s.showForTiers.includes(tier),
  );
}

export function fieldsForTier(tier: TierId): ChecklistField[] {
  const visibleSections = new Set(sectionsForTier(tier).map((s) => s.key));
  return CHECKLIST_FIELDS.filter((f) => visibleSections.has(f.section));
}

// Which fields in the visible-for-this-tier set are required for this
// particular tier. Used by both the client submit guard and the server
// validator — single source of truth. Does NOT filter by showWhen: a
// field with a showWhen that doesn't match is simply hidden and so
// never counts as missing. See `requiredFieldsForTierGiven` for the
// visibility-aware version.
export function requiredFieldsForTier(tier: TierId): ChecklistField[] {
  return fieldsForTier(tier).filter((f) => f.requiredFor.includes(tier));
}

// Visibility gate on a single field for a given set of answers.
// A field with no `showWhen` is always visible. A field whose
// `showWhen` references an unanswered question is hidden until that
// question is answered — which is the right default for conditional
// branches like Section B's ID type.
export function fieldIsVisible(
  field: ChecklistField,
  answers: Record<string, string> | null | undefined,
): boolean {
  if (!field.showWhen) return true;
  const current = answers?.[field.showWhen.fieldId];
  return current === field.showWhen.equals;
}

// Fields visible for this tier *and* for the given answers. Use this
// in the client form when rendering + in required-count math so a
// conditional branch toggle re-counts correctly.
export function visibleFieldsForTier(
  tier: TierId,
  answers: Record<string, string> | null | undefined,
): ChecklistField[] {
  return fieldsForTier(tier).filter((f) => fieldIsVisible(f, answers));
}

// Required subset of visible fields. The onboarding submit guard calls
// this with the current intake_answers so a Passport-only path doesn't
// demand driving-licence uploads, and vice versa.
export function requiredFieldsForTierGiven(
  tier: TierId,
  answers: Record<string, string> | null | undefined,
): ChecklistField[] {
  return visibleFieldsForTier(tier, answers).filter((f) =>
    f.requiredFor.includes(tier),
  );
}

// Legacy driving-licence upload key. Before the Passport/Driving-licence
// branch was introduced, Section B had a single "Driving licence"
// upload at this key. New flow splits it into front + back under
// `director_driving_licence_front` / `_back`. We keep this constant
// exported so the form and panel views can surface any legacy uploads
// as a read-only "previously uploaded" row — the data is still in
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
