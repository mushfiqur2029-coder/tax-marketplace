import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe, stripeWebhookSecret, siteUrl } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { insertAddonPaidNotification } from "@/lib/notifications";
import { sendEmail } from "@/lib/email";
import { getTier } from "@/lib/service-catalog";
import { effectiveFeePence, formatFeeGbp } from "@/lib/case/pricing";

// Tiny HTML escaper for values embedded in email bodies. Same shape
// as the booking route's — inputs here are already-validated DB
// values but defence-in-depth is cheap.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Comma-separated staff inbox list, same env + default as the booking
// route so one toggle controls where SL staff see payment + booking
// receipts.
function slNotifyBcc(): string[] {
  const raw =
    process.env.SL_BOOKING_NOTIFY_EMAILS ??
    "info@sterlingledger.co.uk,nextnoor04@gmail.com";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

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

        const { data: flippedAddon, error: updErr } = await admin
          .from("case_addons")
          .update({
            status: "paid",
            stripe_payment_id: paymentIntentId,
            paid_at: new Date().toISOString(),
          })
          .eq("id", addonId)
          .eq("status", "pending_payment")
          .select("id");
        if (updErr) {
          return NextResponse.json({ error: updErr.message }, { status: 500 });
        }

        // Only fire the follow-up notification + client email when we
        // actually transitioned pending_payment → paid. Stripe retries
        // or an out-of-order status event would otherwise double-notify.
        if (flippedAddon && flippedAddon.length > 0) {
          await insertAddonPaidNotification({
            caseId: addon.case_id,
            accountantId: addon.accountant_id,
            amountPence: addon.amount_pence,
            description: addon.description,
          });

          // Client receipt email + SL inbox BCC. Non-fatal: a failed
          // send can't 500 the webhook (Stripe would retry and we'd
          // have already flipped the row).
          try {
            const { data: caseRow } = await admin
              .from("cases")
              .select("client_id")
              .eq("id", addon.case_id)
              .single();
            if (caseRow) {
              const { data: client } = await admin
                .from("users")
                .select("email")
                .eq("id", caseRow.client_id)
                .single();
              if (client?.email) {
                const chargeLabel = formatFeeGbp(addon.amount_pence);
                const caseUrl = `${siteUrl().replace(/\/$/, "")}/client/cases/${addon.case_id}`;
                const html =
                  `<p>Hi,</p>` +
                  `<p>Thanks — your Sterling Ledger add-on payment of ` +
                  `<strong>${escapeHtml(chargeLabel)}</strong> has been received.</p>` +
                  `<ul>` +
                  `<li>Charge: ${escapeHtml(chargeLabel)}</li>` +
                  `<li>What for: ${escapeHtml(addon.description)}</li>` +
                  `<li>Reference: ${escapeHtml(addon.id)}</li>` +
                  `</ul>` +
                  `<p>Your accountant has been notified and will carry on with the work.</p>` +
                  `<p>You can see this on your case at ` +
                  `<a href="${caseUrl}">${caseUrl}</a>.</p>` +
                  `<p>Sterling Ledger</p>`;
                const sent = await sendEmail({
                  to: client.email,
                  bcc: slNotifyBcc(),
                  subject: `Add-on payment received · ${chargeLabel}`,
                  html,
                  logCaseId: addon.case_id,
                });
                if (!sent.ok) {
                  console.error(
                    "[webhook] addon receipt email send failed:",
                    sent.error,
                  );
                } else if (sent.skipped) {
                  console.warn(
                    `[webhook] addon receipt email skipped: ${sent.reason}`,
                  );
                }
              }
            }
          } catch (mailErr) {
            console.error("[webhook] addon receipt email threw:", mailErr);
          }
        }
        break;
      }

      if (!caseId) break;

      // Only flip to paid+submitted on a fully-paid session.
      const paid = session.payment_status === "paid";

      // Idempotency: scope the UPDATE to pending-payment rows only, so
      // Stripe webhook retries don't re-flip (and don't re-send the
      // client email below). select("id") returns [] when no row was
      // affected, which is the "already processed" signal.
      const { data: flipped, error } = paid
        ? await admin
            .from("cases")
            .update({
              stripe_checkout_session_id: session.id,
              stripe_payment_id:
                typeof session.payment_intent === "string"
                  ? session.payment_intent
                  : (session.payment_intent?.id ?? null),
              stripe_payment_status: "succeeded",
              status: "submitted",
              submitted_at: new Date().toISOString(),
            })
            .eq("id", caseId)
            .neq("stripe_payment_status", "succeeded")
            .select("id")
        : await admin
            .from("cases")
            .update({
              stripe_checkout_session_id: session.id,
              stripe_payment_id:
                typeof session.payment_intent === "string"
                  ? session.payment_intent
                  : (session.payment_intent?.id ?? null),
              stripe_payment_status: "pending",
            })
            .eq("id", caseId)
            .select("id");

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // Receipt email: fired exactly once per case, on the pending →
      // succeeded transition. Stripe sends its own payment-receipt
      // automatically (if enabled in dashboard); this is the business
      // follow-up — "your case is submitted, here's what happens
      // next". The native receipt and this email are complementary,
      // not duplicates. Non-fatal: a bad send must not 500 the
      // webhook (Stripe would retry and we'd re-flip nothing but
      // potentially send twice).
      if (paid && flipped && flipped.length > 0) {
        try {
          const { data: row } = await admin
            .from("cases")
            .select(
              "id, client_id, segment, tier, custom_fee_pence, urgent_fee_pence, is_urgent",
            )
            .eq("id", caseId)
            .single();
          if (row) {
            const { data: client } = await admin
              .from("users")
              .select("email")
              .eq("id", row.client_id)
              .single();
            if (client?.email) {
              const tier = await getTier(row.tier);
              const feePence = effectiveFeePence(row, tier);
              const urgent = row.urgent_fee_pence ?? 0;
              const totalLabel = formatFeeGbp(feePence + urgent);
              const caseUrl = `${siteUrl().replace(/\/$/, "")}/client/cases/${caseId}`;
              const html =
                `<p>Hi,</p>` +
                `<p>Thanks — your Sterling Ledger payment for <strong>${escapeHtml(
                  tier?.title ?? row.tier,
                )}</strong> has been received, and your case is now <strong>submitted</strong>.</p>` +
                `<ul>` +
                `<li>Service: ${escapeHtml(tier?.title ?? row.tier)}</li>` +
                `<li>Total paid: ${escapeHtml(totalLabel)}` +
                (row.is_urgent && urgent > 0
                  ? ` (includes urgent fee ${escapeHtml(formatFeeGbp(urgent))})`
                  : "") +
                `</li>` +
                `<li>Reference: ${escapeHtml(caseId)}</li>` +
                `</ul>` +
                `<p>Our accountants will pick it up and reach out with the next step — usually a short list of documents to upload.</p>` +
                `<p>You can track status any time at ` +
                `<a href="${caseUrl}">${caseUrl}</a>.</p>` +
                `<p>Sterling Ledger</p>`;
              const sent = await sendEmail({
                to: client.email,
                bcc: slNotifyBcc(),
                subject: `Payment received · your case is submitted`,
                html,
                logCaseId: caseId,
              });
              if (!sent.ok) {
                console.error(
                  "[webhook] case receipt email send failed:",
                  sent.error,
                );
              } else if (sent.skipped) {
                console.warn(
                  `[webhook] case receipt email skipped: ${sent.reason}`,
                );
              }
            }
          }
        } catch (mailErr) {
          console.error("[webhook] case receipt email threw:", mailErr);
        }
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
