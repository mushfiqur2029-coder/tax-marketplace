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

// YYYY-MM-DD in Europe/London for a Date instance.
function toLondonYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// "Mon 6 Oct" from a YYYY-MM-DD civil date.
function shortDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// "Monday 6 October 2026" + " at HH:MM" for the confirmation card.
function humanTime(startIso: string): string {
  const d = new Date(startIso);
  const date = d.toLocaleDateString("en-GB", {
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
  }).format(d);
  return `${date} at ${time}`;
}

function isWorkingDay(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow >= 1 && dow <= 5;
}

// Produce the next N working days (starting from today, London) that
// could still host a slot.
function nextWorkingDays(n: number): string[] {
  const out: string[] = [];
  const start = new Date();
  for (let offset = 0; out.length < n && offset < 30; offset++) {
    const d = new Date(start);
    d.setDate(d.getDate() + offset);
    const ymd = toLondonYmd(d);
    if (isWorkingDay(ymd)) out.push(ymd);
  }
  return out;
}

export function BookingPicker({
  summary,
  description,
  attendeeEmail,
  attendeeName,
  serviceLabel,
  daysToShow = DAYS_TO_SHOW_DEFAULT,
  onBooked,
}: Props) {
  const days = useMemo(() => nextWorkingDays(daysToShow), [daysToShow]);
  const [selectedDate, setSelectedDate] = useState<string | null>(days[0] ?? null);
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
    <div className="space-y-5">
      <div>
        <div
          className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Pick a day
        </div>
        <div className="scroll-row flex gap-2 overflow-x-auto pb-2">
          {days.map((d) => {
            const active = d === selectedDate;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setSelectedDate(d)}
                aria-pressed={active}
                className={
                  "shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition " +
                  (active
                    ? "bg-navy-deep text-white"
                    : "border border-line bg-paper text-ink hover:border-sky/50 hover:text-navy-deep")
                }
              >
                {shortDay(d)}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div
          className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Pick a time
        </div>
        {slotsLoading ? (
          <p className="text-sm text-slate">Loading times…</p>
        ) : slotsError ? (
          <p
            className="rounded-lg px-3 py-2 text-sm font-medium text-red-700"
            role="alert"
            style={{ background: "rgba(220,38,38,0.08)" }}
          >
            {slotsError}
          </p>
        ) : !slots || slots.length === 0 ? (
          <p className="text-sm text-slate">
            No times available on this day. Try another.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {slots.map((slot) => {
              const active = pickedSlot?.startIso === slot.startIso;
              return (
                <button
                  key={slot.startIso}
                  type="button"
                  onClick={() => setPickedSlot(slot)}
                  aria-pressed={active}
                  className={
                    "rounded-lg px-3 py-2 text-sm font-semibold transition " +
                    (active
                      ? "bg-navy-deep text-white"
                      : "border border-line bg-paper text-ink hover:border-sky/50 hover:text-navy-deep")
                  }
                >
                  {slot.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {bookingError ? (
        <p
          className="rounded-lg px-3 py-2 text-sm font-medium text-red-700"
          role="alert"
          style={{ background: "rgba(220,38,38,0.08)" }}
        >
          {bookingError}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SLButton
          type="button"
          variant="primary"
          disabled={!pickedSlot || bookingBusy}
          onClick={onConfirm}
        >
          {bookingBusy
            ? "Booking…"
            : pickedSlot
              ? `Book ${pickedSlot.label}`
              : "Pick a time first"}
        </SLButton>
        {pickedSlot ? (
          <span className="text-xs text-slate">
            You&rsquo;ll see your video call link as soon as you book — save it;
            we&rsquo;ll also follow up by email at <strong>{attendeeEmail}</strong>.
          </span>
        ) : null}
      </div>
    </div>
  );
}
