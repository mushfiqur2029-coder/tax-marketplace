import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { siteUrl } from "@/lib/stripe";

// Status-change emails for PCH automated cases. Three triggers:
//   - in_review:        "your return is now with your accountant"
//   - client_approval:  "your figures are ready to approve"
//   - filed:            "your return has been filed"
//
// Always fire-and-forget. Emails must never break the status transition
// that spawned them; if SMTP is down the user still sees the UI update
// and the accountant/admin can resend from the dashboard later.

type Recipient = {
  email: string;
  name: string;
};

type FirmBlock = {
  firmName: string;
  address: string | null;
};

async function loadRecipientsAndFirm(caseId: string): Promise<{
  client: Recipient | null;
  firm: FirmBlock;
  caseLink: string;
} | null> {
  const admin = createAdminClient();
  const { data: c } = await admin
    .from("cases")
    .select("id, client_id, accountant_id")
    .eq("id", caseId)
    .single();
  if (!c) return null;

  const [{ data: client }, { data: headRow }, { data: profile }] = await Promise.all([
    admin.from("users").select("email").eq("id", c.client_id).maybeSingle(),
    admin.from("pch_cases").select("cl_name, cl_email").eq("case_id", caseId).maybeSingle(),
    c.accountant_id
      ? admin
          .from("accountant_profiles")
          .select("trading_name, company_name, legal_name, name, address")
          .eq("user_id", c.accountant_id)
          .maybeSingle()
      : Promise.resolve({ data: null } as { data: null }),
  ]);

  const clientEmail = headRow?.cl_email ?? client?.email ?? null;
  const clientName = headRow?.cl_name ?? client?.email?.split("@")[0] ?? "there";
  const firmName =
    profile?.trading_name ?? profile?.company_name ?? profile?.legal_name ?? profile?.name ?? "Sterling Ledger";
  const firmAddress = profile?.address ?? null;
  const base = siteUrl().replace(/\/$/, "");

  return {
    client: clientEmail ? { email: clientEmail, name: clientName } : null,
    firm: { firmName, address: firmAddress },
    caseLink: `${base}/client/cases/${caseId}/pch`,
  };
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapHtml(opts: {
  heading: string;
  intro: string;
  body: string;
  cta: { label: string; href: string };
  firmName: string;
  firmAddress: string | null;
}): string {
  const firmAddressHtml = opts.firmAddress
    ? opts.firmAddress
        .split(/\r?\n/)
        .map((line) => `<div>${esc(line)}</div>`)
        .join("")
    : "";
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;">
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">${esc(opts.heading)}</h1>
    <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.5;">${esc(opts.intro)}</p>
    <div style="margin:0 0 24px;color:#334155;font-size:14px;line-height:1.6;">${opts.body}</div>
    <p style="margin:0 0 32px;">
      <a href="${esc(opts.cta.href)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px;">
        ${esc(opts.cta.label)}
      </a>
    </p>
    <div style="border-top:1px solid #e2e8f0;padding-top:16px;color:#64748b;font-size:12px;">
      <div><strong style="color:#334155;">${esc(opts.firmName)}</strong></div>
      ${firmAddressHtml}
    </div>
  </div>
</body>
</html>`;
}

const DOCS_BUCKET = "case-documents";

type FinalDoc = { title: string; path: string | null };

function guessMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "application/octet-stream";
}

// Downloads one final-doc slot's bytes from storage and shapes it into
// an EmailAttachment. Returns null (rather than throwing) for a slot
// that's unset or fails to download, so one missing/broken doc never
// blocks the other four from going out.
async function downloadFinalDocAttachment(
  admin: ReturnType<typeof createAdminClient>,
  doc: FinalDoc,
): Promise<{ base64: string; filename: string; mimeType: string } | null> {
  if (!doc.path) return null;
  const { data, error } = await admin.storage.from(DOCS_BUCKET).download(doc.path);
  if (error || !data) {
    console.warn(
      `[pch-status-email] could not download "${doc.title}" at ${doc.path}: ${error?.message ?? "no data"}`,
    );
    return null;
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  const ext = doc.path.split(".").pop()?.toLowerCase() || "pdf";
  return {
    base64: Buffer.from(bytes).toString("base64"),
    filename: `${doc.title}.${ext}`,
    mimeType: guessMimeType(doc.path),
  };
}

// Same staff-inbox convention used by the Stripe webhook and booking
// routes (SL_BOOKING_NOTIFY_EMAILS, comma-separated) so one env toggle
// controls where Sterling Ledger sees a copy of every outbound email
// that matters, this one included.
function internalBackupBcc(): string[] {
  const raw =
    process.env.SL_BOOKING_NOTIFY_EMAILS ??
    "info@sterlingledger.co.uk,nextnoor04@gmail.com";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Public entry points. Each one is wrapped so a thrown error is caught
// and logged but never bubbles into the triggering transaction.
async function safeSend(label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (e) {
    // Intentional: log and swallow so a failing email never bubbles
    // into the triggering transaction.
    console.warn("[pch-status-email] " + label + " failed:", e instanceof Error ? e.message : e);
  }
}

export async function sendPchInReviewEmail(caseId: string): Promise<void> {
  await safeSend("in_review", async () => {
    const ctx = await loadRecipientsAndFirm(caseId);
    if (!ctx?.client) return;
    const html = wrapHtml({
      heading: "Your return is with your accountant",
      intro: `Hi ${ctx.client.name}, we've received everything we need and your return is now in review.`,
      body:
        "<p>Your accountant will prepare your figures and let you know when they're ready for your approval. You don't need to do anything right now, we'll email you again when it's time to sign off.</p>",
      cta: { label: "View your case", href: ctx.caseLink },
      firmName: ctx.firm.firmName,
      firmAddress: ctx.firm.address,
    });
    await sendEmail({
      to: ctx.client.email,
      subject: "We've received your return, we'll take it from here",
      html,
    });
  });
}

