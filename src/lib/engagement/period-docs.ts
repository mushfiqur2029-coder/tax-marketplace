import type { TierId } from "@/lib/plans";
import type { ChecklistField } from "@/lib/engagement/checklist";

// Second-stage document checklist for non_vat_reg + vat_reg. Fires once
// the accountant enters the accounting period dates and before the
// client approval cycle starts. Dormant skips this step entirely.
//
// Same ChecklistField shape as the onboarding schema so the
// OnboardingForm's UploadRow / DocumentUploader can be reused without a
// parallel component. requiredFor lists the TierIds that MUST have this
// field; empty = optional for everyone. The PAYE summary is conditional
// — required only when the case has payroll_registered OR the client
// uploaded a PAYE certificate in Section A — so its requiredFor stays
// empty here and the caller promotes it to required at runtime.

export const PERIOD_DOC_FIELDS: ChecklistField[] = [
  {
    id: "period_bank_statements_pdf",
    section: "A",
    label: "Company bank statements for the full period (PDF)",
    hint: "Statements covering every day of the accounting period.",
    kind: "upload",
    requiredFor: ["non_vat_reg", "vat_reg"],
    multi: true,
  },
  {
    id: "period_bank_statements_csv",
    section: "A",
    label: "Company bank statements for the full period (CSV)",
    hint: "The same statements as transaction data, so your accountant can categorise lines fast.",
    kind: "upload",
    requiredFor: ["non_vat_reg", "vat_reg"],
    multi: true,
  },
  {
    id: "period_credit_card_statements",
    section: "A",
    label: "Company credit card statements",
    kind: "upload",
    requiredFor: [],
    multi: true,
  },
  {
    id: "period_sales_invoices",
    section: "A",
    label: "Sales documents / invoices",
    kind: "upload",
    requiredFor: [],
    multi: true,
  },
  {
    id: "period_purchase_invoices",
    section: "A",
    label: "Purchase documents / invoices",
    kind: "upload",
    requiredFor: [],
    multi: true,
  },
  {
    id: "period_bills",
    section: "A",
    label: "Bill copies",
    kind: "upload",
    requiredFor: [],
    multi: true,
  },
  {
    id: "period_paye_summary",
    section: "A",
    label: "PAYE summary",
    hint: "Required when the company is payroll-registered.",
    kind: "upload",
    // Promoted to required at runtime via periodDocFieldsForCase().
    requiredFor: [],
    multi: true,
  },
];

export const PERIOD_PAYE_FIELD_ID = "period_paye_summary";
export const SECTION_A_PAYE_UPLOAD_ID = "paye_certificate";
export const ACCOUNTANT_ANNUAL_ACCOUNTS_KEY = "accountant_annual_accounts";
export const ACCOUNTANT_CT600_KEY = "accountant_ct600";

// Dormant short-circuits the entire period-docs flow — the spec is
// explicit about "no further client-facing step" after Sections A/B/C.
export function periodDocsApplyToTier(tier: TierId): boolean {
  return tier === "non_vat_reg" || tier === "vat_reg";
}

// Returns the field list for a specific case, with PAYE summary
// promoted to required when payroll applies to the company. The caller
// passes the two booleans so the schema file stays pure data and the
// decision ("is PAYE actually in scope?") lives next to the case row
// that owns the answer.
export function periodDocFieldsForCase(opts: {
  payrollRegistered: boolean;
  payeCertificateUploadedInSectionA: boolean;
}): ChecklistField[] {
  const payeInScope =
    opts.payrollRegistered || opts.payeCertificateUploadedInSectionA;
  return PERIOD_DOC_FIELDS.map((f) => {
    if (f.id !== PERIOD_PAYE_FIELD_ID) return f;
    if (!payeInScope) return f;
    // Shallow-clone with an overridden requiredFor so the submit guard
    // sees it as required for both applicable tiers.
    return { ...f, requiredFor: ["non_vat_reg", "vat_reg"] as TierId[] };
  });
}

export function requiredPeriodDocFieldsForCase(opts: {
  tier: TierId;
  payrollRegistered: boolean;
  payeCertificateUploadedInSectionA: boolean;
}): ChecklistField[] {
  return periodDocFieldsForCase(opts).filter((f) =>
    f.requiredFor.includes(opts.tier),
  );
}

export const PERIOD_DOCS_FOOTER_NOTE =
  "Please upload every required file. We can prepare your accounts the moment the full period's bank data is in. Missing files delay filing.";
