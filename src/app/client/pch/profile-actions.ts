"use server";

// Slice 6: server actions backing the Tab 1 "profile summary" panel.
//
// Three jobs:
//   1. syncPchProfileFromUserAction, idempotent copy of PII already
//      captured at registration (client_profiles.name / contact_number
//      / address) into the corresponding pch_cases columns, so the
//      client never has to re-type data we already have.
//   2. startPchProfileInterviewAction, kicks off the PROFILE flow with
//      a context-aware opener that lists what we have and what we still
//      need. Reuses the generic advanceInterviewAction from the Slice 3
//      module for every subsequent turn.
//   3. commitPchProfileInterviewAction, writes the AI's finalized
//      values back to pch_cases (NOT pch_doc_extractions, because
//      profile fields do not live on a document slot).
//
// All writes are idempotent and gated by `assertEditable` (same
// edit-lock as the rest of Tab 1).

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  openInterview,
  runInterviewTurn,
  PROFILE_INTERVIEW_FIELD_KEYS,
  type InterviewMessage,
  type InterviewTurnResult,
  type ProfileInterviewFieldKey,
} from "@/lib/pch/ai-interview";

// Using Record<never, never> instead of Record<string, never> so the
// zero-extra-fields case ({ ok: true }) satisfies ActionOk without the
// intersection reducing to never.
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
  if (status === "submitted") return null;
  return {
    ok: false,
    error:
      "Your return is already with your accountant. Message them if something needs to change.",
  };
}

