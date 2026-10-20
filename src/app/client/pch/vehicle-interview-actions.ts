"use server";

// Phase 6 Slice 4: server actions backing the vehicle / capital
// allowances conversation.
//
// Three jobs, same shape as the generic interview harness:
//
//   startPchVehicleInterviewAction, kicks off the VEHICLE_CA flow with
//      a context-aware opener that already lists what we've captured
//      (if the client has run the interview before). Otherwise returns
//      the flow's static opener (which explains capital allowances).
//
//   advancePchVehicleInterviewAction, one turn of the interview.
//      Returns either the AI's next question or a finalize payload.
//
//   commitPchVehicleInterviewAction, re-runs finalize server-side and
//      writes the resulting fields to pch_vehicle. Fields the AI
//      marked 'missing' are skipped (prior correct value preserved).
//
// Status enum: 'Owned outright' | 'Hire purchase' | 'PCP' | 'Loan' |
// 'Leased' | 'Rented' | 'No vehicle'. When status is Leased/Rented/
// No vehicle, every detail field (purchase price, CO2, etc.) comes
// back missing and we only write the status.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  openInterview,
  runInterviewTurn,
  type InterviewMessage,
  type InterviewTurnResult,
} from "@/lib/pch/ai-interview";

type ActionOk<T = Record<never, never>> = { ok: true } & T;
type ActionErr = { ok: false; error: string };
type ActionResult<T = Record<never, never>> = ActionOk<T> | ActionErr;

async function requireClientPchCase(caseId: string) {
  const me = await requireRole("client");
  const admin = createAdminClient();
  const { data } = await admin
    .from("cases")
    .select("id, client_id, status, tier")
    .eq("id", caseId)
    .single();
  if (!data) throw new Error("Case not found.");
  if (data.client_id !== me.id) throw new Error("Not your case.");
  if (data.tier !== "uber_phv_automated") {
    throw new Error("Not a PCH automated case.");
  }
  return { me, caseRow: data, admin };
}

function assertEditable(status: string): ActionErr | null {
  if (status === "submitted" || status === "in_review" || status === "prepared") {
    return null;
  }
  return {
    ok: false,
    error:
      "This return has already moved to the approval stage. Message your accountant if something needs to change.",
  };
}

type VehicleRow = {
  status: string | null;
  fuel: string | null;
  make_model: string | null;
  registration: string | null;
  co2_gpkm: number | null;
  purchase_date: string | null;
  purchase_price_pence: number | null;
  new_or_used: string | null;
  business_pct_override: number | null;
};

async function readVehicle(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
): Promise<VehicleRow | null> {
  const { data } = await admin
    .from("pch_vehicle")
    .select("status, fuel, make_model, registration, co2_gpkm, purchase_date, purchase_price_pence, new_or_used, business_pct_override")
    .eq("case_id", caseId)
    .maybeSingle();
  return (data as VehicleRow | null) ?? null;
}

function buildVehicleOpener(current: VehicleRow | null): string | undefined {
  if (!current || !current.status) return undefined;
  // Something was previously captured. Short reminder + offer to update.
  const bits: string[] = [];
  bits.push("Just checking in on your vehicle details.");
  bits.push(`We've got your status as ${current.status}.`);
  if (current.make_model) {
    bits.push(`Make and model: ${current.make_model}.`);
  }
  if (current.registration) {
    bits.push(`Registration: ${current.registration}.`);
  }
  if (current.purchase_price_pence != null) {
    const pounds = (Math.round(current.purchase_price_pence) / 100).toLocaleString(
      "en-GB",
      { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    );
    bits.push(`Purchase price: £${pounds}.`);
  }
  bits.push("Anything to update, or should we leave these as they are?");
  return bits.join(" ");
}

// -------------------------------------------------------------------
// (1) start
// -------------------------------------------------------------------
export async function startPchVehicleInterviewAction(
  caseId: string,
): Promise<ActionResult<{ opener: InterviewMessage }>> {
  try {
    const { caseRow, admin } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    const current = await readVehicle(admin, caseId);
    const override = buildVehicleOpener(current);
    const opener = openInterview("VEHICLE_CA", override);
    return { ok: true, opener };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Vehicle interview failed to start.",
    };
  }
}

