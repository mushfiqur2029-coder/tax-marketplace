import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TaxEngineOutput } from "@/lib/tax-engine";
import {
  PCH_OVERRIDE_FIELDS,
  currentOverrides,
  type OverrideRow,
} from "./overrides";

// Build the structured export payload once; PDF and Excel exporters
// share this so the two downloads cannot drift from each other and
// cannot drift from the admin CSV. Values are override-aware: every
// SA103S box and headline figure reflects the latest effective value
// the accountant has signed off on, not the raw engine calculation.
//
// The payload has two parts:
//   - `accountsPack`: the clean client-facing accounts (cover, report,
//     client approval, P&L). Mirrors the Taj Accountants reference pack
//     format one-for-one.
//   - `workingPapers`: SA103S boxes, Tax & NIC detail, override audit.
//     Appended as later pages in the PDF and extra sheets in the Excel,
//     clearly labelled "not for filing".

export type PchExportPayload = {
  caseId: string;
  taxYear: string;             // e.g. "2025/26"
  periodFromIso: string;       // "2025-04-06"
  periodToIso: string;         // "2026-04-05"
  periodFromDisplay: string;   // "06/04/2025"
  periodToDisplay: string;     // "05/04/2026"
  periodEndedPhrase: string;   // "5 April 2026" (used in disclaimer paragraphs)

  // Who the pack is about.
  client: {
    name: string;
    reference: string;         // Short case ref: last 8 of case id
    occupation: string;        // "Private Hire Car Driver" (hardcoded for PCH tier)
    addressLines: string[];    // Multi-line, each line goes on its own row
    utr: string | null;
    niNumber: string | null;
  };

  // "Prepared By:" firm block. Pulled from the assigned accountant_profile
  // columns (trading_name > company_name > legal_name > name); address
  // from the new accountant_profiles.address column (NULL = no address
  // block). Falls back to Sterling Ledger platform defaults when no
  // accountant is assigned.
  preparedBy: {
    firmName: string;
    addressLines: string[];
    accountantEmail: string | null;
  };

  // Clean client-facing P&L, matches the reference pack layout.
  accountsPack: {
    income: number;
    expenses: { label: string; amount: number }[];
    expensesTotal: number;
    netProfit: number;
  };

  // Accountant working papers: tax calc + SA103S + overrides.
  workingPapers: {
    pl: {
      turnover: number;
      expensesTotal: number;
      netProfit: number;
      capitalAllowances: number;
      taxableProfit: number;
    };
    tax: {
      incomeTax: number;
      class4: number;
      class2Note: string;
      totalDue: number;
      balancingPayment: number;
      poaForNextYear: number;
    };
    sa103sBoxes: { path: string; label: string; engine: number; effective: number }[];
    overrides: {
      fieldPath: string;
      fieldLabel: string;
      oldValue: number | null;
      newValue: number | null;
      reason: string | null;
      overriddenAt: string;
      overriddenByEmail: string | null;
    }[];
  };

  status: string;
  snapshotAt: string | null;
  approval: {
    name: string | null;
    at: string | null;
  };

  // The two dates that go on the signature lines (ACCOUNTANT'S REPORT
  // + CLIENT'S APPROVAL on page 2, and the P&L sign-off on page 3).
  // sentAt is when the accountant finalised and sent this pack
  // (final_pack_sent_at); confirmedAt is when the client typed their
  // name to confirm it (final_pack_confirmed_at). Either can be null
  // (not reached that step yet), in which case the signature line
  // falls back to a blank dotted line for manual dating.
  finalPack: {
    sentAt: string | null;
    confirmedAt: string | null;
  };
};

const SL_FALLBACK_FIRM_NAME = "Sterling Ledger";
const SL_FALLBACK_ADDRESS_LINES: string[] = []; // Platform-default: no address block when nothing is on file

// Parse "YYYY/YY" (e.g. "2025/26") into the UK tax-year period dates.
// Fallback to the current tax year if the string is malformed.
function parsePeriod(taxYear: string): {
  fromIso: string; toIso: string; fromDisplay: string; toDisplay: string; endedPhrase: string;
} {
  const m = /^(\d{4})\/(\d{2})$/.exec(taxYear);
  const startYear = m ? Number(m[1]) : new Date().getFullYear();
  const endYear = startYear + 1;
  const fromIso = `${startYear}-04-06`;
  const toIso = `${endYear}-04-05`;
  return {
    fromIso,
    toIso,
    fromDisplay: `06/04/${startYear}`,
    toDisplay: `05/04/${endYear}`,
    endedPhrase: `5 April ${endYear}`,
  };
}

