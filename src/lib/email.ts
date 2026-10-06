import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import {
  getOwnerOAuthClient,
  hasGmailSendScope,
  readRefreshToken,
} from "@/lib/calendar/oauth-token";

// Email delivery. Three send paths in priority order:
//
//   - sendEmailViaSmtp (primary): nodemailer over SMTP, authenticated
//     against the real Sterling Ledger mailbox. The From address is
//     the mailbox itself (info@sterlingledger.co.uk) with no relaying
//     or aliasing. Driven by SMTP_HOST / SMTP_PORT / SMTP_SECURE /
//     SMTP_USER / SMTP_PASSWORD env.
//
//   - sendEmailViaGmail (fallback): uses the OAuth2 refresh token
//     stored by /api/auth/google/connect to call Gmail's REST API as
//     the connected Gmail account (nextnoor04@gmail.com). Kept wired
//     so email keeps flowing if SMTP ever has an outage, at the cost
//     of a non-matching From address — the recipient's eye sees it as
//     nextnoor04@gmail.com, not info@sterlingledger.co.uk. Only use
//     this path deliberately or when SMTP is skipped.
//
//   - sendEmailViaAppsScript (legacy): posts to a Google Apps Script
//     Web App that calls GmailApp.sendEmail. Never actually deployed
//     in production — the APPSSCRIPT_* env vars have been unset the
//     whole time, so every call quietly logged "skipped" and returned
//     ok. Kept as a last-ditch fallback for anyone who prefers that
//     path.
//
// sendEmail() below is the entry point every caller should use. It
// tries SMTP first, falls back to Gmail, then Apps Script, and
// finally returns a clear "skipped" when none are configured.

export type EmailResult =
  | { ok: true; skipped: false; via: "smtp" | "gmail" | "appsscript" }
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
// SMTP path (primary)
// ------------------------------------------------------------------

// Lazy singleton — nodemailer connects on first use and keeps a
// pool of sockets open so repeated sends within a serverless
// invocation don't each incur a TLS handshake.
let smtpTransporter: Transporter | null = null;

function getSmtpTransporter(): Transporter | null {
  if (
    clearlyUnset(process.env.SMTP_HOST) ||
    clearlyUnset(process.env.SMTP_PORT) ||
    clearlyUnset(process.env.SMTP_USER) ||
    clearlyUnset(process.env.SMTP_PASSWORD)
  ) {
    return null;
  }
  if (smtpTransporter) return smtpTransporter;
  // SMTP_SECURE=true -> implicit TLS (port 465). Any other value falls
  // back to STARTTLS semantics (port 587). Nodemailer calls this flag
  // "secure".
  const secure =
    (process.env.SMTP_SECURE ?? "").toLowerCase() === "true" ||
    process.env.SMTP_SECURE === "1";
  const port = Number.parseInt(process.env.SMTP_PORT!, 10);
  smtpTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number.isFinite(port) ? port : secure ? 465 : 587,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    // Pool keeps the socket warm across sends in one invocation.
    pool: true,
    maxConnections: 2,
    maxMessages: 20,
  });
  return smtpTransporter;
}

