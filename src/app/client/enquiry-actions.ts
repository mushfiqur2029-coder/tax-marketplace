"use server";

import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, fail } from "@/lib/action-result";
import { getTier } from "@/lib/service-catalog";
import { insertEnquiryStatusNotification } from "@/lib/notifications";

// Shape mirrors the CompanyLookup widget's CompanyPick + the three
// contact fields on the enquiry form. company_status is nullable in
// the DB; passing "unknown" (manual entry) or an actual status pill
// from Companies House both work.
export type ServiceEnquiryInput = {
  serviceKey: string;
  companyName: string;
  companyNumber: string;
  companyStatus: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
};

const COMPANY_NUMBER_RE = /^(?:\d{8}|[A-Za-z]{2}\d{6})$/;
// Light shape check. Keeps the server honest without being so strict
// that a real address like "user+tag@sub.example.co.uk" bounces.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function submitServiceEnquiryAction(
  input: ServiceEnquiryInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const me = await requireRole("client");

    const tier = await getTier(input.serviceKey);
    if (!tier || !tier.requiresEnquiry) {
      throw new Error(
        "Unknown service. This enquiry form only accepts bespoke tiers.",
      );
    }

    const companyName = input.companyName.trim();
    const companyNumber = input.companyNumber.trim().toUpperCase();
    const contactName = input.contactName.trim();
    const contactEmail = input.contactEmail.trim();
    const contactPhone = input.contactPhone.trim();
    const companyStatus = (input.companyStatus ?? "unknown").trim() || "unknown";

    if (!companyName) throw new Error("Enter the company name.");
    if (!COMPANY_NUMBER_RE.test(companyNumber)) {
      throw new Error(
        "Company number must be 8 digits, or 2 letters followed by 6 digits (e.g. SC123456).",
      );
    }
    if (!contactName) throw new Error("Enter the contact name.");
    if (!EMAIL_RE.test(contactEmail)) {
      throw new Error("Enter a valid contact email.");
    }
    if (!contactPhone) throw new Error("Enter a contact phone number.");

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("service_enquiries")
      .insert({
        client_id: me.id,
        service_key: input.serviceKey,
        company_name: companyName,
        company_number: companyNumber,
        company_status: companyStatus,
        contact_name: contactName,
        contact_email: contactEmail,
        contact_phone: contactPhone,
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? "Could not submit enquiry.");
    }

    // Admin notifications fan out via the DB trigger
    // (0043_service_enquiries.sql → notify_service_enquiry). No extra
    // client-side fanout needed; keeps the server action thin.
    return { ok: true, data: { id: data.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function setServiceEnquiryStatusAction(
  id: string,
  status: "new" | "contacted" | "closed",
  notes: string | null,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const supabase = await createClient();

    // Capture the previous status + context in one round-trip. Needed for
    // the client-facing notification: we only fire on an actual transition
    // (admin re-saving contacted → contacted shouldn't spam the client),
    // and we need the service_key + client_id to compose the message.
    const admin = createAdminClient();
    const { data: prev } = await admin
      .from("service_enquiries")
      .select("id, status, client_id, service_key")
      .eq("id", id)
      .maybeSingle<{
        id: string;
        status: "new" | "contacted" | "closed";
        client_id: string;
        service_key: string;
      }>();

    const { data, error } = await supabase
      .from("service_enquiries")
      .update({
        status,
        // Admin notes are append-only in the UI, but the API accepts a
        // full replace — the admin page keeps the previous note in the
        // textarea so the admin can decide whether to extend or wipe.
        admin_notes: notes,
      })
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      throw new Error("Enquiry not found or no rows updated.");
    }

    // Only notify the client on actual transitions INTO contacted or
    // closed. Best-effort — a failed notification doesn't roll back the
    // status change (admin's save would be broken for a UI-only
    // concern).
    if (
      prev &&
      prev.status !== status &&
      (status === "contacted" || status === "closed")
    ) {
      const tier = await getTier(prev.service_key);
      await insertEnquiryStatusNotification({
        clientId: prev.client_id,
        status,
        serviceLabel: tier?.title ?? "bespoke",
      }).catch((err) => {
        console.error("[enquiry status notification] failed:", err);
      });
    }

    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
