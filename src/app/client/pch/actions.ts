"use server";

// Server actions for the Uber/PHV automated case flow (phase 2a).
//
// All writes go through the service-role admin client, bypassing RLS;
// each action re-validates ownership (case.client_id === me.id) before
// touching the row. Pattern matches the existing manual flow.
//
// Status gating convention: these actions mutate the structured intake
// tables and don't themselves move case status. The explicit transition
// actions (submitClientIntakeAction, approveDraftAction) are the only
// paths that change cases.status; both re-check the dual sign-off gate
// at write time.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TaxEngineOutput } from "@/lib/tax-engine";
import {
  computeAll,
  UK_TAX_RATES_2025_26,
} from "@/lib/tax-engine";

type ActionOk = { ok: true };
type ActionErr = { ok: false; error: string };
type ActionResult = ActionOk | ActionErr;
type ActionResultWith<T> = (ActionOk & T) | ActionErr;

// -------------------------------------------------------------------
// Ownership guard: throw if the signed-in client doesn't own this case
// AND the case isn't a PCH automated one.
// -------------------------------------------------------------------
async function requirePchCase(caseId: string) {
  const me = await requireRole("client");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cases")
    .select("id, client_id, accountant_id, status, tier")
    .eq("id", caseId)
    .single();
  if (error || !data) throw new Error("Case not found.");
  if (data.client_id !== me.id) throw new Error("Not your case.");
  if (data.tier !== "uber_phv_automated") {
    throw new Error("Not a PCH automated case.");
  }
  return { me, caseRow: data };
}

// -------------------------------------------------------------------
// Document upload: writes to the shared case-documents bucket + inserts
// a case_documents row tagged with the PCH slot code as requirement_key.
// Mirrors uploadAccountantDocumentAction's pattern byte for byte; only
// the slot-key allow-list differs (24 PCH slots vs the 2 accountant
// slots that action polices).
// -------------------------------------------------------------------
export async function uploadPchDocumentAction(
  caseId: string,
  slotCode: string,
  formData: FormData,
): Promise<ActionResultWith<{ id: string; file_name: string; uploaded_at: string }>> {
  const { me } = await requirePchCase(caseId);
  const admin = createAdminClient();

  // Slot code must be one of the known PCH-01..PCH-24 codes.
  const { data: slot } = await admin
    .from("pch_doc_slots")
    .select("code")
    .eq("code", slotCode)
    .maybeSingle();
  if (!slot) return { ok: false, error: "Unknown document slot." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Pick a file first." };
  }
  const MAX = 50 * 1024 * 1024;
  if (file.size > MAX) return { ok: false, error: "File is over 50 MB." };

  // PDF / JPG / PNG only (spec from Client Documents xlsx column E).
  const nameLower = file.name.toLowerCase();
  const typeLower = (file.type || "").toLowerCase();
  const looksRight =
    /\.(pdf|jpe?g|png)$/.test(nameLower)
    || typeLower === "application/pdf"
    || typeLower.startsWith("image/");
  if (!looksRight) {
    return { ok: false, error: "This slot accepts PDF, JPG or PNG only." };
  }

  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${caseId}/${Date.now()}_${safeName}`;
  const buf = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await admin.storage
    .from("case-documents")
    .upload(path, buf, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) return { ok: false, error: upErr.message };

  const { data: inserted, error: insErr } = await admin
    .from("case_documents")
    .insert({
      case_id: caseId,
      file_url: path,
      file_name: file.name,
      uploaded_by: me.id,
      requirement_key: slotCode,
    })
    .select("id, file_name, uploaded_at")
    .single();
  if (insErr) return { ok: false, error: insErr.message };

  // Mark the slot as Uploaded on the per-case checklist.
  await admin.from("pch_doc_status").upsert(
    { case_id: caseId, slot_code: slotCode, status: "Uploaded",
      updated_at: new Date().toISOString(), updated_by: me.id },
    { onConflict: "case_id,slot_code" },
  );

  revalidatePath(`/client/cases/${caseId}/pch`);
  return { ok: true, id: inserted.id, file_name: inserted.file_name,
    uploaded_at: inserted.uploaded_at };
}

// -------------------------------------------------------------------
// Head row (pch_cases) upsert — called on first visit to the intake,
// so every subsequent save can assume the row exists.
// -------------------------------------------------------------------
export async function ensurePchHeadRow(caseId: string): Promise<ActionResult> {
  const { me } = await requirePchCase(caseId);
  const admin = createAdminClient();
  const { error } = await admin
    .from("pch_cases")
    .upsert({ case_id: caseId, cl_email: me.email }, { onConflict: "case_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// -------------------------------------------------------------------
// Save tab 1 (client details + other income + reliefs + POA + MTD + VAT)
// -------------------------------------------------------------------
type ClientTabPatch = {
  cl_name?: string;
  cl_utr?: string;
  cl_nino?: string;
  cl_dob?: string | null;
  cl_address?: string;
  cl_postcode?: string;
  cl_phone?: string;
  cl_email?: string;
  cl_address_changed?: boolean;
  cl_licensing_authority?: string;
  cl_platforms?: string;
  cl_start_date?: string | null;
  cl_stop_date?: string | null;
  employment_income_pence?: number;
  paye_pence?: number;
  rental_profit_pence?: number;
  bank_interest_pence?: number;
  benefits_note?: string;
  marriage_allowance_status?: "None" | "Transferring" | "Receiving";
  spouse_details?: string;
  personal_pension_net_pence?: number;
  gift_aid_net_pence?: number;
  student_loan_plan?: string;
  poa1_due_pence?: number;
  poa2_due_pence?: number;
  poa_reduced?: boolean;
  poa1_paid_pence?: number;
  poa2_paid_pence?: number;
  gross_rent_received_pence?: number;
  last_year_qi_pence?: number;
  vat_registered?: boolean;
  vat_registration_date?: string | null;
  vat_scheme?: string;
};

export async function savePchClientTabAction(
  caseId: string,
  patch: ClientTabPatch,
): Promise<ActionResult> {
  await requirePchCase(caseId);
  const admin = createAdminClient();
  const { error } = await admin
    .from("pch_cases")
    .update(patch)
    .eq("case_id", caseId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/client/cases/${caseId}/pch`);
  return { ok: true };
}

