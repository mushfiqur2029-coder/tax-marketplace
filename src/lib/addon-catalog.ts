// Shared helpers for addon_catalog config rows.
//
// addon_catalog carries two kinds of rows:
//   • Real preset add-ons (every row whose key does not start with __).
//     Accountants pick these from the add-on picker; price snapshotted
//     onto case_addons at request time.
//   • Config rows (keys prefixed __). Not pickable; carry a single tuning
//     value in amount_pence. Today there's one: __custom_max__ (migration
//     0076) which caps the amount a custom add-on can be submitted at.
//
// Keep the caller free of the string literal, any new config row should
// land here as a named export.

import type { SupabaseClient } from "@supabase/supabase-js";

export const CUSTOM_ADDON_CAP_KEY = "__custom_max__";

// Fallback matches the pre-0076 hardcoded value in accountant/actions.ts
// so if the row is missing for any reason (migration not applied yet in
// local dev, truncated table in a test fixture) the server still refuses
// absurd amounts rather than throwing a confusing "cap row not found"
// error at a working accountant.
export const CUSTOM_ADDON_CAP_FALLBACK_PENCE = 500_000;

// Returns the current cap in pence. On any read error OR a missing row,
// falls back to the pre-migration constant. The caller does not need to
// distinguish between "no row yet" and "DB error", both are safe-defaults.
export async function getCustomAddonCapPence(
  supabase: SupabaseClient,
): Promise<number> {
  const { data } = await supabase
    .from("addon_catalog")
    .select("amount_pence")
    .eq("key", CUSTOM_ADDON_CAP_KEY)
    .maybeSingle();
  const value = data?.amount_pence;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return CUSTOM_ADDON_CAP_FALLBACK_PENCE;
  }
  return value;
}