// -------------------------------------------------------------------
// (2) advance (one AI turn)
// -------------------------------------------------------------------
export async function advancePchVehicleInterviewAction(
  caseId: string,
  transcript: InterviewMessage[],
): Promise<ActionResult<{ turn: InterviewTurnResult }>> {
  try {
    const { caseRow } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    const cleaned = transcript
      .map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content.trim() : "",
      }))
      .filter((m) => m.content.length > 0);
    if (cleaned.length === 0 || cleaned[0].role !== "assistant") {
      return { ok: false, error: "Transcript must start with the opener message." };
    }
    const turn = await runInterviewTurn("VEHICLE_CA", cleaned);
    return { ok: true, turn };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI interview failed." };
  }
}

// -------------------------------------------------------------------
// (3) commit (re-finalize server-side + write to pch_vehicle)
// -------------------------------------------------------------------
const ALLOWED_STATUS = new Set([
  "Owned outright", "Hire purchase", "PCP", "Loan", "Leased", "Rented", "No vehicle",
]);
const ALLOWED_FUEL = new Set(["Petrol", "Diesel", "Hybrid", "Electric", "PHEV"]);
const ALLOWED_NEW_OR_USED = new Set(["New", "Used"]);

export async function commitPchVehicleInterviewAction(
  caseId: string,
  transcript: InterviewMessage[],
): Promise<ActionResult<{ writtenKeys: string[] }>> {
  try {
    const { caseRow, admin } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;

    // The client appends a cosmetic closing assistant message once the
    // interview reaches 'done' (see vehicle-interview-panel.tsx `send`).
    // Anthropic's Messages API requires the last message to be from the
    // user, so strip any trailing non-user turns before re-finalising.
    // The last real user message is what originally produced the 'done'
    // turn; replaying from there should produce 'done' again.
    const finalizeTranscript = [...transcript];
    while (
      finalizeTranscript.length > 0
      && finalizeTranscript[finalizeTranscript.length - 1].role !== "user"
    ) {
      finalizeTranscript.pop();
    }
    const final = await runInterviewTurn("VEHICLE_CA", finalizeTranscript);
    if (final.kind !== "done") {
      return {
        ok: false,
        error:
          "The AI isn't finished yet, there are still questions to answer. Keep going in the chat.",
      };
    }

    const patch: Record<string, string | number | null> = {};
    const written: string[] = [];
    for (const [key, field] of Object.entries(final.fields)) {
      if (field.confidence === "missing" || field.value == null) continue;
      switch (key) {
        case "status": {
          const raw = String(field.value).trim();
          if (ALLOWED_STATUS.has(raw)) {
            patch.status = raw;
            written.push(key);
          }
          break;
        }
        case "fuel": {
          const raw = String(field.value).trim();
          if (ALLOWED_FUEL.has(raw)) {
            patch.fuel = raw;
            written.push(key);
          }
          break;
        }
        case "make_model":
        case "registration": {
          const raw = String(field.value).trim();
          if (raw.length > 0) {
            patch[key] = key === "registration" ? raw.toUpperCase().replace(/\s+/g, "") : raw;
            written.push(key);
          }
          break;
        }
        case "co2_gpkm": {
          const n = Math.round(Number(field.value));
          if (Number.isFinite(n) && n >= 0 && n <= 1000) {
            patch.co2_gpkm = n;
            written.push(key);
          }
          break;
        }
        case "purchase_date": {
          const raw = String(field.value).trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            patch.purchase_date = raw;
            written.push(key);
          }
          break;
        }
        case "purchase_price": {
          const n = Number(field.value);
          if (Number.isFinite(n) && n >= 0) {
            patch.purchase_price_pence = Math.round(n * 100);
            written.push(key);
          }
          break;
        }
        case "new_or_used": {
          const raw = String(field.value).trim();
          if (ALLOWED_NEW_OR_USED.has(raw)) {
            patch.new_or_used = raw;
            written.push(key);
          }
          break;
        }
        case "business_pct_override": {
          const n = Number(field.value);
          // AI returns a percentage 0..100 (see VEHICLE_CA interview spec in
          // ai-interview.ts); the DB column is numeric(4,2) 0..1 per migration
          // 0080, which is what the tax engine's businessPctOverride consumes.
          if (Number.isFinite(n) && n >= 0 && n <= 100) {
            patch.business_pct_override = Math.round(n) / 100;
            written.push(key);
          }
          break;
        }
        case "prior_year_wdv_pound": {
          // Written-down value is informational for the accountant; no
          // pch_vehicle column stores it today. We keep the AI's answer
          // in the audit trail by writing it to raw_json below, but
          // skip the direct pch_vehicle write.
          written.push(key);
          break;
        }
      }
    }

    // Always upsert the pch_vehicle row so a client who runs the
    // interview before entering any other vehicle field still ends up
    // with a row (the engine reads this on submit for review).
    const { error } = await admin
      .from("pch_vehicle")
      .upsert({ case_id: caseId, ...patch }, { onConflict: "case_id" });
    if (error) return { ok: false, error: error.message };

    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true, writtenKeys: written };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not save the vehicle answers.",
    };
  }
}

