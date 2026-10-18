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

// Public entry points. Each one is wrapped so a thrown error is caught
// and logged but never bubbles into the triggering transaction.
async function safeSend(label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (e) {
    // eslint-disable-next-line no-console -- intentional: log and swallow
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
        "<p>Your accountant will prepare your figures, run the 33-point review and let you know when they're ready for your approval. You don't need to do anything right now, we'll email you again when it's time to sign off.</p>",
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
