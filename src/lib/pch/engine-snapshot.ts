// Shared engine-input hydration for PCH cases. Both client-side submit
// and accountant-side snapshot refresh need to read the same raw DB
// state (pch_cases head + income/expense lines + vehicle) and shape it
// into TaxEngineInputs for computeAll().
//
// Pulled out of src/app/client/pch/actions.ts so the accountant workspace
// can re-run the snapshot after a P&L edit without duplicating the shape
// (and risking drift). Both callers run under the admin client; RLS
// is enforced upstream in the action's requireRole/requirePchCase
// guards, not inside this hydration code.

import type { createAdminClient } from "@/lib/supabase/admin";
import {
  getRatePackFor,
  hasRatePackFor,
  UK_TAX_RATES_2025_26,
  type TaxEngineInputs,
} from "@/lib/tax-engine";

export async function hydrateInputsFromDb(
  caseId: string,
  admin: ReturnType<typeof createAdminClient>,
): Promise<TaxEngineInputs> {
  const [{ data: head }, { data: inc }, { data: exp }, { data: veh }] =
    await Promise.all([
      admin.from("pch_cases").select("*").eq("case_id", caseId).single(),
      admin.from("pch_income_lines").select("*").eq("case_id", caseId).order("sort_order"),
      admin.from("pch_expense_lines").select("*").eq("case_id", caseId).order("sort_order"),
      admin.from("pch_vehicle").select("*").eq("case_id", caseId).maybeSingle(),
    ]);
  if (!head) throw new Error("Head row missing");

  // Pick the rate pack for THIS case's tax year, not the current year
  // always. Prior-year linked cases are rendered on the exact rate
  // schedule that applied to them. hasRatePackFor() lets the caller
  // fail fast with a human-readable "contact support" message if the
  // year has no pack yet.
  const taxYear = head.tax_year ?? "2025/26";
  const rates = hasRatePackFor(taxYear) ? getRatePackFor(taxYear) : UK_TAX_RATES_2025_26;

  return {
    rates,
    client: {
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
    },
    income: (inc ?? []).map((r) => ({
      grossTakings: (r.gross_takings_pence ?? 0) / 100,
      platformFee: (r.platform_fee_pence ?? 0) / 100,
      onTripMiles: r.on_trip_miles ?? 0,
      deadMiles: r.dead_miles ?? 0,
      type: r.line_type as "Fares" | "Other" | "VAT",
    })),
    expenses: (exp ?? []).map((r) => ({
      label: r.label,
      amountPaid: (r.amount_paid_pence ?? 0) / 100,
      evidence: r.evidence ?? "",
      carCost: r.car_cost as "Yes" | "No" | "Phone",
      category: r.category,
      sa103sBox: r.sa103s_box as 12 | 14 | 16 | 17 | 18 | 19,
    })),
    vehicle: {
      status: (veh?.status ?? "Owned outright") as
        "Owned outright" | "Bought on HP / loan" | "Rented weekly (PCO hire)" | "Leased",
      fuel: (veh?.fuel ?? "Petrol") as "Petrol" | "Diesel" | "Hybrid" | "Electric",
      co2Gpkm: veh?.co2_gpkm ?? undefined,
      boughtThisYear: (veh?.bought_this_year ? "Yes" : "No") as "Yes" | "No",
      purchasePrice: veh?.purchase_price_pence
        ? veh.purchase_price_pence / 100 : undefined,
      newOrUsed: veh?.new_or_used as "New" | "Used" | undefined,
      disposed: (veh?.disposed ? "Yes" : "No") as "Yes" | "No",
      disposalProceeds: veh?.disposal_proceeds_pence
        ? veh.disposal_proceeds_pence / 100 : undefined,
      odoStart: veh?.odo_start ?? undefined,
      odoEnd: veh?.odo_end ?? undefined,
      otherBusinessMiles: veh?.other_business_miles ?? 0,
      phoneBusinessPct: veh?.phone_business_pct
        ? Number(veh.phone_business_pct) : 0.8,
      wdvBroughtForward: (veh?.wdv_brought_forward_pence ?? 0) / 100,
      previousMethod: (veh?.previous_method ?? "First year") as
        "Simplified mileage" | "Actual costs (capital allowances claimed)" | "First year",
      businessPctOverride: veh?.business_pct_override
        ? Number(veh.business_pct_override) : undefined,
      capitalAllowanceRateOverride: veh?.ca_rate_override
        ? Number(veh.ca_rate_override) : undefined,
      methodChoice: veh?.method_choice as "Simplified mileage" | "Actual costs" | undefined,
      realMpg: veh?.real_mpg ? Number(veh.real_mpg) : undefined,
      fuelPricePerLitre: veh?.fuel_price_per_litre
        ? Number(veh.fuel_price_per_litre) : undefined,
    },
  };
}
