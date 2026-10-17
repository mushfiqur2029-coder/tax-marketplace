import { NextResponse, type NextRequest } from "next/server";
import {
  createBooking,
  isCalendarConfigured,
  SLOT_MINUTES_DEFAULT,
  getAuthKind,
} from "@/lib/calendar/booking";
import { buildIcsBase64 } from "@/lib/calendar/ics";
import { createAdminClient } from "@/lib/supabase/admin";
import { insertBookingCreatedNotifications } from "@/lib/notifications";
import { sendEmail } from "@/lib/email";

// POST /api/public/booking/create
//
// Public (unauthenticated) counterpart of /api/booking/create. Serves
// the marketing /contact page booking widget. No session gate; identity
// is "whatever the form says". The three defences against abuse are:
//
//   1. Honeypot field `_website_url`. Bots filling every input tick
//      this box; real browsers leave it empty (it is CSS-hidden).
//      Non-empty: respond 200 with a fake success so the bot thinks
//      it won, but create nothing.
//   2. IP rate limit via public_booking_attempts: at most 5 successful
//      bookings per IP per rolling hour.
//   3. Email rate limit: at most 1 booking per email per rolling 24h.
//
// Public bookings are intentionally NOT persisted to the bookings
// table. That table requires client_id (FK to users) and is designed
// around the signed-in flow. The Google Calendar event + the admin
// 'booking_created' notification + the attendee confirmation email
// are the artefacts of a public booking. Enough for staff visibility
// and for the attendee to find the Meet link later.

const ALLOWED_ORIGINS = new Set([
  "https://sterlingledger.co.uk",
  "https://www.sterlingledger.co.uk",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
  }
  return { "Vary": "Origin" };
}

export const dynamic = "force-dynamic";

// Tiny HTML escaper for the confirmation email body (same shape as
// /api/booking/create). Inputs are already validated types.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Body = {
  startIso?: string;
  attendeeName?: string;
  attendeeEmail?: string;
  attendeePhone?: string;
  message?: string;
  // Hidden honeypot; must stay empty.
  _website_url?: string;
};

