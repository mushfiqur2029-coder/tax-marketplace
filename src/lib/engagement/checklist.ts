import type { TierId } from "@/lib/plans";

// Limited-company onboarding checklist schema.
//
// Source of truth for both the client-facing form and the server-side
// "all required fields present" validation. Transcribed from
// design-reference/limited-company-document-checklists.md with the
// DEFAULT answers already applied inline.
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

export type ChecklistSection = "A" | "B" | "C" | "D";

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
    }
  | {
      id: string;
      section: ChecklistSection;
      label: string;
      hint?: string;
      kind: "upload";
      requiredFor: TierId[];
      multi?: boolean;
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
  },
  {
    key: "B",
    title: "Director's Details",
  },
  {
    key: "C",
    title: "Registration Service",
  },
  {
    key: "D",
    title: "VAT Details",
    showForTiers: ["vat_reg"],
  },
];

// All three services share Sections A, B, C. Section D is appended only
// when the chosen service is vat_reg. The order below is the order
// rendered to the client.
export const CHECKLIST_FIELDS: ChecklistField[] = [
  // ---------------- Section A: Company Details ----------------
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
  {
    id: "director_passport",
    section: "B",
    label: "Passport",
    kind: "upload",
    requiredFor: ["dormant", "non_vat_reg", "vat_reg"],
  },
  {
    id: "director_driving_licence",
    section: "B",
    label: "Driving licence",
    hint: "1st proof of address.",
    kind: "upload",
    requiredFor: ["dormant", "non_vat_reg", "vat_reg"],
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
    kind: "select",
    options: ["Monthly", "Quarterly", "Annually"],
    requiredFor: ["vat_reg"],
  },
  {
    id: "vat_scheme",
    section: "D",
    label: "VAT scheme",
    hint: "Choose Other to specify a scheme not listed.",
    kind: "select",
    options: ["Flat Rate", "Standard", "Other"],
    showOtherOn: "Other",
    requiredFor: ["vat_reg"],
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
// validator — single source of truth.
export function requiredFieldsForTier(tier: TierId): ChecklistField[] {
  return fieldsForTier(tier).filter((f) => f.requiredFor.includes(tier));
}

export const CHECKLIST_FOOTER_NOTE =
  "Please provide all the information requested. Missing information will delay your onboarding. Please also tell us as soon as possible if you have any overdue Accounts, VAT, CIS or PAYE returns, so we can help you avoid HMRC late filing penalties.";
