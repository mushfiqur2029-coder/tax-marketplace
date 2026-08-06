import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe, stripeWebhookSecret } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(
      rawBody,
      signature,
      stripeWebhookSecret(),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const admin = createAdminClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const caseId = session.metadata?.case_id;
      if (!caseId) break;

      // Only flip to paid+submitted on a fully-paid session.
      const paid = session.payment_status === "paid";

      const { error } = await admin
        .from("cases")
        .update({
          stripe_checkout_session_id: session.id,
          stripe_payment_id:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : (session.payment_intent?.id ?? null),
          stripe_payment_status: paid ? "succeeded" : "pending",
          status: paid ? "submitted" : "draft",
          submitted_at: paid ? new Date().toISOString() : null,
        })
        .eq("id", caseId);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      break;
    }
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      const caseId = session.metadata?.case_id;
      if (!caseId) break;
      await admin
        .from("cases")
        .update({ stripe_payment_status: "failed" })
        .eq("id", caseId);
      break;
    }
    default:
      // Ignore other events for now.
      break;
  }

  return NextResponse.json({ received: true });
}
