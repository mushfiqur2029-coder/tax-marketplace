import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { formatDateTime } from "@/lib/format";
import { getTier } from "@/lib/service-catalog";
import { setServiceEnquiryStatusAction } from "@/app/client/enquiry-actions";
import { createBespokeCaseFromEnquiryAction } from "@/app/admin/actions";
import { EnquiryActions } from "./enquiry-actions";
import {
  BespokeCaseForm,
  BespokeCaseExistingLink,
} from "./bespoke-case-form";
import {
  UpcomingCallCard,
  type UpcomingBookingView,
} from "@/components/booking/upcoming-call-card";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  client_id: string;
  service_key: string;
  company_name: string;
  company_number: string;
  company_status: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  status: "new" | "contacted" | "closed";
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
};

export default async function AdminEnquiriesPage() {
  await requireRole("admin");
  const admin = createAdminClient();

  const { data: rows } = await admin
    .from("service_enquiries")
    .select(
      "id, client_id, service_key, company_name, company_number, company_status, contact_name, contact_email, contact_phone, status, admin_notes, created_at, updated_at",
    )
    .order("created_at", { ascending: false });

  const all = (rows ?? []) as Row[];

  // Look up submitter emails for the "submitted by" line. Rare enough
  // table to keep this join client-side (admin page, low traffic).
  const clientIds = Array.from(new Set(all.map((r) => r.client_id)));
  const { data: users } = clientIds.length
    ? await admin.from("users").select("id, email").in("id", clientIds)
    : { data: [] as { id: string; email: string }[] };
  const emailById = new Map((users ?? []).map((u) => [u.id, u.email]));

  // Approved accountants for the "create case" dropdown. Join names from
  // accountant_profiles so the admin picks by human name rather than email.
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

  // Existing bespoke-case links so we hide the create form on
  // enquiries that have already been quoted. Query only on enquiries
  // that are the bespoke tier — others never become cases.
  const bespokeEnquiryIds = all
    .filter((r) => r.service_key === "vat_plus_accounts_200k")
    .map((r) => r.id);
  const { data: bespokeCases } = bespokeEnquiryIds.length
    ? await admin
        .from("cases")
        .select("id, service_enquiry_id, custom_fee_pence")
        .in("service_enquiry_id", bespokeEnquiryIds)
    : { data: [] as { id: string; service_enquiry_id: string; custom_fee_pence: number }[] };
  const caseByEnquiryId = new Map(
    (bespokeCases ?? []).map((c) => [c.service_enquiry_id, c]),
  );

  // Pull every booking linked to any of these enquiries. Service-role
  // bypasses the client-scoped RLS; admin needs to see the same
  // meet_link the client sees so they aren't left digging through
  // Google Calendar for the Meet URL.
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
  // Index latest confirmed booking per enquiry so repeated bookings
  // (rebooks after a cancellation) show the current one.
  const bookingByEnquiryId = new Map<string, UpcomingBookingView>();
  for (const b of bookingRows ?? []) {
    if (b.status !== "confirmed") continue;
    const existing = bookingByEnquiryId.get(b.service_enquiry_id);
    if (
      !existing ||
      new Date(b.starts_at).getTime() > new Date(existing.starts_at).getTime()
    ) {
      bookingByEnquiryId.set(b.service_enquiry_id, b);
    }
  }

  const groups = {
    new: all.filter((r) => r.status === "new"),
    contacted: all.filter((r) => r.status === "contacted"),
    closed: all.filter((r) => r.status === "closed"),
  };

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
    accountantId: string,
    note: string | null,
  ) => {
    "use server";
    return createBespokeCaseFromEnquiryAction(
      enquiryId,
      feeGbp,
      accountantId,
      note,
    );
  };

  return (
    <>
      <RealtimeRefresh
        channel="admin-enquiries"
        subscriptions={[
          { table: "service_enquiries" },
          // Admins need the join link to appear the moment a client
          // completes the booking flow — matching the live-update
          // behaviour already in place on the client dashboard.
          { table: "bookings" },
        ]}
      />
      <AdminPageHeader
        eyebrow="Admin console"
        title="Service enquiries"
        description="Pre-sales leads from the Limited Company bespoke tier. Follow up quickly. Real potential clients waiting on a human reply."
      />
      <Section
        title={`New (${groups.new.length})`}
        emptyLine="No new enquiries. The badge next to Enquiries in the nav turns on when one lands."
      >
        {groups.new.map((r) => (
          <EnquiryCard
            key={r.id}
            row={r}
            submittedByEmail={emailById.get(r.client_id) ?? null}
            accountants={accountants}
            existingCase={caseByEnquiryId.get(r.id) ?? null}
            booking={bookingByEnquiryId.get(r.id) ?? null}
            setStatus={setStatus}
            createCase={createCase}
          />
        ))}
      </Section>

      {groups.contacted.length > 0 ? (
        <Section title={`Contacted (${groups.contacted.length})`} emptyLine="">
          {groups.contacted.map((r) => (
            <EnquiryCard
              key={r.id}
              row={r}
              submittedByEmail={emailById.get(r.client_id) ?? null}
              accountants={accountants}
              existingCase={caseByEnquiryId.get(r.id) ?? null}
              booking={bookingByEnquiryId.get(r.id) ?? null}
              setStatus={setStatus}
              createCase={createCase}
            />
          ))}
        </Section>
      ) : null}

      {groups.closed.length > 0 ? (
        <Section title={`Closed (${groups.closed.length})`} emptyLine="">
          {groups.closed.map((r) => (
            <EnquiryCard
              key={r.id}
              row={r}
              submittedByEmail={emailById.get(r.client_id) ?? null}
              accountants={accountants}
              existingCase={caseByEnquiryId.get(r.id) ?? null}
              booking={bookingByEnquiryId.get(r.id) ?? null}
              setStatus={setStatus}
              createCase={createCase}
            />
          ))}
        </Section>
      ) : null}
    </>
  );
}

