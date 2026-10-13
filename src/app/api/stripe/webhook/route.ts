import "server-only";
import { NextResponse, type NextRequest, after } from "next/server";
import type Stripe from "stripe";
import { stripe, stripeWebhookSecret, siteUrl } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  insertAddonPaidNotification,
  insertCasePaymentStalledNotification,
  insertAddonPaymentStalledNotification,
} from "@/lib/notifications";
import { sendEmail } from "@/lib/email";
import { getTier } from "@/lib/service-catalog";
import { effectiveFeePence, formatFeeGbp } from "@/lib/case/pricing";
import { renderInvoicePdf, type InvoiceData } from "@/lib/invoice/pdf";
import { STALE_DRAFT_DAYS } from "@/app/admin/constants";

// Tiny HTML escaper for values embedded in email bodies. Same shape
// as the booking route's, inputs here are already-validated DB
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
  // snappy, a card is by far the most common case.
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

// Resolve the "Invoice for" primary + secondary lines so the PDF
// shows a real name (or company name on LC) rather than the email.
// Mirrors the sources the engagement letter + case displays already
// use, client_profiles.name for the person's name, and
// cases.intake_answers.company_name (captured at engagement sign)
// for the Limited Company. Fallback waterfall ends at the email so
// a legacy row with no profile still gets a sensible rendering.
async function resolveInvoiceBillingLines(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
  clientEmail: string,
  segment: string,
  intakeAnswers: Record<string, string> | null,
): Promise<{ primary: string; secondary: string | null }> {
  const { data: profile } = await admin
    .from("client_profiles")
    .select("name")
    .eq("user_id", clientId)
    .maybeSingle<{ name: string | null }>();
  const name = (profile?.name ?? "").trim();

  if (segment === "limited_company_vat") {
    const companyName = (intakeAnswers?.company_name ?? "").trim();
    if (companyName) {
      // "ACME TRADING LTD" / "Jane Smith · jane@example.com"
      const sub = name ? `${name} · ${clientEmail}` : clientEmail;
      return { primary: companyName, secondary: sub };
    }
    // Legacy LC case with no company name captured, fall back to
    // name-on-top, email-below so the invoice is still useful.
    return {
      primary: name || clientEmail,
      secondary: name ? clientEmail : null,
    };
  }

  // Personal path (or anything unexpected).
  return {
    primary: name || clientEmail,
    secondary: name ? clientEmail : null,
  };
}