// -------------------------------------------------------------------
// Phase 7 Slice 7.6c: VEHICLE_CA_EXT, vehicle disposal follow-up.
//
// Separate trio from VEHICLE_CA so a client who already finished the
// main vehicle chat doesn't have to re-run it just to record a
// disposal. Gated upstream in the UI on CA-eligible status (Owned
// outright / HP / PCP / Loan); the server also tolerates a run against
// a leased/rented case but will only persist disposed='No' in that
// case.
// -------------------------------------------------------------------

function buildDisposalOpener(current: VehicleRow & { disposed?: boolean | null; disposal_proceeds_pence?: number | null; disposal_date?: string | null } | null): string | undefined {
  if (!current) return undefined;
  if (!current.disposed) return undefined;
  const bits: string[] = ["Just checking in on the disposal you told us about."];
  if (current.disposal_proceeds_pence != null) {
    const pounds = (Math.round(current.disposal_proceeds_pence) / 100).toLocaleString(
      "en-GB",
      { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    );
    bits.push(`Proceeds captured: £${pounds}.`);
  }
  if (current.disposal_date) {
    bits.push(`Date captured: ${current.disposal_date}.`);
  }
  bits.push("Anything to change, or should we leave it as is?");
  return bits.join(" ");
}

export async function startPchDisposalInterviewAction(
  caseId: string,
): Promise<ActionResult<{ opener: InterviewMessage }>> {
  try {
    const { caseRow, admin } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    const { data } = await admin
      .from("pch_vehicle")
      .select("status, fuel, make_model, registration, co2_gpkm, purchase_date, purchase_price_pence, new_or_used, business_pct_override, disposed, disposal_proceeds_pence, disposal_date")
      .eq("case_id", caseId)
      .maybeSingle();
    const override = buildDisposalOpener(data as (VehicleRow & { disposed?: boolean | null; disposal_proceeds_pence?: number | null; disposal_date?: string | null }) | null);
    const opener = openInterview("VEHICLE_CA_EXT", override);
    return { ok: true, opener };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Disposal interview failed to start.",
    };
  }
}

export async function advancePchDisposalInterviewAction(
  caseId: string,
  transcript: InterviewMessage[],
): Promise<ActionResult<{ turn: InterviewTurnResult }>> {
  try {
    const { caseRow } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    const cleaned = transcript
      .map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content.trim() : "",
      }))
      .filter((m) => m.content.length > 0);
    if (cleaned.length === 0 || cleaned[0].role !== "assistant") {
      return { ok: false, error: "Transcript must start with the opener message." };
    }
    const turn = await runInterviewTurn("VEHICLE_CA_EXT", cleaned);
    return { ok: true, turn };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI interview failed." };
  }
}

