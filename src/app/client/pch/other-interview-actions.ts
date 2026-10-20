"use server";

// Phase 7 Slice 7.6b: server actions for the four new PCH client-side
// AI interview flows (RELIEFS, INCOME_PROBE, EXPENSES_PROBE,
// FILING_DETAILS). Each flow follows the same three-action shape as
// VEHICLE_CA (start / advance / commit); the shared AiInterviewPanel
// on the client workspace talks to the trio generically.
//
// On commit each action:
//   1. Re-runs the finalising turn server-side so the written values
//      are the AI's output, not something the browser hand-crafted.
//   2. Writes the extracted field(s) to the DB column(s) the Slice 7.4
//      survey mapped (pch_cases.* text columns from migration 0102, or
//      existing head columns for RELIEFS).
//   3. Writes pch_check_status (status='Done', note=<short summary>)
//      for the matching checklist item(s) so the accountant's row
//      flips to the "Client answered" surface without a second query.
//      EXPENSES_PROBE writes two check-status rows (items 11 + 27).

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

// -------------------------------------------------------------------
// Shared helpers
// -------------------------------------------------------------------

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
  if (status === "submitted") return null;
  return {
    ok: false,
    error:
      "Your return is already with your accountant. Message them if something needs to change.",
  };
}

// Strip trailing non-user turns before re-finalising. See the
// vehicle-interview-actions.ts commit for the reason: Anthropic's
// Messages API requires the last message to be from the user, and
// the client-side AiInterviewPanel appends a cosmetic closing
// assistant bubble when the flow reaches 'done'.
function trimForFinalize(transcript: InterviewMessage[]): InterviewMessage[] {
  const t = [...transcript];
  while (t.length > 0 && t[t.length - 1].role !== "user") t.pop();
  return t;
}

// Clean + validate the transcript before each advance turn.
function cleanTranscript(transcript: InterviewMessage[]): InterviewMessage[] | ActionErr {
  const cleaned = transcript
    .map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content.trim() : "",
    }))
    .filter((m) => m.content.length > 0);
  if (cleaned.length === 0 || cleaned[0].role !== "assistant") {
    return { ok: false, error: "Transcript must start with the opener message." };
  }
  return cleaned;
}

async function writeCheckStatus(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
  itemNumber: number,
  note: string,
  authorId: string,
) {
  await admin.from("pch_check_status").upsert(
    {
      case_id: caseId,
      item_number: itemNumber,
      status: "Done",
      note: note.slice(0, 2000),
      updated_at: new Date().toISOString(),
      updated_by: authorId,
    },
    { onConflict: "case_id,item_number" },
  );
}

// Phase 8 Slice 8.1: one-click "Not applicable" escape hatch for the
// AI interview flows (RELIEFS, INCOME_PROBE, EXPENSES_PROBE,
// FILING_DETAILS, and the Phase 8.5 INCOME_INTERVIEW). The client
// signals that the whole flow doesn't apply to them; we flip every
// mapped pch_check_status row to Done with a note of "Client confirmed
// not applicable" so the accountant can see the row has been resolved
// deliberately rather than left to default. No DB column writes:
// skipping the chat means there's no answer to persist.
//
// VEHICLE_CA doesn't call this because its 'No vehicle' is already an
// in-flow answer the finalise commits properly to pch_vehicle.
const NA_NOTE = "Client confirmed not applicable";

export async function markPchChecklistNotApplicableAction(
  caseId: string,
  itemNumbers: number[],
): Promise<ActionResult> {
  try {
    if (!Array.isArray(itemNumbers) || itemNumbers.length === 0) {
      return { ok: false, error: "No checklist items supplied." };
    }
    const { me, caseRow, admin } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    for (const n of itemNumbers) {
      if (!Number.isInteger(n) || n < 1 || n > 33) {
        return { ok: false, error: `Invalid checklist item number: ${n}` };
      }
    }
    for (const n of itemNumbers) {
      await writeCheckStatus(admin, caseId, n, NA_NOTE, me.id);
    }
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not record 'not applicable'." };
  }
}

// Pull a single string field out of the AI's finalise output.
function pickString(final: InterviewTurnResult, key: string): string | null {
  if (final.kind !== "done") return null;
  const f = final.fields[key];
  if (!f || f.confidence === "missing" || f.value == null) return null;
  const s = String(f.value).trim();
  return s.length > 0 ? s : null;
}

function pickNumber(final: InterviewTurnResult, key: string): number | null {
  if (final.kind !== "done") return null;
  const f = final.fields[key];
  if (!f || f.confidence === "missing" || f.value == null) return null;
  const n = Number(f.value);
  return Number.isFinite(n) ? n : null;
}

// -------------------------------------------------------------------
// Generic start + advance builders. The four flows differ only in
// their slot code, so these two wrap the shared boilerplate; each
// flow's exported action is a one-liner that supplies the slot code.
// -------------------------------------------------------------------

