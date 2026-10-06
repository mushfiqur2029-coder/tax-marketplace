// Shared presentation for a single booked scoping call. Used on
// both the client dashboard (/client "Upcoming calls" section) and
// the admin enquiry detail page so staff see the same date, time
// and Meet join link the client sees. Pure presentation — no RLS
// or data-fetching assumptions; the caller passes a plain object.

export type UpcomingBookingView = {
  id: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  meet_link: string | null;
  service_label: string | null;
  status: string;
};

export function UpcomingCallCard({
  booking,
  headline,
}: {
  booking: UpcomingBookingView;
  // Overrides the default "Your call is booked for ..." sentence.
  // Admin side passes "Scoping call with <name>" (or similar) so
  // the card reads correctly from the staff point of view.
  headline?: string;
}) {
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

  const defaultHeadline = `Your call is booked for ${dateLong} at ${time}.`;

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
          {headline ?? defaultHeadline}
        </div>
        <div className="mt-1 text-xs text-slate">
          <strong className="text-ink">{booking.duration_minutes} min</strong>
          {booking.service_label ? ` · ${booking.service_label}` : null}
          {headline ? ` · ${dateLong} at ${time}` : null}
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
