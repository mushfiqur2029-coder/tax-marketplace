// One-shot backfill for the missing Accountancy Fees expense row
// (Phase M+2 bug). The row was a client-side display-only prefill
// until this fix, so any PCH case where the client never typed in
// that box had no DB row and the tax engine under-counted expenses
// by the fee amount.
//
// For every PCH case:
//   1. If an "Accountancy Fees" row already exists -> skip (idempotent)
//   2. If no fee is computable (0 pence) -> skip
//   3. If pl_confirmed_at is set -> flag only, don't touch (silent
//      change would alter the figures the accountant already
//      confirmed, which the user explicitly wants to review manually)
//   4. Otherwise -> insert the row with the correct fee
//
// Dry run by default; --apply actually inserts the rows. --force
// backfills confirmed cases too (use only after a human has decided
// to re-open them).
//
// Usage:
//   npx tsx scripts/pch-accountancy-fees-backfill.mjs            # dry run
//   npx tsx scripts/pch-accountancy-fees-backfill.mjs --apply    # insert
//   npx tsx scripts/pch-accountancy-fees-backfill.mjs --apply --force   # include confirmed cases
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY in env.

import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY. Load .env.local before running.",
  );
  process.exit(1);
}
const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ACCOUNTANCY_FEES_LABEL = "Accountancy Fees";
const ACCOUNTANCY_FEES_CATEGORY = "Accountancy & insurance";
const ACCOUNTANCY_FEES_SA103S_BOX = 14;
const ACCOUNTANCY_FEES_CAR_COST = "No";

// Mirror of src/lib/case/pricing.ts effectiveFeePence - inlined here
// because tsx can't easily walk through "server-only" imports.
function effectiveFeePence(custom_fee_pence, tier) {
  if (custom_fee_pence != null && custom_fee_pence > 0) {
    return custom_fee_pence;
  }
  if (tier?.sale_price_gbp != null && tier.sale_price_gbp > 0) {
    return tier.sale_price_gbp * 100;
  }
  return (tier?.price_gbp ?? 0) * 100;
}

async function run() {
  console.log(
    `Mode: ${APPLY ? "APPLY" : "DRY RUN"}${FORCE ? " (force: include pl_confirmed cases)" : ""}`,
  );
  console.log("");

  // All PCH cases, with the fields effectiveFeePence needs.
  const { data: cases, error: casesErr } = await admin
    .from("cases")
    .select("id, tier, custom_fee_pence")
    .eq("tier", "uber_phv_automated");
  if (casesErr) {
    console.error(`Cases read failed: ${casesErr.message}`);
    process.exit(1);
  }

  // One tier read for the whole run.
  const { data: tierRow } = await admin
    .from("service_tiers")
    .select("id, price_gbp, sale_price_gbp")
    .eq("id", "uber_phv_automated")
    .maybeSingle();

  // All existing Accountancy Fees rows in one read, grouped by case.
  const { data: existingRows, error: existingErr } = await admin
    .from("pch_expense_lines")
    .select("case_id")
    .eq("label", ACCOUNTANCY_FEES_LABEL);
  if (existingErr) {
    console.error(`Existing-rows read failed: ${existingErr.message}`);
    process.exit(1);
  }
  const hasRow = new Set((existingRows ?? []).map((r) => r.case_id));

  // pl_confirmed_at per case.
  const { data: headRows, error: headErr } = await admin
    .from("pch_cases")
    .select("case_id, pl_confirmed_at");
  if (headErr) {
    console.error(`pch_cases read failed: ${headErr.message}`);
    process.exit(1);
  }
  const plConfirmedAtByCase = new Map(
    (headRows ?? []).map((r) => [r.case_id, r.pl_confirmed_at]),
  );

  const toInsert = [];
  const confirmedSkipped = [];
  const noFeeSkipped = [];
  const alreadyExists = [];

  for (const c of cases ?? []) {
    if (hasRow.has(c.id)) {
      alreadyExists.push(c.id);
      continue;
    }
    const pence = effectiveFeePence(c.custom_fee_pence, tierRow);
    if (!(pence > 0)) {
      noFeeSkipped.push(c.id);
      continue;
    }
    const plConfirmedAt = plConfirmedAtByCase.get(c.id);
    if (plConfirmedAt && !FORCE) {
      confirmedSkipped.push({ id: c.id, pence, plConfirmedAt });
      continue;
    }
    toInsert.push({ caseId: c.id, pence });
  }

  console.log(`Totals:`);
  console.log(`  PCH cases scanned:          ${cases?.length ?? 0}`);
  console.log(`  Already have the row:       ${alreadyExists.length}`);
  console.log(`  No fee computable (£0):     ${noFeeSkipped.length}`);
  console.log(`  Confirmed, skipping (flag): ${confirmedSkipped.length}`);
  console.log(`  Would backfill:             ${toInsert.length}`);
  console.log("");

  if (confirmedSkipped.length > 0) {
    console.log(`Confirmed cases flagged for manual review:`);
    for (const c of confirmedSkipped) {
      console.log(`  case=${c.id}  fee=£${(c.pence / 100).toFixed(2)}  pl_confirmed_at=${c.plConfirmedAt}`);
    }
    console.log("");
    console.log(`  (Re-run with --force --apply to backfill these too.)`);
    console.log("");
  }

  if (toInsert.length === 0) {
    console.log("Nothing to insert.");
    return;
  }
  if (!APPLY) {
    console.log(`Would insert these ${toInsert.length} rows (sample up to 20):`);
    for (const row of toInsert.slice(0, 20)) {
      console.log(`  case=${row.caseId}  fee=£${(row.pence / 100).toFixed(2)}`);
    }
    if (toInsert.length > 20) {
      console.log(`  ... (${toInsert.length - 20} more)`);
    }
    console.log("");
    console.log(`Re-run with --apply to insert.`);
    return;
  }

  // Build sort_order per case: insert after whatever's already there.
  const { data: maxSortRows } = await admin
    .from("pch_expense_lines")
    .select("case_id, sort_order")
    .in("case_id", toInsert.map((r) => r.caseId));
  const maxSortByCase = new Map();
  for (const r of maxSortRows ?? []) {
    const prev = maxSortByCase.get(r.case_id) ?? -1;
    if ((r.sort_order ?? -1) > prev) maxSortByCase.set(r.case_id, r.sort_order ?? -1);
  }

  const inserts = toInsert.map((row) => ({
    case_id: row.caseId,
    label: ACCOUNTANCY_FEES_LABEL,
    amount_paid_pence: row.pence,
    category: ACCOUNTANCY_FEES_CATEGORY,
    sa103s_box: ACCOUNTANCY_FEES_SA103S_BOX,
    car_cost: ACCOUNTANCY_FEES_CAR_COST,
    sort_order: (maxSortByCase.get(row.caseId) ?? -1) + 1,
  }));

  // Insert in chunks of 200 so a single payload never gets too big.
  const CHUNK = 200;
  let inserted = 0;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const chunk = inserts.slice(i, i + CHUNK);
    const { error } = await admin.from("pch_expense_lines").insert(chunk);
    if (error) {
      console.error(`Insert chunk ${i} failed: ${error.message}`);
      console.error(`Inserted ${inserted} rows before the failure.`);
      process.exit(1);
    }
    inserted += chunk.length;
  }
  console.log(`Inserted ${inserted} rows.`);
}

await run();
console.log("Done.");
