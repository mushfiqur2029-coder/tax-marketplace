import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSegment } from "@/lib/segments";
import { getAllTiers } from "@/lib/service-catalog";
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
  const [{ data: cases }, { data: upcomingBookings }] = await Promise.all([
    supabase
      .from("cases")
      .select(
        "id, segment, tier, status, stripe_payment_status, created_at, submitted_at, deadline, is_urgent, intake_answers, custom_fee_pence",
      )
      .eq("client_id", me.id)
      .order("created_at", { ascending: false }),
    // Upcoming confirmed calls, ordered soonest first. RLS limits to
    // the signed-in client; the dashboard surfaces these in a card
    // above the cases list so the booking survives page reloads
    // (not just the one-off confirmation screen right after booking).
    supabase
      .from("bookings")
      .select("id, starts_at, ends_at, duration_minutes, meet_link, service_label, status")
      .eq("client_id", me.id)
      .eq("status", "confirmed")
      .gte("ends_at", new Date().toISOString())
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
        ]}
      />

      <UpcomingCalls bookings={upcomingBookings ?? []} />

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
        <ul className="grid gap-3">
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
