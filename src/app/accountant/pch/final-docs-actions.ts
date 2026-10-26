"use server";

// Phase I.4c / I.4d server surface for the FinalDocumentsPanel on
// the accountant workspace. Four concerns, same requireAccountantPch
// Case guard as pl-actions.ts:
//
//   generateFinalDocsAction(caseId)
//     Runs both PDF generators (SA Forwarding Letter + PCH Accounts),
//     uploads each as a case_documents row + a storage object under
//     ${caseId}/final/, stamps the resulting paths on pch_cases.
//     sa_forwarding_pdf_path / pch_accounts_pdf_path. Refuses with a
//     clear error if the P&L hasn't been confirmed yet. Regenerating
//     any time before send is allowed; the paths just re-stamp (old
//     blobs orphan in storage - will be swept by the reaper, not a
//     correctness issue for the client approval flow).
//
//   uploadPchFinalDocAction(caseId, column, formData)
//     Manual upload path for the SA302 + SA100 slots. 25 MB cap,
//     same accept list the rest of the intake uses. Column is
//     allow-listed to the two Phase I upload columns so a stale /
//     malicious caller can't rewrite sa_forwarding_pdf_path through
//     this entry point.
//
//   deletePchFinalDocAction(caseId, column)
//     Lets the accountant pull a wrong upload back off the slot
//     without needing to replace it first. Reuses the same column
//     allow-list.
//
//   sendForClientConfirmationAction(caseId)
//     Phase I's replacement for the old requestClientFilingAction's
//     33-check gate: refuses unless all FOUR doc paths are populated
//     (both generated PDFs + both manual uploads), then stamps docs_
//     ready_at (if unset) + docs_sent_for_approval_at and flips
//     cases.status submitted/in_review/prepared -> client_approval
//     with a concurrency guard.

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { randomUUID } from "node:crypto";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPchReadyToApproveEmail } from "@/lib/pch/status-emails";
import { generateSaForwardingLetterPdf } from "@/lib/pch/sa-forwarding-letter";
import { generatePchAccountsPdf } from "@/lib/pch/pch-accounts-pdf";

type ActionOk = { ok: true };
type ActionErr = { ok: false; error: string };
type ActionResult = ActionOk | ActionErr;
type ActionResultWith<T> = (ActionOk & T) | ActionErr;

const UPLOAD_COLUMN_SA302 = "sa302_upload_path";
const UPLOAD_COLUMN_SA100 = "sa100_upload_path";
const UPLOAD_ALLOWED = new Set([UPLOAD_COLUMN_SA302, UPLOAD_COLUMN_SA100]);

async function requireAccountantPchCase(caseId: string) {
  const me = await requireRole("accountant");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cases")
    .select("id, client_id, accountant_id, status, tier")
    .eq("id", caseId)
    .single();
  if (error || !data) throw new Error("Case not found.");
  if (data.accountant_id !== me.id) {
    throw new Error("This case is assigned to a different accountant.");
  }
  if (data.tier !== "uber_phv_automated") {
    throw new Error("Not a PCH automated case.");
  }
  return { me, admin, caseRow: data };
}

// -------------------------------------------------------------------
// Generate the SA Forwarding Letter + PCH Accounts PDFs
// -------------------------------------------------------------------

export async function generateFinalDocsAction(
  caseId: string,
): Promise<
  ActionResultWith<{
    saForwardingPdfPath: string;
    pchAccountsPdfPath: string;
  }>
