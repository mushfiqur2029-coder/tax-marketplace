import "server-only";

// Phase M+2 fix: the Accountancy Fees expense row was a client-side
// display-only prefill, never persisted to pch_expense_lines unless
// the client actively edited the field. hydrateInputsFromDb (used by
// both the client's own Submit flow and the accountant's P&L review)
// reads pch_expense_lines directly, so any case where the client
// never touched that box had the real tax calculation understating
// expenses by the fee amount and overstating taxable profit / tax
// owed.
//
// Fix: lazy backfill at load time. ensureAccountancyFeesRow writes
// the row with the correct fee if (a) no row exists AND (b) a fee is
// actually computable for this case. Called from both the client's
// PCH page.tsx and the accountant's; idempotent, so a second call
// is a no-op. Also called from scripts/pch-accountancy-fees-backfill
// .mjs for the one-shot sweep across existing cases.
//
// Slot shape kept in step with FIXED_SLOTS in
// src/app/client/cases/[id]/pch/section-3-expenses.tsx: label
// "Accountancy Fees", category "Accountancy & insurance", sa103s_box
// 14, car_cost "No". If that slot changes, this constant has to
// change too (there's a tiny unit test on the test matrix to catch
// drift, kept with the server action in intake-actions.ts).

import { effectiveFeePence } from "@/lib/case/pricing";
import { getTier } from "@/lib/service-catalog";
import type { createAdminClient } from "@/lib/supabase/admin";

export const ACCOUNTANCY_FEES_LABEL = "Accountancy Fees";
const ACCOUNTANCY_FEES_CATEGORY = "Accountancy & insurance";
const ACCOUNTANCY_FEES_SA103S_BOX = 14;
const ACCOUNTANCY_FEES_CAR_COST = "No";

export type EnsureAccountancyFeesResult =
  | { ok: true; created: false; reason: "already_exists" | "no_fee_known" | "pl_confirmed_skipped" }
  | { ok: true; created: true; pence: number }
  | { ok: false; error: string };

export async function ensureAccountancyFeesRow(
  caseId: string,
  admin: ReturnType<typeof createAdminClient>,
  // force=true overrides the pl_confirmed guard so the sweep script
  // can explicitly backfill a confirmed case after a human has decided
  // to re-open it. Default-off so the per-page-load callers never
  // silently change confirmed figures.
  opts?: { force?: boolean },
): Promise<EnsureAccountancyFeesResult> {
  try {
    // Must be a PCH automated case; the fixed-slot expense table only
    // applies here. Belt-and-braces: this helper refuses other tiers so
    // a wrong caller can't drop an Accountancy Fees row on, say, a
    // vat_reg case.
    const { data: caseRow, error: caseErr } = await admin
      .from("cases")
      .select("id, tier, custom_fee_pence")
      .eq("id", caseId)
      .single();
    if (caseErr) return { ok: false, error: caseErr.message };
    if (caseRow.tier !== "uber_phv_automated") {
      return { ok: true, created: false, reason: "no_fee_known" };
    }

    // Already there? Idempotent: do nothing. Also catches the "client
    // edited the row manually" path, where the row already exists
    // with the client's typed value - we never overwrite that.
    const { data: existing, error: existingErr } = await admin
      .from("pch_expense_lines")
      .select("id")
      .eq("case_id", caseId)
      .eq("label", ACCOUNTANCY_FEES_LABEL)
      .limit(1)
      .maybeSingle();
    if (existingErr) return { ok: false, error: existingErr.message };
    if (existing) {
      return { ok: true, created: false, reason: "already_exists" };
    }

    // pl_confirmed guard: once the accountant has locked the P&L, a
    // silent backfill would change the confirmed figures. Refuse by
    // default; the sweep script passes { force: true } for cases a
    // human has decided to re-open.
    if (!opts?.force) {
      const { data: headRow, error: headErr } = await admin
        .from("pch_cases")
        .select("pl_confirmed_at")
        .eq("case_id", caseId)
        .maybeSingle();
      if (headErr) return { ok: false, error: headErr.message };
      if (headRow?.pl_confirmed_at) {
        return { ok: true, created: false, reason: "pl_confirmed_skipped" };
      }
    }

    const tier = await getTier(caseRow.tier);
    const pence = effectiveFeePence(
      {
        custom_fee_pence: (caseRow.custom_fee_pence as number | null) ?? null,
        tier: caseRow.tier as string,
      },
      tier,
    );
    // Nothing worth writing. Either the tier has no price and no
    // custom_fee was set (very unusual on a PCH case) or we got a 0.
    // Don't drop a 0 row - that would be noisy and misleading.
    if (!(pence > 0)) {
      return { ok: true, created: false, reason: "no_fee_known" };
    }

    // Pick the next sort_order so the row lands at the end rather than
    // colliding with existing rows. Mirrors upsertPchExpenseLineAction's
    // behaviour.
    const { data: lastRow } = await admin
      .from("pch_expense_lines")
      .select("sort_order")
      .eq("case_id", caseId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSort = ((lastRow?.sort_order as number | undefined) ?? -1) + 1;

    const { error: insErr } = await admin.from("pch_expense_lines").insert({
      case_id: caseId,
      label: ACCOUNTANCY_FEES_LABEL,
      amount_paid_pence: pence,
      category: ACCOUNTANCY_FEES_CATEGORY,
      sa103s_box: ACCOUNTANCY_FEES_SA103S_BOX,
      car_cost: ACCOUNTANCY_FEES_CAR_COST,
      sort_order: nextSort,
    });
    if (insErr) return { ok: false, error: insErr.message };
    return { ok: true, created: true, pence };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Backfill failed." };
  }
}
