import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchCompanies } from "@/lib/companies-house";

// Server-side proxy for the Companies House API.
//
// The browser never sees the API key — the key stays in the server env
// and the client only talks to this endpoint. We also gate on an
// authenticated session so a leaked /api/companies-house/search URL
// can't be hammered externally and burn our rate-limit budget.
//
// Shape mirrors `LookupResult` in src/lib/companies-house.ts so the
// client reducer can discriminate on `ok` + `fallback` + `error`.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Sign in to search Companies House." },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const result = await searchCompanies(q);
  // Status code mirrors the semantic. Fallback is 503 so a fetch error
  // handler in the browser can treat it the same as an outage without
  // parsing the body.
  if (result.ok === false && "fallback" in result) {
    return NextResponse.json(result, { status: 503 });
  }
  if (result.ok === false) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
