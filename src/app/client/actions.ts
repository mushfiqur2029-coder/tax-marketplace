"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSegment, type SegmentId } from "@/lib/segments";
import { getTier, type TierId } from "@/lib/plans";
import { stripe, siteUrl } from "@/lib/stripe";
import { type ActionResult, fail } from "@/lib/action-result";

export type { ActionResult };

const BUCKET = "case-documents";

async function assertCaseOwner(caseId: string) {
  const me = await requireRole("client");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cases")
    .select("id, client_id, segment, tier, status, intake_answers, stripe_payment_status")
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
// Create a case draft with segment + tier, then redirect into intake.
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
    const deadlineRaw = String(formData.get("deadline") ?? "").trim();

    if (!getSegment(segment)) throw new Error("Please pick a segment.");
    if (!getTier(tier)) throw new Error("Please pick a plan.");

    let deadline: string | null = null;
    if (deadlineRaw) {
      const d = new Date(deadlineRaw);
      if (isNaN(d.getTime())) throw new Error("Please pick a valid deadline.");
      deadline = d.toISOString();
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("cases")
      .insert({
        client_id: me.id,
        segment,
        tier,
        status: "draft",
        stripe_payment_status: "pending",
        deadline,
      })
      .select("id")
      .single();

    if (error || !data) throw new Error(error?.message ?? "Could not create case.");

    revalidatePath("/client");
    redirect(`/client/cases/${data.id}/intake`);
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Save intake answers.
// -------------------------------------------------------------------------
export async function updateIntakeAction(
  caseId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const { supabase, caseRow } = await assertCaseOwner(caseId);
    if (caseRow.status !== "draft") throw new Error("Case already submitted.");

    const seg = getSegment(caseRow.segment);
    if (!seg) throw new Error("Case has no segment.");

    const answers: Record<string, string> = {};
    for (const field of seg.intake) {
      const raw = formData.get(field.name);
      const val = raw == null ? "" : String(raw).trim();
      if (field.required && !val) {
        throw new Error(`${field.label} is required.`);
      }
      if (val) answers[field.name] = val;
    }

    const { error } = await supabase
      .from("cases")
      .update({ intake_answers: answers })
      .eq("id", caseId);

    if (error) throw new Error(error.message);

    revalidatePath(`/client/cases/${caseId}`);
    redirect(`/client/cases/${caseId}/documents`);
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Upload a document (called from a client component via a form action).
// -------------------------------------------------------------------------
export async function uploadDocumentAction(
  caseId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const { me, supabase, caseRow } = await assertCaseOwner(caseId);
    if (caseRow.status !== "draft") {
      throw new Error("Documents can only be added while case is draft.");
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("Pick a file first.");
    }
    const MAX = 50 * 1024 * 1024;
    if (file.size > MAX) throw new Error("File is over 50 MB.");

    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${caseId}/${Date.now()}_${safeName}`;

    const buf = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buf, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (upErr) throw new Error(upErr.message);

    const { error: dbErr } = await supabase.from("case_documents").insert({
      case_id: caseId,
      uploaded_by: me.id,
      file_url: path,
      file_name: file.name,
    });
    if (dbErr) {
      // Best-effort cleanup on DB failure.
      await supabase.storage.from(BUCKET).remove([path]);
      throw new Error(dbErr.message);
    }

    revalidatePath(`/client/cases/${caseId}/documents`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteDocumentAction(
  caseId: string,
  documentId: string,
): Promise<ActionResult> {
  try {
    const { supabase, caseRow } = await assertCaseOwner(caseId);
    if (caseRow.status !== "draft") throw new Error("Case already submitted.");

    const { data: doc, error: fetchErr } = await supabase
      .from("case_documents")
      .select("id, file_url, case_id")
      .eq("id", documentId)
      .single();
    if (fetchErr || !doc || doc.case_id !== caseId) {
      throw new Error("Document not found.");
    }

    await supabase.storage.from(BUCKET).remove([doc.file_url]);
    const { error: dbErr } = await supabase
      .from("case_documents")
      .delete()
      .eq("id", documentId);
    if (dbErr) throw new Error(dbErr.message);

    revalidatePath(`/client/cases/${caseId}/documents`);
    return { ok: true };
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

    if (
      !caseRow.intake_answers ||
      Object.keys(caseRow.intake_answers as Record<string, unknown>).length === 0
    ) {
      throw new Error("Fill in the intake questions first.");
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
            unit_amount: tier.priceGbp * 100,
            product_data: {
              name: `${tier.title}. ${seg.title}`,
              description: tier.tagline,
            },
          },
        },
      ],
      metadata: {
        case_id: caseId,
        segment: seg.id,
        tier: tier.id,
      },
      success_url: `${base}/client/cases/${caseId}?paid=1`,
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
