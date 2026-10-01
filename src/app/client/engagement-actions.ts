"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTier } from "@/lib/plans";
import { type ActionResult, fail } from "@/lib/action-result";
import { renderEngagementLetterHtml } from "@/lib/engagement/letter-template";
import { renderPdfFromHtml } from "@/lib/engagement/pdf";
import { sendEmailViaAppsScript } from "@/lib/email";

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
//   • segment = limited_company_vat (other segments don't use this flow)
//   • status = draft (post-payment sign is nonsensical)
//   • not already signed
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
        "id, client_id, segment, tier, status, engagement_signed_at",
      )
      .eq("id", caseId)
      .single();
    if (caseErr || !caseRow) throw new Error("Case not found.");
    if (caseRow.client_id !== me.id) throw new Error("Not your case.");
    if (caseRow.segment !== "limited_company_vat") {
      throw new Error("This case doesn't use an engagement letter.");
    }
    if (caseRow.status !== "draft") {
      throw new Error("This case is past the sign step.");
    }
    if (caseRow.engagement_signed_at) {
      throw new Error("You've already signed this engagement letter.");
    }

    const tier = getTier(caseRow.tier);
    if (!tier || tier.group !== "company") {
      throw new Error("Case has no company service selected.");
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
    const letterHtml = renderEngagementLetterHtml({
      effectiveDate: signDate,
      clientName,
      clientEmail: me.email,
      clientPhone: clientPhone || "—",
      serviceName: tier.title,
      totalFee: `£${tier.priceGbp}`,
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
      throw new Error(
        "We couldn't generate your engagement PDF. Please contact support — we haven't recorded this as signed.",
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
      <p>Next step: payment of <strong>£${tier.priceGbp}</strong>. You can complete this now from your case page.</p>
      <p>— Sterling Ledger</p>
    `;
    const internalHtml = `
      <p>New signed engagement letter.</p>
      <ul>
        <li>Client: ${escapeHtml(clientName)} (${escapeHtml(me.email)})</li>
        <li>Service: ${escapeHtml(tier.title)}</li>
        <li>Fee: £${tier.priceGbp}</li>
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
      subject: `New signed engagement — ${me.email} — ${tier.title}`,
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