// -------------------------------------------------------------------
// (1) sync registration PII into pch_cases. Called when the client
//     first opens the PCH workspace (via ensurePchHeadRow upstream).
//     Only writes columns that are currently empty so a later client
//     edit via the interview is never clobbered.
// -------------------------------------------------------------------
export async function syncPchProfileFromUserAction(
  caseId: string,
): Promise<ActionResult> {
  try {
    const { me, admin } = await requireClientPchCase(caseId);
    const [{ data: profile }, { data: head }] = await Promise.all([
      admin
        .from("client_profiles")
        .select("name, contact_number, address")
        .eq("user_id", me.id)
        .maybeSingle(),
      admin
        .from("pch_cases")
        .select("cl_name, cl_phone, cl_address, cl_postcode, cl_email")
        .eq("case_id", caseId)
        .maybeSingle(),
    ]);
    if (!profile) return { ok: true };

    // Address was stored as a multi-line join of line1 \n line2 \n city
    // \n postcode (see signUpAction). Peel the postcode off the end so
    // Tab 1 can display it as its own field; the remainder becomes the
    // address.
    const addrLines = ((profile.address ?? "") as string)
      .split(/\r?\n/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);
    const postcode = addrLines.length > 1 ? addrLines[addrLines.length - 1] : "";
    const addressRest =
      postcode.length > 0 ? addrLines.slice(0, -1).join(", ") : addrLines.join(", ");

    const patch: Record<string, string> = {};
    if (!head?.cl_name && profile.name) patch.cl_name = profile.name;
    if (!head?.cl_phone && profile.contact_number) patch.cl_phone = profile.contact_number;
    if (!head?.cl_address && addressRest) patch.cl_address = addressRest;
    if (!head?.cl_postcode && postcode) patch.cl_postcode = postcode;
    if (!head?.cl_email && me.email) patch.cl_email = me.email;

    if (Object.keys(patch).length === 0) return { ok: true };

    const { error } = await admin
      .from("pch_cases")
      .update(patch)
      .eq("case_id", caseId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Profile sync failed." };
  }
}

// -------------------------------------------------------------------
// (2) start the profile interview. Builds a dynamic opener from the
//     current pch_cases state so the AI's first message lists what we
//     already have and what we still need, instead of blindly asking
//     for everything.
// -------------------------------------------------------------------
type ProfileState = Record<ProfileInterviewFieldKey, string | number | null>;

const FIELD_LABELS: Record<ProfileInterviewFieldKey, string> = {
  cl_dob: "date of birth",
  cl_utr: "UTR",
  cl_nino: "National Insurance number",
  cl_licensing_authority: "licensing authority",
  marriage_allowance_status: "Marriage Allowance status",
  personal_pension_net_pound: "personal pension amount",
  gift_aid_net_pound: "Gift Aid amount",
};

async function readProfileState(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
): Promise<ProfileState> {
  const { data } = await admin
    .from("pch_cases")
    .select(
      "cl_dob, cl_utr, cl_nino, cl_licensing_authority, marriage_allowance_status, personal_pension_net_pence, gift_aid_net_pence",
    )
    .eq("case_id", caseId)
    .maybeSingle();
  const toPounds = (p: number | null | undefined): number | null => {
    if (p == null) return null;
    return Math.round(p) / 100;
  };
  return {
    cl_dob: (data?.cl_dob as string | null) ?? null,
    cl_utr: (data?.cl_utr as string | null) ?? null,
    cl_nino: (data?.cl_nino as string | null) ?? null,
    cl_licensing_authority: (data?.cl_licensing_authority as string | null) ?? null,
    marriage_allowance_status:
      (data?.marriage_allowance_status as string | null) ?? null,
    personal_pension_net_pound: toPounds(
      (data?.personal_pension_net_pence as number | null) ?? null,
    ),
    gift_aid_net_pound: toPounds(
      (data?.gift_aid_net_pence as number | null) ?? null,
    ),
  };
}

function missingKeys(state: ProfileState): ProfileInterviewFieldKey[] {
  return PROFILE_INTERVIEW_FIELD_KEYS.filter((k) => {
    const v = state[k];
    return v == null || v === "" || (typeof v === "number" && Number.isNaN(v));
  });
}

function buildProfileOpener(state: ProfileState, focus: ProfileInterviewFieldKey[]): string {
  if (focus.length === 0) {
    return "Thanks, we already have everything we need for your profile. If anything looks wrong, tell me which field and the correct value and I'll fix it.";
  }
  const first = focus[0];
  const rest = focus.slice(1);
  const haveList = PROFILE_INTERVIEW_FIELD_KEYS
    .filter((k) => !focus.includes(k) && state[k] != null && state[k] !== "")
    .map((k) => FIELD_LABELS[k]);
  const needList = focus.map((k) => FIELD_LABELS[k]);
  const alreadyLine = haveList.length > 0
    ? `We already have your ${listJoin(haveList)}. `
    : "";
  const needLine = `We still need ${listJoin(needList)}.`;
  const firstQ = firstQuestionFor(first);
  return `${alreadyLine}${needLine} ${firstQ}` + (rest.length > 0 ? " We'll take the others one at a time after this." : "");
}

function listJoin(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return items.join(" and ");
  return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
}

function firstQuestionFor(key: ProfileInterviewFieldKey): string {
  switch (key) {
    case "cl_dob":
      return "Let's start with your date of birth, yyyy-mm-dd please.";
    case "cl_utr":
      return "First up: what's your 10-digit HMRC UTR? If you don't have one, say 'I don't know' and we'll flag it for your accountant.";
    case "cl_nino":
      return "Let's start with your National Insurance number, format AB123456C.";
    case "cl_licensing_authority":
      return "First off: who issued your private-hire licence? TfL, or a local council (and which one)?";
    case "marriage_allowance_status":
      return "First one: Marriage Allowance. Are you Transferring part of your personal allowance to a spouse, Receiving some from a spouse, or neither (None)?";
    case "personal_pension_net_pound":
      return "First up: how much did you pay into a personal (private) pension in the tax year? GBP, the net amount you actually paid out, not including basic-rate relief.";
    case "gift_aid_net_pound":
      return "First one: how much did you give to charity under Gift Aid in the tax year? GBP, zero is a fine answer if you didn't.";
  }
}

export async function startPchProfileInterviewAction(
  caseId: string,
): Promise<ActionResult<{ opener: InterviewMessage; focusFieldKeys: ProfileInterviewFieldKey[] }>> {
  try {
    const { caseRow, admin } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    const state = await readProfileState(admin, caseId);
    const focus = missingKeys(state);
    // Even when nothing is missing, the user may want to correct a
    // field. The opener handles the empty-focus case gracefully, and
    // the AI's full PROFILE schema still applies (no focusFieldKeys)
    // so they can touch any field in the correction flow.
    const opener = openInterview("PROFILE", buildProfileOpener(state, focus));
    return { ok: true, opener, focusFieldKeys: focus };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Profile interview failed to start.",
    };
  }
}