export async function sendEmailViaSmtp(
  params: EmailParams,
): Promise<EmailResult> {
  const transporter = getSmtpTransporter();
  if (!transporter) {
    return {
      ok: true,
      skipped: true,
      reason: "SMTP env not configured (SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD)",
    };
  }
  const from = process.env.SMTP_USER!;
  // Same self-BCC / to-BCC dedup as the Gmail path so no recipient
  // appears twice in the delivery.
  const bcc = (params.bcc ?? []).filter((addr) => {
    const a = addr.trim().toLowerCase();
    return (
      a &&
      a !== from.trim().toLowerCase() &&
      a !== params.to.trim().toLowerCase()
    );
  });

  // Fold the legacy pdfBase64 + filename shape into the generic
  // attachments array before handing to nodemailer, matching the
  // Gmail helper's behaviour.
  const attachments = [
    ...(params.attachments ?? []).map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.base64, "base64"),
      contentType: a.mimeType ?? "application/octet-stream",
    })),
  ];
  if (params.pdfBase64 && params.filename) {
    attachments.push({
      filename: params.filename,
      content: Buffer.from(params.pdfBase64, "base64"),
      contentType: "application/pdf",
    });
  }

  try {
    const info = await transporter.sendMail({
      from,
      to: params.to,
      bcc: bcc.length > 0 ? bcc : undefined,
      subject: params.subject,
      html: params.html,
      attachments,
    });
    // Guard against the "accepted-but-no-recipients" oddity some
    // relays produce; if nodemailer thinks nothing was accepted,
    // surface that as a failure so sendEmail falls through to the
    // next path.
    if (
      Array.isArray(info.accepted) &&
      info.accepted.length === 0
    ) {
      console.error(
        `[email] smtp accepted no recipients to=${params.to}` +
          (params.logCaseId ? ` case=${params.logCaseId}` : "") +
          ` response=${info.response ?? "?"}`,
      );
      return {
        ok: false,
        skipped: false,
        error: "SMTP accepted no recipients",
      };
    }
    return { ok: true, skipped: false, via: "smtp" };
  } catch (err) {
    console.error(
      `[email] smtp send threw to=${params.to}` +
        (params.logCaseId ? ` case=${params.logCaseId}` : "") +
        ` err=${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      ok: false,
      skipped: false,
      error: err instanceof Error ? err.message : "smtp send failed",
    };
  }
}

// ------------------------------------------------------------------
// Gmail API path (fallback)
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

  // Resolve the From address. token.email is "unknown" when the
  // OAuth callback couldn't look it up (userinfo.email scope isn't
  // requested; tokeninfo often returns no email without it). Fall
  // back to GOOGLE_CALENDAR_ID — that env var already holds the
  // connected admin's Gmail address (used by the calendar booking
  // code for the same reason). Final fallback is "me", which Gmail
  // interprets as the authenticated sender.
  const fromAddress =
    token.email && token.email !== "unknown"
      ? token.email
      : process.env.GOOGLE_CALENDAR_ID ?? "me";

  // Drop any BCC entry that matches the From address (self-BCC noise)
  // or the To address (Gmail dedupes anyway, but keeping the header
  // clean saves the recipient confusion when they view headers).
  const bcc = (params.bcc ?? []).filter((addr) => {
    const a = addr.trim().toLowerCase();
    return (
      a &&
      a !== fromAddress.trim().toLowerCase() &&
      a !== params.to.trim().toLowerCase()
    );
  });

  const raw = buildRawMime({
    from: fromAddress,
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

// Entry point every caller should use. Tries SMTP first (so emails
// genuinely come from the Sterling Ledger mailbox), falls back to
// Gmail (nextnoor04@gmail.com) if SMTP is unconfigured or skipped,
// and finally Apps Script. The dispatcher means callers don't need
// to know which backend is live.
//
// Behaviour on a hard failure of the primary (ok=false): we do NOT
// retry on the next path. A real send error (bad credentials, bounce,
// SMTP relay rejected the message) is a signal to look at config,
// not to silently re-send through a different From address. Only a
// "skipped" result (not configured) falls through.
export async function sendEmail(params: EmailParams): Promise<EmailResult> {
  const smtp = await sendEmailViaSmtp(params);
  if (smtp.ok && !smtp.skipped) return smtp;
  if (!smtp.ok) return smtp;
  // SMTP was skipped (env not set). Try Gmail.
  const gmail = await sendEmailViaGmail(params);
  if (gmail.ok && !gmail.skipped) return gmail;
  if (!gmail.ok) return gmail;
  // Gmail skipped too. Last-ditch Apps Script.
  return sendEmailViaAppsScript(params);
}
