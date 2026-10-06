import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import {
  isCalendarConfigured,
  isWorkingDay,
  listAvailableSlots,
} from "@/lib/calendar/booking";

export const dynamic = "force-dynamic";

// GET /api/booking/slots?date=YYYY-MM-DD
// Returns the available 15-minute slot starts for the given civil day
// in Europe/London (Mon-Fri 10:00-17:00 by default) after excluding
// everything already busy on the shared Sterling Ledger calendar.
// Signed-in clients only — this is the same gate as the enquiry form
// that calls it.
export async function GET(req: NextRequest) {
  await requireRole("client");

  if (!isCalendarConfigured()) {
    return NextResponse.json(
      { error: "Booking is not configured on this environment." },
      { status: 503 },
    );
  }

  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "Pass ?date=YYYY-MM-DD." },
      { status: 400 },
    );
  }

  // Mon-Fri gate also lives on the service, but short-circuit here so
  // we don't burn a FreeBusy call on known-empty days.
  if (!isWorkingDay(date)) {
    return NextResponse.json({ date, slots: [], reason: "weekend" });
  }

  try {
    const slots = await listAvailableSlots(date);
    return NextResponse.json({ date, slots });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not load slots." },
      { status: 500 },
    );
  }
}
