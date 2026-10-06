"use client";

import { useEffect, useMemo, useState } from "react";
import { SLButton } from "@/components/sl-button";

// Reusable in-app booking picker. Signed-in client picks a date from
// the next ~10 working days, sees the available 15-minute slots for
// that date (fetched from /api/booking/slots), then books one via
// /api/booking/create. Server owns the actual Google Calendar call.
//
// Props keep the component feature-agnostic — the enquiry form passes
// its own summary/description/metadata so a future support-chat
// booking surface can reuse it with different context.

export type BookingResult = {
  eventId: string;
  meetLink: string | null;
  htmlLink: string;
  startIso: string;
  endIso: string;
  // Pre-rendered friendly label like "Mon 12 Oct, 10:30".
  humanLabel: string;
};

type Props = {
  // Short calendar-event title. Shown to the attendee + the owner.
  summary: string;
  // Multi-line description. The frontend doesn't inspect this — the
  // caller is responsible for putting whatever context is useful (eg
  // the client's name, phone, company, service, enquiry id).
  description: string;
  attendeeEmail: string;
  attendeeName?: string;
  // Short label used in the admin "someone booked a call" notification
  // (e.g. "VAT Registered + Accounts (over £200k)"). Falls back to
  // `summary` server-side if omitted.
  serviceLabel?: string;
  // How many business days forward to show. Default 10.
  daysToShow?: number;
  // Called once the booking succeeds; the parent typically swaps its
  // view from "pick a time" to "you're booked".
  onBooked: (result: BookingResult) => void;
};

type Slot = { startIso: string; endIso: string; label: string };

const DAYS_TO_SHOW_DEFAULT = 10;
const SLOT_DURATION_MIN = 15;
// Paging: step forward/back by one working week at a time, overlapping
// the previous window by half so context carries across the jump.
const PAGE_WORKING_DAYS = 5;
// Hard cap on how far forward anyone can book. 8 weeks of working days
// (~2 months) — plenty for a scoping call, prevents infinite future
// browsing. If this needs to shift, change here and the right arrow
// disables itself cleanly without any other callsite caring.
const MAX_WORKING_DAYS = 40;

// -----------------------------------------------------------------------
// Date / time helpers
// -----------------------------------------------------------------------

function toLondonYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function isWorkingDay(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow >= 1 && dow <= 5;
}

// Return `windowSize` working-day YYYY-MM-DD strings starting from the
// `startOffset`-th working day after today (inclusive of today when
// today is a working day and startOffset=0). Used by the day strip's
// paging arrows: startOffset=0 is today's window, +PAGE_WORKING_DAYS
// slides a week forward.
function getWorkingDaysWindow(startOffset: number, windowSize: number): string[] {
  const out: string[] = [];
  const start = new Date();
  let collected = 0;
  for (let calOffset = 0; collected < startOffset + windowSize && calOffset < 200; calOffset++) {
    const d = new Date(start);
    d.setDate(d.getDate() + calOffset);
    const ymd = toLondonYmd(d);
    if (!isWorkingDay(ymd)) continue;
    if (collected >= startOffset) out.push(ymd);
    collected += 1;
  }
  return out;
}

function parseDayParts(ymd: string): {
  dayName: string;
  dateNum: string;
  month: string;
  isToday: boolean;
} {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayName = dt.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const month = dt.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  const today = toLondonYmd(new Date());
  return {
    dayName,
    dateNum: String(d),
    month,
    isToday: today === ymd,
  };
}

// "Friday, 9 October 2026" (confirmation summary heading).
function longHumanDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
}

// "Friday, 9 October 2026 at HH:MM" — passed through to the server for
// the admin notification message so it reads the same everywhere.
function humanTime(startIso: string): string {
  const d = new Date(startIso);
  const date = longHumanDate(startIso);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return `${date} at ${time}`;
}

// Morning = before noon (local label), afternoon = noon onwards. The
// label strings on the slot are already in Europe/London (built server-
// side) so parsing the leading "HH" from the label is accurate.
function splitMorningAfternoon(slots: Slot[]): { morning: Slot[]; afternoon: Slot[] } {
  const morning: Slot[] = [];
  const afternoon: Slot[] = [];
  for (const s of slots) {
    const hour = Number(s.label.slice(0, 2));
    if (hour < 12) morning.push(s);
    else afternoon.push(s);
  }
  return { morning, afternoon };
}

