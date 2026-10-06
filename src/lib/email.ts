import "server-only";
import {
  getOwnerOAuthClient,
  hasGmailSendScope,
  readRefreshToken,
} from "@/lib/calendar/oauth-token";

// Email delivery. Two paths exist for historical reasons:
//
//   - sendEmailViaGmail (preferred): uses the OAuth2 refresh token
//     stored by /api/auth/google/connect to call Gmail's REST API as
//     the connected admin. No external service, no shared secret —
//     only Google credentials we already have. Requires the stored
//     token to carry the gmail.send scope.
//
//   - sendEmailViaAppsScript (legacy): posts to a Google Apps Script
//     Web App that calls GmailApp.sendEmail. Never actually deployed
//     in production — the APPSSCRIPT_* env vars have been unset the
//     whole time, so every call quietly logged "skipped" and returned
//     ok. Kept as a fallback for anyone who prefers that path.
//
// sendEmail() below is the entry point every caller should use. It
// prefers the Gmail API when configured, falls back to Apps Script,
// and finally returns a clear "skipped" when neither is available.

export type EmailResult =
  | { ok: true; skipped: false; via: "gmail" | "appsscript" }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; skipped: false; error: string };

export type EmailAttachment = {
  /** Base64-encoded bytes. */
  base64: string;
  /** Filename the recipient sees. */
  filename: string;
  /** MIME type. Defaults to application/octet-stream on the Apps Script side. */
  mimeType?: string;
};