export async function advancePchProfileInterviewAction(
  caseId: string,
  transcript: InterviewMessage[],
  focusFieldKeys?: string[],
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
    const turn = await runInterviewTurn(
      "PROFILE",
      cleaned,
      focusFieldKeys && focusFieldKeys.length > 0 ? { focusFieldKeys } : undefined,
    );
    return { ok: true, turn };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI interview failed." };
  }
}

// -------------------------------------------------------------------
// (3) commit the AI's finalized values to pch_cases. Writes only the
//     fields the AI returned with confidence !== 'missing'. Missing
//     fields are left as whatever's already in pch_cases so a prior
//     correct value isn't wiped by a "don't know" in a later run.
// -------------------------------------------------------------------
export async function commitPchProfileInterviewAction(
  caseId: string,
  transcript: InterviewMessage[],
  focusFieldKeys?: string[],
): Promise<ActionResult<{ writtenKeys: string[] }>> {
  try {
    const { me, caseRow, admin } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;

    // Re-run finalize server-side so the committed values are the
    // model's output, not something the browser can hand-craft, same
    // pattern as commitInterviewAction for slot interviews.
    const final = await runInterviewTurn(
      "PROFILE",
      transcript,
      focusFieldKeys && focusFieldKeys.length > 0 ? { focusFieldKeys } : undefined,
    );
    if (final.kind !== "done") {
      return {
        ok: false,
        error:
          "The AI isn't finished yet, there are still fields to confirm. Keep going in the chat.",
      };
    }

    const patch: Record<string, string | number | null> = {};
    const written: string[] = [];
    for (const [key, field] of Object.entries(final.fields)) {
      if (field.confidence === "missing" || field.value == null) continue;
      switch (key as ProfileInterviewFieldKey) {
        case "cl_dob":
        case "cl_utr":
        case "cl_nino":
        case "cl_licensing_authority":
          patch[key] = String(field.value).trim();
          written.push(key);
          break;
        case "marriage_allowance_status": {
          const raw = String(field.value).trim();
          const normalized =
            /^transfer/i.test(raw) ? "Transferring"
              : /^receiv/i.test(raw) ? "Receiving"
              : /^none/i.test(raw) ? "None"
              : null;
          if (normalized) {
            patch.marriage_allowance_status = normalized;
            written.push(key);
          }
          break;
        }
        case "personal_pension_net_pound": {
          const n = Number(field.value);
          if (Number.isFinite(n) && n >= 0) {
            patch.personal_pension_net_pence = Math.round(n * 100);
            written.push(key);
          }
          break;
        }
        case "gift_aid_net_pound": {
          const n = Number(field.value);
          if (Number.isFinite(n) && n >= 0) {
            patch.gift_aid_net_pence = Math.round(n * 100);
            written.push(key);
          }
          break;
        }
      }
    }

    if (written.length > 0) {
      // pch_cases has a BEFORE UPDATE trigger that sets updated_at
      // itself (migration 0080), and no updated_by column; just send
      // the patch columns.
      void me;
      const { error } = await admin
        .from("pch_cases")
        .update(patch)
        .eq("case_id", caseId);
      if (error) return { ok: false, error: error.message };
    }
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true, writtenKeys: written };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not save the profile answers.",
    };
  }
}
