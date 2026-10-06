import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { requireRole } from "@/lib/auth";
import {
  isOAuthConfigured,
  newOAuthClient,
  OAUTH_SCOPES,
} from "@/lib/calendar/oauth-token";

export const dynamic = "force-dynamic";

// Admin-only entry point for the one-time Google OAuth2 consent flow.
// Visiting this URL (signed in as admin) builds the Google consent URL
// and redirects. After consent, Google calls back to
// /api/auth/google/callback which persists the resulting refresh token.
//
// Setup prereqs — must happen before this URL will work:
//   1. GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET set from a
//      Google Cloud OAuth 2.0 Client ID (Web application type).
//   2. Authorized redirect URIs in the Google Cloud console must
//      include {NEXT_PUBLIC_SITE_URL}/api/auth/google/callback for
//      every environment (local, preview, prod).
//   3. The OAuth consent screen must list the calendar owner's email
//      as a test user (unless the app is Published).

export async function GET() {
  const me = await requireRole("admin");
  if (!isOAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          "Google OAuth isn't configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first.",
      },
      { status: 503 },
    );
  }

  const client = newOAuthClient();
  // CSRF protection: random nonce bound to the admin's user id. Checked
  // against the state echoed back by Google in the callback.
  const nonce = crypto.randomBytes(16).toString("hex");
  const state = `${me.id}:${nonce}`;

  const consentUrl = client.generateAuthUrl({
    // offline + prompt=consent is what forces Google to issue a
    // refresh_token. Without this, a repeat consent returns only an
    // access_token and we end up unable to refresh when it expires.
    access_type: "offline",
    prompt: "consent",
    scope: [...OAUTH_SCOPES],
    state,
    // include_granted_scopes keeps any previously-granted scopes if
    // the owner has consented to other apps on this account.
    include_granted_scopes: true,
  });

  const res = NextResponse.redirect(consentUrl);
  res.cookies.set("gcal_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
