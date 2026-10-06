import "server-only";
import Stripe from "stripe";

let cached: Stripe | null = null;

export function stripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Add it to .env.local (test-mode key: sk_test_...).",
    );
  }
  cached = new Stripe(key);
  return cached;
}

export function stripeWebhookSecret(): string {
  const s = process.env.STRIPE_WEBHOOK_SECRET;
  if (!s) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is not set. Get one from `stripe listen` and add to .env.local.",
    );
  }
  return s;
}

// Base URL used in every outbound email + any Stripe redirect that
// needs an absolute host. Resolution order:
//
//   1. NEXT_PUBLIC_SITE_URL — the explicit production/preview value
//      an operator set on Vercel. Preferred when non-empty.
//   2. VERCEL_URL — Vercel-auto-injected per deployment. Doesn't
//      include a protocol; prefix https. Deployment-specific (not
//      a stable alias), so links in long-lived emails could end up
//      pointing at an old deployment URL — but still better than
//      "localhost" or a hostless path when (1) was misconfigured.
//   3. http://localhost:3000 — local dev fallback. Loudly logged
//      when we fall here while running on Vercel so the misconfig
//      shows up in logs instead of silently emailing broken links.
//
// Using || instead of ?? so an empty string (as currently stored
// on Vercel prod for NEXT_PUBLIC_SITE_URL) is treated the same as
// unset. Trailing slash stripped so callers can safely append
// paths with their own leading slash.
export function siteUrl(): string {
  const explicit = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercelHost = (process.env.VERCEL_URL ?? "").trim();
  if (vercelHost) {
    const url = vercelHost.startsWith("http")
      ? vercelHost
      : `https://${vercelHost}`;
    return url.replace(/\/+$/, "");
  }

  // Falling here on Vercel means someone deployed without setting
  // NEXT_PUBLIC_SITE_URL. Log loudly rather than silently shipping
  // localhost links to real inboxes.
  if (process.env.VERCEL === "1" || process.env.VERCEL === "true") {
    console.error(
      "[siteUrl] NEXT_PUBLIC_SITE_URL unset in a Vercel deployment and VERCEL_URL also missing — falling back to localhost. Fix the env var before more emails go out.",
    );
  }
  return "http://localhost:3000";
}