export async function sendPchReadyToApproveEmail(caseId: string): Promise<void> {
  await safeSend("client_approval", async () => {
    const ctx = await loadRecipientsAndFirm(caseId);
    if (!ctx?.client) return;
    const html = wrapHtml({
      heading: "Your figures are ready to approve",
      intro: `Hi ${ctx.client.name}, your accountant has prepared your Self Assessment figures. One click to review and file.`,
      body:
        "<p>Open your case to see the full Profit &amp; Loss and the tax owed. If anything looks off, message your accountant before approving. Once you approve, we'll file your return with HMRC.</p>",
      cta: { label: "Review and approve", href: ctx.caseLink },
      firmName: ctx.firm.firmName,
      firmAddress: ctx.firm.address,
    });
    await sendEmail({
      to: ctx.client.email,
      subject: "Your Self Assessment is ready to approve",
      html,
    });
  });
}

export async function sendPchFiledEmail(caseId: string): Promise<void> {
  await safeSend("filed", async () => {
    const ctx = await loadRecipientsAndFirm(caseId);
    if (!ctx?.client) return;
    const html = wrapHtml({
      heading: "Your return has been filed",
      intro: `Hi ${ctx.client.name}, your Self Assessment has been submitted to HMRC.`,
      body:
        "<p>You'll find your approved Profit &amp; Loss, your tax summary and payment reference on your case page. Keep the attached figures with your records; your accountant will keep a copy on file too.</p>",
      cta: { label: "View filed return", href: ctx.caseLink },
      firmName: ctx.firm.firmName,
      firmAddress: ctx.firm.address,
    });
    await sendEmail({
      to: ctx.client.email,
      subject: "Filed, your Self Assessment is in with HMRC",
      html,
    });
  });
}

// Fired once the accountant marks a PCH case "complete" (filed ->
// complete, gated on proof_of_submission_path already being set, see
// updateCaseStatusAction). Attaches all five final documents - the SA
// forwarding letter, PCH Accounts, SA302, SA100 and the proof of
// submission the accountant just uploaded - to one email sent to the
// client, bcc'd to the Sterling Ledger staff inboxes as a backup copy.
// A doc slot that fails to download is skipped rather than blocking
// the whole send; whatever did come through still reaches the client.
export async function sendPchCompleteDocsEmail(caseId: string): Promise<void> {
  await safeSend("complete-docs", async () => {
    const ctx = await loadRecipientsAndFirm(caseId);
    if (!ctx?.client) return;

    const admin = createAdminClient();
    const { data: head } = await admin
      .from("pch_cases")
      .select(
        "sa_forwarding_pdf_path, pch_accounts_pdf_path, sa302_upload_path, sa100_upload_path, proof_of_submission_path",
      )
      .eq("case_id", caseId)
      .maybeSingle();
    if (!head) return;

    const docs: FinalDoc[] = [
      { title: "SA Tax Return forwarding letter", path: head.sa_forwarding_pdf_path },
      { title: "PCH Accounts", path: head.pch_accounts_pdf_path },
      { title: "SA302", path: head.sa302_upload_path },
      { title: "SA100", path: head.sa100_upload_path },
      { title: "Proof of submission", path: head.proof_of_submission_path },
    ];
    const attachments = (
      await Promise.all(docs.map((d) => downloadFinalDocAttachment(admin, d)))
    ).filter((a): a is NonNullable<typeof a> => a !== null);

    const html = wrapHtml({
      heading: "Your return is complete",
      intro: `Hi ${ctx.client.name}, your Self Assessment has been filed and your case is now marked complete.`,
      body:
        "<p>All of your final documents, including proof of submission to HMRC, are attached to this email for your records. You can also view and download them any time from your case page.</p>",
      cta: { label: "View your documents", href: ctx.caseLink },
      firmName: ctx.firm.firmName,
      firmAddress: ctx.firm.address,
    });

    await sendEmail({
      to: ctx.client.email,
      bcc: internalBackupBcc(),
      subject: "Your Self Assessment is complete, documents attached",
      html,
      attachments,
      logCaseId: caseId,
    });
  });
}
