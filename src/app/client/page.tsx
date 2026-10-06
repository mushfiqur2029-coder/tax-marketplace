import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSegment } from "@/lib/segments";
import { getAllTiers, getTier } from "@/lib/service-catalog";
import { effectiveFeePence, formatFeeGbp } from "@/lib/case/pricing";
import { companyNameFromAnswers } from "@/lib/case/company-label";
import { PortalPageHeader } from "@/components/portal-page-header";
import { EmptyState } from "@/components/empty-state";
import { SLLink } from "@/components/sl-button";
import { StatusPill } from "@/components/case/status-pill";
import { DeadlinePill } from "@/components/case/deadline-pill";
import { UrgentPill } from "@/components/case/urgent-pill";
import { formatDate } from "@/lib/format";
import { ClientCasesFilter, type ClientCaseCounts } from "./client-cases-filter";
import { ClientSuspensionBanner } from "./suspension-banner";
import { RealtimeRefresh } from "@/components/realtime-refresh";

export const dynamic = "force-dynamic";

type View = "in_progress" | "completed" | "pending";

const IN_PROGRESS = new Set([
  "submitted",
  "in_review",
  "prepared",
  "client_approval",
  "filed",
]);

export default async function ClientDashboard({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view: viewRaw } = await searchParams;
  const view: View =
    viewRaw === "completed" || viewRaw === "pending" ? viewRaw : "in_progress";

  const me = await requireRole("client");
  const supabase = await createClient();
  const [
    { data: cases },
    { data: upcomingBookingsRaw },
    { data: enquiries },
    { data: allBookings },
  ] = await Promise.all([
    supabase
      .from("cases")
      .select(
        "id, segment, tier, status, stripe_payment_status, created_at, submitted_at, deadline, is_urgent, intake_answers, custom_fee_pence, service_enquiry_id",
      )
      .eq("client_id", me.id)
      .order("created_at", { ascending: false }),
    // Upcoming confirmed calls, ordered soonest first. RLS limits to
    // the signed-in client; the dashboard surfaces these in a card
    // above the cases list so the booking survives page reloads
    // (not just the one-off confirmation screen right after booking).
    supabase
      .from("bookings")
      .select(
        "id, starts_at, ends_at, duration_minutes, meet_link, service_label, status, service_enquiry_id",
      )
      .eq("client_id", me.id)
      .eq("status", "confirmed")
      .gte("ends_at", new Date().toISOString())
      .order("starts_at", { ascending: true }),
    // All enquiries this client has filed. Lives in a dedicated section
    // below cases so the client can see the status of their bespoke
    // leads — including closed/quoted outcomes. RLS limits to the
    // signed-in client via service_enquiries_client_select.
    supabase
      .from("service_enquiries")
      .select(
        "id, service_key, company_name, company_number, status, created_at, updated_at",
      )
      .eq("client_id", me.id)
      .order("created_at", { ascending: false }),
    // Every booking (not just upcoming) so the enquiries list can show
    // the attached scoping-call info regardless of whether it's in the
    // future or already happened.
    supabase
      .from("bookings")
      .select(
        "id, service_enquiry_id, starts_at, ends_at, duration_minutes, meet_link, service_label, status",
      )
      .eq("client_id", me.id)
      .order("starts_at", { ascending: true }),
  ]);

  const all = cases ?? [];
  const filtered = all.filter((c) => {
    if (view === "completed") return c.status === "complete";
    if (view === "pending") return c.status === "draft";
    return IN_PROGRESS.has(c.status);
  });

  const counts: ClientCaseCounts = {
    in_progress: all.filter((c) => IN_PROGRESS.has(c.status)).length,
    completed: all.filter((c) => c.status === "complete").length,
    pending: all.filter((c) => c.status === "draft").length,
  };

  const tierMap = new Map(
    (
      await getAllTiers({ includeInactive: true, includeAdminCreateOnly: true })
    ).map((t) => [t.id as string, t]),
  );

  // Index enquiries by id so bookings can resolve "is this enquiry
  // closed?" without a per-row DB round-trip. Index cases the same way
  // so quoted enquiries can render a "View case" shortcut.
  const enquiriesList = enquiries ?? [];
  const enquiryById = new Map(enquiriesList.map((e) => [e.id, e]));
  const caseByEnquiryId = new Map(
    (cases ?? [])
      .filter((c) => c.service_enquiry_id)
      .map((c) => [c.service_enquiry_id as string, c]),
  );
  const bookingsByEnquiryId = new Map<string, typeof allBookings>();
  for (const b of allBookings ?? []) {
    if (!b.service_enquiry_id) continue;
    const arr = bookingsByEnquiryId.get(b.service_enquiry_id) ?? [];
    arr.push(b);
    bookingsByEnquiryId.set(b.service_enquiry_id, arr);
  }

  // Upcoming calls: hide any booking whose linked enquiry is closed,
  // so the dashboard matches the admin-side state. Bookings without a
  // linked enquiry (future support-call flows) stay visible.
  const upcomingBookings = (upcomingBookingsRaw ?? []).filter((b) => {
    if (!b.service_enquiry_id) return true;
    const enq = enquiryById.get(b.service_enquiry_id);
    if (!enq) return true;
    return enq.status !== "closed";
  });

  // Resolve service_key -> readable title once per unique key. Admin
  // can edit catalog titles so we can't hard-code these; falling back
  // to the raw key keeps retired tiers rendering sensibly.
  const uniqueServiceKeys = Array.from(
    new Set(enquiriesList.map((e) => e.service_key)),
  );
  const enquiryTierTitles = new Map(
    await Promise.all(
      uniqueServiceKeys.map(
        async (k) => [k, (await getTier(k))?.title ?? k] as const,
      ),
    ),
  );

  return (
    <>
      <PortalPageHeader
        eyebrow="Client workspace"
        title="Your tax returns"
        description="Track the status of your filings and chat with your accountant."
      />
      <ClientSuspensionBanner />
      <RealtimeRefresh
        channel={`client-dashboard-${me.id}`}
        subscriptions={[
          { table: "cases", filter: `client_id=eq.${me.id}` },
          // Covers add-on paid updates (status flip) so the "Payment required" badge disappears live.
          { table: "case_addons" },
          // Bookings for the upcoming-calls section; booking in a
          // second tab or admin cancelling updates the first tab
          // without a reload.
          { table: "bookings", filter: `client_id=eq.${me.id}` },
          // Enquiries: when admin flips the status (contacted / closed
          // / converted-to-case) the upcoming-calls section hides any
          // associated booking and the Enquiries history re-renders
          // without a reload.
          { table: "service_enquiries", filter: `client_id=eq.${me.id}` },
        ]}
      />

      <UpcomingCalls bookings={upcomingBookings} />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <ClientCasesFilter active={view} counts={counts} />
        {me.status !== "suspended" ? (
          <SLLink href="/client/new" variant="primary">
            Start a new return
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M4 10h12M11 5l5 5-5 5" />
            </svg>
          </SLLink>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={
            all.length === 0
              ? "Your cases will appear here."
              : `Nothing ${view === "in_progress" ? "in progress" : view === "pending" ? "pending" : "completed"} right now.`
          }
          hint={
            all.length === 0
              ? "Click Start a new return above. Answer a few questions, upload documents, and pay to submit."
              : "Switch tabs above to see cases in other states."
          }
        />
      ) : (
        <ul className="grid gap-3" data-dashboard-cases>
          {filtered.map((c) => {
            const seg = getSegment(c.segment);
            const tier = tierMap.get(c.tier) ?? null;
            const companyName = companyNameFromAnswers(
              c.intake_answers,
              c.segment,
            );
            return (
              <li key={c.id}>
                <Link
                  href={`/client/cases/${c.id}`}
                  className="card-sl group flex items-center gap-4 p-5 transition hover:border-sky/40 hover:-translate-y-0.5"
                >
                  <div
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white text-lg"
                    style={{
                      background:
                        "linear-gradient(135deg, var(--navy), var(--sky))",
                    }}
                    aria-hidden="true"
                  >
                    {seg?.numeral ?? "•"}
                  </div>
                  <div className="min-w-0 flex-1">
                    {companyName ? (
                      <div className="truncate text-sm font-semibold text-ink">
                        {companyName}
                      </div>
                    ) : null}
                    <div
                      className={
                        "flex flex-wrap items-center gap-2 " +
                        (companyName ? "mt-0.5" : "")
                      }
                    >
                      <span
                        className={
                          companyName
                            ? "text-xs text-slate"
                            : "text-sm font-semibold text-ink"
                        }
                      >
                        {seg?.title ?? c.segment}
                      </span>
                      <span className="text-xs text-slate">·</span>
                      <span className="text-xs text-slate">
                        {tier?.title ?? c.tier} · {formatFeeGbp(effectiveFeePence(c, tier))}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate">
                      Started {formatDate(c.created_at)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusPill status={c.status} />
                    {c.is_urgent ? <UrgentPill size="sm" /> : null}
                    {c.deadline ? (
                      <DeadlinePill deadline={c.deadline} size="sm" />
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <EnquiriesHistory
        enquiries={enquiriesList.map((e) => ({
          id: e.id,
          serviceLabel:
            enquiryTierTitles.get(e.service_key) ?? e.service_key,
          companyName: e.company_name,
          companyNumber: e.company_number,
          status: e.status,
          createdAt: e.created_at,
          updatedAt: e.updated_at,
          caseId: caseByEnquiryId.get(e.id)?.id ?? null,
          bookings: (bookingsByEnquiryId.get(e.id) ?? []).map((b) => ({
            id: b.id,
            startsAt: b.starts_at,
            durationMinutes: b.duration_minutes,
            meetLink: b.meet_link,
            status: b.status,
          })),
        }))}
      />
    </>
  );
}

type UpcomingBooking = {
  id: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  meet_link: string | null;
  service_label: string | null;
  status: string;
};

// Surfaces any confirmed, future bookings for the signed-in client.
// Hidden entirely when the client has no upcoming calls so the dashboard
// stays uncluttered on the typical "no scoping call booked" state.
function UpcomingCalls({ bookings }: { bookings: UpcomingBooking[] }) {
  if (bookings.length === 0) return null;
  return (
    <section className="mb-6">
      <h2
        className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Upcoming calls
      </h2>
      <ul className="grid gap-3">
        {bookings.map((b) => (
          <li key={b.id}>
            <UpcomingCallCard booking={b} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function UpcomingCallCard({ booking }: { booking: UpcomingBooking }) {
  const start = new Date(booking.starts_at);
  const dateLong = start.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(start);
  const dayNum = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
  }).format(start);
  const monthShort = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    month: "short",
  }).format(start);
  const dayShort = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
  }).format(start);

  return (
    <div className="card-sl flex items-center gap-4 p-5">
      <div
        className="relative shrink-0 flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-xl text-white"
        style={{
          background: "linear-gradient(135deg, var(--navy), var(--sky))",
        }}
        aria-hidden="true"
      >
        <span
          className="text-[10px] font-semibold uppercase tracking-widest text-white/85"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {dayShort}
        </span>
        <span
          className="text-xl font-bold leading-none"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {dayNum}
        </span>
        <span
          className="text-[10px] uppercase tracking-widest text-white/85"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {monthShort}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div
          className="text-base font-semibold text-ink sm:text-lg"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Your call is booked for {dateLong} at {time}.
        </div>
        <div className="mt-1 text-xs text-slate">
          <strong className="text-ink">{booking.duration_minutes} min</strong>
          {booking.service_label ? ` · ${booking.service_label}` : null}
        </div>
      </div>
      {booking.meet_link ? (
        <a
          href={booking.meet_link}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-full bg-navy-deep px-4 py-2 text-xs font-semibold text-white transition hover:opacity-90"
        >
          Join call
        </a>
      ) : null}
    </div>
  );
}

// Enquiries history. Rendered below the cases list so the main
// dashboard surface stays focused on live cases while giving the
// client a durable record of every bespoke lead they've filed —
// what Sterling Ledger did with it, and the scoping-call booking
// (if any) that went with it.
type EnquiryHistoryItem = {
  id: string;
  serviceLabel: string;
  companyName: string;
  companyNumber: string;
  status: "new" | "contacted" | "closed";
  createdAt: string;
  updatedAt: string;
  caseId: string | null;
  bookings: Array<{
    id: string;
    startsAt: string;
    durationMinutes: number;
    meetLink: string | null;
    status: string;
  }>;
};

function EnquiriesHistory({ enquiries }: { enquiries: EnquiryHistoryItem[] }) {
  if (enquiries.length === 0) return null;
  return (
    <section className="mt-10">
      <h2
        className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Enquiries ({enquiries.length})
      </h2>
      <p className="mb-3 text-xs text-slate">
        Bespoke enquiries you&rsquo;ve filed. Updates here when Sterling
        Ledger picks one up, closes it, or turns it into a priced case.
      </p>
      <ul className="grid gap-3">
        {enquiries.map((e) => (
          <li key={e.id}>
            <EnquiryHistoryRow enquiry={e} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function EnquiryHistoryRow({ enquiry }: { enquiry: EnquiryHistoryItem }) {
  // Admin's close-and-convert flow leaves the enquiry at status
  // 'closed' AND populates a case. Render that outcome distinctly
  // from a plain "closed, no action" so the client sees it as a win.
  const outcome: "new" | "contacted" | "closed" | "quoted" =
    enquiry.caseId && enquiry.status === "closed" ? "quoted" : enquiry.status;

  const upcomingBookings = enquiry.bookings
    .filter((b) => b.status === "confirmed" && new Date(b.startsAt) >= new Date())
    .sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    );
  const pastBookings = enquiry.bookings
    .filter((b) => !(b.status === "confirmed" && new Date(b.startsAt) >= new Date()))
    .sort(
      (a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime(),
    );
  // Scoping-call reference most relevant to the current enquiry
  // state: upcoming while live, otherwise the most recent past one.
  const activeBooking =
    outcome === "closed" || outcome === "quoted"
      ? pastBookings[0] ?? null
      : upcomingBookings[0] ?? pastBookings[0] ?? null;

  const createdLabel = formatDate(enquiry.createdAt);
  const updatedLabel = formatDate(enquiry.updatedAt);
  const movedAt =
    enquiry.updatedAt !== enquiry.createdAt ? updatedLabel : null;

  return (
    <div className="card-sl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink">
            {enquiry.companyName}
            <span className="ml-2 text-xs font-normal text-slate">
              ({enquiry.companyNumber})
            </span>
          </div>
          <div className="mt-0.5 text-xs text-slate">
            {enquiry.serviceLabel}
          </div>
          <div className="mt-1 text-[11px] text-slate">
            Filed {createdLabel}
            {movedAt ? ` · Last update ${movedAt}` : null}
          </div>
        </div>
        <EnquiryStatusPill outcome={outcome} />
      </div>

      {activeBooking ? (
        <div className="mt-3 rounded-lg border border-line bg-paper px-3 py-2 text-xs text-slate">
          Scoping call:{" "}
          <strong className="text-ink">
            {new Date(activeBooking.startsAt).toLocaleString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
              timeZone: "Europe/London",
            })}
          </strong>{" "}
          · {activeBooking.durationMinutes} min
          {outcome === "closed" || outcome === "quoted"
            ? " · (call archived)"
            : null}
          {activeBooking.meetLink &&
          outcome !== "closed" &&
          outcome !== "quoted" ? (
            <>
              {" · "}
              <a
                href={activeBooking.meetLink}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-navy-deep underline underline-offset-2 hover:text-sky"
              >
                Join
              </a>
            </>
          ) : null}
        </div>
      ) : null}

      {outcome === "quoted" && enquiry.caseId ? (
        <div className="mt-3">
          <Link
            href={`/client/cases/${enquiry.caseId}`}
            className="inline-flex items-center gap-1 rounded-full bg-navy-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
          >
            Open your case
            <svg
              width="12"
              height="12"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 10h12M11 5l5 5-5 5" />
            </svg>
          </Link>
        </div>
      ) : null}

      {outcome === "closed" ? (
        <p className="mt-3 text-[11px] text-slate">
          If this closed in error, reply to our last email and we&rsquo;ll
          take another look.
        </p>
      ) : null}
    </div>
  );
}

function EnquiryStatusPill({
  outcome,
}: {
  outcome: "new" | "contacted" | "closed" | "quoted";
}) {
  const styles: Record<typeof outcome, { bg: string; fg: string; label: string }> = {
    new: {
      bg: "rgba(25,156,217,0.14)",
      fg: "#1472A6",
      label: "Filed",
    },
    contacted: {
      bg: "rgba(217,159,25,0.14)",
      fg: "#B57E12",
      label: "In review",
    },
    quoted: {
      bg: "rgba(19,217,160,0.14)",
      fg: "#0E9E77",
      label: "Quoted · case open",
    },
    closed: {
      bg: "rgba(100,116,139,0.18)",
      fg: "#475569",
      label: "Closed",
    },
  };
  const s = styles[outcome];
  return (
    <span
      className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
      style={{
        background: s.bg,
        color: s.fg,
        fontFamily: "var(--font-mono)",
      }}
    >
      {s.label}
    </span>
  );
}
