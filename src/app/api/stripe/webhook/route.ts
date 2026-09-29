import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe, stripeWebhookSecret } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { insertAddonPaidNotification } from "@/lib/notifications";

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
      const addonId = session.metadata?.addon_id;
      const caseId = session.metadata?.case_id;

      // Add-on payments carry addon_id in metadata. A session that has
      // addon_id is *only* an add-on payment, so we branch here to keep the
      // case path untouched — never flip case.stripe_payment_status on an
      // add-on session even though case_id is also stamped for cross-ref.
      if (addonId) {
        const paid = session.payment_status === "paid";
        if (!paid) break;

        const paymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent?.id ?? null);

        // Load the row so we know who to notify. Guarded by status so the
        // reconcile path can't double-notify.
        const { data: addon } = await admin
          .from("case_addons")
          .select(
            "id, case_id, accountant_id, amount_pence, description, status",
          )
          .eq("id", addonId)
          .single();
        if (!addon || addon.status === "paid") break;

        const { error: updErr } = await admin
          .from("case_addons")
          .update({
            status: "paid",
            stripe_payment_id: paymentIntentId,
            paid_at: new Date().toISOString(),
          })
          .eq("id", addonId)
          .eq("status", "pending_payment");
        if (updErr) {
          return NextResponse.json({ error: updErr.message }, { status: 500 });
        }

        await insertAddonPaidNotification({
          caseId: addon.case_id,
          accountantId: addon.accountant_id,
          amountPence: addon.amount_pence,
          description: addon.description,
        });
        break;
      }

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
      const addonId = session.metadata?.addon_id;
      const caseId = session.metadata?.case_id;

      // Add-on session failures: leave the row at pending_payment so the
      // client can retry. Nothing to write.
      if (addonId) break;

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
