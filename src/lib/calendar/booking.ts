// Reusable booking service for the Sterling Ledger calendar. Backs
// the bespoke LC enquiry picker today and is designed to work for any
// future "pick a 15-minute slot" surface (client support, accountant
// consultations, etc.) by accepting the calendar id, working hours,
// slot duration, and timezone as optional overrides.
//
// Auth: service account JWT (google-auth-library handles token
// refresh + caching). The service account must be granted "Make
// changes to events" on the target calendar for createBooking to
// succeed; a view-only grant is enough for listAvailableSlots.
//
// ---------------------------------------------------------------------
// Option B upgrade path (planned, do this once booking volume > manual
// is painful): switch from service-account JWT to OAuth2 user-
// impersonation. The service account path has two Google-side
// limitations we live with today:
//   1. `attendees` can't be added (403 forbiddenForServiceAccounts),
//      so clients don't get a Google calendar invite — our in-app
//      confirmation + 'booking_created' notification carry the info.
//   2. `conferenceData` with hangoutsMeet is rejected (400 "Invalid
//      conference type value"), so events ship without a Meet link
//      and the calendar owner has to attach one manually. The
//      'booking_created' notification exists specifically to make
//      sure that step isn't missed.
// Both are unlocked by (a) switching to an OAuth2 user flow where
// the calendar owner (nextnoor04@gmail.com) authorizes the app once,
// subsequent events are created AS them, or (b) moving the calendar
// to a Google Workspace tenant and enabling Domain-Wide Delegation
// on this service account.
//
// Shape of the (a) upgrade:
//   - Add /api/auth/google/connect + /api/auth/google/callback
//     routes that run the OAuth2 consent flow and persist the
//     resulting refresh_token (encrypted, same approach as
//     COMPANY_AUTH_CODE_KEY uses for CH auth codes).
//   - Swap getAuth() below from `new JWT(...)` to
//     `new OAuth2Client(...)` + `.setCredentials({ refresh_token })`.
//     The rest of the file is already written against access tokens,
//     so nothing else changes.
//   - Add `attendees` + `conferenceData` back to the body in
//     createBooking (both are currently blocked by the service
//     account; they're the whole point of upgrading).
//   - Remove the 'booking_created' notification's "add a Meet link
//     manually" phrasing (the Meet link is auto-attached once this
//     is live) and shift the message to a quieter "FYI, a scoping
//     call just landed" tone.
// ---------------------------------------------------------------------

import { JWT } from "google-auth-library";

export const WORKING_HOURS_DEFAULT = { startHour: 10, endHour: 17 } as const;
export const SLOT_MINUTES_DEFAULT = 15;
export const TIMEZONE_DEFAULT = "Europe/London";
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

// Env is read lazily so dev builds don't crash when the booking env
// isn't configured (the picker just hides itself in that case).
export function isCalendarConfigured(): boolean {
  const hasKey =
    !!process.env.GOOGLE_CALENDAR_PRIVATE_KEY ||
    !!process.env.GOOGLE_CALENDAR_PRIVATE_KEY_BASE64;
  return !!(
    process.env.GOOGLE_CALENDAR_CLIENT_EMAIL &&
    hasKey &&
    process.env.GOOGLE_CALENDAR_ID
  );
}

let authSingleton: JWT | null = null;
function getAuth(): JWT {
  if (authSingleton) return authSingleton;
  const clientEmail = process.env.GOOGLE_CALENDAR_CLIENT_EMAIL;
  const privateKey = resolvePrivateKey();
  if (!clientEmail || !privateKey) {
    throw new Error("Google Calendar credentials are not configured.");
  }
  authSingleton = new JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [CALENDAR_SCOPE],
  });
  return authSingleton;
}

// Private key accepts two formats so deployment is easy on any env:
//
//   - GOOGLE_CALENDAR_PRIVATE_KEY_BASE64: base64 of the full PEM.
//     Preferred for Vercel/CI envs because the Vercel CLI plugin
//     rejects any `--value` that starts with a dash (and a PEM
//     begins with "-----BEGIN"). base64 is pure a-zA-Z0-9+/= so it
//     never collides with CLI flag parsing.
//   - GOOGLE_CALENDAR_PRIVATE_KEY: the raw PEM. If the value came
//     via dotenv with literal \n escape sequences we convert them
//     back to real newlines before passing to the JWT signer.
//
// Checked in that order so adding the base64 form later doesn't
// require removing the raw form.
function resolvePrivateKey(): string | null {
  const b64 = process.env.GOOGLE_CALENDAR_PRIVATE_KEY_BASE64;
  if (b64) {
    try {
      return Buffer.from(b64, "base64").toString("utf-8");
    } catch {
      return null;
    }
  }
  const raw = process.env.GOOGLE_CALENDAR_PRIVATE_KEY;
  if (raw) return raw.replace(/\\n/g, "\n");
  return null;
}

