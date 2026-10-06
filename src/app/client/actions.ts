"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSegment, type SegmentId } from "@/lib/segments";
import {
  getTier,
  RETIRED_PERSONAL_TIER_IDS,
  type TierId,
} from "@/lib/plans";
import { effectiveFeePence } from "@/lib/case/pricing";
import type Stripe from "stripe";
import { stripe, siteUrl } from "@/lib/stripe";
import { type ActionResult, fail } from "@/lib/action-result";
import {
  URGENT_FEE_PENCE,
  validateDeadline,
} from "@/lib/working-days";
import { insertAddonPaidNotification } from "@/lib/notifications";

export type { ActionResult };

const BUCKET = "case-documents";

async function assertCaseOwner(caseId: string) {
  const me = await requireRole("client");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cases")
    .select("id, client_id, segment, tier, status, intake_answers, stripe_payment_status, deadline, is_urgent, urgent_fee_pence, custom_fee_pence, engagement_signed_at")
    .eq("id", caseId)
    .single();
  if (error || !data) throw new Error("Case not found.");
  if (data.client_id !== me.id) throw new Error("Not your case.");
  return { me, supabase, caseRow: data };
}

// Suspended clients keep read access to their existing cases (via the
// existing SELECT policies) but every mutating server action goes through
// this gate. Enforced at server-action layer rather than RLS because a
// broader block would also stop admin support-chat replies from being read.
function assertNotSuspended(status: string, action: string): void {
  if (status === "suspended") {
    throw new Error(
      `Your account is suspended and can't ${action}. Contact support to reinstate.`,
    );
  }
}

