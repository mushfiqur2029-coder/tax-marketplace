"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, fail } from "@/lib/action-result";
import { getTier, type TierId } from "@/lib/plans";
import {
  CHECKLIST_FIELDS,
  ENCRYPTED_FIELD_ID,
  fieldsForTier,
  requiredFieldsForTierGiven,
  type ChecklistField,
} from "@/lib/engagement/checklist";

const BUCKET = "case-documents";

// All limited-company onboarding writes happen on paid draft cases
// (status='submitted' + stripe_payment_status='succeeded' per the webhook
// after Stripe success) OR directly after Stripe success_url bounce when
// the webhook is still catching up. The gate here is "client owns, case
// is paid-but-not-onboarded, case is limited-company". We don't block on
// status because the webhook sets status='submitted' independently of
// the onboarding submit — the two gates are orthogonal.
async function assertCaseInOnboarding(caseId: string) {
  const me = await requireRole("client");
  const supabase = await createClient();
  // intake_answers has to be in this SELECT: both save and submit
  // merge/validate against caseRow.intake_answers, so leaving it out
  // silently nukes everything on every save (next = { ...{}, [field]: v })
  // and makes submit mark every answered field as missing. Was masked
  // for ages by 0039's RLS block — all writes failed anyway — so the
  // bug didn't surface until the policy fix landed and writes started
  // actually hitting the row.
  const { data: caseRow, error } = await supabase
    .from("cases")
    .select(
      "id, client_id, segment, tier, stripe_payment_status, onboarding_submitted_at, intake_answers",
    )
    .eq("id", caseId)
    .single();
  if (error || !caseRow) throw new Error("Case not found.");
  if (caseRow.client_id !== me.id) throw new Error("Not your case.");
  if (caseRow.segment !== "limited_company_vat") {
    throw new Error("Onboarding checklist only applies to limited-company cases.");
  }
  if (caseRow.stripe_payment_status !== "succeeded") {
    throw new Error("Please complete payment before uploading documents.");
  }
  if (caseRow.onboarding_submitted_at) {
    throw new Error("You've already submitted your onboarding.");
  }
  const tier = getTier(caseRow.tier) as unknown as { id: TierId; group: string };
  if (!tier || tier.group !== "company") {
    throw new Error("Case has no company service selected.");
  }
  return {
    me,
    supabase,
    admin: createAdminClient(),
    caseRow,
    tier: tier.id as TierId,
  };
}