export type EmailParams = {
  to: string;
  subject: string;
  html: string;
  /** Optional CC list. Used by booking confirmations to also notify the
   * Sterling Ledger inbox without the client seeing the extra copy. */
  bcc?: string[];
  /** Optional PDF attachment, base64-encoded. Legacy single-attachment path. */
  pdfBase64?: string;
  /** Required when pdfBase64 is set — the filename the recipient sees. */
  filename?: string;
  /** Generic attachments array. Preferred over pdfBase64 for anything non-PDF. */
  attachments?: EmailAttachment[];
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
    return {
      ok: true,
      skipped: true,
      reason: "missing APPSSCRIPT_EMAIL_URL or APPSSCRIPT_EMAIL_SECRET",
    };
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
        attachments: params.attachments
          ? params.attachments.map((a) => ({
              base64: a.base64,
              filename: a.filename,
              mime_type: a.mimeType ?? "application/octet-stream",
            }))
          : null,
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
    return { ok: true, skipped: false, via: "appsscript" };
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

// ------------------------------------------------------------------
// Gmail API path
// ------------------------------------------------------------------

// Build an RFC 5322 MIME message, then base64url-encode it for the
// Gmail REST API's `raw` field. Multipart/mixed when attachments are
// present; HTML-only otherwise. We don't do multipart/alternative
// (plain-text alongside HTML) — Gmail renders the HTML fine on its
// own and the extra body only exists for cases where it would,
// which is rare for the booking confirmation surface.
function buildRawMime(params: {
  from: string;
  to: string;
  bcc?: string[];
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}): string {
  const boundary = "sl_boundary_" + Math.random().toString(36).slice(2);
  const headers: string[] = [
    `From: ${params.from}`,
    `To: ${params.to}`,
  ];
  if (params.bcc?.length) {
    headers.push(`Bcc: ${params.bcc.join(", ")}`);
  }
  // Gmail requires MIME-Version. Subject is RFC 2047-encoded so any
  // non-ASCII (e.g. £) survives transport.
  headers.push("MIME-Version: 1.0");
  headers.push(`Subject: ${encodeHeader(params.subject)}`);

  const atts = params.attachments ?? [];
  if (atts.length === 0) {
    headers.push(`Content-Type: text/html; charset="UTF-8"`);
    headers.push("Content-Transfer-Encoding: base64");
    const bodyB64 = Buffer.from(params.html, "utf-8").toString("base64");
    const message = headers.join("\r\n") + "\r\n\r\n" + wrap76(bodyB64);
    return toBase64Url(Buffer.from(message, "utf-8"));
  }

  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts: string[] = [headers.join("\r\n"), ""];
  // HTML part
  parts.push(`--${boundary}`);
  parts.push(`Content-Type: text/html; charset="UTF-8"`);
  parts.push("Content-Transfer-Encoding: base64");
  parts.push("");
  parts.push(wrap76(Buffer.from(params.html, "utf-8").toString("base64")));
  // Attachment parts
  for (const a of atts) {
    parts.push(`--${boundary}`);
    const mime = a.mimeType ?? "application/octet-stream";
    parts.push(`Content-Type: ${mime}; name="${a.filename}"`);
    parts.push(`Content-Disposition: attachment; filename="${a.filename}"`);
    parts.push("Content-Transfer-Encoding: base64");
    parts.push("");
    parts.push(wrap76(a.base64));
  }
  parts.push(`--${boundary}--`);
  const message = parts.join("\r\n");
  return toBase64Url(Buffer.from(message, "utf-8"));
}

function toBase64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// RFC 2045 §6.8: base64-encoded body lines SHOULD be <= 76 chars.
function wrap76(s: string): string {
  return s.replace(/(.{76})/g, "$1\r\n");
}

// RFC 2047 "encoded-word" for the Subject header so non-ASCII (£, —)
// survives. UTF-8 base64 form keeps the implementation tiny.
function encodeHeader(s: string): string {
  // ASCII fast path.
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  const encoded = Buffer.from(s, "utf-8").toString("base64");
  return `=?UTF-8?B?${encoded}?=`;
}

export async function sendEmailViaGmail(
  params: EmailParams,
): Promise<EmailResult> {
  const client = await getOwnerOAuthClient();
  if (!client) {
    return {
      ok: true,
      skipped: true,
      reason:
        "no Google OAuth token stored (go through /api/auth/google/connect)",
    };
  }
  const hasScope = await hasGmailSendScope();
  if (!hasScope) {
    console.error(
      `[email] gmail skipped (stored token has no gmail.send scope — reconsent required) to=${params.to}` +
        (params.logCaseId ? ` case=${params.logCaseId}` : ""),
    );
    return {
      ok: true,
      skipped: true,
      reason:
        "stored OAuth token has no gmail.send scope — reconsent via /api/auth/google/connect",
    };
  }
  const token = await readRefreshToken();
  if (!token) {
    return {
      ok: true,
      skipped: true,
      reason: "no Google OAuth token row",
    };
  }

  // Mint an access token. OAuth2Client caches internally so repeated
  // sends within one invocation don't each round-trip to Google.
  let accessToken: string | null | undefined;
  try {
    const t = await client.getAccessToken();
    accessToken = typeof t === "string" ? t : t?.token;
  } catch (err) {
    console.error(
      `[email] gmail access-token refresh failed to=${params.to} err=${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return {
      ok: false,
      skipped: false,
      error:
        err instanceof Error
          ? err.message
          : "could not refresh Google access token",
    };
  }
  if (!accessToken) {
    return {
      ok: false,
      skipped: false,
      error: "Google returned no access token",
    };
  }

  // Reuse the legacy `pdfBase64 + filename` shape by promoting it into
  // the attachments array before building MIME, so both callers work.
  const attachments: EmailAttachment[] = [];
  if (params.attachments?.length) attachments.push(...params.attachments);
  if (params.pdfBase64 && params.filename) {
    attachments.push({
      base64: params.pdfBase64,
      filename: params.filename,
      mimeType: "application/pdf",
    });
  }

  // Drop any BCC entry that matches the From address (self-BCC noise)
  // or the To address (Gmail dedupes anyway, but keeping the header
  // clean saves the recipient confusion when they view headers).
  const bcc = (params.bcc ?? []).filter((addr) => {
    const a = addr.trim().toLowerCase();
    return (
      a &&
      a !== token.email.trim().toLowerCase() &&
      a !== params.to.trim().toLowerCase()
    );
  });

  const raw = buildRawMime({
    from: token.email,
    to: params.to,
    bcc: bcc.length > 0 ? bcc : undefined,
    subject: params.subject,
    html: params.html,
    attachments,
  });

  try {
    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        `[email] gmail send failed status=${res.status} to=${params.to}` +
          (params.logCaseId ? ` case=${params.logCaseId}` : "") +
          ` body=${text.slice(0, 500)}`,
      );
      return {
        ok: false,
        skipped: false,
        error: `gmail API returned ${res.status}`,
      };
    }
    return { ok: true, skipped: false, via: "gmail" };
  } catch (err) {
    console.error(
      `[email] gmail send threw to=${params.to}` +
        (params.logCaseId ? ` case=${params.logCaseId}` : "") +
        ` err=${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      ok: false,
      skipped: false,
      error: err instanceof Error ? err.message : "gmail send failed",
    };
  }
}

// Entry point every caller should use. Prefers Gmail when configured
// AND the token has gmail.send; otherwise falls back to Apps Script
// (which, in current deployments, logs skipped). The dispatcher means
// callers don't need to know which backend is live.
export async function sendEmail(params: EmailParams): Promise<EmailResult> {
  const gmail = await sendEmailViaGmail(params);
  if (gmail.ok && !gmail.skipped) return gmail;
  if (!gmail.ok) return gmail;
  // Gmail was skipped (no token / no scope). Try Apps Script fallback.
  return sendEmailViaAppsScript(params);
}
