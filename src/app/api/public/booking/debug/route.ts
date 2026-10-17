import { NextResponse } from "next/server";

// Short-lived diagnostic. Reports on the shape and provenance of the
// Google service account env values as the function sees them at
// runtime, without leaking any secret material. Intended to be hit
// once to confirm the Vercel-stored values look right, then removed
// in a follow-up commit.
//
// Public, no auth. Returns:
//   - hasCalendarId         ...  is GOOGLE_CALENDAR_ID set
//   - hasEmail              ...  is GOOGLE_SERVICE_ACCOUNT_EMAIL set
//   - emailDomain           ...  the @domain part of the email (safe)
//   - hasKey                ...  is GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY set
//   - keyRawLen             ...  length of the stored string
//   - keyStartsWithBegin    ...  starts with "-----BEGIN PRIVATE KEY-----"
//   - keyEndsWithEnd        ...  ends with "-----END PRIVATE KEY-----" (trimmed)
//   - keyHasRealNewlines    ...  contains any real \n byte
//   - keyLiteralBackslashN  ...  contains the two-char sequence \n (backslash+n)
//   - keyAfterReplaceLen    ...  length after replacing literal \n with real \n
//   - keyAfterReplaceLines  ...  number of lines after the replace
//   - oauthClientSet        ...  is GOOGLE_OAUTH_CLIENT_ID set
//
// Nothing above reveals the private key material itself.

export const dynamic = "force-dynamic";

export function GET() {
  const id = process.env.GOOGLE_CALENDAR_ID ?? "";
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "";
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "";
  const keyAfter = key.replace(/\\n/g, "\n");
  const emailAtIdx = email.indexOf("@");
  return NextResponse.json(
    {
      hasCalendarId: id.length > 0,
      calendarIdDomain: id.includes("@") ? id.split("@")[1] : null,
      hasEmail: email.length > 0,
      emailDomain: emailAtIdx > 0 ? email.slice(emailAtIdx) : null,
      hasKey: key.length > 0,
      keyRawLen: key.length,
      keyStartsWithBegin: key.trimStart().startsWith("-----BEGIN PRIVATE KEY-----"),
      keyEndsWithEnd: key.trimEnd().endsWith("-----END PRIVATE KEY-----"),
      keyHasRealNewlines: /\n/.test(key),
      keyLiteralBackslashN: /\\n/.test(key),
      keyAfterReplaceLen: keyAfter.length,
      keyAfterReplaceLines: keyAfter.split("\n").length,
      oauthClientSet: !!process.env.GOOGLE_OAUTH_CLIENT_ID,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
