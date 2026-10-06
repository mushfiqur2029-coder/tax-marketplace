import "server-only";
import { OAuth2Client } from "google-auth-library";
import { createAdminClient } from "@/lib/supabase/admin";

// Google OAuth2 user-impersonation setup. One admin goes through the
// consent flow at /api/auth/google/connect, Google returns a refresh
// token, we encrypt + persist it in public.google_oauth_token via the
// set_google_refresh_token RPC. Subsequent calendar calls read the
// token here, hand it to an OAuth2Client, and act AS the calendar
// owner — which is the whole point: lets us invite real attendees and
// attach a Meet link, both of which the service-account path can't
// do on a personal Gmail calendar.

export const OAUTH_SCOPES = [
  // calendar is a superset; .events alone would also work but adding
  // calendar makes the FreeBusy query path simpler and keeps consent
  // readable ("See and edit all your calendars").
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  // Send-only Gmail scope. Powers the booking confirmation + inbox-
  // notification emails via src/lib/email.ts → sendEmailViaGmail.
  // Note: Google scopes are additive only through a fresh consent —
  // if the stored refresh token predates this line, the connected
  // admin must go back through /api/auth/google/connect once to
  // grant the new scope. Existing calendar calls keep working with
  // the old token until that happens.
  "https://www.googleapis.com/auth/gmail.send",
] as const;

// String the stored row's granted_scope should contain for Gmail send
// to work. Exported so callers can gate / warn.
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export function isOAuthConfigured(): boolean {
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
}

export function getRedirectUri(): string {
  const explicit = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (explicit) return explicit;
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  if (!base) {
    throw new Error(
      "NEXT_PUBLIC_SITE_URL (or GOOGLE_OAUTH_REDIRECT_URI) must be set so Google knows where to send the consent response.",
    );
  }
  return `${base.replace(/\/$/, "")}/api/auth/google/callback`;
}

// Factory — a fresh OAuth2Client each call. OAuth2Client caches its
// current access token on the instance, so for repeated use within one
// serverless invocation prefer getOwnerOAuthClient() below which
// stashes the instance.
export function newOAuthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not set.");
  }
  return new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri: getRedirectUri(),
  });
}

type StoredToken = { email: string; refreshToken: string; scope: string | null };

export async function readRefreshToken(): Promise<StoredToken | null> {
  const key = process.env.COMPANY_AUTH_CODE_KEY;
  if (!key) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_google_refresh_token", {
    p_key: key,
  });
  if (error) {
    console.error("[google oauth] read failed:", error.message);
    return null;
  }
  const row = (data as Array<{ email: string; refresh_token: string; scope: string | null }> | null)?.[0];
  if (!row?.refresh_token) return null;
  return {
    email: row.email,
    refreshToken: row.refresh_token,
    scope: row.scope,
  };
}

export async function writeRefreshToken(input: {
  email: string;
  refreshToken: string;
  scope: string;
  adminId: string;
}): Promise<void> {
  const key = process.env.COMPANY_AUTH_CODE_KEY;
  if (!key) {
    throw new Error(
      "COMPANY_AUTH_CODE_KEY must be set to encrypt the refresh token.",
    );
  }
  const admin = createAdminClient();
  const { error } = await admin.rpc("set_google_refresh_token", {
    p_email: input.email,
    p_refresh_token: input.refreshToken,
    p_scope: input.scope,
    p_key: key,
    p_admin_id: input.adminId,
  });
  if (error) throw new Error(error.message);
}

// Returns an OAuth2Client pre-loaded with the stored refresh token,
// ready to call .getAccessToken() against. Null when either the
// OAuth app isn't configured OR no admin has gone through consent yet.
// Callers (createBooking, FreeBusy) fall back to the service-account
// JWT when this is null, matching the Option A behaviour.
let ownerClientSingleton: OAuth2Client | null = null;

export async function getOwnerOAuthClient(): Promise<OAuth2Client | null> {
  if (!isOAuthConfigured()) return null;
  const token = await readRefreshToken();
  if (!token) return null;
  if (!ownerClientSingleton) {
    ownerClientSingleton = newOAuthClient();
  }
  // setCredentials is idempotent — overwriting on every call keeps the
  // in-memory state in sync if an admin re-consents and the token
  // rotates.
  ownerClientSingleton.setCredentials({ refresh_token: token.refreshToken });
  return ownerClientSingleton;
}

export async function hasOwnerOAuth(): Promise<boolean> {
  return (await getOwnerOAuthClient()) !== null;
}

// True when the connected admin has granted gmail.send alongside the
// calendar scopes. Caller-facing (email helper) uses this to short-
// circuit with a clear "needs reconsent" result rather than letting
// Google return a 403 at send time.
export async function hasGmailSendScope(): Promise<boolean> {
  const token = await readRefreshToken();
  if (!token || !token.scope) return false;
  return token.scope.split(/\s+/).includes(GMAIL_SEND_SCOPE);
}
