// Reusable booking service for the Sterling Ledger calendar. Backs
// the bespoke LC enquiry picker today and is designed to work for any
// future "pick a 15-minute slot" surface (client support, accountant
// consultations, etc.) by accepting the calendar id, working hours,
// slot duration, and timezone as optional overrides.
//
// Auth prefers an OAuth2 refresh token granted via the one-time admin
// consent flow at /api/auth/google/connect — the server acts AS the
// calendar owner, which is what unlocks `attendees` (native Google
// calendar invite to the client) and `conferenceData.hangoutsMeet`
// (auto-attached Meet link).
//
// Fallback is the service-account JWT. In that mode the two features
// above are rejected by Google (see getAccessToken comment), so bookings
// still get persisted but go out without a native invite / Meet link.
// Fallback keeps slot listing working on a dev box or a brand-new
// deploy where consent hasn't happened yet.

import { JWT, OAuth2Client } from "google-auth-library";
import { getOwnerOAuthClient } from "./oauth-token";

export const WORKING_HOURS_DEFAULT = { startHour: 10, endHour: 17 } as const;
export const SLOT_MINUTES_DEFAULT = 15;
export const TIMEZONE_DEFAULT = "Europe/London";
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

// Env is read lazily so dev builds don't crash when the booking env
// isn't configured (the picker just hides itself in that case).
// Either auth path (OAuth2 owner refresh token OR service-account JWT)
// is enough to list slots + create events — the picker should surface
// as long as GOOGLE_CALENDAR_ID is set and at least one auth path has
// its env vars present.
export function isCalendarConfigured(): boolean {
  if (!process.env.GOOGLE_CALENDAR_ID) return false;
  const hasServiceAccountKey =
    !!process.env.GOOGLE_CALENDAR_PRIVATE_KEY ||
    !!process.env.GOOGLE_CALENDAR_PRIVATE_KEY_BASE64;
  const hasServiceAccount =
    !!process.env.GOOGLE_CALENDAR_CLIENT_EMAIL && hasServiceAccountKey;
  const hasOAuth =
    !!process.env.GOOGLE_OAUTH_CLIENT_ID &&
    !!process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  return hasServiceAccount || hasOAuth;
}

// Expose which auth path is live so the API create route can choose
// the right admin-notification wording ("add a Meet link manually" vs
// "FYI, a booking just landed" when Google auto-attaches the Meet).
export async function getAuthKind(): Promise<AuthContext["kind"]> {
  const { kind } = await getAuthContext();
  return kind;
}

let jwtSingleton: JWT | null = null;
function getJwt(): JWT | null {
  if (jwtSingleton) return jwtSingleton;
  const clientEmail = process.env.GOOGLE_CALENDAR_CLIENT_EMAIL;
  const privateKey = resolvePrivateKey();
  if (!clientEmail || !privateKey) return null;
  jwtSingleton = new JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [CALENDAR_SCOPE],
  });
  return jwtSingleton;
}

export type AuthContext = {
  // "owner" = OAuth2 client acting as the calendar owner; can invite
  // attendees + attach Meet. "service_account" = JWT; can read FreeBusy
  // and create bare events only.
  kind: "owner" | "service_account";
  // Pre-fetched access token so downstream callers don't have to care
  // about which auth path produced it.
  accessToken: string;
};

async function getAuthContext(): Promise<AuthContext> {
  const oauth: OAuth2Client | null = await getOwnerOAuthClient();
  if (oauth) {
    const { token } = await oauth.getAccessToken();
    if (!token) {
      throw new Error(
        "Could not obtain Google access token from the owner OAuth2 refresh token. Reconnect at /api/auth/google/connect.",
      );
    }
    return { kind: "owner", accessToken: token };
  }
  const jwt = getJwt();
  if (!jwt) {
    throw new Error(
      "Google Calendar isn't configured. Set up either the OAuth2 flow (preferred) or the service-account env vars.",
    );
  }
  const { token } = await jwt.getAccessToken();
  if (!token) {
    throw new Error(
      "Could not obtain Google access token from the service-account JWT.",
    );
  }
  return { kind: "service_account", accessToken: token };
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
  const { accessToken } = await getAuthContext();
  return accessToken;
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

  const auth = await getAuthContext();
  const isOwner = auth.kind === "owner";

  // Base body — works for both auth kinds.
  type EventBody = {
    summary: string;
    description: string;
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
    extendedProperties: { private: Record<string, string> };
    attendees?: Array<{ email: string; displayName?: string }>;
    conferenceData?: {
      createRequest: {
        requestId: string;
        conferenceSolutionKey: { type: string };
      };
    };
  };
  const body: EventBody = {
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

  // Owner path (OAuth2): attach the real attendee + a Meet conference.
  // Google will send a native calendar invite with the Meet link.
  //
  // Service-account path: both of these would be rejected by Google
  //   - `attendees` → 403 forbiddenForServiceAccounts
  //   - `conferenceData` with hangoutsMeet → 400 "Invalid conference type value"
  // so we omit them and the Meet link comes back null. The admin
  // 'booking_created' notification still fires with the "attach a Meet
  // link manually" phrasing in that mode.
  if (isOwner) {
    body.attendees = [
      {
        email: input.attendeeEmail,
        displayName: input.attendeeName,
      },
    ];
    body.conferenceData = {
      createRequest: {
        requestId: `sl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  // conferenceDataVersion=1 is required for Google to actually create
  // the Meet; without it the createRequest is silently ignored.
  // sendUpdates=all tells Google to email the attendee the invite.
  const qs = isOwner
    ? "?conferenceDataVersion=1&sendUpdates=all"
    : "";

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${qs}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
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
