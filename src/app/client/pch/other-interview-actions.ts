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
// (E) INCOME_INTERVIEW, Phase 8 Slice 8.5
//
// Chat-based income capture when the driver has no bank statement to
// upload. Writes ONE aggregated pch_income_lines row (gross, fees,
// on-trip miles) tagged with an "Interview: " source prefix so re-runs
// are idempotent and the row never collides with bank-origin rows
// (which use the "Bank: " prefix).
// -------------------------------------------------------------------

const INTERVIEW_SOURCE_PREFIX = "Interview: ";

async function buildIncomeInterviewOpener(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
): Promise<string | undefined> {
  // If a prior run already captured a line, open with a short summary
  // and offer to amend rather than restarting cold.
  const { data } = await admin
    .from("pch_income_lines")
    .select("source, gross_takings_pence, platform_fee_pence, on_trip_miles")
    .eq("case_id", caseId)
    .like("source", INTERVIEW_SOURCE_PREFIX + "%")
    .maybeSingle();
  if (!data) return undefined;
  const grossGbp = Number(data.gross_takings_pence ?? 0) / 100;
  const feesGbp = Number(data.platform_fee_pence ?? 0) / 100;
  const miles = Number(data.on_trip_miles ?? 0);
  const fmt = (n: number) =>
    "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const platforms = (data.source as string).slice(INTERVIEW_SOURCE_PREFIX.length);
  return (
    `Last time you told us: platforms ${platforms}, gross ${fmt(grossGbp)}, fees ${fmt(feesGbp)}, on-trip miles ${miles.toLocaleString("en-GB")}. ` +
    "Anything to change, or should we leave it as is?"
  );
}

export async function startPchIncomeInterviewAction(caseId: string) {
  const { admin } = await requireClientPchCase(caseId);
  const override = await buildIncomeInterviewOpener(admin, caseId);
  return startFlow(caseId, "INCOME_INTERVIEW", override);
}

export async function advancePchIncomeInterviewAction(
  caseId: string,
  transcript: InterviewMessage[],
) {
  return advanceFlow(caseId, "INCOME_INTERVIEW", transcript);
}

export async function commitPchIncomeInterviewAction(
  caseId: string,
  transcript: InterviewMessage[],
): Promise<ActionResult> {
  try {
    const { caseRow, admin } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    const final = await runInterviewTurn("INCOME_INTERVIEW", trimForFinalize(transcript));
    if (final.kind !== "done") {
      return { ok: false, error: "The AI isn't finished yet, keep going in the chat." };
    }
    const platforms = pickString(final, "platforms_summary") ?? "";
    const grossGbp = pickNumber(final, "total_gross_gbp");
    const feesGbp = pickNumber(final, "total_fees_gbp");
    const miles = pickNumber(final, "total_on_trip_miles");

    // Readiness depends on at least one row with positive gross; refuse
    // to write a zero-only row because the engine couldn't run anyway
    // and we'd leave the client with a false "ready" state.
    if (grossGbp == null || grossGbp <= 0) {
      return {
        ok: false,
        error:
          "We couldn't record income without a confirmed total gross figure. Please answer the gross question in the chat.",
      };
    }

    // Replace any previous interview-origin row(s) so re-running is
    // idempotent. The LIKE pattern mirrors the bank-aggregator's own
    // delete-by-prefix approach so manual/bank rows stay untouched.
    await admin
      .from("pch_income_lines")
      .delete()
      .eq("case_id", caseId)
      .like("source", INTERVIEW_SOURCE_PREFIX + "%");

    const sourceLabel = platforms.length > 0
      ? INTERVIEW_SOURCE_PREFIX + platforms.slice(0, 240)
      : INTERVIEW_SOURCE_PREFIX + "Driver-reported income";

    const { error } = await admin.from("pch_income_lines").insert({
      case_id: caseId,
      source: sourceLabel,
      line_type: "Fares",
      sort_order: 0,
      gross_takings_pence: Math.round(grossGbp * 100),
      platform_fee_pence: feesGbp != null && feesGbp >= 0 ? Math.round(feesGbp * 100) : 0,
      on_trip_miles: miles != null && miles >= 0 ? Math.round(miles) : 0,
      dead_miles: 0,
    });
    if (error) return { ok: false, error: error.message };

    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save your income." };
  }
}

// -------------------------------------------------------------------
// (F) EXPENSE_INTERVIEW, chat-based non-vehicle expense capture
//
// Companion to INCOME_INTERVIEW. Six optional expense categories:
// each one, if the client confirms a positive annual figure, writes
// a single pch_expense_lines row with the fixed category / car_cost /
// SA103S box for that category. Missing / zero fields never produce a
// row. The write carries evidence = "Estimate (E2) via AI interview"
// so the auto-derived checklist item 8 (every expense line has
// evidence) stays satisfied.
//
// Idempotency: all written rows carry a "Interview: " label prefix.
// Commit deletes every row with that prefix for this case before
// inserting fresh ones; manual + bank-origin rows ("Bank: " prefix)
// are untouched.
// -------------------------------------------------------------------