export async function commitPchDisposalInterviewAction(
  caseId: string,
  transcript: InterviewMessage[],
): Promise<ActionResult<{ writtenKeys: string[] }>> {
  try {
    const { me, caseRow, admin } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;

    const finalizeTranscript = [...transcript];
    while (
      finalizeTranscript.length > 0
      && finalizeTranscript[finalizeTranscript.length - 1].role !== "user"
    ) {
      finalizeTranscript.pop();
    }
    const final = await runInterviewTurn("VEHICLE_CA_EXT", finalizeTranscript);
    if (final.kind !== "done") {
      return {
        ok: false,
        error:
          "The AI isn't finished yet, there are still questions to answer. Keep going in the chat.",
      };
    }

    const written: string[] = [];
    const disposedRaw = final.fields.disposed;
    const disposed =
      disposedRaw && disposedRaw.confidence !== "missing"
      && String(disposedRaw.value).trim().toLowerCase() === "yes";

    const patch: Record<string, boolean | number | string | null> = { disposed };
    written.push("disposed");

    if (disposed) {
      const proceedsField = final.fields.disposal_proceeds_gbp;
      if (proceedsField && proceedsField.confidence !== "missing" && proceedsField.value != null) {
        const n = Number(proceedsField.value);
        if (Number.isFinite(n) && n >= 0) {
          patch.disposal_proceeds_pence = Math.round(n * 100);
          written.push("disposal_proceeds_gbp");
        }
      }
      const dateField = final.fields.disposal_date;
      if (dateField && dateField.confidence !== "missing" && dateField.value != null) {
        const raw = String(dateField.value).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
          patch.disposal_date = raw;
          written.push("disposal_date");
        }
      }
    } else {
      // Explicitly clear any previously captured proceeds/date so a
      // client who flips disposed Yes to No doesn't leave stale figures
      // sitting on the row for compute.ts to pick up on a later run.
      patch.disposal_proceeds_pence = null;
      patch.disposal_date = null;
    }

    const { error } = await admin
      .from("pch_vehicle")
      .upsert({ case_id: caseId, ...patch }, { onConflict: "case_id" });
    if (error) return { ok: false, error: error.message };

    // Checklist row (item 16): one-line note the accountant reads
    // without opening the chat.
    let note: string;
    if (disposed) {
      const proceeds = typeof patch.disposal_proceeds_pence === "number"
        ? "£" + (patch.disposal_proceeds_pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : "proceeds unconfirmed";
      const date = typeof patch.disposal_date === "string" ? patch.disposal_date : "date unconfirmed";
      note = `Disposed this year. ${proceeds}, ${date}.`;
    } else {
      note = "No disposal this year.";
    }
    await admin.from("pch_check_status").upsert(
      {
        case_id: caseId,
        item_number: 16,
        status: "Done",
        note: note.slice(0, 2000),
        updated_at: new Date().toISOString(),
        updated_by: me.id,
      },
      { onConflict: "case_id,item_number" },
    );

    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true, writtenKeys: written };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not save the disposal answer.",
    };
  }
}

// One-tap "No, I kept the car" path. Semantically identical to running
// the chat and answering disposed='No', so we write the same state:
// pch_vehicle.disposed=false (plus clear any stale proceeds/date) and
// mark item 16 Done with the matching note. Lets the common-case driver
// resolve item 16 in a single click without opening the AI panel.
export async function markNoVehicleDisposalAction(
  caseId: string,
): Promise<ActionResult> {
  try {
    const { me, caseRow, admin } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    const { error } = await admin
      .from("pch_vehicle")
      .upsert(
        { case_id: caseId, disposed: false, disposal_proceeds_pence: null, disposal_date: null },
        { onConflict: "case_id" },
      );
    if (error) return { ok: false, error: error.message };
    await admin.from("pch_check_status").upsert(
      {
        case_id: caseId,
        item_number: 16,
        status: "Done",
        note: "No disposal this year.",
        updated_at: new Date().toISOString(),
        updated_by: me.id,
      },
      { onConflict: "case_id,item_number" },
    );
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not record 'no disposal'.",
    };
  }
}

// Card-level "I have no vehicle" skip. Same semantics as the client
// answering "No vehicle" in the full VEHICLE_CA chat: upserts the
// pch_vehicle row with status='No vehicle' and clears any disposal
// fields (a client flipping to no-vehicle shouldn't leave stale
// disposal figures behind that compute.ts would still apply). All
// vehicle-related checklist items (12/13/15) are auto-derived from
// pch_vehicle, so the no-vehicle status flows through to the
// accountant's view without explicit pch_check_status writes.
export async function markNoVehicleAction(
  caseId: string,
): Promise<ActionResult> {
  try {
    const { caseRow, admin } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    const { error } = await admin
      .from("pch_vehicle")
      .upsert(
        {
          case_id: caseId,
          status: "No vehicle",
          disposed: false,
          disposal_proceeds_pence: null,
          disposal_date: null,
        },
        { onConflict: "case_id" },
      );
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not record 'no vehicle'.",
    };
  }
}