async function getAccessToken(): Promise<string> {
  const { token } = await getAuth().getAccessToken();
  if (!token) throw new Error("Could not obtain Google Calendar access token.");
  return token;
}

function getCalendarId(explicit?: string): string {
  const id = explicit ?? process.env.GOOGLE_CALENDAR_ID;
  if (!id) throw new Error("GOOGLE_CALENDAR_ID is not set.");
  return id;
}

// ---------------------------------------------------------------------
// Slot generation
// ---------------------------------------------------------------------

export type BookingOptions = {
  // Target calendar id. Defaults to GOOGLE_CALENDAR_ID.
  calendarId?: string;
  // 15-minute default, overridable per feature.
  slotMinutes?: number;
  // Default 10:00-17:00 local, overridable.
  workingHours?: { startHour: number; endHour: number };
  // Default Europe/London.
  timezone?: string;
};

export type Slot = {
  // ISO 8601 with offset — safe to pass to new Date().
  startIso: string;
  endIso: string;
  // Pre-rendered "10:00" label in the configured timezone, so clients
  // never have to re-render the time themselves and the UI matches
  // the calendar event they're about to create.
  label: string;
};

// Parse a YYYY-MM-DD date string into year/month/day numbers.
function parseYmd(ymd: string): { y: number; m: number; d: number } {
  const match = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid date format (want YYYY-MM-DD): ${ymd}`);
  return {
    y: Number(match[1]),
    m: Number(match[2]),
    d: Number(match[3]),
  };
}

// Return 0 (Sunday) through 6 (Saturday) for a YYYY-MM-DD in UTC — the
// calendar day boundary is tz-aware upstream when needed, but for the
// Mon-Fri check we only need civil weekday from the date components.
function civilWeekday(ymd: string): number {
  const { y, m, d } = parseYmd(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWorkingDay(ymd: string): boolean {
  const dow = civilWeekday(ymd);
  return dow >= 1 && dow <= 5;
}

// Build the absolute instant for a given civil (date, hour, minute)
// pair in a given IANA timezone. We do this by trial-and-adjust so we
// don't need a dedicated TZ library — Node 20+ has Intl.DateTimeFormat
// with timeZone + hour12=false which gives us the needed inverse.
function civilToUtc(
  ymd: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const { y, m, d } = parseYmd(ymd);
  // First guess: treat the civil wall-clock as UTC.
  const guess = new Date(Date.UTC(y, m - 1, d, hour, minute, 0, 0));
  // Compute the offset the target timezone applies at that instant.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(guess);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asLocal = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  const offset = asLocal - guess.getTime();
  return new Date(guess.getTime() - offset);
}

// Render an ISO string's local hour:minute in a given timezone.
function formatHHMM(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

// Generate every candidate 15-min slot start for a given civil day
// in the configured working window, as [startIso, endIso] pairs.
function candidateSlots(
  ymd: string,
  opts: Required<Pick<BookingOptions, "slotMinutes" | "workingHours" | "timezone">>,
): Slot[] {
  const { startHour, endHour } = opts.workingHours;
  const slots: Slot[] = [];
  for (let h = startHour; h < endHour; h++) {
    for (let m = 0; m < 60; m += opts.slotMinutes) {
      const start = civilToUtc(ymd, h, m, opts.timezone);
      const end = new Date(start.getTime() + opts.slotMinutes * 60_000);
      const startIso = start.toISOString();
      slots.push({
        startIso,
        endIso: end.toISOString(),
        label: formatHHMM(startIso, opts.timezone),
      });
    }
  }
  return slots;
}

// ---------------------------------------------------------------------
// Google Calendar queries
// ---------------------------------------------------------------------

type BusyRange = { start: string; end: string };

async function freeBusy(
  calendarId: string,
  timeMin: string,
  timeMax: string,
  timeZone: string,
): Promise<BusyRange[]> {
  const token = await getAccessToken();
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      timeZone,
      items: [{ id: calendarId }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FreeBusy failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    calendars?: Record<string, { busy?: BusyRange[]; errors?: Array<{ reason: string }> }>;
  };
  const entry = data.calendars?.[calendarId];
  if (!entry) throw new Error("FreeBusy response missing calendar entry.");
  if (entry.errors && entry.errors.length > 0) {
    throw new Error(
      `FreeBusy error for ${calendarId}: ${entry.errors.map((e) => e.reason).join(", ")}`,
    );
  }
  return entry.busy ?? [];
}

// Does [startIso, endIso) overlap any busy range? Google's busy ranges
// are also [start, end) so the comparison is strict-less-than on the
// matching boundary.
function overlaps(startIso: string, endIso: string, busy: BusyRange[]): boolean {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  for (const b of busy) {
    const bs = new Date(b.start).getTime();
    const be = new Date(b.end).getTime();
    if (s < be && e > bs) return true;
  }
  return false;
}

// Return the available slots for a given civil day. Non-working days
// (Sat/Sun) return []. Past slots on today return []. Everything else
// is checked against the calendar's busy ranges.
export async function listAvailableSlots(
  ymd: string,
  options: BookingOptions = {},
): Promise<Slot[]> {
  const opts = {
    slotMinutes: options.slotMinutes ?? SLOT_MINUTES_DEFAULT,
    workingHours: options.workingHours ?? WORKING_HOURS_DEFAULT,
    timezone: options.timezone ?? TIMEZONE_DEFAULT,
  };
  if (!isWorkingDay(ymd)) return [];

  const candidates = candidateSlots(ymd, opts);
  if (candidates.length === 0) return [];

  // One freebusy query per day — bounded by the first/last candidate.
  const timeMin = candidates[0].startIso;
  const timeMax = candidates[candidates.length - 1].endIso;
  const busy = await freeBusy(
    getCalendarId(options.calendarId),
    timeMin,
    timeMax,
    opts.timezone,
  );

  const now = Date.now();
  return candidates.filter((slot) => {
    if (new Date(slot.startIso).getTime() <= now) return false;
    return !overlaps(slot.startIso, slot.endIso, busy);
  });
}

// ---------------------------------------------------------------------
// Event creation
// ---------------------------------------------------------------------

export type CreateBookingInput = {
  startIso: string;
  // Defaults to SLOT_MINUTES_DEFAULT; the API route and picker both
  // use the same number so an off-grid value should never land here.
  slotMinutes?: number;
  // Short title shown on the calendar.
  summary: string;
  // Long-form notes — client name/email/phone go here plus any
  // feature-specific context.
  description: string;
  // Attendee for the invite + Meet link. We also stash it on
  // extendedProperties.private.attendeeEmail so a future admin UI can
  // search by it without parsing the description.
  attendeeEmail: string;
  attendeeName?: string;
  calendarId?: string;
  timezone?: string;
};

export type CreateBookingResult = {
  eventId: string;
  htmlLink: string;
  // Google Meet URL if one was attached (requires the calendar owner
  // to have Meet enabled for the account; always true for @gmail.com).
  meetLink: string | null;
};

export async function createBooking(
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  const slotMinutes = input.slotMinutes ?? SLOT_MINUTES_DEFAULT;
  const timezone = input.timezone ?? TIMEZONE_DEFAULT;
  const calendarId = getCalendarId(input.calendarId);
  const start = new Date(input.startIso);
  const end = new Date(start.getTime() + slotMinutes * 60_000);

  // Belt-and-braces: re-check that the exact slot is still free. This
  // is a soft race — Google's native guard is "if there's a conflict,
  // insert still succeeds" — so we do it here and refuse ourselves.
  const busy = await freeBusy(calendarId, start.toISOString(), end.toISOString(), timezone);
  if (overlaps(start.toISOString(), end.toISOString(), busy)) {
    throw new Error("That slot was taken while you were booking. Pick another.");
  }

  const token = await getAccessToken();
  // Service account constraints on a personal (non-Workspace) calendar:
  //   - `attendees`: rejected without Domain-Wide Delegation of
  //     Authority. DWD is a Workspace-only setting, so for @gmail.com
  //     calendars this is a hard "no". Attendee info therefore lives
  //     in the event description + extendedProperties.
  //   - `conferenceData` with `hangoutsMeet`: rejected ("Invalid
  //     conference type value") because the service account itself
  //     isn't a Meet-enabled principal. Options to unlock Meet are
  //     (a) switch to OAuth2 user-impersonation flow, or (b) move the
  //     calendar to a paid Workspace tenant and enable DWD.
  //
  // Until one of those lands we create the event WITHOUT a Meet link;
  // meetLink comes back null and the UI handles that case. The owner
  // can attach a Meet manually when they see the event, or we can
  // post-process out-of-band.
  const body = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: start.toISOString(), timeZone: timezone },
    end: { dateTime: end.toISOString(), timeZone: timezone },
    extendedProperties: {
      private: {
        source: "sterling-ledger",
        attendeeEmail: input.attendeeEmail,
        attendeeName: input.attendeeName ?? "",
      },
    },
  };

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Calendar event create failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const event = (await res.json()) as {
    id: string;
    htmlLink: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: Array<{ entryPointType: string; uri: string }> };
  };

  const meetFromEntryPoints =
    event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ?? null;

  return {
    eventId: event.id,
    htmlLink: event.htmlLink,
    meetLink: event.hangoutLink ?? meetFromEntryPoints,
  };
}
