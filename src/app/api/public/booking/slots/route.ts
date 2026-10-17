import { NextResponse, type NextRequest } from "next/server";
import {
  isCalendarConfigured,
  isWorkingDay,
  listAvailableSlots,
} from "@/lib/calendar/booking";

// GET /api/public/booking/slots?date=YYYY-MM-DD
//
// Public (unauthenticated) counterpart of /api/booking/slots. Called
// cross-origin from the static marketing /contact page served from
// sterlingledger.co.uk, which runs the vanilla-JS slot picker.
//
// Response shape matches the auth'd endpoint byte for byte so the two
// pickers (React in-app + vanilla static) can share expectations.
// Returned slots are already filtered to future-only and against the
// shared Sterling Ledger calendar's busy ranges.

const ALLOWED_ORIGINS = new Set([
  "https://sterlingledger.co.uk",
  "https://www.sterlingledger.co.uk",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
  }
  return { "Vary": "Origin" };
}

export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");

  if (!isCalendarConfigured()) {
    return NextResponse.json(
      { error: "Booking is not configured on this environment." },
      { status: 503, headers: corsHeaders(origin) },
    );
  }

  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "Pass ?date=YYYY-MM-DD." },
      { status: 400, headers: corsHeaders(origin) },
    );
  }

  // Weekend short-circuit so we don't burn a FreeBusy call on days we
  // already know are empty.
  if (!isWorkingDay(date)) {
    return NextResponse.json(
      { date, slots: [], reason: "weekend" },
      { headers: corsHeaders(origin) },
    );
  }

  try {
    const slots = await listAvailableSlots(date);
    return NextResponse.json(
      { date, slots },
      { headers: corsHeaders(origin) },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not load slots." },
      { status: 500, headers: corsHeaders(origin) },
    );
  }
}
