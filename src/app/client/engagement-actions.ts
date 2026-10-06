"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTier } from "@/lib/plans";
import { effectiveFeePence, formatFeeGbp } from "@/lib/case/pricing";
import { type ActionResult, fail } from "@/lib/action-result";
import { renderEngagementLetterHtml } from "@/lib/engagement/letter-template";
import { renderPdfFromHtml } from "@/lib/engagement/pdf";
import { sendEmailViaAppsScript } from "@/lib/email";

// Shape of the three company identity keys we store in intake_answers.
// company_status is retained from the Companies House pick so downstream
// surfaces (approval cards, admin case detail) can show "Active" /
// "Dissolved" without re-querying. "unknown" means the client typed it
// in manually and we didn't verify.
const COMPANY_NUMBER_RE = /^(?:\d{8}|[A-Za-z]{2}\d{6})$/;

const BUCKET = "case-documents";

// Format a Date as "1 October 2026" (en-GB long date). Used for both the
// effective date and the sign date in the letter.
function formatLongDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
}

function stripDataUrlPrefix(dataUrl: string): string | null {
  // Expected shape: "data:image/png;base64,AAAA..."
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:image/png;base64,") || comma === -1) {
    return null;
  }
  return dataUrl.slice(comma + 1);
}

// -------------------------------------------------------------------------
// Client signs the engagement letter.
//
// Guards:
//   • case must be the caller's own
//   • segment = limited_company_vat OR personal
//   • status = draft (post-payment sign is nonsensical)
//   • not already signed
//
// Variants:
//   • limited_company — requires company_name + company_number in
//     intake_answers (captured by the Companies House picker above);
//     letter renders the full Parties block with director labels.
//   • personal — no company identity needed; letter renders a
//     client-only Parties block.
//
// Writes:
//   • uploads the signature PNG and the compiled PDF to case-documents/
//     signatures/{case_id}/ via the admin client (bucket has RLS, but
//     admin bypass is simpler than minting a signed URL loop)
//   • snapshots client name + phone from client_profiles onto the case
//   • stamps engagement_signed_at
//
// Then fires two emails (client + info@sterlingledger.co.uk). Email
// failures do NOT roll back the signing: payment can still proceed, and
// a missing APPSSCRIPT_EMAIL_URL env in local dev just logs a skipped
// line. Flag in README once the Script is deployed.
// -------------------------------------------------------------------------
// -------------------------------------------------------------------------
// setCompanyIdentityAction
// Called from the engagement sign page as the client picks (or manually
// enters) their Companies House details. Writes company_name,
// company_number and the picked company_status into intake_answers via
// the merge RPC so a concurrent save can't clobber other keys. Only
// valid in the pre-sign draft state — once engagement is signed the
// snapshot is baked into the PDF and must not change here.
// -------------------------------------------------------------------------
export async function setCompanyIdentityAction(
  caseId: string,
  input: {
    companyName: string;
    companyNumber: string;
    companyStatus: string | null;
  },
): Promise<ActionResult> {
  try {
    const me = await requireRole("client");
    const supabase = await createClient();

    const { data: caseRow, error: caseErr } = await supabase
      .from("cases")
      .select("id, client_id, segment, status, engagement_signed_at")
      .eq("id", caseId)
      .single();
    if (caseErr || !caseRow) throw new Error("Case not found.");
    if (caseRow.client_id !== me.id) throw new Error("Not your case.");
    if (caseRow.segment !== "limited_company_vat") {
      throw new Error("This case doesn't use a company identity.");
    }
    if (caseRow.engagement_signed_at) {
      throw new Error(
        "The engagement letter is already signed. Contact support to correct the company details.",
      );
    }
    if (caseRow.status !== "draft") {
      throw new Error("This case is past the engagement step.");
    }

    const name = input.companyName.trim();
    const number = input.companyNumber.trim().toUpperCase();
    if (!name) throw new Error("Enter the company name.");
    if (!COMPANY_NUMBER_RE.test(number)) {
      throw new Error(
        "Company number must be 8 digits, or 2 letters followed by 6 digits (e.g. SC123456).",
      );
    }
    const status = (input.companyStatus ?? "unknown").trim() || "unknown";

    const { data: rows, error: rpcErr } = await supabase.rpc(
      "merge_case_intake_answers",
      {
        p_case_id: caseId,
        p_patch: {
          company_name: name,
          company_number: number,
          company_status: status,
        },
      },
    );
    if (rpcErr) throw new Error(rpcErr.message);
    if ((rows ?? 0) === 0) {
      throw new Error(
        "Save didn't take. The database refused the write. Reload the page and try again.",
      );
    }

    revalidatePath(`/client/cases/${caseId}/engagement`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// clearCompanyIdentityAction
// Companion to setCompanyIdentityAction — used by the widget's "Change"
// button so the client can pick a different company before signing.
// Deliberately writes empty-string values rather than deleting keys
// because the merge RPC only merges (|| in SQL has no delete semantic).
// -------------------------------------------------------------------------
export async function clearCompanyIdentityAction(
  caseId: string,
): Promise<ActionResult> {
  try {
    const me = await requireRole("client");
    const supabase = await createClient();

    const { data: caseRow, error: caseErr } = await supabase
      .from("cases")
      .select("id, client_id, segment, status, engagement_signed_at")
      .eq("id", caseId)
      .single();
    if (caseErr || !caseRow) throw new Error("Case not found.");
    if (caseRow.client_id !== me.id) throw new Error("Not your case.");
    if (caseRow.engagement_signed_at) {
      throw new Error(
        "The engagement letter is already signed. Contact support to correct the company details.",
      );
    }
    if (caseRow.status !== "draft") {
      throw new Error("This case is past the engagement step.");
    }

    const { data: rows, error: rpcErr } = await supabase.rpc(
      "merge_case_intake_answers",
      {
        p_case_id: caseId,
        p_patch: {
          company_name: "",
          company_number: "",
          company_status: "",
        },
      },
    );
    if (rpcErr) throw new Error(rpcErr.message);
    if ((rows ?? 0) === 0) {
      throw new Error(
        "Clear didn't take. The database refused the write. Reload and try again.",
      );
    }
    revalidatePath(`/client/cases/${caseId}/engagement`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function signEngagementAction(
  caseId: string,
  signatureDataUrl: string,
): Promise<ActionResult> {
  try {
    const me = await requireRole("client");

    const supabase = await createClient();
    const { data: caseRow, error: caseErr } = await supabase
      .from("cases")
      .select(
        "id, client_id, segment, tier, status, engagement_signed_at, intake_answers, custom_fee_pence",
      )
      .eq("id", caseId)
      .single();
    if (caseErr || !caseRow) throw new Error("Case not found.");
    if (caseRow.client_id !== me.id) throw new Error("Not your case.");
    if (
      caseRow.segment !== "limited_company_vat" &&
      caseRow.segment !== "personal"
    ) {
      throw new Error("This case doesn't use an engagement letter.");
    }
    if (caseRow.status !== "draft") {
      throw new Error("This case is past the sign step.");
    }
    if (caseRow.engagement_signed_at) {
      throw new Error("You've already signed this engagement letter.");
    }

    const tier = getTier(caseRow.tier);
    if (!tier) throw new Error("Case has no service selected.");
    const isCompany = caseRow.segment === "limited_company_vat";
    if (isCompany && tier.group !== "company") {
      throw new Error("Case has no company service selected.");
    }
    if (!isCompany && tier.group !== "personal") {
      throw new Error("Case has no personal service selected.");
    }

    // Company identity must be captured before signing on the LC path —
    // the engagement letter PDF prints company_name and company_number
    // at the top of the Parties block, and the Section A pre-fills on
    // onboarding are sourced from these two keys. Personal cases carry
    // no company identity and skip this gate entirely.
    const ans =
      (caseRow as unknown as {
        intake_answers: Record<string, string> | null;
      }).intake_answers ?? {};
    let companyName = "";
    let companyNumber = "";
    if (isCompany) {
      companyName = (ans.company_name ?? "").trim();
      companyNumber = (ans.company_number ?? "").trim().toUpperCase();
      if (!companyName || !companyNumber) {
        throw new Error(
          "Pick your company from Companies House (or enter it manually) before signing.",
        );
      }
      if (!COMPANY_NUMBER_RE.test(companyNumber)) {
        throw new Error(
          "Stored company number is in the wrong format. Click Change and re-enter it.",
        );
      }
    }

    // Pull the client's profile for snapshot. Phone can legitimately be
    // blank — the letter will render "—" in that case.
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("client_profiles")
      .select("name, contact_number")
      .eq("user_id", me.id)
      .maybeSingle();
    const clientName = (profile?.name ?? me.name ?? me.email).trim();
    const clientPhone = (profile?.contact_number ?? "").trim();

    const sigBase64 = stripDataUrlPrefix(signatureDataUrl);
    if (!sigBase64) throw new Error("Signature image missing or malformed.");

    const now = new Date();
    const signDate = formatLongDate(now);

    // Build the HTML, render the PDF. Render failure is surfaced as a
    // clean error rather than storing a partial file.
    let pdfBytes: Uint8Array;
    const feeLabel = formatFeeGbp(
      effectiveFeePence(
        caseRow as unknown as { custom_fee_pence: number | null },
        tier,
      ),
    );
    const letterHtml = renderEngagementLetterHtml({
      effectiveDate: signDate,
      variant: isCompany ? "limited_company" : "personal",
      companyName,
      companyNumber,
      clientName,
      clientEmail: me.email,
      clientPhone: clientPhone || "—",
      serviceName: tier.title,
      totalFee: feeLabel,
      signatureDataUrl,
      signDate,
    });
    try {
      pdfBytes = await renderPdfFromHtml(letterHtml);
    } catch (err) {
      console.error(
        `[engagement] pdf render failed case=${caseId} err=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Signature + checkbox are preserved in the form state on error,
      // so the user can click Sign and continue again without redrawing.
      // Only surface "contact support" if a retry is unlikely to help —
      // for now, every error here is transient enough to retry.
      throw new Error(
        "We couldn't generate your engagement PDF just now. Please click Sign and continue again. Your signature and tick are kept. If it keeps failing, contact support.",
      );
    }

    const basePath = `signatures/${caseId}`;
    const sigPath = `${basePath}/signature.png`;
    const pdfPath = `${basePath}/engagement.pdf`;

    const sigBytes = Buffer.from(sigBase64, "base64");
    const sigUpload = await admin.storage
      .from(BUCKET)
      .upload(sigPath, sigBytes, {
        contentType: "image/png",
        upsert: true,
      });
    if (sigUpload.error) throw new Error(sigUpload.error.message);

    const pdfUpload = await admin.storage
      .from(BUCKET)
      .upload(pdfPath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (pdfUpload.error) throw new Error(pdfUpload.error.message);

    const { error: updateErr } = await admin
      .from("cases")
      .update({
        engagement_signed_at: now.toISOString(),
        engagement_pdf_path: pdfPath,
        signature_image_path: sigPath,
        client_name_snapshot: clientName,
        client_phone_snapshot: clientPhone || null,
      })
      .eq("id", caseId);
    if (updateErr) throw new Error(updateErr.message);

    // Emails are best-effort. See src/lib/email.ts for the fallback
    // behaviour when APPSSCRIPT_EMAIL_URL / APPSSCRIPT_EMAIL_SECRET are
    // not set yet.
    const pdfBase64 = Buffer.from(pdfBytes).toString("base64");
    const pdfFilename = `sterling-ledger-engagement-letter.pdf`;

    const clientHtml = `
      <p>Hi ${escapeHtml(clientName)},</p>
      <p>Thanks for signing the engagement letter for your <strong>${escapeHtml(
        tier.title,
      )}</strong> service. A copy is attached for your records.</p>
      <p>Next step: payment of <strong>${feeLabel}</strong>. You can complete this now from your case page.</p>
      <p>Sterling Ledger</p>
    `;
    const internalHtml = `
      <p>New signed engagement letter.</p>
      <ul>
        <li>Client: ${escapeHtml(clientName)} (${escapeHtml(me.email)})</li>
        <li>Service: ${escapeHtml(tier.title)}</li>
        <li>Fee: ${feeLabel}</li>
        <li>Case ID: ${escapeHtml(caseId)}</li>
      </ul>
      <p>PDF is attached.</p>
    `;

    await sendEmailViaAppsScript({
      to: me.email,
      subject: "Your Sterling Ledger engagement letter",
      html: clientHtml,
      pdfBase64,
      filename: pdfFilename,
      logCaseId: caseId,
    });
    await sendEmailViaAppsScript({
      to: "info@sterlingledger.co.uk",
      subject: `New signed engagement · ${me.email} · ${tier.title}`,
      html: internalHtml,
      pdfBase64,
      filename: pdfFilename,
      logCaseId: caseId,
    });

    revalidatePath(`/client/cases/${caseId}`);
    revalidatePath(`/client`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Signed URL for the stored engagement PDF or raw signature PNG, so
// client / accountant / admin can view their own copy after signing.
// `asset` picks which file: 'pdf' (the compiled letter) or 'signature'
// (the drawn PNG, kept separately so a template re-render can reuse the
// signature without re-asking the client).
export async function getEngagementAssetSignedUrl(
  caseId: string,
  asset: "pdf" | "signature",
): Promise<ActionResult<string>> {
  try {
    const supabase = await createClient();
    const admin = createAdminClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in.");

    const { data: caseRow } = await admin
      .from("cases")
      .select(
        "client_id, accountant_id, engagement_pdf_path, signature_image_path, stripe_payment_status",
      )
      .eq("id", caseId)
      .single();
    if (!caseRow) throw new Error("Case not found.");

    const path =
      asset === "pdf"
        ? caseRow.engagement_pdf_path
        : caseRow.signature_image_path;
    if (!path) {
      throw new Error(
        asset === "pdf"
          ? "Engagement letter not available yet."
          : "Signature image not available yet.",
      );
    }

    // Access rules mirror what the accountant case detail page shows:
    // admin always, client owner, assigned accountant, and — because
    // unassigned queue cases are visible to every approved accountant
    // deciding whether to take them — any approved accountant on a paid
    // queue case too. Without this last branch an accountant looking at
    // the queue would see "Engagement letter signed" with a broken
    // signature image, even though they can see the rest of the case.
    const { data: meRow } = await admin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();
    const isAdmin = meRow?.role === "admin";
    const isOwner = caseRow.client_id === user.id;
    const isAssigned = caseRow.accountant_id === user.id;

    let isApprovedAccountantOnQueueCase = false;
    if (
      !isAdmin &&
      !isOwner &&
      !isAssigned &&
      meRow?.role === "accountant" &&
      caseRow.accountant_id === null &&
      caseRow.stripe_payment_status === "succeeded"
    ) {
      const { data: ap } = await admin
        .from("accountant_profiles")
        .select("approval_status")
        .eq("user_id", user.id)
        .maybeSingle();
      isApprovedAccountantOnQueueCase = ap?.approval_status === "approved";
    }

    if (
      !isAdmin &&
      !isOwner &&
      !isAssigned &&
      !isApprovedAccountantOnQueueCase
    ) {
      throw new Error("Not allowed.");
    }

    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(path, 60);
    if (error || !data) {
      throw new Error(error?.message ?? "Could not sign URL.");
    }
    return { ok: true, data: data.signedUrl };
  } catch (e) {
    return fail(e);
  }
}

// Decrypt the Company Authentication Code for the admin / assigned
// accountant. Authz is enforced by the get_company_auth_code RPC which
// checks is_admin() or caseRow.accountant_id = auth.uid(). We also
// enforce it here as a defense-in-depth read gate before even making
// the RPC call. Key lives in COMPANY_AUTH_CODE_KEY env; missing env is
// a fail-closed error with a clear server log line.
export async function revealCompanyAuthCodeAction(
  caseId: string,
): Promise<ActionResult<string | null>> {
  try {
    const supabase = await createClient();
    const admin = createAdminClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in.");

    const { data: caseRow } = await admin
      .from("cases")
      .select("accountant_id, company_auth_code_encrypted")
      .eq("id", caseId)
      .single();
    if (!caseRow) throw new Error("Case not found.");

    const { data: meRow } = await admin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();
    const isAdmin = meRow?.role === "admin";
    const isAssigned = caseRow.accountant_id === user.id;
    if (!isAdmin && !isAssigned) {
      // Deliberately distinct wording from the "not saved yet" state so
      // the UI shows the right thing. Not-saved is handled upstream by
      // the authCodeAvailable prop ("(not provided by client yet)");
      // this branch only fires for a user who isn't the assigned
      // accountant or an admin.
      throw new Error(
        "Only the assigned accountant or an admin can reveal this code.",
      );
    }

    // Short-circuit the ciphertext-null case with a distinct ok+null
    // result so the UI can show "(not provided by client yet)" rather
    // than silently falling back to the Reveal button again. In normal
    // flow this is unreachable because the parent panel passes
    // authCodeAvailable=false when the column is null and renders the
    // not-provided string instead of the Reveal button.
    if (caseRow.company_auth_code_encrypted == null) {
      return { ok: true, data: null };
    }

    const key = process.env.COMPANY_AUTH_CODE_KEY;
    if (!key) {
      console.error(
        `[onboarding] COMPANY_AUTH_CODE_KEY missing; refused to decrypt auth code case=${caseId}`,
      );
      throw new Error(
        "Server isn't configured to decrypt authentication codes. Contact support.",
      );
    }

    // Call via the user-session supabase client, not admin — the RPC's
    // authz uses auth.uid(), which is null for service-role sessions
    // (admin). This was the real cause of "Not allowed." firing for
    // the assigned accountant. See migration 0041.
    const { data, error } = await supabase.rpc("get_company_auth_code", {
      p_case_id: caseId,
      p_key: key,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: (data as string | null) ?? null };
  } catch (e) {
    return fail(e);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
