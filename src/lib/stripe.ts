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

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}
