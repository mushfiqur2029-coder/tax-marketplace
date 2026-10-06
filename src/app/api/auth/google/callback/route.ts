import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import {
  isOAuthConfigured,
  newOAuthClient,
  writeRefreshToken,
} from "@/lib/calendar/oauth-token";

export const dynamic = "force-dynamic";

// Receives Google's response to the consent flow started at
// /api/auth/google/connect. Exchanges the auth code for a refresh
// token, persists it encrypted in public.google_oauth_token, then
// redirects the admin back to /admin with a short success note.

function errorRedirect(req: NextRequest, reason: string): NextResponse {
  const url = new URL("/admin", req.nextUrl.origin);
  url.searchParams.set("gcal_error", reason);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const me = await requireRole("admin");
  if (!isOAuthConfigured()) {
    return NextResponse.json(
      { error: "OAuth not configured on this environment." },
      { status: 503 },
    );
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const err = req.nextUrl.searchParams.get("error");
  const stateCookie = req.cookies.get("gcal_oauth_state")?.value;

  if (err) {
    // User clicked "Deny" on the consent screen, or Google refused.
    return errorRedirect(req, err);
  }
  if (!code) return errorRedirect(req, "missing_code");
  if (!state || !stateCookie || state !== stateCookie) {
    return errorRedirect(req, "state_mismatch");
  }
  // State is "<adminUserId>:<nonce>" — guard against someone finishing
  // consent in a different admin's browser.
  if (!state.startsWith(me.id + ":")) {
    return errorRedirect(req, "state_user_mismatch");
  }

  try {
    const client = newOAuthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      // Google only issues a refresh token on the FIRST consent, or when
      // prompt=consent is set and offline access is explicitly re-granted.
      // Our connect route sets both, so this usually means the user has
      // already approved the app previously and Google is returning only
      // an access token. Fix: revoke at myaccount.google.com/permissions,
      // then re-run connect.
      return errorRedirect(req, "no_refresh_token");
    }

    // Resolve which Google account was granted. tokeninfo is the
    // official way to check; we save it alongside the token so a
    // future deploy can detect "wait, the token is for the wrong
    // account" without a round-trip to Google on every call.
    client.setCredentials(tokens);
    let email = "unknown";
    try {
      if (tokens.access_token) {
        const info = await client.getTokenInfo(tokens.access_token);
        email = info.email ?? email;
      }
    } catch (e) {
      console.warn("[google oauth] tokeninfo lookup failed:", e);
    }

    await writeRefreshToken({
      email,
      refreshToken: tokens.refresh_token,
      scope: tokens.scope ?? "",
      adminId: me.id,
    });

    const res = NextResponse.redirect(
      new URL("/admin?gcal_connected=1", req.nextUrl.origin),
    );
    res.cookies.delete("gcal_oauth_state");
    return res;
  } catch (e) {
    console.error("[google oauth callback] exchange failed:", e);
    return errorRedirect(req, "exchange_failed");
  }
}
