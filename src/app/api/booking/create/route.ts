import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
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

export const dynamic = "force-dynamic";

// Tiny HTML/attribute escaper for the confirmation email body. No
// external dep for one function; the inputs are already validated
// shapes (ISO datetime, service title, Meet URL).
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}

type Body = {
  startIso?: string;
  // Short title shown on the calendar event.
  summary?: string;
  // Pre-rendered multi-line description. The frontend owns the
  // formatting so a future caller (support bookings, etc.) can
  // decide what to put here.
  description?: string;
  attendeeEmail?: string;
  attendeeName?: string;
  // Short human-readable label for the admin notification only
  // ("Monday 12 October 2026 at 10:30"). Optional; the server falls
  // back to the ISO start if omitted.
  humanLabel?: string;
  // Short service label used in the admin notification message
  // ("VAT Registered + Accounts (over £200k)"). Optional; the server
  // falls back to summary.
  serviceLabel?: string;
  // Optional link to the originating service_enquiries row. Lets the
  // persisted bookings row carry context so the client dashboard can
  // show the booking + its enquiry together. Future booking surfaces
  // (support calls, consultations) can leave this null and still use
  // the picker end-to-end.
  enquiryId?: string;
};

// POST /api/booking/create
// Creates a calendar event with a Google Meet link and emails the
// attendee an invite. Returns { eventId, meetLink, htmlLink } on
// success. Session-gated the same way as the slots endpoint.
export async function POST(req: NextRequest) {
  const me = await requireRole("client");

  if (!isCalendarConfigured()) {
    return NextResponse.json(
      { error: "Booking is not configured on this environment." },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const startIso = body.startIso;
  const summary = (body.summary ?? "").trim();
  const description = (body.description ?? "").trim();
  const attendeeEmail = (body.attendeeEmail ?? "").trim();
  const attendeeName = body.attendeeName?.trim();

  if (!startIso || Number.isNaN(new Date(startIso).getTime())) {
    return NextResponse.json({ error: "Pass a valid startIso." }, { status: 400 });
  }
  if (!summary || !description) {
    return NextResponse.json(
      { error: "summary and description are required." },
      { status: 400 },
    );
  }
  if (!attendeeEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(attendeeEmail)) {
    return NextResponse.json(
      { error: "Pass a valid attendeeEmail." },
      { status: 400 },
    );
  }
  // Defensive: refuse to send the invite to an address other than the
  // signed-in user's. This endpoint is only called from the enquiry
  // form today, which uses me.email already — this guards against a
  // crafted POST sending spam invites via our calendar.
  if (attendeeEmail.toLowerCase() !== me.email.toLowerCase()) {
    return NextResponse.json(
      { error: "Attendee email must match the signed-in account." },
      { status: 403 },
    );
  }

  try {
    const result = await createBooking({
      startIso,
      summary,
      description,
      attendeeEmail,
      attendeeName,
    });

    // Persist the booking so the client can see "your call is booked"
    // on return visits, not just on the one-off confirmation screen
    // right after booking. Server role bypasses RLS; the row is scoped
    // to the signed-in client via me.id and the SELECT policy restricts
    // reads to the owner.
    const startDate = new Date(startIso);
    const endDate = new Date(startDate.getTime() + SLOT_MINUTES_DEFAULT * 60_000);
    const admin = createAdminClient();
    const { error: bookingInsertErr } = await admin.from("bookings").insert({
      client_id: me.id,
      service_enquiry_id: body.enquiryId ?? null,
      starts_at: startDate.toISOString(),
      ends_at: endDate.toISOString(),
      duration_minutes: SLOT_MINUTES_DEFAULT,
      google_event_id: result.eventId,
      google_event_url: result.htmlLink,
      meet_link: result.meetLink,
      status: "confirmed",
      attendee_name: attendeeName ?? null,
      attendee_email: attendeeEmail,
      service_label: body.serviceLabel?.trim() || summary,
    });
    if (bookingInsertErr) {
      // Log but don't fail the response — the Google event already
      // exists and is the ultimate source of truth. The admin
      // notification below is the backstop for staff visibility.
      console.error(
        `[booking] persist failed event=${result.eventId}:`,
        bookingInsertErr.message,
      );
    }

    // Fan a 'booking_created' notification out to every admin AND the
    // calendar owner. When the owner OAuth2 path is live, Google
    // auto-attaches the Meet link + sends a native invite to the
    // attendee, so the notification is purely informational. When we
    // fall back to the service account, the Meet link has to be added
    // manually and the notification message reflects that.
    const authKind = await getAuthKind().catch(() => "service_account" as const);
    try {
      await insertBookingCreatedNotifications({
        attendeeEmail,
        attendeeName: attendeeName ?? attendeeEmail,
        serviceLabel: body.serviceLabel?.trim() || summary,
        humanLabel: body.humanLabel?.trim() || startIso,
        calendarOwnerEmail: process.env.GOOGLE_CALENDAR_ID ?? "",
        eventHtmlLink: result.htmlLink,
        meetAttached: authKind === "owner",
      });
    } catch (notifyErr) {
      console.error("[booking] notify failed:", notifyErr);
    }

    // Confirmation email: delivered via the Gmail API (sendEmail →
    // sendEmailViaGmail) using the OAuth2 refresh token the connected
    // admin granted. The native Google invite that the owner path
    // sends is the primary artefact; this email reinforces it with
    // the Meet link in-line and the .ics attached so Outlook / Apple
    // Calendar users have a one-click add-to-calendar.
    //
    // Also sent (via BCC) to the Sterling Ledger inbox so staff see
    // every booking land in one place, matching the brief: notify the
    // info@ mailbox on every booking with the same Meet join link
    // the client receives.
    try {
      const humanLabel = body.humanLabel?.trim() || startIso;
      const serviceLabel = body.serviceLabel?.trim() || summary;
      const ics = buildIcsBase64({
        uid: result.eventId,
        summary,
        description,
        startIso,
        endIso: endDate.toISOString(),
        url: result.meetLink ?? result.htmlLink,
        location: result.meetLink ?? undefined,
      });
      const emailHtml =
        `<p>Hi ${attendeeName ?? ""},</p>` +
        `<p>Your Sterling Ledger scoping call for <strong>${escapeHtml(
          serviceLabel,
        )}</strong> is confirmed for <strong>${escapeHtml(
          humanLabel,
        )}</strong>.</p>` +
        (result.meetLink
          ? `<p>Join the call: <a href="${escapeAttr(result.meetLink)}">${escapeHtml(
              result.meetLink,
            )}</a></p>`
          : `<p>We'll follow up with the video call link shortly.</p>`) +
        `<p>Add it to your calendar using the attached invite file.</p>` +
        `<p>Sterling Ledger</p>`;
      // Comma-separated list is supported in env. Falls back to the
      // single-mailbox default so the brief ("info@sterlingledger.co.uk
      // and/or nextnoor04@gmail.com") is honoured even without config.
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
        console.error("[booking] confirmation email send failed:", sent.error);
      } else if (sent.skipped) {
        console.warn(
          "[booking] confirmation email skipped: " + sent.reason,
        );
      }
    } catch (mailErr) {
      console.error("[booking] confirmation email failed:", mailErr);
    }

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not create booking." },
      { status: 500 },
    );
  }
}
