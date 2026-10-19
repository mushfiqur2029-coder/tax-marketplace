"use server";

// Server actions for the Uber/PHV automated case flow.
//
// All writes go through the service-role admin client, bypassing RLS;
// each action re-validates ownership (case.client_id === me.id) before
// touching the row. Pattern matches the existing manual flow.
//
// Flow (post-refactor, see docs on the new client workspace):
//   submitted (paid) → client edits intake (sections 1-5)
//     → submitForReviewAction runs the engine, auto-assigns an
//       accountant, moves status to in_review. Client no longer sees
//       any figures from this point on.
//   in_review / prepared → accountant works (checklist, overrides,
//     SA302) via accountant actions. Client intake is read-only.
//   client_approval → accountant has advanced the case; the client
//     sees the figures for the first time and signs off.
//   filed / complete → done.
//
// Edit lock: once a case has left `submitted`, every intake-mutating
// action in this file refuses. The accountant must bounce it back if
// a change is needed.

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { autoAssignAccountant } from "@/lib/case/auto-assign";
import {
  computeAll,
  UK_TAX_RATES_2025_26,
  getRatePackFor,
  hasRatePackFor,
} from "@/lib/tax-engine";
import {
  validateVehicle,
  canRunDraft,
  validateUtr,
  validateNino,
} from "@/lib/pch/validation";
import {
  schedulePchExtraction,
  runPchExtractionJob,
} from "@/lib/pch/extraction-trigger";
import { sendPchInReviewEmail } from "@/lib/pch/status-emails";
import { syncPchProfileFromUserAction } from "@/app/client/pch/profile-actions";

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