// -------------------------------------------------------------------------
// Create a case draft with segment + tier, then redirect into the
// engagement letter. Both Personal (new 9-up catalogue) and Limited
// Company flows take the same shape: pick a service, sign the letter,
// pay, upload documents. There is no intake form and no deadline step.
// -------------------------------------------------------------------------
// createCaseAction uses redirect() on success. fail() re-throws Next's
// NEXT_REDIRECT digest so control flow still works — only real errors get
// wrapped into the return value.
export async function createCaseAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const me = await requireRole("client");
    assertNotSuspended(me.status, "start a new return");
    const segment = String(formData.get("segment") ?? "") as SegmentId;
    const tier = String(formData.get("tier") ?? "") as TierId;

    // Only two segments are sold now. Retired personal segments
    // (first_time_filer / self_employed / landlord / investor / cis /
    // high_earner) are kept in the type for safety but rejected here.
    if (segment !== "personal" && segment !== "limited_company_vat") {
      throw new Error("Please pick a service.");
    }
    if (!getSegment(segment)) throw new Error("Please pick a service.");

    const tierDef = getTier(tier);
    if (!tierDef) throw new Error("Please pick a service.");

    // Retired personal tiers (basic / standard / premium). The TypeScript
    // union keeps them for legacy references; the sale path refuses.
    if ((RETIRED_PERSONAL_TIER_IDS as readonly string[]).includes(tier)) {
      throw new Error("That option is no longer available. Please pick from the current list.");
    }

    // Enquiry-only tiers (bespoke, no flat fee) must not land in
    // cases.tier — they live in service_enquiries. Belt-and-braces on
    // the form's own routing: the client wizard sends enquiry-tier
    // picks to /client/new/enquiry, but a crafted POST straight to
    // createCaseAction would otherwise create a half-formed case with
    // priceGbp=0 and no engagement path.
    if (tierDef.requiresEnquiry) {
      throw new Error(
        "This service is bespoke. Use the enquiry form instead of starting a case.",
      );
    }
    // Admin-only tiers (vat_plus_accounts_bespoke) must be created by
    // admin via the enquiry → case flow, not by the client self-serving.
    if (tierDef.adminCreateOnly) {
      throw new Error(
        "This service can only be opened by Sterling Ledger admins following a scoping call.",
      );
    }

    // Segment / tier cross-check: can't put a company tier on a
    // personal case or vice versa.
    const tierSide: "personal" | "company" = tierDef.group;
    const segmentSide: "personal" | "company" =
      segment === "limited_company_vat" ? "company" : "personal";
    if (tierSide !== segmentSide) {
      throw new Error("That service doesn't match the selected mode.");
    }

    // Both current flat-fee segments (Personal and Limited Company)
    // carry a client-chosen filing deadline + optional urgent upgrade.
    // This is the client's desired completion date — separate from the
    // accountant-set accounting period dates (period_start_date /
    // period_end_date / vat_return_cycles) which stay as they are and
    // aren't touched here. Validate server-side so a crafted POST
    // can't bypass the 5-working-day minimum.
    const deadlineRaw = String(formData.get("deadline") ?? "").trim();
    const isUrgent = formData.get("is_urgent") === "true";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadlineRaw)) {
      throw new Error("Please pick a filing deadline.");
    }
    const check = await validateDeadline(deadlineRaw, isUrgent);
    if (!check.ok) {
      throw new Error(
        isUrgent
          ? `That date is too soon even for urgent. Earliest urgent date: ${check.earliest}.`
          : `Please pick a date on or after ${check.earliest} (5 working days minimum). Tick Urgent (+£${URGENT_FEE_PENCE / 100}) to allow earlier dates.`,
      );
    }
    const urgentFee = isUrgent ? URGENT_FEE_PENCE : 0;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("cases")
      .insert({
        client_id: me.id,
        segment,
        tier,
        status: "draft",
        stripe_payment_status: "pending",
        deadline: deadlineRaw,
        is_urgent: isUrgent,
        urgent_fee_pence: urgentFee,
      })
      .select("id")
      .single();

    if (error || !data) throw new Error(error?.message ?? "Could not create case.");

    revalidatePath("/client");
    // Both Personal and Limited Company go through the engagement letter
    // next. The letter page branches on segment to pick the variant.
    redirect(`/client/cases/${data.id}/engagement`);
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Create a Stripe Checkout session and redirect the user to it.
// -------------------------------------------------------------------------
export async function startCheckoutAction(
  caseId: string,
): Promise<ActionResult> {
  try {
    const { me, supabase, caseRow } = await assertCaseOwner(caseId);
    assertNotSuspended(me.status, "make payments");
    if (caseRow.status !== "draft") throw new Error("Case already submitted.");

    const seg = getSegment(caseRow.segment);
    const tier = getTier(caseRow.tier);
    if (!seg || !tier) throw new Error("Case is missing segment or tier.");

    const isCompany = seg.id === "limited_company_vat";
    const isPersonal = seg.id === "personal";

    if (isCompany || isPersonal) {
      // Both current flows gate on the engagement letter being signed
      // (contractually required before we can take payment or start
      // work). Intake / deadline don't apply to either path.
      if (!caseRow.engagement_signed_at) {
        throw new Error(
          "Please sign the engagement letter before you can pay.",
        );
      }
    } else {
      // Retired personal cases (first_time_filer / self_employed /
      // landlord / investor / cis / high_earner). None exist after the
      // data wipe; the branch is kept so a residual row can still
      // check out via the old intake + deadline gates.
      if (
        !caseRow.intake_answers ||
        Object.keys(caseRow.intake_answers as Record<string, unknown>).length === 0
      ) {
        throw new Error("Fill in the intake questions first.");
      }
      if (caseRow.deadline) {
        const check = await validateDeadline(caseRow.deadline, !!caseRow.is_urgent);
        if (!check.ok) {
          throw new Error(
            caseRow.is_urgent
              ? `Your deadline is too soon even for urgent. Earliest available: ${check.earliest}. Go back and update.`
              : `Your deadline no longer meets the 5-working-day minimum. Earliest standard: ${check.earliest}. Go back and either update the deadline or tick Urgent (+£100).`,
          );
        }
      }
    }

    // Build Stripe line items. Plan always; urgent as a separate line so
    // the receipt reads clearly.
    const isUrgent = !!caseRow.is_urgent;
    const planPence = effectiveFeePence(caseRow, tier);
    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: planPence,
          product_data: {
            // The tier title already names the service for both Personal
            // (e.g. "Sole trader / self-employed") and Limited Company
            // (e.g. "Dormant company"); adding ". Personal" or
            // ". Limited company & VAT" would be redundant. Retired-
            // personal cases keep the "<tier>. <segment>" form so the
            // old Stripe receipts stay recognizable.
            name:
              isCompany || isPersonal
                ? tier.title
                : `${tier.title}. ${seg.title}`,
            description: tier.tagline,
          },
        },
      },
    ];
    if (isUrgent) {
      // Server-authoritative fee — never trust anything the client sent.
      line_items.push({
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: URGENT_FEE_PENCE,
          product_data: {
            name: "Urgent processing",
            description: "Fast-track under the standard 5-working-day rule.",
          },
        },
      });
    }

    const base = siteUrl();
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items,
      metadata: {
        case_id: caseId,
        segment: seg.id,
        tier: tier.id,
        is_urgent: isUrgent ? "1" : "0",
      },
      // Both Personal (new 9-up catalogue) and Limited Company clients
      // continue to the onboarding checklist after payment. Retired
      // personal cases (if any surface) bounce back to the case page
      // where the "payment received" banner lands them.
      success_url:
        isCompany || isPersonal
          ? `${base}/client/cases/${caseId}/onboarding?paid=1`
          : `${base}/client/cases/${caseId}?paid=1`,
      cancel_url: `${base}/client/cases/${caseId}/checkout?canceled=1`,
    });

    // Save session id so we can reconcile if the webhook is late.
    await supabase
      .from("cases")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", caseId);

    if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
    redirect(session.url);
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Fallback: if the webhook hasn't fired yet, poll Stripe once and reconcile.
// Called from the case-detail page after ?paid=1.
// -------------------------------------------------------------------------
export async function reconcilePaymentAction(caseId: string) {
  const { supabase, caseRow } = await assertCaseOwner(caseId);
  if (caseRow.stripe_payment_status === "succeeded") return;
  if (!caseRow.status || caseRow.status !== "draft") return;

  const admin = createAdminClient();
  const { data: fresh } = await admin
    .from("cases")
    .select("stripe_checkout_session_id, stripe_payment_status")
    .eq("id", caseId)
    .single();
  if (!fresh?.stripe_checkout_session_id) return;
  if (fresh.stripe_payment_status === "succeeded") return;

  const session = await stripe().checkout.sessions.retrieve(
    fresh.stripe_checkout_session_id,
  );
  if (session.payment_status === "paid") {
    await admin
      .from("cases")
      .update({
        stripe_payment_status: "succeeded",
        stripe_payment_id:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent?.id ?? null),
        status: "submitted",
        submitted_at: new Date().toISOString(),
      })
      .eq("id", caseId);
    revalidatePath(`/client/cases/${caseId}`);
    revalidatePath("/client");
  }
  // Suppress unused-var complaint on caseRow in some setups
  void supabase;
}