type ExpenseFieldSpec = {
  key: string;
  friendlyLabel: string;
  car_cost: "Yes" | "No" | "Phone";
  category: string;
  box: 12 | 14 | 16 | 17 | 18 | 19;
};

const EXPENSE_INTERVIEW_FIELDS: ReadonlyArray<ExpenseFieldSpec> = [
  { key: "phone_data_gbp", friendlyLabel: "Mobile phone and data",
    car_cost: "Phone", category: "Phone & technology", box: 18 },
  { key: "cleaning_gbp", friendlyLabel: "Vehicle cleaning",
    car_cost: "Yes", category: "Vehicle running costs", box: 12 },
  { key: "parking_tolls_gbp", friendlyLabel: "Congestion, ULEZ and parking",
    car_cost: "Yes", category: "Congestion, ULEZ, tolls & parking", box: 12 },
  { key: "insurance_gbp", friendlyLabel: "Vehicle insurance",
    car_cost: "Yes", category: "Accountancy & insurance", box: 14 },
  { key: "subs_fees_gbp", friendlyLabel: "Licences and subscriptions",
    car_cost: "No", category: "Licences & compliance", box: 19 },
];

const EXPENSE_INTERVIEW_EVIDENCE = "Estimate (E2) via AI interview";

async function buildExpenseInterviewOpener(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
): Promise<string | undefined> {
  const { data } = await admin
    .from("pch_expense_lines")
    .select("label, amount_paid_pence")
    .eq("case_id", caseId)
    .like("label", INTERVIEW_SOURCE_PREFIX + "%");
  if (!data || data.length === 0) return undefined;
  const total = data.reduce((n, r) => n + Number(r.amount_paid_pence ?? 0), 0);
  const fmt = (p: number) =>
    "£" + (p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    `Last time you told us: ${data.length} expense line${data.length === 1 ? "" : "s"} totalling ${fmt(total)}. ` +
    "Anything to change, add, or correct?"
  );
}

export async function startPchExpenseInterviewAction(caseId: string) {
  const { admin } = await requireClientPchCase(caseId);
  const override = await buildExpenseInterviewOpener(admin, caseId);
  return startFlow(caseId, "EXPENSE_INTERVIEW", override);
}

export async function advancePchExpenseInterviewAction(
  caseId: string,
  transcript: InterviewMessage[],
) {
  return advanceFlow(caseId, "EXPENSE_INTERVIEW", transcript);
}

export async function commitPchExpenseInterviewAction(
  caseId: string,
  transcript: InterviewMessage[],
): Promise<ActionResult> {
  try {
    const { caseRow, admin } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    const final = await runInterviewTurn("EXPENSE_INTERVIEW", trimForFinalize(transcript));
    if (final.kind !== "done") {
      return { ok: false, error: "The AI isn't finished yet, keep going in the chat." };
    }

    // Replace prior interview-origin expense rows (idempotent re-run).
    await admin
      .from("pch_expense_lines")
      .delete()
      .eq("case_id", caseId)
      .like("label", INTERVIEW_SOURCE_PREFIX + "%");

    type Insert = {
      case_id: string; label: string; amount_paid_pence: number;
      car_cost: "Yes" | "No" | "Phone"; category: string;
      sa103s_box: 12 | 14 | 16 | 17 | 18 | 19;
      evidence: string; sort_order: number;
    };
    const inserts: Insert[] = [];

    // The five fixed-category fields.
    EXPENSE_INTERVIEW_FIELDS.forEach((spec, idx) => {
      const gbp = pickNumber(final, spec.key);
      if (gbp == null || gbp <= 0) return;
      inserts.push({
        case_id: caseId,
        label: INTERVIEW_SOURCE_PREFIX + spec.friendlyLabel,
        amount_paid_pence: Math.round(gbp * 100),
        car_cost: spec.car_cost,
        category: spec.category,
        sa103s_box: spec.box,
        evidence: EXPENSE_INTERVIEW_EVIDENCE,
        sort_order: idx,
      });
    });

    // The paired "other" field: write iff BOTH a positive amount AND a
    // non-empty label were captured; otherwise skip so the "Other"
    // category doesn't land as an unlabelled line the accountant has
    // to chase.
    const otherGbp = pickNumber(final, "other_business_gbp");
    const otherLabel = pickString(final, "other_business_label");
    if (otherGbp != null && otherGbp > 0 && otherLabel && otherLabel.length > 0) {
      inserts.push({
        case_id: caseId,
        label: INTERVIEW_SOURCE_PREFIX + otherLabel.slice(0, 240),
        amount_paid_pence: Math.round(otherGbp * 100),
        car_cost: "No",
        category: "Other expenses",
        sa103s_box: 19,
        evidence: EXPENSE_INTERVIEW_EVIDENCE,
        sort_order: EXPENSE_INTERVIEW_FIELDS.length,
      });
    }

    if (inserts.length > 0) {
      const { error } = await admin.from("pch_expense_lines").insert(inserts);
      if (error) return { ok: false, error: error.message };
    }

    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save your expenses." };
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
