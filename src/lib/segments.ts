export type SegmentId =
  | "first_time_filer"
  | "self_employed"
  | "landlord"
  | "investor"
  | "cis"
  | "high_earner";

export type IntakeField = {
  name: string;
  label: string;
  hint?: string;
  type: "text" | "textarea" | "number" | "select";
  required?: boolean;
  options?: string[];
  prefix?: string;
};

export type Segment = {
  id: SegmentId;
  title: string;
  tagline: string;
  numeral: "①" | "②" | "③" | "④" | "⑤" | "⑥";
  intake: IntakeField[];
  suggestedDocs: string[];
};

export const SEGMENTS: Segment[] = [
  {
    id: "first_time_filer",
    title: "First-time filer",
    tagline: "New to Self Assessment — we'll tell you what's needed in plain English.",
    numeral: "①",
    intake: [
      {
        name: "employment_status",
        label: "Employment status this tax year",
        type: "select",
        options: ["Employed", "Self-employed", "Both", "Neither"],
        required: true,
      },
      {
        name: "other_income",
        label: "Any income beyond your main salary?",
        hint: "e.g. rental, freelance, crypto, dividends",
        type: "textarea",
      },
      {
        name: "tax_code",
        label: "Current tax code (if known)",
        hint: "On your P60 or payslip",
        type: "text",
      },
    ],
    suggestedDocs: ["P60", "P45 (if changed jobs)", "Payslips"],
  },
  {
    id: "self_employed",
    title: "Self-employed",
    tagline: "Sole trader / freelancer — income, expenses, and deductions.",
    numeral: "②",
    intake: [
      {
        name: "trade",
        label: "Trade or profession",
        type: "text",
        required: true,
      },
      {
        name: "annual_turnover",
        label: "Approximate annual turnover",
        prefix: "£",
        type: "number",
        required: true,
      },
      {
        name: "vat_registered",
        label: "Are you VAT-registered?",
        type: "select",
        options: ["No", "Yes — standard", "Yes — flat rate"],
        required: true,
      },
      {
        name: "notes",
        label: "Anything unusual we should know?",
        hint: "Major purchases, closed periods, foreign income…",
        type: "textarea",
      },
    ],
    suggestedDocs: ["Invoices", "Receipts / expenses", "Business bank statements"],
  },
  {
    id: "landlord",
    title: "Landlord",
    tagline: "Rental income, mortgage interest, allowable expenses.",
    numeral: "③",
    intake: [
      {
        name: "property_count",
        label: "Number of let properties",
        type: "number",
        required: true,
      },
      {
        name: "total_rental_income",
        label: "Total rental income for the year",
        prefix: "£",
        type: "number",
        required: true,
      },
      {
        name: "mortgages",
        label: "Are any properties mortgaged?",
        type: "select",
        options: ["No", "Yes — one", "Yes — multiple"],
        required: true,
      },
      {
        name: "notes",
        label: "Anything else about the properties?",
        hint: "e.g. HMO, short-lets, foreign property",
        type: "textarea",
      },
    ],
    suggestedDocs: ["Rental statements", "Mortgage interest certificate", "Repair receipts"],
  },
  {
    id: "investor",
    title: "Investor",
    tagline: "Capital gains from shares, crypto, or property sales.",
    numeral: "④",
    intake: [
      {
        name: "asset_types",
        label: "What did you sell this year?",
        hint: "Shares / crypto / property / other",
        type: "text",
        required: true,
      },
      {
        name: "approx_proceeds",
        label: "Approximate total proceeds",
        prefix: "£",
        type: "number",
        required: true,
      },
      {
        name: "uk_resident",
        label: "UK tax resident for the full year?",
        type: "select",
        options: ["Yes", "No", "Not sure"],
        required: true,
      },
    ],
    suggestedDocs: ["Broker statements", "Crypto exchange CSVs", "Completion statement"],
  },
  {
    id: "cis",
    title: "CIS / Construction",
    tagline: "Sub-contractor deductions — most workers are owed a refund.",
    numeral: "⑤",
    intake: [
      {
        name: "cis_deductions",
        label: "Total CIS deductions taken this year",
        prefix: "£",
        type: "number",
        required: true,
      },
      {
        name: "vehicle_expenses",
        label: "Vehicle / mileage costs",
        prefix: "£",
        type: "number",
      },
      {
        name: "materials",
        label: "Materials you paid for",
        prefix: "£",
        type: "number",
      },
      {
        name: "notes",
        label: "Anything else?",
        type: "textarea",
      },
    ],
    suggestedDocs: [
      "CIS deduction statements",
      "Fuel / mileage log",
      "Materials receipts",
    ],
  },
  {
    id: "high_earner",
    title: "High earner",
    tagline: "Higher / additional rate, tapered allowances, pensions.",
    numeral: "⑥",
    intake: [
      {
        name: "base_salary",
        label: "Base salary",
        prefix: "£",
        type: "number",
        required: true,
      },
      {
        name: "bonus_and_dividends",
        label: "Bonus and/or dividends",
        prefix: "£",
        type: "number",
      },
      {
        name: "pension_contributions",
        label: "Pension contributions (your side)",
        prefix: "£",
        type: "number",
      },
      {
        name: "other_income",
        label: "Anything else? (rental, side income, foreign)",
        type: "textarea",
      },
    ],
    suggestedDocs: ["P60", "Bonus / share vesting statements", "Pension provider statement"],
  },
];

export function getSegment(id: string | null | undefined): Segment | null {
  if (!id) return null;
  return SEGMENTS.find((s) => s.id === id) ?? null;
}
