import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe, stripeWebhookSecret, siteUrl } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { insertAddonPaidNotification } from "@/lib/notifications";
import { sendEmail } from "@/lib/email";
import { getTier } from "@/lib/service-catalog";
import { effectiveFeePence, formatFeeGbp } from "@/lib/case/pricing";
import { renderInvoicePdf, type InvoiceData } from "@/lib/invoice/pdf";

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

// Pretty-print an ISO timestamp as "6 October 2026" in Europe/London.
// Used for the "Paid date" row on the invoice.
function formatPaidDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(d);
}

// Resolve a human-readable payment-method label from the Stripe
// Checkout session: "Card (Visa .. 4242)" when we have the brand +
// last4, otherwise "Card" / "" / falls back to a sensible default.
// Everything we need is on the session already by the time the
// webhook fires; no extra API call.
async function resolvePaymentMethodLabel(
  session: Stripe.Checkout.Session,
): Promise<string> {
  // Session carries payment_method_types ("card", "bacs_debit", …)
  // but not the brand/last4. Those live on the PaymentIntent's
  // payment_method object. We expand on demand to keep the webhook
  // snappy — a card is by far the most common case.
  try {
    const pmTypes = session.payment_method_types ?? [];
    const kind = pmTypes[0] ?? "card";
    if (kind !== "card") return capitalize(kind.replace(/_/g, " "));
    const piId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : (session.payment_intent?.id ?? null);
    if (!piId) return "Card";
    const pi = await stripe().paymentIntents.retrieve(piId, {
      expand: ["payment_method"],
    });
    const pm =
      typeof pi.payment_method === "string" ? null : pi.payment_method;
    if (pm && pm.card) {
      const brand = pm.card.brand
        ? capitalize(pm.card.brand)
        : "Card";
      const last4 = pm.card.last4 ? ` ·· ${pm.card.last4}` : "";
      return `${brand}${last4}`;
    }
    return "Card";
  } catch (err) {
    console.error(
      "[webhook] payment-method lookup failed:",
      err instanceof Error ? err.message : String(err),
    );
    return "Card";
  }
}
function capitalize(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

// Render an invoice PDF and return the base64 payload the email
// layer expects. Non-fatal callers wrap this in try/catch — a
// chromium hiccup must not block the status-update that already
// landed in the DB.
async function buildInvoiceAttachment(
  data: InvoiceData,
): Promise<{ base64: string; filename: string } | null> {
  try {
    const bytes = await renderInvoicePdf(data);
    const base64 = Buffer.from(bytes).toString("base64");
    return {
      base64,
      filename: `${data.invoiceNumber}.pdf`,
    };
  } catch (err) {
    console.error(
      "[webhook] invoice PDF render failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
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
            // Re-select the add-on so the invoice_number assigned
            // by the DB trigger (migration 0061) is in hand before
            // we build the PDF.
            const { data: paidAddon } = await admin
              .from("case_addons")
              .select(
                "id, case_id, amount_pence, description, invoice_number, paid_at",
              )
              .eq("id", addonId)
              .single();
            const { data: caseRow } = await admin
              .from("cases")
              .select("client_id")
              .eq("id", addon.case_id)
              .single();
            if (caseRow && paidAddon) {
              const { data: client } = await admin
                .from("users")
                .select("email")
                .eq("id", caseRow.client_id)
                .single();
              if (client?.email) {
                const chargeLabel = formatFeeGbp(paidAddon.amount_pence);
                const caseUrl = `${siteUrl().replace(/\/$/, "")}/client/cases/${addon.case_id}`;
                const reference = paymentIntentId ?? paidAddon.id;
                const paymentMethod =
                  await resolvePaymentMethodLabel(session);
                const paidDateLabel = formatPaidDate(
                  paidAddon.paid_at ?? new Date().toISOString(),
                );
                const invoiceAttachment = paidAddon.invoice_number
                  ? await buildInvoiceAttachment({
                      invoiceNumber: paidAddon.invoice_number,
                      clientName: client.email,
                      paidDateLabel,
                      paymentReference: reference,
                      paymentMethod,
                      items: [
                        {
                          description: paidAddon.description,
                          unitPricePence: paidAddon.amount_pence,
                        },
                      ],
                    })
                  : null;
                if (!paidAddon.invoice_number) {
                  console.error(
                    `[webhook] addon ${paidAddon.id} has no invoice_number after paid flip; skipping attachment.`,
                  );
                }

                const html =
                  `<p>Hi,</p>` +
                  `<p>Thanks — your Sterling Ledger add-on payment of ` +
                  `<strong>${escapeHtml(chargeLabel)}</strong> has been received.</p>` +
                  `<ul>` +
                  `<li>Invoice no: ${escapeHtml(paidAddon.invoice_number ?? "(unavailable)")}</li>` +
                  `<li>Charge: ${escapeHtml(chargeLabel)}</li>` +
                  `<li>What for: ${escapeHtml(paidAddon.description)}</li>` +
                  `<li>Reference: ${escapeHtml(reference)}</li>` +
                  `</ul>` +
                  `<p>Your invoice is attached as a PDF for your records.</p>` +
                  `<p>Your accountant has been notified and will carry on with the work.</p>` +
                  `<p>You can see this on your case at ` +
                  `<a href="${caseUrl}">${caseUrl}</a>.</p>` +
                  `<p>Sterling Ledger</p>`;
                const sent = await sendEmail({
                  to: client.email,
                  bcc: slNotifyBcc(),
                  subject: `Add-on payment received · ${paidAddon.invoice_number ?? chargeLabel}`,
                  html,
                  attachments: invoiceAttachment
                    ? [
                        {
                          base64: invoiceAttachment.base64,
                          filename: invoiceAttachment.filename,
                          mimeType: "application/pdf",
                        },
                      ]
                    : undefined,
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
          // Pull the row AFTER the update so the DB trigger has
          // populated invoice_number. Trigger lives in migration
          // 0061: fires when stripe_payment_status transitions to
          // 'succeeded' and assigns `invoice_number` via the
          // sl_invoice_seq sequence inside the same transaction.
          const { data: row } = await admin
            .from("cases")
            .select(
              "id, client_id, segment, tier, custom_fee_pence, urgent_fee_pence, is_urgent, invoice_number, submitted_at",
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
              const urgentFeePence = row.urgent_fee_pence ?? 0;
              const totalPence = feePence + urgentFeePence;
              const totalLabel = formatFeeGbp(totalPence);
              const caseUrl = `${siteUrl().replace(/\/$/, "")}/client/cases/${caseId}`;

              // Build the invoice PDF. Line items mirror the user's
              // spec: the service name as the first line, then an
              // explicit "Urgent filing" line only when the case
              // was actually urgent — no empty "Adjustments" row.
              const paymentReference =
                typeof session.payment_intent === "string"
                  ? session.payment_intent
                  : (session.payment_intent?.id ?? session.id);
              const paymentMethod =
                await resolvePaymentMethodLabel(session);
              const paidDateLabel = formatPaidDate(
                row.submitted_at ?? new Date().toISOString(),
              );
              const items = [
                {
                  description: tier?.title ?? row.tier,
                  unitPricePence: feePence,
                },
              ];
              if (row.is_urgent && urgentFeePence > 0) {
                items.push({
                  description: "Urgent filing",
                  unitPricePence: urgentFeePence,
                });
              }
              const invoiceAttachment = row.invoice_number
                ? await buildInvoiceAttachment({
                    invoiceNumber: row.invoice_number,
                    clientName: client.email,
                    paidDateLabel,
                    paymentReference,
                    paymentMethod,
                    items,
                  })
                : null;
              if (!row.invoice_number) {
                console.error(
                  `[webhook] case ${caseId} has no invoice_number after paid flip; skipping attachment.`,
                );
              }

              const html =
                `<p>Hi,</p>` +
                `<p>Thanks — your Sterling Ledger payment for <strong>${escapeHtml(
                  tier?.title ?? row.tier,
                )}</strong> has been received, and your case is now <strong>submitted</strong>.</p>` +
                `<ul>` +
                `<li>Invoice no: ${escapeHtml(row.invoice_number ?? "(unavailable)")}</li>` +
                `<li>Service: ${escapeHtml(tier?.title ?? row.tier)}</li>` +
                `<li>Total paid: ${escapeHtml(totalLabel)}` +
                (row.is_urgent && urgentFeePence > 0
                  ? ` (includes urgent fee ${escapeHtml(formatFeeGbp(urgentFeePence))})`
                  : "") +
                `</li>` +
                `<li>Reference: ${escapeHtml(paymentReference)}</li>` +
                `</ul>` +
                `<p>Your invoice is attached as a PDF for your records.</p>` +
                `<p>Our accountants will pick up the case and reach out with the next step — usually a short list of documents to upload.</p>` +
                `<p>You can track status any time at ` +
                `<a href="${caseUrl}">${caseUrl}</a>.</p>` +
                `<p>Sterling Ledger</p>`;
              const sent = await sendEmail({
                to: client.email,
                bcc: slNotifyBcc(),
                subject: `Payment received · ${row.invoice_number ?? "your case"} · your case is submitted`,
                html,
                attachments: invoiceAttachment
                  ? [
                      {
                        base64: invoiceAttachment.base64,
                        filename: invoiceAttachment.filename,
                        mimeType: "application/pdf",
                      },
                    ]
                  : undefined,
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
