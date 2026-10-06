import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PLAN_TIERS,
  type PlanTier,
  type TierId,
  type PlanGroup,
} from "@/lib/plans";

// Service catalogue reader. All runtime price + display reads should
// go through this (via getTier / getAllTiers) so admin edits to the
// public.service_catalog table propagate everywhere.
//
// Code-side PLAN_TIERS from src/lib/plans.ts is the fallback used
// when (a) the DB row is missing or (b) the DB fetch fails. That keeps
// local dev + build-time rendering working if the table hasn't been
// seeded yet, and keeps the type-level TierId union authoritative:
// adding a NEW tier is a code change (new union member + new seed row
// via migration), not something admin can do via the UI.

type Row = {
  id: string;
  group: string;
  title: string;
  tagline: string;
  description: string | null;
  features: string[] | null;
  footer_line: string | null;
  hero_line: string | null;
  price_gbp: number;
  original_gbp: number | null;
  save_gbp: number | null;
  price_display: string | null;
  price_gbp_subtitle: string | null;
  price_suffix: string | null;
  price_per: string | null;
  featured: boolean;
  active: boolean;
  display_order: number;
  requires_enquiry: boolean;
  admin_create_only: boolean;
};

function rowToTier(row: Row): PlanTier {
  return {
    id: row.id as TierId,
    group: row.group as PlanGroup,
    title: row.title,
    tagline: row.tagline,
    priceGbp: row.price_gbp,
    originalGbp: row.original_gbp ?? undefined,
    saveGbp: row.save_gbp ?? undefined,
    priceGbpSubtitle: row.price_gbp_subtitle ?? undefined,
    priceSuffix: row.price_suffix ?? undefined,
    pricePer: row.price_per ?? undefined,
    featured: row.featured || undefined,
    heroLine: row.hero_line ?? undefined,
    features: row.features ?? undefined,
    description: row.description ?? undefined,
    footerLine: row.footer_line ?? undefined,
    priceDisplay: row.price_display ?? undefined,
    requiresEnquiry: row.requires_enquiry || undefined,
    adminCreateOnly: row.admin_create_only || undefined,
    active: row.active,
  };
}

// Static fallback keyed by id, used when the DB fetch fails or returns
// nothing for a given tier id. Keeps the system functional on first
// boot (table empty) and in dev without network.
function staticFallback(id: string): PlanTier | null {
  return PLAN_TIERS.find((t) => t.id === id) ?? null;
}

// Fetch a single tier by id. Returns null only when both the DB and
// the static fallback miss (i.e. unknown tier id).
export async function getTier(
  id: string | null | undefined,
): Promise<PlanTier | null> {
  if (!id) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("service_catalog")
    .select("*")
    .eq("id", id)
    .maybeSingle<Row>();
  if (error) {
    console.error(`[service_catalog] fetch failed for ${id}:`, error.message);
    return staticFallback(id);
  }
  if (!data) return staticFallback(id);
  return rowToTier(data);
}

type AllTiersOpts = {
  group?: PlanGroup;
  // Default behaviour hides adminCreateOnly tiers from the two
  // client-wizard helpers (getPersonalTiers / getCompanyTiers). Pass
  // true from the admin UI where we want to see all tiers including
  // the bespoke one.
  includeAdminCreateOnly?: boolean;
  // Default hides inactive rows. Admin UI sets includeInactive=true.
  includeInactive?: boolean;
};

export async function getAllTiers(
  opts: AllTiersOpts = {},
): Promise<PlanTier[]> {
  const admin = createAdminClient();
  let q = admin
    .from("service_catalog")
    .select("*")
    .order("display_order", { ascending: true });
  if (opts.group) q = q.eq("group", opts.group);
  if (!opts.includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) {
    console.error("[service_catalog] list failed:", error.message);
    // Fall back to the static array; preserve the opts filters.
    return PLAN_TIERS.filter((t) => {
      if (opts.group && t.group !== opts.group) return false;
      if (!opts.includeAdminCreateOnly && t.adminCreateOnly) return false;
      return true;
    });
  }
  let tiers = (data as Row[]).map(rowToTier);
  if (!opts.includeAdminCreateOnly) {
    tiers = tiers.filter((t) => !t.adminCreateOnly);
  }
  return tiers;
}

// Convenience wrappers mirroring the sync PERSONAL_TIERS / COMPANY_TIERS
// exports that plans.ts used to provide.
export async function getPersonalTiers(): Promise<PlanTier[]> {
  return getAllTiers({ group: "personal" });
}

export async function getCompanyTiers(): Promise<PlanTier[]> {
  return getAllTiers({ group: "company" });
}

// Convenience for the "pick the right list for this segment" case the
// wizard uses. SegmentId import kept local to avoid widening the
// public surface of this file.
import type { SegmentId } from "@/lib/segments";
export async function getTiersForSegment(
  segmentId: SegmentId | null | undefined,
): Promise<PlanTier[]> {
  if (segmentId === "limited_company_vat") return getCompanyTiers();
  return getPersonalTiers();
}

// Admin writes --------------------------------------------------------
export type ServiceCatalogPatch = {
  title?: string;
  tagline?: string;
  description?: string | null;
  features?: string[] | null;
  footer_line?: string | null;
  hero_line?: string | null;
  price_gbp?: number;
  original_gbp?: number | null;
  save_gbp?: number | null;
  price_display?: string | null;
  price_gbp_subtitle?: string | null;
  price_suffix?: string | null;
  price_per?: string | null;
  featured?: boolean;
  active?: boolean;
  display_order?: number;
};

export async function updateServiceCatalogRow(
  id: string,
  patch: ServiceCatalogPatch,
  updatedBy: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("service_catalog")
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: updatedBy })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