// -------------------------------------------------------------------------
// saveChecklistAnswersAction
// Upserts text / select / date fields into cases.intake_answers (reusing
// the existing JSONB). The Company Authentication Code is special-cased:
// routed through set_company_auth_code RPC which encrypts via pgcrypto.
// Called on blur / section-save, not just at submit, so progress persists.
// -------------------------------------------------------------------------
export async function saveChecklistAnswersAction(
  caseId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const { supabase, caseRow, tier, admin } = await assertCaseInOnboarding(
      caseId,
    );

    const visibleFields = fieldsForTier(tier);
    const existing =
      (caseRow as unknown as { intake_answers: Record<string, string> | null })
        .intake_answers ?? {};

    // Build the next answers map by merging what's in the form with what
    // was already there. We only touch fields that appear in the form —
    // leaves other sections' values untouched, so a per-section save
    // doesn't blow away unrelated progress.
    const next: Record<string, string> = { ...existing };
    let encryptPlain: string | null = null;

    for (const field of visibleFields) {
      if (field.kind === "upload") continue; // uploads live in case_documents

      const raw = formData.get(field.id);
      if (raw == null) continue; // not in this submit
      const value = String(raw).trim();

      // Pattern validation on text fields where a regex is defined.
      // We validate here (write-time) AND on submit — write-time catches
      // the mistake earlier and keeps bad values out of the row.
      if (field.kind === "text" && field.pattern && value) {
        const re = new RegExp(field.pattern.regex);
        if (!re.test(value)) throw new Error(field.pattern.message);
      }

      // The encrypted field never lands in intake_answers. We stash the
      // plaintext for the RPC call below and skip the JSONB write.
      if (field.id === ENCRYPTED_FIELD_ID) {
        if (value) encryptPlain = value;
        continue;
      }

      // "Other" freetext mirror for the vat_scheme select.
      if (field.kind === "select" && field.showOtherOn) {
        const otherRaw = formData.get(`${field.id}_other`);
        if (otherRaw != null) {
          next[`${field.id}_other`] = String(otherRaw).trim();
        }
      }

      if (value) {
        next[field.id] = value;
      } else {
        delete next[field.id];
      }
    }

    // .select("id") turns a 0-rows-affected RLS block from a silent
    // success ({error:null,data:null}) into a loud error. That silent
    // shape was exactly how the onboarding fields appeared to save
    // but never actually did — see migration 0039 for the fuller
    // story. Defense in depth: even if a future RLS change
    // accidentally re-locks this path, the user will get an error
    // they can act on rather than discovering it on submit.
    const { data: updData, error: updErr } = await supabase
      .from("cases")
      .update({ intake_answers: next })
      .eq("id", caseId)
      .select("id");
    if (updErr) throw new Error(updErr.message);
    if (!updData || updData.length === 0) {
      throw new Error(
        "Save didn't take — the database refused the write. Reload the page and try again.",
      );
    }

    if (encryptPlain != null) {
      const key = process.env.COMPANY_AUTH_CODE_KEY;
      if (!key) {
        // Fail-closed: refusing to store the auth code is better than
        // silently writing an unrecoverable ciphertext (wrong key) or
        // plaintext (no key). The log line tells us env is missing.
        console.error(
          `[onboarding] COMPANY_AUTH_CODE_KEY missing; refused to encrypt auth code case=${caseId}`,
        );
        throw new Error(
          "Server isn't configured to accept the authentication code yet. Contact support.",
        );
      }
      const { error: rpcErr } = await admin.rpc("set_company_auth_code", {
        p_case_id: caseId,
        p_plain: encryptPlain,
        p_key: key,
      });
      if (rpcErr) throw new Error(rpcErr.message);
    }

    revalidatePath(`/client/cases/${caseId}/onboarding`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// uploadChecklistDocumentAction
// Upload a file tagged with its requirement_key so the client UI and the
// accountant view can group uploads by checklist slot.
// -------------------------------------------------------------------------
export async function uploadChecklistDocumentAction(
  caseId: string,
  requirementKey: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const { me, supabase, tier } = await assertCaseInOnboarding(caseId);

    // Validate the requirement_key against the schema. Prevents a
    // malicious client submitting an arbitrary key that doesn't fit any
    // slot — the accountant case view would then show a stray group.
    const visible = fieldsForTier(tier);
    const slot = visible.find(
      (f) => f.id === requirementKey && f.kind === "upload",
    );
    if (!slot) throw new Error("That upload slot doesn't exist on your service.");

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("Pick a file first.");
    }
    const MAX = 50 * 1024 * 1024;
    if (file.size > MAX) throw new Error("File is over 50 MB.");

    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${caseId}/${Date.now()}_${safeName}`;
    const buf = new Uint8Array(await file.arrayBuffer());

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buf, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (upErr) throw new Error(upErr.message);

    const { error: dbErr } = await supabase.from("case_documents").insert({
      case_id: caseId,
      uploaded_by: me.id,
      file_url: path,
      file_name: file.name,
      requirement_key: requirementKey,
    });
    if (dbErr) {
      await supabase.storage.from(BUCKET).remove([path]);
      throw new Error(dbErr.message);
    }

    revalidatePath(`/client/cases/${caseId}/onboarding`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// removeChecklistDocumentAction
// Lets the client swap out a wrong upload without having to contact
// support. Guarded to the same owner + draft onboarding window.
// -------------------------------------------------------------------------
export async function removeChecklistDocumentAction(
  caseId: string,
  documentId: string,
): Promise<ActionResult> {
  try {
    const { supabase } = await assertCaseInOnboarding(caseId);

    const { data: doc, error: fetchErr } = await supabase
      .from("case_documents")
      .select("id, file_url, case_id, requirement_key")
      .eq("id", documentId)
      .single();
    if (fetchErr || !doc || doc.case_id !== caseId) {
      throw new Error("Document not found.");
    }
    if (!doc.requirement_key) {
      // Belt-and-braces: this action is scoped to checklist uploads only.
      throw new Error("That document isn't part of your onboarding checklist.");
    }

    const { error: delErr } = await supabase
      .from("case_documents")
      .delete()
      .eq("id", documentId);
    if (delErr) throw new Error(delErr.message);

    await supabase.storage.from(BUCKET).remove([doc.file_url]);

    revalidatePath(`/client/cases/${caseId}/onboarding`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// submitChecklistAction
// Validates every required field is present (text in intake_answers OR
// at least one case_documents row with the matching requirement_key),
// stamps onboarding_submitted_at, and bounces the client back to the
// case dashboard. Case now becomes visible in the accountant queue.
//
// Server-side re-validation of required fields matters here — a client
// with a stale CHECKLIST_FIELDS copy or an interrupted upload could
// otherwise submit a partial onboarding and trip accountants later.
// -------------------------------------------------------------------------
export async function submitChecklistAction(
  caseId: string,
): Promise<ActionResult> {
  try {
    const { supabase, admin, caseRow, tier } = await assertCaseInOnboarding(
      caseId,
    );

    const answers =
      (caseRow as unknown as { intake_answers: Record<string, string> | null })
        .intake_answers ?? {};
    // Required set depends on the client's answers because of Section
    // B's ID branch — Passport means one upload, Driving licence means
    // two. requiredFieldsForTierGiven filters by both tier and
    // showWhen visibility.
    const required = requiredFieldsForTierGiven(tier, answers);

    // Load uploaded doc keys in one query. Fine even for 20+ files.
    const { data: docs } = await admin
      .from("case_documents")
      .select("requirement_key")
      .eq("case_id", caseId);
    const uploadedKeys = new Set(
      (docs ?? [])
        .map((d) => d.requirement_key)
        .filter((k): k is string => !!k),
    );

    // Separately, the Company Authentication Code lives encrypted. We
    // check presence by reading the column directly (bytea is enough —
    // no need to decrypt for a presence check).
    const { data: cryptoCheck } = await admin
      .from("cases")
      .select("company_auth_code_encrypted")
      .eq("id", caseId)
      .single();
    const authCodeSet = !!cryptoCheck?.company_auth_code_encrypted;

    const missing: ChecklistField[] = [];
    for (const field of required) {
      if (field.kind === "upload") {
        if (!uploadedKeys.has(field.id)) missing.push(field);
        continue;
      }
      if (field.id === ENCRYPTED_FIELD_ID) {
        if (!authCodeSet) missing.push(field);
        continue;
      }
      const v = answers[field.id];
      if (!v || !String(v).trim()) {
        missing.push(field);
        continue;
      }
      if (field.kind === "text" && field.pattern) {
        const re = new RegExp(field.pattern.regex);
        if (!re.test(v)) {
          missing.push(field);
        }
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `Still missing: ${missing.map((f) => f.label).join(", ")}.`,
      );
    }

    const { data: updData, error: updErr } = await supabase
      .from("cases")
      .update({ onboarding_submitted_at: new Date().toISOString() })
      .eq("id", caseId)
      .select("id");
    if (updErr) throw new Error(updErr.message);
    if (!updData || updData.length === 0) {
      throw new Error(
        "Submit didn't take — the database refused the write. Reload the page and try again.",
      );
    }

    revalidatePath(`/client/cases/${caseId}`);
    revalidatePath(`/client/cases/${caseId}/onboarding`);
    // Accountant queue page caches on fetch; make sure a fresh queue
    // load picks up the new case.
    revalidatePath(`/accountant`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
