import "server-only";

// Thin wrapper around the Google Apps Script Web App that sends email via
// GmailApp.sendEmail from info@sterlingledger.co.uk. The Script accepts a
// JSON body:
//   { to, subject, html, pdf_base64?, filename? }
// and authenticates on a shared secret in the X-Shared-Secret header.
//
// Fallback: when either env var is absent, we log a clear "[email]
// skipped" line and return a non-error "skipped" result. Callers do not
// need to care — their business action still succeeds. This means
// signing + payment work end-to-end on a dev box without the Script
// deployed yet; the user confirmed that once the Script URL and secret
// land in env, emails start flowing with no code change.

export type EmailResult =
  | { ok: true; skipped: false }
  | { ok: true; skipped: true }
  | { ok: false; skipped: false; error: string };

export type EmailParams = {
  to: string;
  subject: string;
  html: string;
  /** Optional PDF attachment, base64-encoded. */
  pdfBase64?: string;
  /** Required when pdfBase64 is set — the filename the recipient sees. */
  filename?: string;
  /** For log context only, so a skipped line is traceable to a case. */
  logCaseId?: string;
};

function clearlyUnset(v: string | undefined): boolean {
  return !v || v.trim() === "";
}

export async function sendEmailViaAppsScript(
  params: EmailParams,
): Promise<EmailResult> {
  const url = process.env.APPSSCRIPT_EMAIL_URL;
  const secret = process.env.APPSSCRIPT_EMAIL_SECRET;

  if (clearlyUnset(url) || clearlyUnset(secret)) {
    console.error(
      `[email] skipped (missing APPSSCRIPT_EMAIL_URL or APPSSCRIPT_EMAIL_SECRET) to=${params.to} subject=${JSON.stringify(
        params.subject,
      )}` + (params.logCaseId ? ` case=${params.logCaseId}` : ""),
    );
    return { ok: true, skipped: true };
  }

  try {
    const res = await fetch(url as string, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-shared-secret": secret as string,
      },
      body: JSON.stringify({
        to: params.to,
        subject: params.subject,
        html: params.html,
        pdf_base64: params.pdfBase64 ?? null,
        filename: params.filename ?? null,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        `[email] send failed status=${res.status} to=${params.to}` +
          (params.logCaseId ? ` case=${params.logCaseId}` : "") +
          ` body=${text.slice(0, 500)}`,
      );
      return {
        ok: false,
        skipped: false,
        error: `email provider returned ${res.status}`,
      };
    }
    return { ok: true, skipped: false };
  } catch (err) {
    console.error(
      `[email] send threw to=${params.to}` +
        (params.logCaseId ? ` case=${params.logCaseId}` : "") +
        ` err=${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      ok: false,
      skipped: false,
      error: err instanceof Error ? err.message : "email send failed",
    };
  }
}