// -------------------------------------------------------------------------
// Add-on payment: create a Stripe Checkout session for a single add-on.
// Amount is re-read from the case_addons row at this moment (never trusted
// from the caller). Ownership is verified via a join on cases.client_id.
// -------------------------------------------------------------------------
export async function startAddonCheckoutAction(
  addonId: string,
): Promise<ActionResult> {
  try {
    const me = await requireRole("client");
    assertNotSuspended(me.status, "make payments");
    const supabase = await createClient();

    // Load the add-on and its case in one shot. Ownership is asserted below.
    const { data: addon, error: addonErr } = await supabase
      .from("case_addons")
      .select(
        "id, case_id, accountant_id, description, amount_pence, status",
      )
      .eq("id", addonId)
      .single();
    if (addonErr || !addon) throw new Error("Add-on not found.");

    const { data: caseRow, error: caseErr } = await supabase
      .from("cases")
      .select("id, client_id")
      .eq("id", addon.case_id)
      .single();
    if (caseErr || !caseRow) throw new Error("Case not found.");
    if (caseRow.client_id !== me.id) throw new Error("Not your case.");

    if (addon.status !== "pending_payment") {
      throw new Error(
        addon.status === "paid"
          ? "This add-on is already paid."
          : "This add-on isn't ready for payment.",
      );
    }
    if (!Number.isFinite(addon.amount_pence) || addon.amount_pence <= 0) {
      throw new Error("Add-on amount is invalid.");
    }

    const base = siteUrl();
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: addon.amount_pence, // server-authoritative
            product_data: {
              name: "Add-on service",
              description: addon.description,
            },
          },
        },
      ],
      // Only addon_id. Deliberately no case_id: if a stale or older webhook
      // handler ever loses the addon branch, we do NOT want it to treat this
      // session's metadata.case_id as a case payment and clobber the case
      // row. The case can always be recovered from the add-on's DB row.
      metadata: {
        addon_id: addon.id,
      },
      success_url: `${base}/client/cases/${addon.case_id}?addon_paid=${addon.id}`,
      cancel_url: `${base}/client/cases/${addon.case_id}?addon_canceled=${addon.id}`,
    });

    const admin = createAdminClient();
    await admin
      .from("case_addons")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", addon.id);

    if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
    redirect(session.url);
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Fallback: if the Stripe webhook hasn't landed yet, poll the session once
// and reconcile. Called from the client case-detail page after
// ?addon_paid=<addonId>. Idempotent — safe to call after the webhook won
// the race, since case_addons.status will already be 'paid'.
// -------------------------------------------------------------------------
export async function reconcileAddonPaymentAction(addonId: string) {
  const me = await requireRole("client");
  const admin = createAdminClient();

  const { data: addon } = await admin
    .from("case_addons")
    .select(
      "id, case_id, accountant_id, description, amount_pence, status, stripe_checkout_session_id",
    )
    .eq("id", addonId)
    .single();
  if (!addon) return;

  const { data: caseRow } = await admin
    .from("cases")
    .select("client_id")
    .eq("id", addon.case_id)
    .single();
  if (!caseRow || caseRow.client_id !== me.id) return;
  if (addon.status === "paid") return;
  if (!addon.stripe_checkout_session_id) return;

  const session = await stripe().checkout.sessions.retrieve(
    addon.stripe_checkout_session_id,
  );
  if (session.payment_status !== "paid") return;

  await admin
    .from("case_addons")
    .update({
      status: "paid",
      stripe_payment_id:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null),
      paid_at: new Date().toISOString(),
    })
    .eq("id", addonId)
    .eq("status", "pending_payment"); // race guard against the webhook

  await insertAddonPaidNotification({
    caseId: addon.case_id,
    accountantId: addon.accountant_id,
    amountPence: addon.amount_pence,
    description: addon.description,
  });

  revalidatePath(`/client/cases/${addon.case_id}`);
  revalidatePath(`/accountant/cases/${addon.case_id}`);
}

