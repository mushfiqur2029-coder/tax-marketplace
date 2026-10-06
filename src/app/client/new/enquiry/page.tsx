import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PortalPageHeader } from "@/components/portal-page-header";
import { ClientSuspensionBanner } from "@/app/client/suspension-banner";
import { getTier } from "@/lib/plans";
import { submitServiceEnquiryAction } from "@/app/client/enquiry-actions";
import { EnquiryForm } from "./enquiry-form";

export const dynamic = "force-dynamic";

export default async function ClientEnquiryPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string }>;
}) {
  const { service } = await searchParams;
  const me = await requireRole("client");

  // The enquiry form only accepts bespoke tiers. Anything else routes
  // back to /client/new where the normal picker runs — avoids the
  // enquiry form becoming an alternative entry point for flat-fee
  // tiers (and the server action would reject the submit anyway).
  const tier = getTier(service ?? null);
  if (!tier || !tier.requiresEnquiry) {
    redirect("/client/new");
  }

  // Pre-fill contact details from the client's profile. The enquirer
  // can edit each one — the person inside the company who wants the
  // service isn't always the one who set up the Sterling Ledger
  // account.
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("client_profiles")
    .select("name, contact_number")
    .eq("user_id", me.id)
    .maybeSingle();

  const defaultContactName = (profile?.name ?? me.name ?? "").trim();
  const defaultContactEmail = me.email;
  const defaultContactPhone = (profile?.contact_number ?? "").trim();

  return (
    <>
      <PortalPageHeader
        eyebrow="Limited Company"
        title={tier.title}
        description="Bespoke engagement. Tell us about your company and we'll book a scoping call."
      />
      <ClientSuspensionBanner />
      <EnquiryForm
        serviceKey={tier.id}
        serviceTitle={tier.title}
        defaultContactName={defaultContactName}
        defaultContactEmail={defaultContactEmail}
        defaultContactPhone={defaultContactPhone}
        bookingUrl={process.env.GOOGLE_CALENDAR_BOOKING_URL ?? null}
        submit={submitServiceEnquiryAction}
      />

      <div className="mt-10">
        <Link
          href="/client/new"
          className="text-sm font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
        >
          ← Back to service picker
        </Link>
      </div>
    </>
  );
}