// -----------------------------------------------------------------------
// Main component
// -----------------------------------------------------------------------

export function BookingPicker({
  summary,
  description,
  attendeeEmail,
  attendeeName,
  serviceLabel,
  daysToShow = DAYS_TO_SHOW_DEFAULT,
  onBooked,
}: Props) {
  const [startOffset, setStartOffset] = useState(0);
  const days = useMemo(
    () => getWorkingDaysWindow(startOffset, daysToShow),
    [startOffset, daysToShow],
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(days[0] ?? null);

  // Right arrow caps at MAX_WORKING_DAYS; left arrow caps at today.
  const canGoBack = startOffset > 0;
  const canGoForward = startOffset + daysToShow < MAX_WORKING_DAYS;

  const pageBy = (delta: number) => {
    const clamped = Math.max(
      0,
      Math.min(startOffset + delta, Math.max(0, MAX_WORKING_DAYS - daysToShow)),
    );
    if (clamped === startOffset) return;
    setStartOffset(clamped);
    // If the current selection is no longer in the visible window, snap
    // to the first day of the new window. This also triggers the slot
    // fetch effect so the time grid refreshes to the new date.
    const nextDays = getWorkingDaysWindow(clamped, daysToShow);
    if (selectedDate && !nextDays.includes(selectedDate)) {
      setSelectedDate(nextDays[0] ?? null);
    }
  };
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [pickedSlot, setPickedSlot] = useState<Slot | null>(null);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  // Load slots whenever the selected date changes.
  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;
    setSlotsLoading(true);
    setSlotsError(null);
    setSlots(null);
    setPickedSlot(null);
    (async () => {
      try {
        const res = await fetch(`/api/booking/slots?date=${selectedDate}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setSlotsError(data?.error ?? "Could not load times.");
          setSlots([]);
          return;
        }
        setSlots(data.slots ?? []);
      } catch (e) {
        if (cancelled) return;
        setSlotsError(e instanceof Error ? e.message : "Could not load times.");
        setSlots([]);
      } finally {
        if (!cancelled) setSlotsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  const onConfirm = async () => {
    if (!pickedSlot) return;
    setBookingBusy(true);
    setBookingError(null);
    try {
      const humanLabel = humanTime(pickedSlot.startIso);
      const res = await fetch("/api/booking/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          startIso: pickedSlot.startIso,
          summary,
          description,
          attendeeEmail,
          attendeeName,
          humanLabel,
          serviceLabel,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBookingError(data?.error ?? "Could not book that time.");
        // If it's a slot-taken race, refresh the slots.
        if (res.status === 500 && selectedDate) {
          setSelectedDate(selectedDate);
        }
        return;
      }
      onBooked({
        eventId: data.eventId,
        meetLink: data.meetLink ?? null,
        htmlLink: data.htmlLink,
        startIso: pickedSlot.startIso,
        endIso: pickedSlot.endIso,
        humanLabel: humanTime(pickedSlot.startIso),
      });
    } catch (e) {
      setBookingError(e instanceof Error ? e.message : "Could not book that time.");
    } finally {
      setBookingBusy(false);
    }
  };

  if (days.length === 0) {
    return (
      <p className="text-sm text-slate">
        No working days available in the next few weeks.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* ======================= Day strip ======================= */}
      <section>
        <SectionLabel>Pick a day</SectionLabel>
        {/* Flanked by paging arrows. The arrows live outside the
            scroll-row so (a) the horizontal swipe gesture inside the
            row never fights with a tap on the arrow, and (b) the
            edge-fade mask doesn't dim them. */}
        <div className="flex items-center gap-2 sm:gap-3">
          <PageArrow
            direction="left"
            disabled={!canGoBack}
            onClick={() => pageBy(-PAGE_WORKING_DAYS)}
          />
          <div className="scroll-row -mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 pb-2 sm:gap-3">
            {days.map((ymd) => (
              <DayCard
                key={ymd}
                ymd={ymd}
                active={ymd === selectedDate}
                onClick={() => setSelectedDate(ymd)}
              />
            ))}
          </div>
          <PageArrow
            direction="right"
            disabled={!canGoForward}
            onClick={() => pageBy(PAGE_WORKING_DAYS)}
          />
        </div>
      </section>

      {/* ======================= Time slots ======================= */}
      <section>
        <SectionLabel>Pick a time</SectionLabel>
        {slotsLoading ? (
          <SlotsSkeleton />
        ) : slotsError ? (
          <ErrorNote>{slotsError}</ErrorNote>
        ) : !slots || slots.length === 0 ? (
          <EmptyDay />
        ) : (
          <SlotGroups
            slots={slots}
            pickedSlot={pickedSlot}
            onPick={setPickedSlot}
          />
        )}
      </section>

      {/* ======================= Confirmation card ======================= */}
      {pickedSlot ? (
        <ConfirmCard
          slot={pickedSlot}
          attendeeEmail={attendeeEmail}
          busy={bookingBusy}
          error={bookingError}
          onConfirm={onConfirm}
        />
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------
// Paging arrow — 44x44 tap target (iOS Human Interface Guideline minimum)
// so mobile taps land cleanly. Positioned outside the horizontal
// scroll-row so swipe gestures don't fight with button taps.
// -----------------------------------------------------------------------

function PageArrow({
  direction,
  disabled,
  onClick,
}: {
  direction: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === "left" ? "Earlier dates" : "Later dates"}
      className={
        "shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-full border transition " +
        (disabled
          ? "cursor-not-allowed border-line/60 bg-paper/60 text-slate/40"
          : "border-line bg-paper text-slate hover:-translate-y-0.5 hover:border-sky/60 hover:text-navy-deep")
      }
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {direction === "left" ? (
          <polyline points="15 18 9 12 15 6" />
        ) : (
          <polyline points="9 18 15 12 9 6" />
        )}
      </svg>
    </button>
  );
}

// -----------------------------------------------------------------------
// Day card — day name on top (small/mono/muted), big bold date, month
// below. Selected state fills with sky blue; today gets a dot indicator
// in the muted state.
// -----------------------------------------------------------------------

function DayCard({
  ymd,
  active,
  onClick,
}: {
  ymd: string;
  active: boolean;
  onClick: () => void;
}) {
  const { dayName, dateNum, month, isToday } = parseDayParts(ymd);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "relative shrink-0 flex w-16 flex-col items-center justify-center gap-0.5 rounded-xl py-3 transition " +
        (active
          ? "bg-sky text-white shadow-[0_10px_26px_-14px_rgba(25,156,217,0.65)]"
          : "border border-line bg-paper text-ink hover:-translate-y-0.5 hover:border-sky/50 hover:shadow-[0_8px_18px_-14px_rgba(25,156,217,0.45)]")
      }
    >
      <span
        className={
          "text-[10px] font-semibold uppercase tracking-widest " +
          (active ? "text-white/85" : "text-slate")
        }
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {dayName}
      </span>
      <span
        className={
          "text-2xl font-bold leading-none " +
          (active ? "text-white" : "text-ink")
        }
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {dateNum}
      </span>
      <span
        className={
          "text-[10px] uppercase tracking-widest " +
          (active ? "text-white/85" : "text-slate")
        }
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {month}
      </span>
      {isToday && !active ? (
        <span
          className="absolute right-2 top-2 inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--sky)" }}
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}

// -----------------------------------------------------------------------
// Slot groups — morning + afternoon labels above pill grids. Mobile
// stays comfortable with 2 columns; wider screens open up to 3/4/5.
// -----------------------------------------------------------------------

function SlotGroups({
  slots,
  pickedSlot,
  onPick,
}: {
  slots: Slot[];
  pickedSlot: Slot | null;
  onPick: (s: Slot) => void;
}) {
  const { morning, afternoon } = splitMorningAfternoon(slots);
  return (
    <div className="space-y-5">
      {morning.length > 0 ? (
        <SlotGroup
          label="Morning"
          slots={morning}
          pickedSlot={pickedSlot}
          onPick={onPick}
        />
      ) : null}
      {afternoon.length > 0 ? (
        <SlotGroup
          label="Afternoon"
          slots={afternoon}
          pickedSlot={pickedSlot}
          onPick={onPick}
        />
      ) : null}
    </div>
  );
}

function SlotGroup({
  label,
  slots,
  pickedSlot,
  onPick,
}: {
  label: string;
  slots: Slot[];
  pickedSlot: Slot | null;
  onPick: (s: Slot) => void;
}) {
  return (
    <div>
      <GroupLabel>{label}</GroupLabel>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {slots.map((slot) => (
          <SlotPill
            key={slot.startIso}
            slot={slot}
            active={pickedSlot?.startIso === slot.startIso}
            onClick={() => onPick(slot)}
          />
        ))}
      </div>
    </div>
  );
}

function SlotPill({
  slot,
  active,
  onClick,
}: {
  slot: Slot;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded-full px-4 py-2.5 text-sm font-semibold transition " +
        (active
          ? "bg-sky text-white shadow-[0_10px_26px_-14px_rgba(25,156,217,0.65)]"
          : "border border-line bg-paper text-ink hover:-translate-y-0.5 hover:border-sky/60 hover:text-navy-deep")
      }
    >
      {slot.label}
    </button>
  );
}

// -----------------------------------------------------------------------
// Skeleton — shows while /api/booking/slots is in flight. Matches the
// final layout (two groups, pill grid) so the swap doesn't jolt.
// -----------------------------------------------------------------------

function SlotsSkeleton() {
  return (
    <div className="space-y-5" aria-live="polite" aria-busy="true">
      <SkeletonGroup label="Morning" count={8} />
      <SkeletonGroup label="Afternoon" count={20} />
    </div>
  );
}

function SkeletonGroup({ label, count }: { label: string; count: number }) {
  return (
    <div>
      <GroupLabel>{label}</GroupLabel>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="h-11 animate-pulse rounded-full"
            style={{ background: "var(--cloud)" }}
          />
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Empty state when a day has no available slots (owner fully booked,
// or every slot is in the past — Google side has already filtered).
// -----------------------------------------------------------------------

function EmptyDay() {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-cloud/40 p-6 text-center sm:p-8">
      <div
        className="mx-auto mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl text-white"
        style={{
          background: "linear-gradient(135deg, var(--navy), var(--sky))",
        }}
        aria-hidden="true"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </div>
      <p
        className="text-base font-semibold text-ink"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        No times available on this day.
      </p>
      <p className="mt-1 text-sm text-slate">
        Try another day from the row above.
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------
// Confirmation card — appears only after a slot is picked. Mini day
// chip + full long-form date + duration + Confirm button. Review step
// so the client isn't booking from a bare "Book 10:00" primary.
// -----------------------------------------------------------------------

function ConfirmCard({
  slot,
  attendeeEmail,
  busy,
  error,
  onConfirm,
}: {
  slot: Slot;
  attendeeEmail: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  const { dayName, dateNum, month } = parseDayParts(toLondonYmd(new Date(slot.startIso)));
  return (
    <div
      className="rounded-2xl border p-5 sm:p-6"
      style={{
        borderColor: "rgba(25,156,217,0.40)",
        background:
          "linear-gradient(180deg, rgba(25,156,217,0.05), rgba(25,156,217,0.015))",
      }}
    >
      <SectionLabel>Confirm your call</SectionLabel>
      <div className="mt-3 flex items-start gap-4">
        {/* Mini date chip — gradient to echo the empty-state icon tile
            and the EmptyState block elsewhere in the app. */}
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
            {dayName}
          </span>
          <span
            className="text-xl font-bold leading-none"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {dateNum}
          </span>
          <span
            className="text-[10px] uppercase tracking-widest text-white/85"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {month}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="text-base font-semibold text-ink sm:text-lg"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {longHumanDate(slot.startIso)}
          </div>
          <div className="mt-1 text-sm text-slate">
            <strong className="text-ink">{slot.label}</strong> ·{" "}
            {SLOT_DURATION_MIN} minutes
          </div>
          <div className="mt-2 text-xs text-slate">
            Video call link + follow-up email to{" "}
            <strong className="text-ink">{attendeeEmail}</strong>.
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}

      <div className="mt-5">
        <SLButton
          type="button"
          variant="primary"
          className="w-full sm:w-auto"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? "Booking…" : "Confirm booking"}
        </SLButton>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Small shared chrome bits
// -----------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {children}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {children}
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="rounded-lg px-3 py-2 text-sm font-medium text-red-700"
      role="alert"
      style={{ background: "rgba(220,38,38,0.08)" }}
    >
      {children}
    </p>
  );
}