// -------------------------------------------------------------------
// Income lines (tab 2) — set-and-forget bulk replace. The client sends
// the full list and we atomically swap it. Simpler than per-row CRUD.
// -------------------------------------------------------------------
type IncomeLineInput = {
  source: string;
  gross_takings_pence: number;
  platform_fee_pence: number;
  on_trip_miles: number;
  dead_miles: number;
  evidence?: string;
  notes?: string;
  line_type: "Fares" | "Other" | "VAT";
};

export async function savePchIncomeLinesAction(
  caseId: string,
  lines: IncomeLineInput[],
): Promise<ActionResult> {
  await requirePchCase(caseId);
  const admin = createAdminClient();
  const { error: delErr } = await admin
    .from("pch_income_lines").delete().eq("case_id", caseId);
  if (delErr) return { ok: false, error: delErr.message };
  if (lines.length > 0) {
    const rows = lines.map((l, i) => ({
      case_id: caseId, sort_order: i,
      source: l.source,
      gross_takings_pence: l.gross_takings_pence | 0,
      platform_fee_pence: l.platform_fee_pence | 0,
      on_trip_miles: l.on_trip_miles | 0,
      dead_miles: l.dead_miles | 0,
      evidence: l.evidence ?? null,
      notes: l.notes ?? null,
      line_type: l.line_type,
    }));
    const { error: insErr } = await admin.from("pch_income_lines").insert(rows);
    if (insErr) return { ok: false, error: insErr.message };
  }
  revalidatePath(`/client/cases/${caseId}/pch`);
  return { ok: true };
}

// -------------------------------------------------------------------
// Expense lines (tab 3) — same bulk-replace pattern.
// -------------------------------------------------------------------
type ExpenseLineInput = {
  label: string;
  amount_paid_pence: number;
  evidence?: string;
  car_cost: "Yes" | "No" | "Phone";
  category:
    | "Vehicle running costs" | "Vehicle hire, lease & finance"
    | "Congestion, ULEZ, tolls & parking" | "Licences & compliance"
    | "Phone & technology" | "Platform & card fees"
    | "Finance & bank charges" | "Accountancy & insurance"
    | "Other expenses" | "VAT paid (Flat Rate Scheme)";
  sa103s_box: 12 | 14 | 16 | 17 | 18 | 19;
};

export async function savePchExpenseLinesAction(
  caseId: string,
  lines: ExpenseLineInput[],
): Promise<ActionResult> {
  await requirePchCase(caseId);
  const admin = createAdminClient();
  const { error: delErr } = await admin
    .from("pch_expense_lines").delete().eq("case_id", caseId);
  if (delErr) return { ok: false, error: delErr.message };
  if (lines.length > 0) {
    const rows = lines.map((l, i) => ({
      case_id: caseId, sort_order: i,
      label: l.label,
      amount_paid_pence: l.amount_paid_pence | 0,
      evidence: l.evidence ?? null,
      car_cost: l.car_cost,
      category: l.category,
      sa103s_box: l.sa103s_box,
    }));
    const { error: insErr } = await admin.from("pch_expense_lines").insert(rows);
    if (insErr) return { ok: false, error: insErr.message };
  }
  revalidatePath(`/client/cases/${caseId}/pch`);
  return { ok: true };
}