function Section({
  title,
  emptyLine,
  children,
}: {
  title: string;
  emptyLine: string;
  children: React.ReactNode;
}) {
  const childArr = Array.isArray(children) ? children : [children];
  const hasAny = childArr.filter(Boolean).length > 0;
  return (
    <section className="mb-10">
      <h2
        className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {title}
      </h2>
      {hasAny ? (
        <ul className="grid gap-3">{childArr}</ul>
      ) : emptyLine ? (
        <p className="card-sl border-dashed p-6 text-center text-sm text-slate">
          {emptyLine}
        </p>
      ) : null}
    </section>
  );
}

async function EnquiryCard({
  row,
  submittedByEmail,
  accountants,
  existingCase,
  booking,
  setStatus,
  createCase,
}: {
  row: Row;
  submittedByEmail: string | null;
  accountants: { id: string; name: string | null; email: string }[];
  existingCase: { id: string; custom_fee_pence: number } | null;
  booking: UpcomingBookingView | null;
  setStatus: (
    id: string,
    status: "new" | "contacted" | "closed",
    notes: string | null,
  ) => Promise<import("@/lib/action-result").ActionResult>;
  createCase: (
    enquiryId: string,
    feeGbp: number,
    accountantId: string,
    note: string | null,
  ) => Promise<import("@/lib/action-result").ActionResult<{ caseId: string }>>;
}) {
  const tier = await getTier(row.service_key);
  const serviceLabel = tier?.title ?? row.service_key;
  // Only the bespoke tier gets the "create case" form. Other enquiry
  // tiers (there is only this one today, but the catalogue could grow)
  // use the status actions only.
  const supportsBespoke = row.service_key === "vat_plus_accounts_200k";
  return (
    <li>
      <div className="card-sl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-ink">
                {row.company_name}
              </span>
              <span
                className="rounded bg-cloud px-1.5 py-0.5 text-[11px] font-semibold text-ink"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {row.company_number}
              </span>
              <StatusPill status={row.status} />
              {row.company_status &&
              row.company_status.toLowerCase() !== "active" &&
              row.company_status.toLowerCase() !== "unknown" ? (
                <CompanyStatusPill status={row.company_status} />
              ) : null}
            </div>
            <p
              className="mt-1 text-[11px] uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {serviceLabel}
            </p>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-slate">Contact</dt>
              <dd className="text-ink">{row.contact_name}</dd>
              <dt className="text-slate">Email</dt>
              <dd className="text-ink">
                <a
                  href={`mailto:${row.contact_email}`}
                  className="font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
                >
                  {row.contact_email}
                </a>
              </dd>
              <dt className="text-slate">Phone</dt>
              <dd className="text-ink">
                <a
                  href={`tel:${row.contact_phone.replace(/\s+/g, "")}`}
                  className="font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
                >
                  {row.contact_phone}
                </a>
              </dd>
              <dt className="text-slate">Submitted</dt>
              <dd className="text-ink">
                {formatDateTime(row.created_at)}
                {submittedByEmail ? (
                  <span className="ml-1 text-xs text-slate">
                    · by {submittedByEmail}
                  </span>
                ) : null}
              </dd>
              {row.updated_at && row.updated_at !== row.created_at ? (
                <>
                  <dt className="text-slate">Last update</dt>
                  <dd className="text-ink">{formatDateTime(row.updated_at)}</dd>
                </>
              ) : null}
            </dl>
          </div>
        </div>

        {booking ? (
          <div className="mt-4">
            <h4
              className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Scoping call booked
            </h4>
            <UpcomingCallCard
              booking={booking}
              headline={`Call with ${row.contact_name}`}
            />
          </div>
        ) : null}

        <EnquiryActions
          id={row.id}
          status={row.status}
          initialNotes={row.admin_notes ?? ""}
          setStatus={setStatus}
        />

        {supportsBespoke ? (
          existingCase ? (
            <BespokeCaseExistingLink
              caseId={existingCase.id}
              feePence={existingCase.custom_fee_pence}
            />
          ) : (
            <BespokeCaseForm
              enquiryId={row.id}
              accountants={accountants}
              createCase={createCase}
            />
          )
        ) : null}
      </div>
    </li>
  );
}

function StatusPill({ status }: { status: "new" | "contacted" | "closed" }) {
  const map = {
    new: { label: "New", bg: "rgba(25,156,217,0.14)", color: "#0A6B99" },
    contacted: {
      label: "Contacted",
      bg: "rgba(217,159,25,0.14)",
      color: "#8a5c05",
    },
    closed: {
      label: "Closed",
      bg: "rgba(15,30,77,0.08)",
      color: "var(--navy-deep)",
    },
  }[status];
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
      style={{
        background: map.bg,
        color: map.color,
        fontFamily: "var(--font-mono)",
      }}
    >
      {map.label}
    </span>
  );
}

function CompanyStatusPill({ status }: { status: string }) {
  const label = status
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
      style={{
        background: "rgba(220,38,38,0.10)",
        color: "#B91C1C",
        fontFamily: "var(--font-mono)",
      }}
      title="Companies House status"
    >
      Co · {label}
    </span>
  );
}