// Resolve the client IP from Vercel's x-forwarded-for chain. First
// entry is the real client; subsequent entries are proxies in between.
function clientIp(req: NextRequest): string {
  const h = req.headers;
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip") ?? "unknown";
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (!isCalendarConfigured()) {
    return NextResponse.json(
      { error: "Booking is not configured on this environment." },
      { status: 503, headers: cors },
    );
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400, headers: cors },
    );
  }

  // Honeypot. Return fake success so bots do not probe further.
  if (body._website_url && body._website_url.trim().length > 0) {
    return NextResponse.json(
      { ok: true, eventId: "noop", htmlLink: "", meetLink: null },
      { status: 200, headers: cors },
    );
  }

  const startIso = body.startIso;
  const attendeeName = (body.attendeeName ?? "").trim();
  const attendeeEmail = (body.attendeeEmail ?? "").trim().toLowerCase();
  const attendeePhone = (body.attendeePhone ?? "").trim();
  const message = (body.message ?? "").trim();

  if (!startIso || Number.isNaN(new Date(startIso).getTime())) {
    return NextResponse.json(
      { error: "Pass a valid startIso." },
      { status: 400, headers: cors },
    );
  }
  if (!attendeeName) {
    return NextResponse.json(
      { error: "Name is required." },
      { status: 400, headers: cors },
    );
  }
  if (!attendeeEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(attendeeEmail)) {
    return NextResponse.json(
      { error: "A valid email is required." },
      { status: 400, headers: cors },
    );
  }
  // Belt-and-braces: refuse bookings in the past. The slot query also
  // filters past slots but the client could POST any ISO string.
  if (new Date(startIso).getTime() <= Date.now()) {
    return NextResponse.json(
      { error: "That time is in the past." },
      { status: 400, headers: cors },
    );
  }

  const ip = clientIp(req);
  const admin = createAdminClient();

  // IP cap: 5 bookings per rolling hour.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: ipCount } = await admin
    .from("public_booking_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("created_at", hourAgo);
  if ((ipCount ?? 0) >= 5) {
    return NextResponse.json(
      {
        error:
          "Too many bookings from this network in the last hour. Try again later or email us.",
      },
      { status: 429, headers: cors },
    );
  }

  // Email cap: 1 booking per rolling 24h.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: emailCount } = await admin
    .from("public_booking_attempts")
    .select("id", { count: "exact", head: true })
    .eq("email", attendeeEmail)
    .gte("created_at", dayAgo);
  if ((emailCount ?? 0) >= 1) {
    return NextResponse.json(
      {
        error:
          "There is already a booking in the last 24 hours for this email. Reply to your confirmation email if you need to reschedule.",
      },
      { status: 429, headers: cors },
    );
  }

  // Build calendar event payload. Summary stays short; description
  // carries the client-entered context so the accountant has it in the
  // event detail. attendeeName goes into summary to make the calendar
  // read "Scoping call: Jane Smith" at a glance.
  const summary = `Scoping call: ${attendeeName}`;
  const descriptionParts: string[] = [
    `Name: ${attendeeName}`,
    `Email: ${attendeeEmail}`,
  ];
  if (attendeePhone) descriptionParts.push(`Phone: ${attendeePhone}`);
  if (message) descriptionParts.push("", "Message:", message);
  descriptionParts.push("", "Source: sterlingledger.co.uk /contact");
  const description = descriptionParts.join("\n");

  // Pre-rendered label used by the admin notification and the
  // confirmation email. Keep format identical to the auth'd route so
  // staff see the same string everywhere.
  const startDate = new Date(startIso);
  const endDate = new Date(startDate.getTime() + SLOT_MINUTES_DEFAULT * 60_000);
  const humanLabel =
    startDate.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/London",
    }) +
    " at " +
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).format(startDate);
  const serviceLabel = "Public contact-page scoping call";

  let eventId = "";
  let htmlLink = "";
  let meetLink: string | null = null;

  try {
    const result = await createBooking({
      startIso,
      summary,
      description,
      attendeeEmail,
      attendeeName,
    });
    eventId = result.eventId;
    htmlLink = result.htmlLink;
    meetLink = result.meetLink;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not create booking." },
      { status: 500, headers: cors },
    );
  }

  // Record the attempt only after a successful Google insert so a
  // failed/race booking does not count against the attendee's cap.
  try {
    await admin
      .from("public_booking_attempts")
      .insert({ ip, email: attendeeEmail });
  } catch (recordErr) {
    console.error("[public-booking] rate-limit insert failed:", recordErr);
  }

  // Fan admin notifications and send the attendee confirmation email,
  // same shape as the auth'd route.
  const authKind = await getAuthKind().catch(
    () => "service_account" as const,
  );

  try {
    await insertBookingCreatedNotifications({
      attendeeEmail,
      attendeeName,
      serviceLabel,
      humanLabel,
      calendarOwnerEmail: process.env.GOOGLE_CALENDAR_ID ?? "",
      eventHtmlLink: htmlLink,
      meetAttached: authKind === "owner",
    });
  } catch (notifyErr) {
    console.error("[public-booking] notify failed:", notifyErr);
  }

  try {
    const ics = buildIcsBase64({
      uid: eventId,
      summary,
      description,
      startIso,
      endIso: endDate.toISOString(),
      url: meetLink ?? htmlLink,
      location: meetLink ?? undefined,
    });
    const emailHtml =
      `<p>Hi ${escapeHtml(attendeeName)},</p>` +
      `<p>Your Sterling Ledger scoping call is confirmed for <strong>${escapeHtml(
        humanLabel,
      )}</strong>.</p>` +
      (meetLink
        ? `<p>Join the call: <a href="${escapeHtml(meetLink)}">${escapeHtml(
            meetLink,
          )}</a></p>`
        : `<p>We'll follow up with the video call link shortly.</p>`) +
      `<p>Add it to your calendar using the attached invite file.</p>` +
      `<p>Sterling Ledger</p>`;
    const slNotifyRaw =
      process.env.SL_BOOKING_NOTIFY_EMAILS ??
      "info@sterlingledger.co.uk,nextnoor04@gmail.com";
    const bcc = slNotifyRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== attendeeEmail);
    const sent = await sendEmail({
      to: attendeeEmail,
      bcc,
      subject: `Scoping call confirmed · ${humanLabel}`,
      html: emailHtml,
      attachments: [
        {
          base64: ics,
          filename: "sterling-ledger-call.ics",
          mimeType: "text/calendar",
        },
      ],
    });
    if (!sent.ok) {
      console.error(
        "[public-booking] confirmation email send failed:",
        sent.error,
      );
    } else if (sent.skipped) {
      console.warn(
        "[public-booking] confirmation email skipped: " + sent.reason,
      );
    }
  } catch (mailErr) {
    console.error("[public-booking] confirmation email failed:", mailErr);
  }

  return NextResponse.json(
    { eventId, htmlLink, meetLink },
    { status: 200, headers: cors },
  );
}