function splitAddress(raw: string | null | undefined): string[] {
  if (!raw) return [];
  // Supports both newline-separated and comma-separated input. Comma split
  // is lossy for addresses with commas inside a single line, so prefer
  // newlines when the admin uses them.
  const normalised = raw.includes("\n")
    ? raw.split("\n")
    : raw.split(",");
  return normalised.map((s) => s.trim()).filter(Boolean);
}

export async function buildPchExportPayload(
  caseId: string,
): Promise<PchExportPayload | null> {
  const admin = createAdminClient();

  const { data: caseRow } = await admin
    .from("cases")
    .select("id, client_id, accountant_id, status, tier")
    .eq("id", caseId)
    .single();
  if (!caseRow || caseRow.tier !== "uber_phv_automated") return null;

  const [
    { data: head },
    { data: overridesRaw },
    { data: client },
    { data: accountantProfile },
    { data: accountantUser },
  ] = await Promise.all([
    admin
      .from("pch_cases")
      .select("tax_year, cl_name, cl_email, cl_utr, cl_nino, cl_address, cl_postcode, engine_snapshot, engine_snapshot_at, client_approval_at, client_approval_name, final_pack_sent_at, final_pack_confirmed_at")
      .eq("case_id", caseId)
      .single(),
    admin
      .from("pch_overrides")
      .select("id, field_path, old_value, new_value, reason, overridden_by, overridden_at")
      .eq("case_id", caseId)
      .order("overridden_at", { ascending: false }),
    admin.from("users").select("id, email").eq("id", caseRow.client_id).maybeSingle(),
    caseRow.accountant_id
      ? admin
          .from("accountant_profiles")
          .select("name, company_name, legal_name, trading_name, address")
          .eq("user_id", caseRow.accountant_id)
          .maybeSingle()
      : Promise.resolve({ data: null } as { data: null }),
    caseRow.accountant_id
      ? admin
          .from("users")
          .select("email")
          .eq("id", caseRow.accountant_id)
          .maybeSingle()
      : Promise.resolve({ data: null } as { data: null }),
  ]);

  const snapshot = (head?.engine_snapshot ?? null) as TaxEngineOutput | null;
  const overrides = (overridesRaw ?? []) as OverrideRow[];
  const effective = snapshot ? currentOverrides(overrides) : new Map();

  // Resolve user emails for overridden_by so the audit trail reads as
  // "jane@firm.com" rather than a bare uuid.
  const touchedBy = Array.from(
    new Set(overrides.map((o) => o.overridden_by).filter(Boolean) as string[]),
  );
  const { data: touchedByUsers } = touchedBy.length
    ? await admin.from("users").select("id, email").in("id", touchedBy)
    : { data: [] as { id: string; email: string }[] };
  const emailById = new Map((touchedByUsers ?? []).map((u) => [u.id, u.email]));

  const pickEffective = (path: string, calculated: number) =>
    effective.get(path)?.value ?? calculated;

  const workingPapers: PchExportPayload["workingPapers"] = snapshot
    ? {
        pl: {
          turnover: snapshot.pl.turnover,
          expensesTotal: snapshot.pl.expensesTotal,
          netProfit: snapshot.pl.netProfit,
          capitalAllowances: pickEffective("pl.capitalAllowances", snapshot.pl.capitalAllowances),
          taxableProfit: pickEffective("pl.taxableProfit", snapshot.pl.taxableProfit),
        },
        tax: {
          incomeTax: pickEffective("tax.incomeTax", snapshot.tax.incomeTax),
          class4: pickEffective("tax.class4", snapshot.tax.class4),
          class2Note: snapshot.tax.class2Suggestion,
          totalDue: snapshot.tax.totalTaxAndNic,
          balancingPayment: snapshot.tax.balancingPayment,
          poaForNextYear: snapshot.tax.poaForNextYear,
        },
        sa103sBoxes: PCH_OVERRIDE_FIELDS
          .filter((f) => f.group === "SA103S boxes")
          .map((f) => {
            const engine = f.read(snapshot);
            const effectiveValue = effective.get(f.path)?.value ?? engine;
            return { path: f.path, label: f.label, engine, effective: effectiveValue };
          }),
        overrides: overrides.map((o) => {
          const field = PCH_OVERRIDE_FIELDS.find((f) => f.path === o.field_path);
          return {
            fieldPath: o.field_path,
            fieldLabel: field?.label ?? o.field_path,
            oldValue: o.old_value != null ? Number(o.old_value) : null,
            newValue: o.new_value != null ? Number(o.new_value) : null,
            reason: o.reason,
            overriddenAt: o.overridden_at,
            overriddenByEmail: o.overridden_by ? emailById.get(o.overridden_by) ?? null : null,
          };
        }),
      }
    : {
        pl: { turnover: 0, expensesTotal: 0, netProfit: 0, capitalAllowances: 0, taxableProfit: 0 },
        tax: { incomeTax: 0, class4: 0, class2Note: "", totalDue: 0, balancingPayment: 0, poaForNextYear: 0 },
        sa103sBoxes: [],
        overrides: [],
      };

  // Clean client-facing P&L. Numbers come from the engine snapshot
  // (override-aware), not the raw intake rows. Reason: the simplified
  // mileage method REPLACES car costs with a flat per-mile allowance,
  // so showing raw Fuel + Mileage would double-count. Platform fees
  // live on pch_income_lines, not pch_expense_lines, so a per-label
  // walk of the expense table misses them entirely. The engine has
  // already resolved both of those into its SA103S box totals, which
  // reconcile to the net-profit figure exactly.
  //
  // Expense categories are the HMRC-standard SA103S box labels; we
  // only emit boxes with non-zero amounts so the pack stays short on
  // a thin case.
  const income = snapshot ? snapshot.pl.turnover : 0;
  const engineExpensesTotal = snapshot ? snapshot.pl.expensesTotal : 0;
  const boxLabels: { path: string; label: string }[] = [
    { path: "sa103s.box12_carVanTravel", label: "Car, van and travel costs" },
    { path: "sa103s.box14_rentRatesPowerInsurance", label: "Rent, rates, power and insurance" },
    { path: "sa103s.box16_accountancyLegalProf", label: "Accountancy, legal and professional fees" },
    { path: "sa103s.box17_interestBankCardCharges", label: "Interest and bank charges" },
    { path: "sa103s.box18_phoneAndOfficeCosts", label: "Phone, fax, stationery and office costs" },
    { path: "sa103s.box19_otherAllowable", label: "Other allowable business expenses" },
  ];
  const categorisedExpenses: { label: string; amount: number }[] = [];
  if (snapshot) {
    for (const b of boxLabels) {
      const field = PCH_OVERRIDE_FIELDS.find((f) => f.path === b.path);
      if (!field) continue;
      const amount = effective.get(b.path)?.value ?? field.read(snapshot);
      if (amount <= 0.5) continue;
      categorisedExpenses.push({ label: b.label, amount });
    }
  }

  const accountsPack: PchExportPayload["accountsPack"] = {
    income,
    expenses: categorisedExpenses,
    expensesTotal: engineExpensesTotal,
    // Client-facing Net Profit = Income - Expenses only. Capital
    // allowances and tax deductions live in the working papers.
    netProfit: income - engineExpensesTotal,
  };

  const period = parsePeriod(head?.tax_year ?? "2025/26");

  // Client address: UK free-text address + separate postcode on PCH head.
  // Preserve multi-line layout for display; postcode goes on its own line
  // to match the reference pack.
  const addressBase = splitAddress(head?.cl_address ?? null);
  const clientAddressLines = head?.cl_postcode
    ? [...addressBase, head.cl_postcode]
    : addressBase;

  // Firm name resolution. trading_name wins because that's the brand
  // the client already sees on the engagement letter; fall back through
  // company_name, legal_name, personal name, and finally the platform
  // default so a half-filled profile still produces a sensible pack.
  const firmName =
    accountantProfile?.trading_name
    ?? accountantProfile?.company_name
    ?? accountantProfile?.legal_name
    ?? accountantProfile?.name
    ?? SL_FALLBACK_FIRM_NAME;
  const firmAddressLines = accountantProfile?.address
    ? splitAddress(accountantProfile.address)
    : SL_FALLBACK_ADDRESS_LINES;

  return {
    caseId,
    taxYear: head?.tax_year ?? "2025/26",
    periodFromIso: period.fromIso,
    periodToIso: period.toIso,
    periodFromDisplay: period.fromDisplay,
    periodToDisplay: period.toDisplay,
    periodEndedPhrase: period.endedPhrase,
    client: {
      name: head?.cl_name ?? client?.email ?? "",
      reference: caseId.slice(0, 8).toUpperCase(),
      occupation: "Private Hire Car Driver",
      addressLines: clientAddressLines,
      utr: head?.cl_utr ?? null,
      niNumber: head?.cl_nino ?? null,
    },
    preparedBy: {
      firmName,
      addressLines: firmAddressLines,
      accountantEmail: accountantUser?.email ?? null,
    },
    accountsPack,
    workingPapers,
    status: caseRow.status,
    snapshotAt: head?.engine_snapshot_at ?? null,
    approval: {
      name: head?.client_approval_name ?? null,
      at: head?.client_approval_at ?? null,
    },
    finalPack: {
      sentAt: head?.final_pack_sent_at ?? null,
      confirmedAt: head?.final_pack_confirmed_at ?? null,
    },
  };
}
