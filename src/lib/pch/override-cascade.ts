import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  computeTax,
  getRatePackFor,
  hasRatePackFor,
  UK_TAX_RATES_2025_26,
  type TaxEngineOutput,
} from "@/lib/tax-engine";
import { PCH_OVERRIDE_FIELD_BY_PATH } from "./overrides";

// Auto-cascade overrides when a parent engine figure is overridden.
// Keeps downstream dependents in step without re-running the full
// engine (which would also need to re-apply the override as an input,
// out of scope for now, see audit discussion for option β).
//
// Current cascade chain, as agreed with product:
//
//   pl.taxableProfit
//     -> tax.incomeTax          (fresh from computeTax on modified PL)
//     -> tax.class4             (same)
//     -> sa103s.box31_totalTaxableProfits  (rounded taxable profit)
//
// Rows get an `auto:` reason prefix so the audit log can tell them
// apart from accountant-authored overrides, and so a subsequent
// revert of the parent can walk the cascade and clean itself up
// without touching manual intent.

const AUTO_REASON = "auto: cascaded from Taxable profit";
const AUTO_REASON_PREFIX = "auto:";

export function isAutoCascadeReason(reason: string | null | undefined): boolean {
  return typeof reason === "string" && reason.startsWith(AUTO_REASON_PREFIX);
}

type HeadForTax = {
  tax_year: string | null;
  employment_income_pence: number | null;
  paye_pence: number | null;
  rental_profit_pence: number | null;
  bank_interest_pence: number | null;
  personal_pension_net_pence: number | null;
  gift_aid_net_pence: number | null;
  marriage_allowance_status: string | null;
  poa1_due_pence: number | null;
  poa2_due_pence: number | null;
  poa1_paid_pence: number | null;
  poa2_paid_pence: number | null;
  last_year_qi_pence: number | null;
  gross_rent_received_pence: number | null;
};

function clientFromHead(head: HeadForTax) {
  return {
    employmentIncome: (head.employment_income_pence ?? 0) / 100,
    paye: (head.paye_pence ?? 0) / 100,
    rentalProfit: (head.rental_profit_pence ?? 0) / 100,
    bankInterest: (head.bank_interest_pence ?? 0) / 100,
    personalPensionNet: (head.personal_pension_net_pence ?? 0) / 100,
    giftAidNet: (head.gift_aid_net_pence ?? 0) / 100,
    marriageAllowanceStatus: (head.marriage_allowance_status ?? "None") as
      "None" | "Transferring" | "Receiving",
    poa1Due: (head.poa1_due_pence ?? 0) / 100,
    poa2Due: (head.poa2_due_pence ?? 0) / 100,
    poa1Paid: (head.poa1_paid_pence ?? 0) / 100,
    poa2Paid: (head.poa2_paid_pence ?? 0) / 100,
    lastYearQualifyingIncome: (head.last_year_qi_pence ?? 0) / 100,
    grossRentReceived: (head.gross_rent_received_pence ?? 0) / 100,
  };
}

export async function cascadeTaxableProfitOverride(args: {
  admin: ReturnType<typeof createAdminClient>;
  caseId: string;
  meId: string;
  newTaxableProfit: number;
  snapshot: TaxEngineOutput;
}): Promise<void> {
  const { admin, caseId, meId, newTaxableProfit, snapshot } = args;

  const { data: head } = await admin
    .from("pch_cases")
    .select(
      "tax_year, employment_income_pence, paye_pence, rental_profit_pence, bank_interest_pence, personal_pension_net_pence, gift_aid_net_pence, marriage_allowance_status, poa1_due_pence, poa2_due_pence, poa1_paid_pence, poa2_paid_pence, last_year_qi_pence, gross_rent_received_pence",
    )
    .eq("case_id", caseId)
    .maybeSingle();
  if (!head) return;
  const taxYear = (head.tax_year as string | null) ?? "2025/26";
  const rates = hasRatePackFor(taxYear) ? getRatePackFor(taxYear) : UK_TAX_RATES_2025_26;

  // Modified PL: swap in the override so computeTax derives downstream
  // figures from the accountant's intent. Everything else on the PL
  // (turnover, expenses, capital allowances, per-row breakdown) stays
  // as the engine computed it.
  const pl = { ...snapshot.pl, taxableProfit: newTaxableProfit };
  const client = clientFromHead(head as HeadForTax);
  const newTax = computeTax(pl, client, rates);

  const cascades: Array<[string, number]> = [
    ["tax.incomeTax", newTax.incomeTax],
    ["tax.class4", newTax.class4],
    ["sa103s.box31_totalTaxableProfits", Math.round(newTaxableProfit)],
  ];

  for (const [path, value] of cascades) {
    const field = PCH_OVERRIDE_FIELD_BY_PATH[path];
    if (!field) continue;
    const engineValue = field.read(snapshot);
    // Skip no-op cascades: the computed cascade value already matches
    // what the engine produced, so no override is needed.
    if (Math.abs(engineValue - value) < 0.005) continue;
    await admin.from("pch_overrides").insert({
      case_id: caseId,
      field_path: path,
      old_value: String(engineValue),
      new_value: String(value),
      reason: AUTO_REASON,
      overridden_by: meId,
    });
  }
}

// Revert the cascade when the parent (pl.taxableProfit) is reverted.
// Only reverts a cascaded field if its newest row is itself an auto
// row; if the accountant manually overrode that field after the
// cascade landed, we leave it alone (their intent wins).
export async function cascadeRevertTaxableProfit(args: {
  admin: ReturnType<typeof createAdminClient>;
  caseId: string;
  meId: string;
}): Promise<void> {
  const { admin, caseId, meId } = args;
  const CASCADE_PATHS = [
    "tax.incomeTax",
    "tax.class4",
    "sa103s.box31_totalTaxableProfits",
  ];
  for (const path of CASCADE_PATHS) {
    const { data: latest } = await admin
      .from("pch_overrides")
      .select("new_value, reason")
      .eq("case_id", caseId)
      .eq("field_path", path)
      .order("overridden_at", { ascending: false })
      .limit(1);
    const row = latest?.[0];
    if (!row) continue;
    // If the newest row is already a revert (new_value null) or an
    // accountant-authored override (reason not auto:*), there's
    // nothing to do.
    if (row.new_value === null) continue;
    if (!isAutoCascadeReason(row.reason as string | null)) continue;
    await admin.from("pch_overrides").insert({
      case_id: caseId,
      field_path: path,
      old_value: row.new_value,
      new_value: null,
      reason: "auto: cascade revert",
      overridden_by: meId,
    });
  }
}
