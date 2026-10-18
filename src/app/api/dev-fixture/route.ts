import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Dev-only fixture server for local E2E tests. Returns the reference
// Uber annual summary PDF so the browser can upload it through the
// real client flow. Returns 403 in production.

export const dynamic = "force-dynamic";

export function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }
  const path = join(process.cwd(), "reference", "pch-uber", "1. PCH", "SA 2481", "2024-25 docs", "uber_annual_2024.pdf");
  const bytes = readFileSync(path);
  return new NextResponse(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline; filename=\"uber_annual_2024.pdf\"",
      "Cache-Control": "no-store",
    },
  });
}