// Render an invoice PDF and return the base64 payload the email
// layer expects. Non-fatal callers wrap this in try/catch, a
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
// Stripe gives webhook handlers up to a response and retries on
// timeout. The receipt-email path here renders a branded PDF via
// Puppeteer / @sparticuz/chromium, which has non-trivial cold-start
// latency on Vercel; a cold hit plus the Chromium launch plus the
// PDF generation itself can push past the default 10s function
// limit. Stripe then retries, but by the time it does the DB flip
// has already committed, so the webhook's status-filter guards
// correctly skip the re-send and the client email is silently
// dropped. 60s here matches Vercel Pro's max; Hobby ignores
// values above 10s so if the project is on Hobby this is a hint,
// not a change (and Hobby would need the Pro upgrade for this fix
// to actually work).
export const maxDuration = 60;

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
      // case path untouched, never flip case.stripe_payment_status on an
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

          // Client receipt email + SL inbox BCC. Moved OFF the
          // synchronous webhook path via Next 16's after(): Chromium
          // PDF render + SMTP round-trip can comfortably exceed
          // Vercel Hobby's 10s function cap, which caused Stripe to
          // retry a successful payment and the retry's idempotency
          // guard then silently skipped the resend. after() keeps
          // the invocation alive after the 200 response, so the
          // email can take as long as it needs without blocking
          // Stripe. Failures land in post_payment_delivery_failures
          // (migration 0072) so a bad render doesn't go silent.
          after(async () => {
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
            // Fetch the parent case so the "Invoice for" block can
            // branch on segment + pick up the LC company name
            // captured at engagement sign.
            const { data: caseRow } = await admin
              .from("cases")
              .select("client_id, segment, intake_answers")
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
                const billing = await resolveInvoiceBillingLines(
                  admin,
                  caseRow.client_id,
                  client.email,
                  caseRow.segment,
                  (caseRow.intake_answers ?? null) as
                    | Record<string, string>
                    | null,
                );
                const invoiceAttachment = paidAddon.invoice_number
                  ? await buildInvoiceAttachment({
                      invoiceNumber: paidAddon.invoice_number,
                      billingPrimary: billing.primary,
                      billingSecondary: billing.secondary,
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
                  `<p>Thanks. Your Sterling Ledger add-on payment of ` +
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
            const msg =
              mailErr instanceof Error ? mailErr.message : String(mailErr);
            console.error(
              `[webhook] addon receipt email failed for case ${addon.case_id} addon ${addonId}: ${msg}`,
            );
            await admin.from("post_payment_delivery_failures").insert({
              case_id: addon.case_id,
              stage: "addon_email",
              error_message: msg,
              context: {
                addon_id: addonId,
                session_id: session.id,
                payment_intent: paymentIntentId,
              },
            });
          }
          });
        }
        break;
      }

      // Bespoke two-stage balance payment. The deposit used the main
      // case path above (metadata.payment_kind absent → treat as the
      // single-fee case charge); the balance is the SECOND payment
      // on the same case, triggered when the client clicks Approve.
      // Guarded on metadata.payment_kind so we never conflate the
      // two for a case that has both.
      if (session.metadata?.payment_kind === "bespoke_balance" && caseId) {
        const paid = session.payment_status === "paid";
        if (!paid) break;
        const paymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent?.id ?? null);

        // Idempotency: scope to the pending-balance window AND the
        // client_approval status. A webhook retry after the first
        // success-run can't double-flip because
        // balance_payment_status will already be 'succeeded', and a
        // crafted session carrying this kind for an unrelated case
        // can't advance the status because the client_approval
        // filter won't match.
        const { data: flipped, error: flipErr } = await admin
          .from("cases")
          .update({
            balance_payment_status: "succeeded",
            balance_stripe_payment_id: paymentIntentId,
            balance_stripe_checkout_session_id: session.id,
            balance_paid_at: new Date().toISOString(),
            status: "filed",
          })
          .eq("id", caseId)
          .eq("status", "client_approval")
          .neq("balance_payment_status", "succeeded")
          .select("id, accountant_id, client_id");
        if (flipErr) {
          return NextResponse.json({ error: flipErr.message }, { status: 500 });
        }

        if (flipped && flipped.length > 0) {
          // notify_case_change DB trigger (0013) fires on the
          // client_approval -> filed status flip, so client +
          // admins already get the "Case moved to Filed."
          // notification. Nothing extra needed on the admin side.
          // The accountant doesn't get status_change from that
          // trigger (it only fans to client + admins) so push an
          // explicit note here. Wrapped in try/catch and logged to
          // post_payment_delivery_failures (migration 0072) on
          // failure, because the DB flip has already committed and
          // Stripe won't retry effectively (status-filter guard
          // above would 0-row the retry). Without this marker a
          // silent notification drop is invisible until an angry
          // email.
          const accountantId = flipped[0]?.accountant_id as
            | string
            | null
            | undefined;
          if (accountantId) {
            try {
              const { error: notifErr } = await admin
                .from("notifications")
                .insert({
                  recipient_id: accountantId,
                  type: "case_status_change" as const,
                  case_id: caseId,
                  message:
                    "Bespoke balance paid and client approved. Case is now Filed. You can submit to HMRC / Companies House.",
                });
              if (notifErr) throw new Error(notifErr.message);
            } catch (notifThrow) {
              const msg =
                notifThrow instanceof Error
                  ? notifThrow.message
                  : String(notifThrow);
              console.error(
                `[webhook] balance accountant notification failed for case ${caseId}: ${msg}`,
              );
              await admin.from("post_payment_delivery_failures").insert({
                case_id: caseId,
                stage: "balance_notification",
                error_message: msg,
                context: {
                  accountant_id: accountantId,
                  session_id: session.id,
                  payment_intent: paymentIntentId,
                },
              });
            }
          }

          // Balance receipt email + branded invoice PDF. Mirrors the
          // deposit receipt email above; the only differences are the
          // labels ("balance" instead of "deposit") and the invoice
          // number (balance_invoice_number assigned by trigger
          // added in migration 0066). Moved off the synchronous
          // webhook path via after(): same reason as the add-on and
          // deposit branches, Vercel Hobby's 10s cap can't afford
          // the Chromium render + SMTP step on top of the DB flip.
          after(async () => {
          try {
            const { data: freshRow } = await admin
              .from("cases")
              .select(
                "id, client_id, segment, tier, custom_fee_pence, deposit_pence, balance_pence, balance_invoice_number, balance_paid_at, intake_answers",
              )
              .eq("id", caseId)
              .single();
            if (freshRow) {
              const { data: client } = await admin
                .from("users")
                .select("email")
                .eq("id", freshRow.client_id)
                .single();
              if (client?.email) {
                const tier = await getTier(freshRow.tier);
                const balancePence = freshRow.balance_pence ?? 0;
                const totalFeePence = freshRow.custom_fee_pence ?? 0;
                const depositPence = freshRow.deposit_pence ?? 0;
                const balanceLabel = formatFeeGbp(balancePence);
                const totalLabel = formatFeeGbp(totalFeePence);
                const depositLabel = formatFeeGbp(depositPence);
                const paymentReference =
                  typeof session.payment_intent === "string"
                    ? session.payment_intent
                    : (session.payment_intent?.id ?? session.id);
                const paymentMethod =
                  await resolvePaymentMethodLabel(session);
                const paidDateLabel = formatPaidDate(
                  freshRow.balance_paid_at ?? new Date().toISOString(),
                );
                const caseUrl = `${siteUrl().replace(/\/$/, "")}/client/cases/${caseId}`;
                const items = [
                  {
                    description: `${tier?.title ?? freshRow.tier} (balance)`,
                    unitPricePence: balancePence,
                  },
                ];
                const billing = await resolveInvoiceBillingLines(
                  admin,
                  freshRow.client_id,
                  client.email,
                  freshRow.segment,
                  (freshRow.intake_answers ?? null) as Record<
                    string,
                    string
                  > | null,
                );
                const invoiceAttachment = freshRow.balance_invoice_number
                  ? await buildInvoiceAttachment({
                      invoiceNumber: freshRow.balance_invoice_number,
                      billingPrimary: billing.primary,
                      billingSecondary: billing.secondary,
                      paidDateLabel,
                      paymentReference,
                      paymentMethod,
                      items,
                    })
                  : null;
                if (!freshRow.balance_invoice_number) {
                  console.error(
                    `[webhook] case ${caseId} has no balance_invoice_number after balance paid; skipping attachment.`,
                  );
                }
                const html =
                  `<p>Hi,</p>` +
                  `<p>Thanks. Your Sterling Ledger balance payment for <strong>${escapeHtml(
                    tier?.title ?? freshRow.tier,
                  )}</strong> has been received, and your case is now <strong>filed</strong>. Your accountant will submit it to HMRC / Companies House.</p>` +
                  `<ul>` +
                  `<li>Balance invoice no: ${escapeHtml(freshRow.balance_invoice_number ?? "(unavailable)")}</li>` +
                  `<li>Service: ${escapeHtml(tier?.title ?? freshRow.tier)} (balance)</li>` +
                  `<li>Balance paid: ${escapeHtml(balanceLabel)}</li>` +
                  `<li>Deposit previously paid: ${escapeHtml(depositLabel)}</li>` +
                  `<li>Total fee: ${escapeHtml(totalLabel)}</li>` +
                  `<li>Reference: ${escapeHtml(paymentReference)}</li>` +
                  `</ul>` +
                  `<p>Your balance invoice is attached as a PDF.</p>` +
                  `<p>You can track status any time at <a href="${caseUrl}">${caseUrl}</a>.</p>` +
                  `<p>Sterling Ledger</p>`;
                await sendEmail({
                  to: client.email,
                  bcc: slNotifyBcc(),
                  subject: `Balance payment received · ${freshRow.balance_invoice_number ?? "your case"} · filed`,
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
              }
            }
          } catch (mailErr) {
            // Durable marker: the DB flip is already committed and
            // Stripe's retry would skip this step on re-fire, so a
            // silent log is a bug. Insert a row admins can query
            // + resolve manually (resend the invoice email once
            // they've addressed the underlying issue).
            const msg =
              mailErr instanceof Error
                ? mailErr.message
                : String(mailErr);
            console.error(
              `[webhook] balance receipt email failed for case ${caseId}: ${msg}`,
            );
            await admin.from("post_payment_delivery_failures").insert({
              case_id: caseId,
              stage: "balance_email",
              error_message: msg,
              context: {
                session_id: session.id,
                payment_intent: paymentIntentId,
              },
            });
          }
          });
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
      // follow-up ,  "your case is submitted, here's what happens
      // next". The native receipt and this email are complementary,
      // not duplicates. Moved off the synchronous webhook path via
      // after(): Chromium PDF + SMTP comfortably exceeds Vercel
      // Hobby's 10s cap, and the pre-after sync version was timing
      // out and Stripe retries were being silently skipped by the
      // idempotency guard (DB flip already committed).
      if (paid && flipped && flipped.length > 0) {
        after(async () => {
        try {
          // Pull the row AFTER the update so the DB trigger has
          // populated invoice_number. Trigger lives in migration
          // 0061: fires when stripe_payment_status transitions to
          // 'succeeded' and assigns `invoice_number` via the
          // sl_invoice_seq sequence inside the same transaction.
          const { data: row } = await admin
            .from("cases")
            .select(
              "id, client_id, segment, tier, custom_fee_pence, deposit_pence, balance_pence, urgent_fee_pence, is_urgent, invoice_number, submitted_at, intake_answers",
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
              // Bespoke two-stage: THIS invoice is for the deposit
              // only. upfrontChargePence returns deposit_pence when
              // set, which was the actual Stripe charge amount.
              // Non-bespoke / legacy bespoke: effectiveFeePence
              // (same as deposit here because deposit_pence is null).
              const feePence =
                row.deposit_pence != null && row.deposit_pence > 0
                  ? row.deposit_pence
                  : effectiveFeePence(row, tier);
              const urgentFeePence = row.urgent_fee_pence ?? 0;
              const totalPence = feePence + urgentFeePence;
              const totalLabel = formatFeeGbp(totalPence);
              const isBespokeDeposit =
                row.deposit_pence != null &&
                row.deposit_pence > 0 &&
                row.balance_pence != null &&
                row.balance_pence > 0;
              const balanceLabel = isBespokeDeposit
                ? formatFeeGbp(row.balance_pence!)
                : null;
              const caseUrl = `${siteUrl().replace(/\/$/, "")}/client/cases/${caseId}`;

              // Build the invoice PDF. Line items mirror the user's
              // spec: the service name as the first line, then an
              // explicit "Urgent filing" line only when the case
              // was actually urgent, no empty "Adjustments" row.
              // Bespoke two-stage deposit tags the service line with
              // "(deposit)" so the client's PDF archive reads
              // clearly across both invoices on the same case.
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
                  description: isBespokeDeposit
                    ? `${tier?.title ?? row.tier} (deposit)`
                    : (tier?.title ?? row.tier),
                  unitPricePence: feePence,
                },
              ];
              if (row.is_urgent && urgentFeePence > 0) {
                items.push({
                  description: "Urgent filing",
                  unitPricePence: urgentFeePence,
                });
              }
              const billing = await resolveInvoiceBillingLines(
                admin,
                row.client_id,
                client.email,
                row.segment,
                (row.intake_answers ?? null) as Record<string, string> | null,
              );
              const invoiceAttachment = row.invoice_number
                ? await buildInvoiceAttachment({
                    invoiceNumber: row.invoice_number,
                    billingPrimary: billing.primary,
                    billingSecondary: billing.secondary,
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
                `<p>Thanks. Your Sterling Ledger ${isBespokeDeposit ? "deposit " : ""}payment for <strong>${escapeHtml(
                  tier?.title ?? row.tier,
                )}</strong> has been received, and your case is now <strong>submitted</strong>.</p>` +
                `<ul>` +
                `<li>Invoice no: ${escapeHtml(row.invoice_number ?? "(unavailable)")}</li>` +
                `<li>Service: ${escapeHtml(tier?.title ?? row.tier)}${isBespokeDeposit ? " (deposit)" : ""}</li>` +
                `<li>${isBespokeDeposit ? "Deposit paid" : "Total paid"}: ${escapeHtml(totalLabel)}` +
                (row.is_urgent && urgentFeePence > 0
                  ? ` (includes urgent fee ${escapeHtml(formatFeeGbp(urgentFeePence))})`
                  : "") +
                `</li>` +
                (isBespokeDeposit && balanceLabel
                  ? `<li>Balance due on approval: ${escapeHtml(balanceLabel)}</li>`
                  : "") +
                `<li>Reference: ${escapeHtml(paymentReference)}</li>` +
                `</ul>` +
                `<p>Your invoice is attached as a PDF for your records.</p>` +
                `<p>Our accountants will pick up the case and reach out with the next step, usually a short list of documents to upload.${
                  isBespokeDeposit
                    ? ` The balance of ${balanceLabel} will be payable the moment you approve the prepared work.`
                    : ""
                }</p>` +
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
          const msg =
            mailErr instanceof Error ? mailErr.message : String(mailErr);
          console.error(
            `[webhook] case receipt email failed for case ${caseId}: ${msg}`,
          );
          await admin.from("post_payment_delivery_failures").insert({
            case_id: caseId,
            stage: "deposit_email",
            error_message: msg,
            context: {
              session_id: session.id,
              payment_intent:
                typeof session.payment_intent === "string"
                  ? session.payment_intent
                  : (session.payment_intent?.id ?? null),
            },
          });
        }
        });
      }
      break;
    }
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      const addonId = session.metadata?.addon_id;
      const caseId = session.metadata?.case_id;
      const reason: "expired" | "failed" =
        event.type === "checkout.session.expired" ? "expired" : "failed";

      // ---- Add-on branch ----
      // Don't flip the row, keep it at pending_payment so the client
      // can retry from the same Pay button. Stale-draft deletion does
      // NOT sweep add-ons, so there's no deletion threat to warn
      // about either, which means no client email. Admin gets an
      // in-app notification so a stall is visible rather than
      // silently lost.
      if (addonId) {
        try {
          const { data: addonRow } = await admin
            .from("case_addons")
            .select(
              "id, case_id, amount_pence, description, status",
            )
            .eq("id", addonId)
            .maybeSingle();
          if (addonRow && addonRow.status === "pending_payment") {
            const { data: caseRow } = await admin
              .from("cases")
              .select("client_id")
              .eq("id", addonRow.case_id)
              .single();
            if (caseRow) {
              const { data: client } = await admin
                .from("users")
                .select("email")
                .eq("id", caseRow.client_id)
                .single();
              const { data: profile } = await admin
                .from("client_profiles")
                .select("name")
                .eq("user_id", caseRow.client_id)
                .maybeSingle<{ name: string | null }>();
              const clientName = (profile?.name ?? "").trim();
              if (client?.email) {
                await insertAddonPaymentStalledNotification({
                  caseId: addonRow.case_id,
                  addonDescription: addonRow.description,
                  amountPence: addonRow.amount_pence,
                  clientName: clientName || client.email,
                  clientEmail: client.email,
                  reason,
                });
              }
            }
          }
        } catch (notifyErr) {
          console.error(
            "[webhook] addon-stall notification failed:",
            notifyErr,
          );
        }
        break;
      }

      // ---- Case branch ----
      // Idempotency: scope the UPDATE so retries of the same event
      // (Stripe redelivery) don't re-flip the row and don't double-
      // send the client email + admin notification. .select("id")
      // returns [] when nothing was affected = "already processed".
      if (!caseId) break;
      const { data: flippedFailed } = await admin
        .from("cases")
        .update({ stripe_payment_status: "failed" })
        .eq("id", caseId)
        .neq("stripe_payment_status", "failed")
        .neq("stripe_payment_status", "succeeded")
        .select("id");
      if (!flippedFailed || flippedFailed.length === 0) break;

      try {
        const { data: row } = await admin
          .from("cases")
          .select("id, client_id, segment, tier")
          .eq("id", caseId)
          .single();
        if (!row) break;
        const { data: client } = await admin
          .from("users")
          .select("email")
          .eq("id", row.client_id)
          .single();
        const { data: profile } = await admin
          .from("client_profiles")
          .select("name")
          .eq("user_id", row.client_id)
          .maybeSingle<{ name: string | null }>();
        const clientName = (profile?.name ?? "").trim();
        const tier = await getTier(row.tier);
        const serviceLabel = tier?.title ?? row.tier;
        const caseUrl = `${siteUrl().replace(/\/$/, "")}/client/cases/${caseId}/checkout`;

        // Admin visibility, fire regardless of email outcome so
        // staff see the stall even if the client email bounces.
        try {
          await insertCasePaymentStalledNotification({
            caseId,
            clientName: clientName || client?.email || "unknown",
            clientEmail: client?.email ?? "unknown",
            serviceLabel,
            reason,
          });
        } catch (notifyErr) {
          console.error(
            "[webhook] case-stall notification failed:",
            notifyErr,
          );
        }

        // Client email. References STALE_DRAFT_DAYS (same constant
        // the sweeper uses) so the "deleted in N days" number stays
        // in lockstep with the real policy. Non-fatal: a failed
        // send must not 500 the webhook or Stripe would retry and
        // double-notify admin.
        if (client?.email) {
          const headline =
            reason === "expired"
              ? "Your checkout session expired before payment completed"
              : "Your payment didn't go through";
          // "deleted in N days" references STALE_DRAFT_DAYS directly
          // so the number can't drift away from what the sweeper
          // actually enforces.
          const html =
            `<p>Hi,</p>` +
            `<p>${headline}. Your case for <strong>${escapeHtml(
              serviceLabel,
            )}</strong> is still a <strong>draft</strong>. Nothing has been charged to your card.</p>` +
            `<p>You can retry payment any time at ` +
            `<a href="${caseUrl}">${caseUrl}</a>.</p>` +
            `<p><strong>Heads up:</strong> if payment isn't completed within ` +
            `<strong>${STALE_DRAFT_DAYS} days</strong> of the case being created, ` +
            `we'll remove the draft automatically.</p>` +
            `<p>If anything's wrong or you need a hand, reply to this email.</p>` +
            `<p>Sterling Ledger</p>`;
          const sent = await sendEmail({
            to: client.email,
            bcc: slNotifyBcc(),
            subject:
              reason === "expired"
                ? `Checkout expired. Your ${serviceLabel} case is still draft`
                : `Payment didn't go through. Your ${serviceLabel} case is still draft`,
            html,
            logCaseId: caseId,
          });
          if (!sent.ok) {
            console.error(
              "[webhook] case-stall email send failed:",
              sent.error,
            );
          } else if (sent.skipped) {
            console.warn(
              `[webhook] case-stall email skipped: ${sent.reason}`,
            );
          }
        }
      } catch (mailErr) {
        console.error("[webhook] case-stall handler threw:", mailErr);
      }
      break;
    }
    default:
      // Ignore other events for now.
      break;
  }

  return NextResponse.json({ received: true });
}