async function startFlow(
  caseId: string,
  slotCode: string,
  overrideOpener?: string,
): Promise<ActionResult<{ opener: InterviewMessage }>> {
  try {
    const { caseRow } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    const opener = openInterview(slotCode, overrideOpener);
    return { ok: true, opener };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Interview failed to start." };
  }
}

async function advanceFlow(
  caseId: string,
  slotCode: string,
  transcript: InterviewMessage[],
): Promise<ActionResult<{ turn: InterviewTurnResult }>> {
  try {
    const { caseRow } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    const cleaned = cleanTranscript(transcript);
    if ("ok" in cleaned && cleaned.ok === false) return cleaned;
    const turn = await runInterviewTurn(slotCode, cleaned as InterviewMessage[]);
    return { ok: true, turn };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI interview failed." };
  }
}

// -------------------------------------------------------------------
// (A) RELIEFS, items 19
// -------------------------------------------------------------------

const ALLOWED_MA_STATUS = new Set(["None", "Transferring", "Receiving"]);

async function buildReliefsOpener(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
): Promise<string | undefined> {
  const { data } = await admin
    .from("pch_cases")
    .select("personal_pension_net_pence, gift_aid_net_pence, marriage_allowance_status")
    .eq("case_id", caseId)
    .maybeSingle();
  if (!data) return undefined;
  const pension = Number(data.personal_pension_net_pence ?? 0);
  const giftAid = Number(data.gift_aid_net_pence ?? 0);
  const ma = (data.marriage_allowance_status as string | null) ?? "None";
  if (pension === 0 && giftAid === 0 && (ma === "None" || !ma)) return undefined;
  const bits: string[] = ["Just checking in on your reliefs."];
  const fmt = (p: number) =>
    "£" + (p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (pension > 0) bits.push(`We have personal pension contributions of ${fmt(pension)}.`);
  if (giftAid > 0) bits.push(`We have Gift Aid donations of ${fmt(giftAid)}.`);
  if (ma && ma !== "None") bits.push(`Marriage Allowance: ${ma}.`);
  bits.push("Anything to change, or should we leave these as they are?");
  return bits.join(" ");
}

export async function startPchReliefsInterviewAction(caseId: string) {
  const { admin } = await requireClientPchCase(caseId);
  const override = await buildReliefsOpener(admin, caseId);
  return startFlow(caseId, "RELIEFS", override);
}

export async function advancePchReliefsInterviewAction(
  caseId: string,
  transcript: InterviewMessage[],
) {
  return advanceFlow(caseId, "RELIEFS", transcript);
}

export async function commitPchReliefsInterviewAction(
  caseId: string,
  transcript: InterviewMessage[],
): Promise<ActionResult> {
  try {
    const { me, caseRow, admin } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    const final = await runInterviewTurn("RELIEFS", trimForFinalize(transcript));
    if (final.kind !== "done") {
      return { ok: false, error: "The AI isn't finished yet, keep going in the chat." };
    }
    const pensionGbp = pickNumber(final, "personal_pension_net_gbp");
    const giftAidGbp = pickNumber(final, "gift_aid_net_gbp");
    const maRaw = pickString(final, "marriage_allowance_status");
    const ma = maRaw && ALLOWED_MA_STATUS.has(maRaw) ? maRaw : "None";

    const patch: Record<string, number | string> = { marriage_allowance_status: ma };
    if (pensionGbp != null && pensionGbp >= 0) {
      patch.personal_pension_net_pence = Math.round(pensionGbp * 100);
    }
    if (giftAidGbp != null && giftAidGbp >= 0) {
      patch.gift_aid_net_pence = Math.round(giftAidGbp * 100);
    }
    const { error } = await admin.from("pch_cases").update(patch).eq("case_id", caseId);
    if (error) return { ok: false, error: error.message };

    // Short note the accountant reads on CheckRow for item 19.
    const fmt = (gbp: number) =>
      "£" + gbp.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const noteParts: string[] = [];
    noteParts.push(`Pension (net): ${pensionGbp != null ? fmt(pensionGbp) : "£0.00"}`);
    noteParts.push(`Gift Aid (net): ${giftAidGbp != null ? fmt(giftAidGbp) : "£0.00"}`);
    noteParts.push(`Marriage Allowance: ${ma}`);
    await writeCheckStatus(admin, caseId, 19, noteParts.join(" · "), me.id);

    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save reliefs." };
  }
}

// -------------------------------------------------------------------
// (B) INCOME_PROBE, item 5
// -------------------------------------------------------------------

async function buildIncomeProbeOpener(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
): Promise<string | undefined> {
  const { data } = await admin
    .from("pch_cases")
    .select("nil_platforms_note")
    .eq("case_id", caseId)
    .maybeSingle();
  const prior = data?.nil_platforms_note as string | null | undefined;
  if (!prior) return undefined;
  return `Last time you told us: "${prior.slice(0, 200)}". Anything to add or correct?`;
}

export async function startPchIncomeProbeInterviewAction(caseId: string) {
  const { admin } = await requireClientPchCase(caseId);
  const override = await buildIncomeProbeOpener(admin, caseId);
  return startFlow(caseId, "INCOME_PROBE", override);
}

export async function advancePchIncomeProbeInterviewAction(
  caseId: string,
  transcript: InterviewMessage[],
) {
  return advanceFlow(caseId, "INCOME_PROBE", transcript);
}

export async function commitPchIncomeProbeInterviewAction(
  caseId: string,
  transcript: InterviewMessage[],
): Promise<ActionResult> {
  try {
    const { me, caseRow, admin } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    const final = await runInterviewTurn("INCOME_PROBE", trimForFinalize(transcript));
    if (final.kind !== "done") {
      return { ok: false, error: "The AI isn't finished yet, keep going in the chat." };
    }
    const note = pickString(final, "nil_platforms_note") ?? "";
    const { error } = await admin
      .from("pch_cases")
      .update({ nil_platforms_note: note.length > 0 ? note : null })
      .eq("case_id", caseId);
    if (error) return { ok: false, error: error.message };
    if (note.length > 0) {
      await writeCheckStatus(admin, caseId, 5, note, me.id);
    }
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save answer." };
  }
}

// -------------------------------------------------------------------
// (C) EXPENSES_PROBE, items 11 + 27 (one flow, two check-status rows)
// -------------------------------------------------------------------

async function buildExpensesProbeOpener(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
): Promise<string | undefined> {
  const { data } = await admin
    .from("pch_cases")
    .select("expenses_probe_note")
    .eq("case_id", caseId)
    .maybeSingle();
  const prior = data?.expenses_probe_note as string | null | undefined;
  if (!prior) return undefined;
  return `Last time you told us: "${prior.slice(0, 200)}". Anything to add or correct?`;
}

export async function startPchExpensesProbeInterviewAction(caseId: string) {
  const { admin } = await requireClientPchCase(caseId);
  const override = await buildExpensesProbeOpener(admin, caseId);
  return startFlow(caseId, "EXPENSES_PROBE", override);
}

export async function advancePchExpensesProbeInterviewAction(
  caseId: string,
  transcript: InterviewMessage[],
) {
  return advanceFlow(caseId, "EXPENSES_PROBE", transcript);
}

export async function commitPchExpensesProbeInterviewAction(
  caseId: string,
  transcript: InterviewMessage[],
): Promise<ActionResult> {
  try {
    const { me, caseRow, admin } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    const final = await runInterviewTurn("EXPENSES_PROBE", trimForFinalize(transcript));
    if (final.kind !== "done") {
      return { ok: false, error: "The AI isn't finished yet, keep going in the chat." };
    }
    const note = pickString(final, "expenses_probe_note") ?? "";
    const { error } = await admin
      .from("pch_cases")
      .update({ expenses_probe_note: note.length > 0 ? note : null })
      .eq("case_id", caseId);
    if (error) return { ok: false, error: error.message };
    if (note.length > 0) {
      await writeCheckStatus(admin, caseId, 11, note, me.id);
      await writeCheckStatus(admin, caseId, 27, note, me.id);
    }
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save answer." };
  }
}

// -------------------------------------------------------------------
// (D) FILING_DETAILS, item 31
// -------------------------------------------------------------------

async function buildFilingDetailsOpener(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
): Promise<string | undefined> {
  const { data } = await admin
    .from("pch_cases")
    .select("repayment_account_name")
    .eq("case_id", caseId)
    .maybeSingle();
  const prior = data?.repayment_account_name as string | null | undefined;
  if (!prior) return undefined;
  return `Last time you told us the repayment account is in the name of "${prior}". Still the same, or should it change?`;
}

export async function startPchFilingDetailsInterviewAction(caseId: string) {
  const { admin } = await requireClientPchCase(caseId);
  const override = await buildFilingDetailsOpener(admin, caseId);
  return startFlow(caseId, "FILING_DETAILS", override);
}

export async function advancePchFilingDetailsInterviewAction(
  caseId: string,
  transcript: InterviewMessage[],
) {
  return advanceFlow(caseId, "FILING_DETAILS", transcript);
}

export async function commitPchFilingDetailsInterviewAction(
  caseId: string,
  transcript: InterviewMessage[],
): Promise<ActionResult> {
  try {
    const { me, caseRow, admin } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    const final = await runInterviewTurn("FILING_DETAILS", trimForFinalize(transcript));
    if (final.kind !== "done") {
      return { ok: false, error: "The AI isn't finished yet, keep going in the chat." };
    }
    const name = pickString(final, "repayment_account_name") ?? "";
    const { error } = await admin
      .from("pch_cases")
      .update({ repayment_account_name: name.length > 0 ? name : null })
      .eq("case_id", caseId);
    if (error) return { ok: false, error: error.message };
    if (name.length > 0) {
      await writeCheckStatus(admin, caseId, 31, `Repayment account: ${name}`, me.id);
    }
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save answer." };
  }
}
