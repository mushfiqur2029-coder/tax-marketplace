import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAllTiers } from "@/lib/service-catalog";

// Public, unauthenticated pricing feed. Consumed by the static marketing
// site at sterlingledger.co.uk (served from cPanel) so prices stay in
// sync with the admin-edited catalogues without a static-site redeploy.
//
// Shape is deliberately stable: additive-only, never remove fields.
// The marketing page's small inline fetcher reads this response, matches
// by `id` / `key`, and overwrites the HTML placeholders.
//
// What this surfaces:
//   • tiers, service_catalog rows, filtered to active + non-admin-create-only
//                (admin-only tiers like the bespoke LC are hidden from
//                 the public price list; they're ever-only reachable via
//                 /admin/enquiries bespoke flow)
//   • addons, addon_catalog rows, filtered to active + non-sentinel
//                (sentinels like __custom_max__ are config, not real
//                 add-ons, see src/lib/addon-catalog.ts)
//
// What this does NOT surface:
//   • profile data, user info, cases, anything else, this endpoint is
//     deliberately narrow to the pricing surface.

// CORS: only the two marketing hostnames can read this. Browser CORS
// alone doesn't prevent a server-side scrape, but it closes the obvious
// "random site embeds our prices in their marketing" footgun.
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
  // No matching origin: respond without the ACAO header so the browser
  // refuses to expose the body. We still return the JSON for direct
  // same-origin reads (e.g. curl from the Next.js host) which is harmless.
  return { "Vary": "Origin" };
}

export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");

  // Tiers via the shared helper so filters stay consistent with the
  // Next.js marketing homepage (active, non-admin-only).
  const [personal, company] = await Promise.all([
    getAllTiers({ group: "personal" }),
    getAllTiers({ group: "company" }),
  ]);
  const tiers = [...personal, ...company].map((t) => ({
    id: t.id,
    group: t.group,
    title: t.title,
    tagline: t.tagline,
    description: t.description ?? null,
    features: t.features ?? [],
    footerLine: t.footerLine ?? null,
    heroLine: t.heroLine ?? null,
    priceGbp: t.priceGbp,
    // When salePriceGbp is non-null, the marketing site renders
    // "was £priceGbp now £salePriceGbp" strike-through styling.
    salePriceGbp: t.salePriceGbp ?? null,
    // originalGbp / saveGbp are legacy fields currently unused by the
    // marketing UI. Kept in the response for forward-compat.
    originalGbp: t.originalGbp ?? null,
    saveGbp: t.saveGbp ?? null,
    priceDisplay: t.priceDisplay ?? null,
    priceGbpSubtitle: t.priceGbpSubtitle ?? null,
    priceSuffix: t.priceSuffix ?? null,
    pricePer: t.pricePer ?? null,
    featured: t.featured ?? false,
    requiresEnquiry: t.requiresEnquiry ?? false,
  }));

  // Addons: direct read because getAllTiers' sibling helper lives in a
  // different lib. Filter __-prefixed sentinel rows (config, not real
  // add-ons) client-side here same as the admin page does.
  const admin = createAdminClient();
  const { data: addonRows } = await admin
    .from("addon_catalog")
    .select("key, name, description, amount_pence, active")
    .eq("active", true)
    .order("name", { ascending: true });
  const addons = (addonRows ?? [])
    .filter((r) => !r.key.startsWith("__"))
    .map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      amountPence: r.amount_pence,
    }));

  const body = {
    tiers,
    addons,
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: 200,
    headers: {
      ...corsHeaders(origin),
      // Short edge cache so repeated marketing page loads don't hit the
      // DB; stale-while-revalidate keeps the UX snappy while admin edits
      // propagate within a minute or two.
      "Cache-Control":
        "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