// -------------------------------------------------------------------
// Vehicle (tab 4) — single row per case.
// -------------------------------------------------------------------
type VehiclePatch = Record<string, unknown>;
export async function savePchVehicleAction(
  caseId: string,
  patch: VehiclePatch,
): Promise<ActionResult> {
  await requirePchCase(caseId);
  const admin = createAdminClient();
  const { error } = await admin.from("pch_vehicle").upsert(
    { case_id: caseId, ...patch },
    { onConflict: "case_id" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/client/cases/${caseId}/pch`);
  return { ok: true };
}

// -------------------------------------------------------------------
// Doc checklist slot status (mark as Uploaded / Not applicable / Awaiting
// with a note).
// -------------------------------------------------------------------
export async function setPchDocStatusAction(
  caseId: string,
  slotCode: string,
  status: "Uploaded" | "Not applicable" | "Awaiting",
  note?: string,
): Promise<ActionResult> {
  const { me } = await requirePchCase(caseId);
  const admin = createAdminClient();
  const { error } = await admin.from("pch_doc_status").upsert(
    { case_id: caseId, slot_code: slotCode, status, note: note ?? null,
      updated_at: new Date().toISOString(), updated_by: me.id },
    { onConflict: "case_id,slot_code" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/client/cases/${caseId}/pch`);
  return { ok: true };
}

// -------------------------------------------------------------------
// Run the engine + snapshot. Pulls the latest intake rows, hydrates
// TaxEngineInputs, calls computeAll, writes the output to
// pch_cases.engine_snapshot. The draft page reads this snapshot and
// the client approval signs off on it.
// -------------------------------------------------------------------
async function hydrateInputsFromDb(caseId: string, admin: ReturnType<typeof createAdminClient>) {
  const [{ data: head }, { data: inc }, { data: exp }, { data: veh }] =
    await Promise.all([
      admin.from("pch_cases").select("*").eq("case_id", caseId).single(),
      admin.from("pch_income_lines").select("*").eq("case_id", caseId).order("sort_order"),
      admin.from("pch_expense_lines").select("*").eq("case_id", caseId).order("sort_order"),
      admin.from("pch_vehicle").select("*").eq("case_id", caseId).maybeSingle(),
    ]);
  if (!head) throw new Error("Head row missing");
  return {
    rates: UK_TAX_RATES_2025_26,
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

export async function runEngineAndSnapshotAction(
  caseId: string,
): Promise<ActionResultWith<{ snapshot: TaxEngineOutput }>> {
  await requirePchCase(caseId);
  const admin = createAdminClient();
  try {
    const inputs = await hydrateInputsFromDb(caseId, admin);
    const snapshot = computeAll(inputs);
    const { error } = await admin
      .from("pch_cases")
      .update({
        engine_snapshot: snapshot,
        engine_snapshot_at: new Date().toISOString(),
      })
      .eq("case_id", caseId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true, snapshot };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Engine run failed" };
  }
}

// -------------------------------------------------------------------
// Client approval — captures the typed name + timestamp against the
// current engine snapshot. Does NOT move case status; status advance
// is a separate explicit action.
// -------------------------------------------------------------------
export async function recordClientApprovalAction(
  caseId: string,
  typedName: string,
): Promise<ActionResult> {
  const { me } = await requirePchCase(caseId);
  const trimmed = typedName.trim();
  if (trimmed.length < 2) {
    return { ok: false, error: "Please type your full name to approve." };
  }
  const admin = createAdminClient();
  // Need a snapshot to approve — refuse if there isn't one.
  const { data: head } = await admin
    .from("pch_cases")
    .select("engine_snapshot_at")
    .eq("case_id", caseId)
    .single();
  if (!head?.engine_snapshot_at) {
    return { ok: false, error: "No draft to approve yet. Run the draft first." };
  }
  const { error } = await admin
    .from("pch_cases")
    .update({
      client_approval_name: trimmed,
      client_approval_at: new Date().toISOString(),
      client_approval_version: 1,
    })
    .eq("case_id", caseId);
  if (error) return { ok: false, error: error.message };
  // Advance case status to client_approval if we're coming from prepared.
  // The RLS gate on the cases table already permits the client to move
  // client_approval → filed; here we only mark the approval record.
  revalidatePath(`/client/cases/${caseId}/pch`);
  return { ok: true };
}
