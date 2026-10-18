import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { siteUrl } from "@/lib/stripe";

// Nudge the OTHER party on a case when a new in-platform message
// arrives, so conversations keep moving even when nobody's actively
// signed in. Author role decides who gets the ping: a client message
// nudges the accountant, an accountant message nudges the client.
// Admin messages don't trigger emails (admin steps in rarely enough
// that a quiet audit entry is fine).

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendCaseMessageNotification(opts: {
  caseId: string;
  authorRole: "client" | "accountant" | "admin";
  body: string;
}): Promise<void> {
  if (opts.authorRole === "admin") return;
  try {
    const admin = createAdminClient();
    const { data: caseRow } = await admin
      .from("cases")
      .select("client_id, accountant_id, tier")
      .eq("id", opts.caseId)
      .single();
    if (!caseRow) return;
    const recipientId = opts.authorRole === "client"
      ? caseRow.accountant_id
      : caseRow.client_id;
    if (!recipientId) return;
    const { data: user } = await admin
      .from("users")
      .select("email")
      .eq("id", recipientId)
      .maybeSingle();
    if (!user?.email) return;

    const base = siteUrl().replace(/\/$/, "");
    const workspacePath = caseRow.tier === "uber_phv_automated"
      ? (opts.authorRole === "client"
          ? `/accountant/cases/${opts.caseId}/pch`
          : `/client/cases/${opts.caseId}/pch`)
      : (opts.authorRole === "client"
          ? `/accountant/cases/${opts.caseId}`
          : `/client/cases/${opts.caseId}`);
    const caseLink = base + workspacePath;

    const senderLabel = opts.authorRole === "client" ? "your client" : "your accountant";
    const preview = opts.body.length > 240 ? opts.body.slice(0, 240) + "..." : opts.body;

    const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;">
    <h1 style="margin:0 0 8px;font-size:18px;font-weight:700;">New message from ${esc(senderLabel)}</h1>
    <p style="margin:0 0 16px;color:#475569;font-size:13px;">Case ${esc(opts.caseId.slice(0, 8))}.</p>
    <blockquote style="margin:0 0 20px;padding:12px 14px;background:#f8fafc;border-left:3px solid #0f172a;color:#1e293b;font-size:14px;line-height:1.5;">
      ${esc(preview).replace(/\n/g, "<br>")}
    </blockquote>
    <p style="margin:0 0 32px;">
      <a href="${esc(caseLink)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px;">
        Reply in the case
      </a>
    </p>
    <p style="margin:0;color:#94a3b8;font-size:11px;">
      Replies to this email aren't monitored. Please reply inside the case so the thread stays on file.
    </p>
  </div>
</body>
</html>`;

    await sendEmail({
      to: user.email,
      subject: "New message on your case " + opts.caseId.slice(0, 8),
      html,
    });
  } catch {
    // Notifications must never block the message write. Swallow + move on.
  }
}
