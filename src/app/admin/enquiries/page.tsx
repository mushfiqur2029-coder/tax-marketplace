import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { getAllTiers } from "@/lib/service-catalog";
import { setServiceEnquiryStatusAction } from "@/app/client/enquiry-actions";
import { createBespokeCaseFromEnquiryAction } from "@/app/admin/actions";
import type { UpcomingBookingView } from "@/components/booking/upcoming-call-card";
import {
  AdminEnquiriesLive,
  type BespokeCaseLink,
  type EnquiryRow,
} from "./admin-enquiries-live";

export const dynamic = "force-dynamic";

export default async function AdminEnquiriesPage() {
  await requireRole("admin");
  const admin = createAdminClient();

  const { data: rows } = await admin
    .from("service_enquiries")
    .select(
      "id, client_id, service_key, company_name, company_number, company_status, contact_name, contact_email, contact_phone, status, admin_notes, created_at, updated_at",
    )
    .order("created_at", { ascending: false });

  const all = (rows ?? []) as EnquiryRow[];

  const clientIds = Array.from(new Set(all.map((r) => r.client_id)));
  const { data: users } = clientIds.length
    ? await admin.from("users").select("id, email").in("id", clientIds)
    : { data: [] as { id: string; email: string }[] };
  const emailById: Record<string, string> = Object.fromEntries(
    (users ?? []).map((u) => [u.id, u.email as string]),
  );

  // Pre-fetch tier titles so the client renderer can look them up by
  // service_key without a server round trip. New enquiries that come
  // in via realtime fall back to the key if their tier wasn't in this
  // list; today only one tier is enquiry-only so coverage is full.
  const tiers = await getAllTiers();
  const tierTitleByKey: Record<string, string> = Object.fromEntries(
    tiers.map((t) => [t.id, t.title]),
  );

  const { data: approvedAccs } = await admin
    .from("accountant_profiles")
    .select("user_id, name")
    .eq("approval_status", "approved");
  const accIds = (approvedAccs ?? []).map((a) => a.user_id);
  const { data: accUsers } = accIds.length
    ? await admin.from("users").select("id, email").in("id", accIds)
    : { data: [] as { id: string; email: string }[] };
  const accEmailById = new Map((accUsers ?? []).map((u) => [u.id, u.email]));
  const accountants = (approvedAccs ?? [])
    .map((a) => ({
      id: a.user_id as string,
      name: a.name as string | null,
      email: accEmailById.get(a.user_id as string) ?? "",
    }))
    .filter((a) => !!a.email)
    .sort((a, b) =>
      (a.name?.trim() || a.email).localeCompare(b.name?.trim() || b.email),
    );

  const bespokeEnquiryIds = all
    .filter((r) => r.service_key === "vat_plus_accounts_200k")
    .map((r) => r.id);
  const { data: bespokeCases } = bespokeEnquiryIds.length
    ? await admin
        .from("cases")
        .select("id, service_enquiry_id, custom_fee_pence")
        .in("service_enquiry_id", bespokeEnquiryIds)
    : { data: [] as { id: string; service_enquiry_id: string; custom_fee_pence: number }[] };
  const caseByEnquiryId: Record<string, BespokeCaseLink> = Object.fromEntries(
    (bespokeCases ?? []).map((c) => [
      c.service_enquiry_id as string,
      { id: c.id as string, custom_fee_pence: Number(c.custom_fee_pence ?? 0) },
    ]),
  );

  const enquiryIds = all.map((r) => r.id);
  const { data: bookingRows } = enquiryIds.length
    ? await admin
        .from("bookings")
        .select(
          "id, service_enquiry_id, starts_at, ends_at, duration_minutes, meet_link, service_label, status",
        )
        .in("service_enquiry_id", enquiryIds)
        .order("starts_at", { ascending: true })
    : {
        data: [] as Array<{
          id: string;
          service_enquiry_id: string;
          starts_at: string;
          ends_at: string;
          duration_minutes: number;
          meet_link: string | null;
          service_label: string | null;
          status: string;
        }>,
      };
  const bookingByEnquiryId: Record<string, UpcomingBookingView> = {};
  for (const b of bookingRows ?? []) {
    if (b.status !== "confirmed") continue;
    const existing = bookingByEnquiryId[b.service_enquiry_id];
    if (
      !existing ||
      new Date(b.starts_at).getTime() > new Date(existing.starts_at).getTime()
    ) {
      bookingByEnquiryId[b.service_enquiry_id] = b;
    }
  }

  const setStatus = async (
    id: string,
    status: "new" | "contacted" | "closed",
    notes: string | null,
  ) => {
    "use server";
    return setServiceEnquiryStatusAction(id, status, notes);
  };
  const createCase = async (
    enquiryId: string,
    feeGbp: number,
    depositGbp: number,
    commissionGbp: number,
    accountantId: string,
    note: string | null,
  ) => {
    "use server";
    return createBespokeCaseFromEnquiryAction(
      enquiryId,
      feeGbp,
      depositGbp,
      commissionGbp,
      accountantId,
      note,
    );
  };

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="Service enquiries"
        description="Pre-sales leads from the Limited Company bespoke tier. Follow up quickly. Real potential clients waiting on a human reply."
      />
      <AdminEnquiriesLive
        initial={all}
        emailById={emailById}
        tierTitleByKey={tierTitleByKey}
        caseByEnquiryId={caseByEnquiryId}
        bookingByEnquiryId={bookingByEnquiryId}
        accountants={accountants}
        setStatus={setStatus}
        createCase={createCase}
      />
    </>
  );
}