> {
  try {
    const { me, admin } = await requireAccountantPchCase(caseId);

    const { data: head, error } = await admin
      .from("pch_cases")
      .select("pl_confirmed_at")
      .eq("case_id", caseId)
      .single();
    if (error) return { ok: false, error: error.message };
    if (!head?.pl_confirmed_at) {
      return {
        ok: false,
        error: "Confirm the P&L before generating the final documents.",
      };
    }

    const [letterBytes, accountsBytes] = await Promise.all([
      generateSaForwardingLetterPdf(caseId, admin),
      generatePchAccountsPdf(caseId, admin),
    ]);

    const letterPath = `${caseId}/final/sa-forwarding-${randomUUID()}.pdf`;
    const accountsPath = `${caseId}/final/pch-accounts-${randomUUID()}.pdf`;

    const [letterUp, accountsUp] = await Promise.all([
      admin.storage
        .from("case-documents")
        .upload(letterPath, letterBytes, { contentType: "application/pdf" }),
      admin.storage
        .from("case-documents")
        .upload(accountsPath, accountsBytes, { contentType: "application/pdf" }),
    ]);
    if (letterUp.error) {
      return { ok: false, error: "SA letter upload failed: " + letterUp.error.message };
    }
    if (accountsUp.error) {
      return { ok: false, error: "PCH Accounts upload failed: " + accountsUp.error.message };
    }

    // case_documents rows so the file surfaces in the Documents panel
    // for both sides, same pattern uploadPchGeneralDocumentAction uses.
    const docsIns = await admin.from("case_documents").insert([
      {
        case_id: caseId,
        uploaded_by: me.id,
        file_name: "SA Forwarding Letter.pdf",
        file_url: letterPath,
        requirement_key: "pch-final-sa-forwarding",
      },
      {
        case_id: caseId,
        uploaded_by: me.id,
        file_name: "PCH Accounts.pdf",
        file_url: accountsPath,
        requirement_key: "pch-final-pch-accounts",
      },
    ]);
    if (docsIns.error) return { ok: false, error: docsIns.error.message };

    const upd = await admin
      .from("pch_cases")
      .update({
        sa_forwarding_pdf_path: letterPath,
        pch_accounts_pdf_path: accountsPath,
      })
      .eq("case_id", caseId);
    if (upd.error) return { ok: false, error: upd.error.message };

    revalidatePath(`/accountant/cases/${caseId}/pch`);
    return {
      ok: true,
      saForwardingPdfPath: letterPath,
      pchAccountsPdfPath: accountsPath,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Generate failed." };
  }
}

// -------------------------------------------------------------------
// Manual SA302 / SA100 upload
// -------------------------------------------------------------------

export async function uploadPchFinalDocAction(
  caseId: string,
  column: string,
  formData: FormData,
): Promise<ActionResultWith<{ path: string }>> {
  try {
    if (!UPLOAD_ALLOWED.has(column)) {
      return { ok: false, error: "Column not writable from this action." };
    }
    const { me, admin } = await requireAccountantPchCase(caseId);

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Pick a file first." };
    }
    const MAX = 25 * 1024 * 1024;
    if (file.size > MAX) return { ok: false, error: "File is over 25 MB." };

    const typeLower = (file.type || "").toLowerCase();
    const nameLower = file.name.toLowerCase();
    const isPdf = typeLower === "application/pdf" || nameLower.endsWith(".pdf");
    const isJpeg = typeLower === "image/jpeg" || /\.jpe?g$/.test(nameLower);
    const isPng = typeLower === "image/png" || /\.png$/.test(nameLower);
    const isWebp = typeLower === "image/webp" || /\.webp$/.test(nameLower);
    if (!isPdf && !isJpeg && !isPng && !isWebp) {
      return { ok: false, error: "Upload a PDF, JPG, PNG or WebP." };
    }

    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_");
    const path = `${caseId}/final/${column}-${randomUUID()}-${safe}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await admin.storage
      .from("case-documents")
      .upload(path, bytes, { contentType: file.type || "application/octet-stream" });
    if (up.error) return { ok: false, error: "Upload failed: " + up.error.message };

    const requirementKey =
      column === UPLOAD_COLUMN_SA302 ? "pch-final-sa302" : "pch-final-sa100";
    const docIns = await admin.from("case_documents").insert({
      case_id: caseId,
      uploaded_by: me.id,
      file_name: file.name,
      file_url: path,
      requirement_key: requirementKey,
    });
    if (docIns.error) return { ok: false, error: docIns.error.message };

    const upd = await admin
      .from("pch_cases")
      .update({ [column]: path })
      .eq("case_id", caseId);
    if (upd.error) return { ok: false, error: upd.error.message };

    revalidatePath(`/accountant/cases/${caseId}/pch`);
    return { ok: true, path };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed." };
  }
}

export async function deletePchFinalDocAction(
  caseId: string,
  column: string,
): Promise<ActionResult> {
  try {
    if (!UPLOAD_ALLOWED.has(column)) {
      return { ok: false, error: "Column not writable from this action." };
    }
    const { admin } = await requireAccountantPchCase(caseId);
    const upd = await admin
      .from("pch_cases")
      .update({ [column]: null })
      .eq("case_id", caseId);
    if (upd.error) return { ok: false, error: upd.error.message };
    revalidatePath(`/accountant/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Remove failed." };
  }
}

// -------------------------------------------------------------------
// Send for client confirmation. Phase I.4d gate: all FOUR doc paths
// populated, then stamp docs_ready_at / docs_sent_for_approval_at and
// flip the case to client_approval. Replaces the old
// requestClientFilingAction (same name is still exported from
// src/app/accountant/pch/actions.ts to keep its reserved slot; the
// orchestrator / FinalDocumentsPanel calls THIS one).
// -------------------------------------------------------------------

export async function sendForClientConfirmationAction(
  caseId: string,
): Promise<ActionResult> {
  try {
    const { caseRow, admin } = await requireAccountantPchCase(caseId);

    const { data: head, error } = await admin
      .from("pch_cases")
      .select(
        "sa_forwarding_pdf_path, pch_accounts_pdf_path, sa302_upload_path, sa100_upload_path, docs_ready_at",
      )
      .eq("case_id", caseId)
      .single();
    if (error) return { ok: false, error: error.message };
    const missing: string[] = [];
    if (!head?.sa_forwarding_pdf_path) missing.push("SA Forwarding Letter");
    if (!head?.pch_accounts_pdf_path) missing.push("PCH Accounts");
    if (!head?.sa302_upload_path) missing.push("SA302");
    if (!head?.sa100_upload_path) missing.push("SA100");
    if (missing.length > 0) {
      return {
        ok: false,
        error: `${missing.join(", ")} not yet on this case. All four documents must be in place before sending for client confirmation.`,
      };
    }

    if (
      caseRow.status !== "submitted"
      && caseRow.status !== "in_review"
      && caseRow.status !== "prepared"
    ) {
      return {
        ok: false,
        error: `Case status is ${caseRow.status}; must be submitted, in_review or prepared to send for confirmation.`,
      };
    }

    const now = new Date().toISOString();
    const headUpd = await admin
      .from("pch_cases")
      .update({
        docs_ready_at: head.docs_ready_at ?? now,
        docs_sent_for_approval_at: now,
      })
      .eq("case_id", caseId);
    if (headUpd.error) return { ok: false, error: headUpd.error.message };

    const statusUpd = await admin
      .from("cases")
      .update({ status: "client_approval" })
      .eq("id", caseId)
      .eq("status", caseRow.status); // concurrency guard
    if (statusUpd.error) return { ok: false, error: statusUpd.error.message };

    after(() => sendPchReadyToApproveEmail(caseId));
    revalidatePath(`/accountant/cases/${caseId}/pch`);
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Send failed." };
  }
}