// -------------------------------------------------------------------------
// Client approves the prepared return. Moves status client_approval -> filed.
// The accountant's ALLOWED_TRANSITIONS deliberately omits this step so a
// return can never be marked filed without the client's explicit sign-off.
// -------------------------------------------------------------------------
export async function approveAndFileAction(
  caseId: string,
): Promise<ActionResult> {
  try {
    const { me, supabase, caseRow } = await assertCaseOwner(caseId);
    assertNotSuspended(me.status, "approve filings");
    if (caseRow.status !== "client_approval") {
      throw new Error("This case isn't awaiting your approval right now.");
    }
    // .select().single() converts a 0-row RLS-filtered result into a
    // PGRST116 error so we can't silently succeed if the policy blocks the
    // update.
    const { data, error } = await supabase
      .from("cases")
      .update({ status: "filed" })
      .eq("id", caseId)
      .eq("status", "client_approval")
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Approval didn't take. Try again.");
    revalidatePath(`/client/cases/${caseId}`);
    revalidatePath("/client");
    revalidatePath("/accountant");
    revalidatePath(`/accountant/cases/${caseId}`);
    return { ok: true };
  } catch (e) {
    return fail(e, "Approval failed.");
  }
}

// -------------------------------------------------------------------------
// Signed URL for downloading a document (client owner viewing their own).
// -------------------------------------------------------------------------
export async function getDocumentSignedUrl(
  caseId: string,
  filePath: string,
): Promise<ActionResult<string>> {
  try {
    const { supabase, caseRow } = await assertCaseOwner(caseId);
    void caseRow;
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(filePath, 60);
    if (error || !data) {
      throw new Error(error?.message ?? "Could not sign URL.");
    }
    return { ok: true, data: data.signedUrl };
  } catch (e) {
    return fail(e);
  }
}