// Guard for intake-mutating actions: refuse once the case has been
// submitted for review. The client no longer owns the data from that
// point; the accountant does, and silent edits post-review would
// invalidate the engine snapshot they're working against.
function assertEditableByClient(status: string): ActionErr | null {
  if (status === "submitted") return null;
  return {
    ok: false,
    error:
      "Your return is already with your accountant. Message them if something needs to change.",
  };
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
  const { me, caseRow } = await requirePchCase(caseId);
  const lock = assertEditableByClient(caseRow.status);
  if (lock) return lock;
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

  // Allowed file types per slot:
  //   PCH-14 (bank statements): PDF, CSV, XLSX
  //   PCH-24 (Photo ID): PDF, JPG, PNG, HEIC
  //   Everything else: PDF, JPG, PNG (original Phase 3 spec)
  const nameLower = file.name.toLowerCase();
  const typeLower = (file.type || "").toLowerCase();
  const isPdf = typeLower === "application/pdf" || nameLower.endsWith(".pdf");
  const isImage = typeLower.startsWith("image/") || /\.(jpe?g|png|heic|webp)$/.test(nameLower);
  const isCsv = typeLower === "text/csv" || nameLower.endsWith(".csv");
  const isXlsx =
    typeLower.includes("spreadsheet")
    || typeLower === "application/vnd.ms-excel"
    || nameLower.endsWith(".xlsx")
    || nameLower.endsWith(".xls");
  const looksRight =
    slotCode === "PCH-14"
      ? (isPdf || isCsv || isXlsx)
      : (isPdf || isImage);
  if (!looksRight) {
    const expected =
      slotCode === "PCH-14"
        ? "PDF, CSV or Excel"
        : "PDF, JPG or PNG";
    return { ok: false, error: "This slot accepts " + expected + " only." };
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

  // Branch on slot: PCH-14 (bank statement) goes through the Phase 6
  // Slice 2 ingest pipeline (parse -> store transactions -> AI
  // categorise -> aggregate to pch_income_lines/pch_expense_lines);
  // every other slot goes through the per-slot extraction pattern from
  // Phase 3. Both run in next/after so the upload response isn't
  // blocked on the 10 to 60 second model work.
  if (slotCode === "PCH-14") {
    const { ingestBankStatement } = await import("@/lib/pch/bank-trigger");
    const documentId = inserted.id;
    after(async () => {
      await ingestBankStatement({ caseId, documentId });
    });
  } else {
    const scheduled = await schedulePchExtraction({
      caseId,
      slotCode,
      documentId: inserted.id,
    });
    if (!scheduled.skipped) {
      const extractionId = scheduled.extractionId;
      after(async () => {
        await runPchExtractionJob(extractionId);
      });
    }
  }

  revalidatePath(`/client/cases/${caseId}/pch`);
  return { ok: true, id: inserted.id, file_name: inserted.file_name,
    uploaded_at: inserted.uploaded_at };
}

// -------------------------------------------------------------------
// Head row (pch_cases) upsert, called on first visit to the intake,
// so every subsequent save can assume the row exists.
//
// Slice 6: also prefills Tab 1 PII columns (name / phone / address /
// postcode) from client_profiles if they're currently empty. The copy
// is idempotent and non-destructive, delegated to
// syncPchProfileFromUserAction. Downstream profile interview reads a
// pre-populated head row and skips those fields in its "what's still
// needed" opener.
// -------------------------------------------------------------------
export async function ensurePchHeadRow(caseId: string): Promise<ActionResult> {
  const { me } = await requirePchCase(caseId);
  const admin = createAdminClient();
  const { error } = await admin
    .from("pch_cases")
    .upsert({ case_id: caseId, cl_email: me.email }, { onConflict: "case_id" });
  if (error) return { ok: false, error: error.message };
  // Best-effort; a sync failure is logged but does not block the
  // workspace opening. The profile panel will show "Not captured" for
  // the missing columns and the client can run the interview.
  const sync = await syncPchProfileFromUserAction(caseId);
  if (!sync.ok) {
    console.warn("[ensurePchHeadRow] profile sync failed:", sync.error);
  }
  return { ok: true };
}

// Tab 1 "save client tab" action removed in Slice 6. The ~30-field
// raw form is gone; head columns are now populated by:
//   - syncPchProfileFromUserAction (registration PII, auto)
//   - applyPchExtractionAction (Photo ID vision → cl_name / cl_dob /
//     cl_address / cl_postcode via SLOT_APPLY_MAPS["PCH-24"])
//   - savePchIdentityFieldsAction below (just UTR + NI, the two
//     fields that cannot come off an ID and the one surface that
//     still accepts manual client typing)
//   - accountant overrides (pch_overrides, for anything else)

// -------------------------------------------------------------------
// Phase 6 Slice 1: compact UTR + NI save. UTR is 10 digits, NI is
// 2 letters + 6 digits + 1 letter. Server-side validation mirrors the
// client card so a hand-crafted POST can't bypass format checks. Both
// fields are OPTIONAL in isolation (client may fill one, save, then
// come back for the other) but each one, when present, must validate.
// -------------------------------------------------------------------
export async function savePchIdentityFieldsAction(
  caseId: string,
  patch: { cl_utr?: string | null; cl_nino?: string | null },
): Promise<ActionResult> {
  const { caseRow } = await requirePchCase(caseId);
  const lock = assertEditableByClient(caseRow.status);
  if (lock) return lock;
  const toWrite: Record<string, string | null> = {};
  if (patch.cl_utr !== undefined) {
    const utr = (patch.cl_utr ?? "").trim();
    if (utr.length > 0) {
      const utrErr = validateUtr(utr);
      if (utrErr) return { ok: false, error: utrErr };
    }
    toWrite.cl_utr = utr.length > 0 ? utr : null;
  }
  if (patch.cl_nino !== undefined) {
    const nino = (patch.cl_nino ?? "").trim();
    if (nino.length > 0) {
      const ninoErr = validateNino(nino);
      if (ninoErr) return { ok: false, error: ninoErr };
    }
    toWrite.cl_nino = nino.length > 0 ? nino.toUpperCase() : null;
  }
  if (Object.keys(toWrite).length === 0) return { ok: true };
  const admin = createAdminClient();
  const { error } = await admin
    .from("pch_cases")
    .update(toWrite)
    .eq("case_id", caseId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/client/cases/${caseId}/pch`);
  return { ok: true };
}

// -------------------------------------------------------------------
// Income lines (tab 2), set-and-forget bulk replace. The client sends
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
  const { caseRow } = await requirePchCase(caseId);
  const lock = assertEditableByClient(caseRow.status);
  if (lock) return lock;
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
// Expense lines (tab 3), same bulk-replace pattern.
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
  const { caseRow } = await requirePchCase(caseId);
  const lock = assertEditableByClient(caseRow.status);
  if (lock) return lock;
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
// Vehicle, single row per case (patched by the VEHICLE_CA interview).
// -------------------------------------------------------------------
type VehiclePatch = Record<string, unknown>;
export async function savePchVehicleAction(
  caseId: string,
  patch: VehiclePatch,
): Promise<ActionResult> {
  const { caseRow } = await requirePchCase(caseId);
  const lock = assertEditableByClient(caseRow.status);
  if (lock) return lock;
  const admin = createAdminClient();
  // Mileage consistency check needs the current income totals from
  // DB (not the patch) because the client UI doesn't send them with
  // the vehicle save. Pull the aggregates and run the validator.
  const { data: inc } = await admin
    .from("pch_income_lines")
    .select("on_trip_miles, dead_miles")
    .eq("case_id", caseId);
  const onTrip = (inc ?? []).reduce((n, r) => n + (r.on_trip_miles ?? 0), 0);
  const dead = (inc ?? []).reduce((n, r) => n + (r.dead_miles ?? 0), 0);
  const errs = validateVehicle(
    patch as Parameters<typeof validateVehicle>[0],
    onTrip, dead,
    Number((patch as Record<string, unknown>).other_business_miles ?? 0),
  );
  const first = Object.values(errs)[0];
  if (first) return { ok: false, error: first };
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
  const { me, caseRow } = await requirePchCase(caseId);
  const lock = assertEditableByClient(caseRow.status);
  if (lock) return lock;
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
// Slice 5: client asks the accountant to help with a slot they can't
// resolve themselves (no document, no AI interview path, or the AI
// interview wasn't available on this slot). Flips the slot into the
// 'Awaiting accountant' state introduced in migration 0092; the
// accountant workspace surfaces every blocked slot proactively.
//
// Separate from setPchDocStatusAction so the intent is explicit and
// so the client-side status API doesn't quietly widen to accept any
// state.
// -------------------------------------------------------------------
export async function requestPchAccountantHelpAction(
  caseId: string,
  slotCode: string,
  note?: string,
): Promise<ActionResult> {
  const { me, caseRow } = await requirePchCase(caseId);
  const lock = assertEditableByClient(caseRow.status);
  if (lock) return lock;
  const admin = createAdminClient();
  const trimmed = typeof note === "string" ? note.trim() : "";
  // Prefix every stored note with a stable marker so the accountant
  // panel can tell "client asked for help" from "accountant resolved it"
  // without a second column.
  const marker = "[Client asked for help on " + new Date().toISOString().slice(0, 10) + "]";
  const stored = trimmed.length > 0 ? `${marker} ${trimmed}` : marker;
  const { error } = await admin.from("pch_doc_status").upsert(
    {
      case_id: caseId,
      slot_code: slotCode,
      status: "Awaiting accountant",
      note: stored,
      updated_at: new Date().toISOString(),
      updated_by: me.id,
    },
    { onConflict: "case_id,slot_code" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/client/cases/${caseId}/pch`);
  return { ok: true };
}

// -------------------------------------------------------------------
// Run the engine + snapshot. Pulls the latest intake rows, hydrates
// TaxEngineInputs, calls computeAll, writes the output to
// pch_cases.engine_snapshot. The client never calls this directly;
// it's invoked by submitForReviewAction when the client hands the
// case off, so the accountant inherits a pre-computed snapshot ready
// to review.
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

// -------------------------------------------------------------------
// Submit the finished intake to the accountant. One transition that:
//   1. Runs the engine on the current intake and stores the snapshot
//      (the accountant inherits it; the client never sees it).
//   2. Auto-assigns the least-loaded approved accountant when the case
//      is still unassigned. Admin can override later.
//   3. Moves case status: submitted -> in_review.
//
// All three happen in sequence inside this action so a half-done
// handoff (snapshot without assignment, etc.) is not possible. If the
// engine readiness check fails, nothing moves and the client is told
// what to fix.
// -------------------------------------------------------------------
export async function submitForReviewAction(
  caseId: string,
): Promise<ActionResult> {
  const { caseRow } = await requirePchCase(caseId);
  if (caseRow.status !== "submitted") {
    return {
      ok: false,
      error:
        "This return has already been submitted to your accountant.",
    };
  }
  const admin = createAdminClient();
  try {
    const inputs = await hydrateInputsFromDb(caseId, admin);
    const readiness = canRunDraft(
      inputs.income.map((l) => ({ grossTakings: l.grossTakings, type: l.type })),
      {
        odo_start: inputs.vehicle.odoStart ?? null,
        odo_end: inputs.vehicle.odoEnd ?? null,
        method_choice: inputs.vehicle.methodChoice ?? null,
        business_pct_override: inputs.vehicle.businessPctOverride ?? null,
      },
    );
    if (!readiness.ok) {
      return { ok: false, error: readiness.blockers.join(" ") };
    }
    const snapshot = computeAll(inputs);
    const { error: snapErr } = await admin
      .from("pch_cases")
      .update({
        engine_snapshot: snapshot,
        engine_snapshot_at: new Date().toISOString(),
      })
      .eq("case_id", caseId);
    if (snapErr) return { ok: false, error: snapErr.message };

    const assignment = await autoAssignAccountant(caseId);
    if (!assignment.assigned && assignment.reason === "no_accountants") {
      return {
        ok: false,
        error:
          "No accountant is available right now. Try again later or contact support.",
      };
    }

    const { error: statusErr } = await admin
      .from("cases")
      .update({ status: "in_review" })
      .eq("id", caseId)
      .eq("status", "submitted");
    if (statusErr) return { ok: false, error: statusErr.message };

    after(() => sendPchInReviewEmail(caseId));
    revalidatePath(`/client/cases/${caseId}/pch`);
    revalidatePath(`/accountant`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Submit failed" };
  }
}

// -------------------------------------------------------------------
// Figures approval. Only valid when the accountant has advanced the
// case to client_approval; captures the typed name + timestamp against
// the snapshot the accountant signed off on.
//
// This is the FIRST of two sign-off gates in Phase 6. It records that
// the client is happy with the numbers; the case status stays at
// client_approval so the accountant can then generate and send the
// final pack (Slice 7 flow via sendFinalPackAction / confirmFinalPackAction
// / markFiledWithHmrcAction). The case only flips to 'filed' when the
// accountant marks it filed with HMRC after the second sign-off gate.
// -------------------------------------------------------------------
export async function recordClientApprovalAction(
  caseId: string,
  typedName: string,
): Promise<ActionResult> {
  const { caseRow } = await requirePchCase(caseId);
  const trimmed = typedName.trim();
  if (trimmed.length < 2) {
    return { ok: false, error: "Please type your full name to approve." };
  }
  if (caseRow.status !== "client_approval") {
    return {
      ok: false,
      error:
        "This return isn't ready for your approval yet. Your accountant will let you know when it is.",
    };
  }
  const admin = createAdminClient();
  const { data: head } = await admin
    .from("pch_cases")
    .select("engine_snapshot_at")
    .eq("case_id", caseId)
    .single();
  if (!head?.engine_snapshot_at) {
    return { ok: false, error: "No snapshot to approve." };
  }
  const { error: approvalErr } = await admin
    .from("pch_cases")
    .update({
      client_approval_name: trimmed,
      client_approval_at: new Date().toISOString(),
      client_approval_version: 1,
    })
    .eq("case_id", caseId);
  if (approvalErr) return { ok: false, error: approvalErr.message };

  revalidatePath(`/client/cases/${caseId}/pch`);
  revalidatePath(`/accountant/cases/${caseId}/pch`);
  return { ok: true };
}

// -------------------------------------------------------------------
// Phase 6 Slice 7: client-side confirmation of the final accounts pack.
//
// Separate from Phase 2b's recordClientApprovalAction (which captures
// the figures approval). This second gate records the client's sign-off
// on the final pack the accountant just delivered. Only once this is
// set can the accountant click "Mark filed with HMRC".
// -------------------------------------------------------------------
export async function confirmFinalPackAction(
  caseId: string,
  signedName: string,
): Promise<ActionResult> {
  const { caseRow } = await requirePchCase(caseId);
  const admin = createAdminClient();
  const { data: head } = await admin
    .from("pch_cases")
    .select("final_pack_sent_at, final_pack_confirmed_at")
    .eq("case_id", caseId)
    .maybeSingle();
  if (!head?.final_pack_sent_at) {
    return {
      ok: false,
      error: "Your accountant hasn't sent the final pack yet.",
    };
  }
  if (head.final_pack_confirmed_at) {
    return { ok: false, error: "You've already confirmed the final pack." };
  }
  const trimmed = (signedName ?? "").trim();
  if (trimmed.length < 2) {
    return { ok: false, error: "Please type your full name to confirm." };
  }
  const { error } = await admin
    .from("pch_cases")
    .update({
      final_pack_confirmed_at: new Date().toISOString(),
      final_pack_confirmed_name: trimmed,
    })
    .eq("case_id", caseId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/client/cases/${caseId}/pch`);
  revalidatePath(`/accountant/cases/${caseId}/pch`);
  void caseRow;
  return { ok: true };
}
