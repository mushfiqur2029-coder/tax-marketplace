// One-off recompute for cases that locked their P&L BEFORE the
// Phase M+5 fix that wired pch_vehicle.private_use_amount_pence into
// the tax engine (buildPL now subtracts it from taxable profit).
//
// For every confirmed PCH case with a nonzero private use amount:
//   1. Hydrate TaxEngineInputs from the live DB rows (same shape the
//      runtime server actions use).
//   2. Re-run computeAll with the fixed engine.
//   3. Overwrite pch_cases.engine_snapshot with the fresh result.
//      pl_confirmed_at / pl_confirmed_by / client_approval columns
//      are NOT touched - this is a pure recompute of a stored
//      figure, not a re-approval.
//
// Dry run by default; --apply writes the new snapshots. --force is
// NOT a flag here because the P&L lock is the whole point of this
// script - we only hit cases where pl_confirmed_at is set, and we
// deliberately don't clear it.
//
// Usage:
//   npx tsx scripts/pch-private-use-recompute.mjs            # dry run
//   npx tsx scripts/pch-private-use-recompute.mjs --apply    # write
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY in env.
//
// This script imports the real engine modules through the TS source;
// run via a loader that handles `server-only` and `@/` path aliases
// (see scripts/_server-only-loader.mjs). Example invocation:
//   node --experimental-strip-types \
//        --experimental-loader ./scripts/_server-only-loader.mjs \
//        scripts/pch-private-use-recompute.mjs

import { createClient } from "@supabase/supabase-js";
import { computeAll } from "../src/lib/tax-engine/compute.ts";
import { hydrateInputsFromDb } from "../src/lib/pch/engine-snapshot.ts";

const APPLY = process.argv.includes("--apply");

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

async function run() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log("");

  // Target cases: pl_confirmed_at IS NOT NULL AND the linked pch_
  // vehicle row has private_use_amount_pence > 0. Done in two reads
  // so this file doesn't need PostgREST join syntax; the per-case
  // vehicle read then confirms the private use amount.
  const { data: confirmed, error: confirmedErr } = await admin
    .from("pch_cases")
    .select("case_id, pl_confirmed_at")
    .not("pl_confirmed_at", "is", null);
  if (confirmedErr) {
    console.error(`pch_cases read failed: ${confirmedErr.message}`);
    process.exit(1);
  }

  const candidates = [];
  for (const row of confirmed ?? []) {
    const caseId = row.case_id;
    const { data: veh, error: vehErr } = await admin
      .from("pch_vehicle")
      .select("private_use_amount_pence")
      .eq("case_id", caseId)
      .maybeSingle();
    if (vehErr) {
      console.error(`pch_vehicle read for ${caseId} failed: ${vehErr.message}`);
      process.exit(1);
    }
    const puPence = Number(veh?.private_use_amount_pence ?? 0);
    if (puPence > 0) {
      candidates.push({ caseId, pence: puPence, plConfirmedAt: row.pl_confirmed_at });
    }
  }

  console.log(`Confirmed PCH cases scanned:     ${(confirmed ?? []).length}`);
  console.log(`With nonzero private use amount: ${candidates.length}`);
  console.log("");

  if (candidates.length === 0) {
    console.log("Nothing to recompute.");
    return;
  }

  for (const c of candidates) {
    const inputs = await hydrateInputsFromDb(c.caseId, admin);
    const snapshot = computeAll(inputs);
    const pl = snapshot.pl;
    const before = c.caseId;
    const beforeFmt = (p) => `£${(p ?? 0).toFixed(2)}`;

    console.log(`Case ${before}  pl_confirmed_at=${c.plConfirmedAt}`);
    console.log(`  private_use_amount_pence:        ${c.pence}  (£${(c.pence / 100).toFixed(2)})`);
    console.log(`  engine.pl.netProfit:             ${beforeFmt(pl.netProfit)}`);
    console.log(`  engine.pl.capitalAllowances:     ${beforeFmt(pl.capitalAllowances)}`);
    console.log(`  engine.pl.privateUseAmount:      ${beforeFmt(pl.privateUseAmount)}`);
    console.log(`  engine.pl.taxableProfit (NEW):   ${beforeFmt(pl.taxableProfit)}`);
    console.log(`  engine.tax.totalTaxAndNic:       ${beforeFmt(snapshot.tax.totalTaxAndNic)}`);
    console.log(`  engine.tax.dueBy31Jan:           ${beforeFmt(snapshot.tax.dueBy31Jan)}`);

    // Read the stored snapshot before overwriting so the before/after
    // taxable profit shows side by side.
    const { data: existingHead } = await admin
      .from("pch_cases")
      .select("engine_snapshot")
      .eq("case_id", c.caseId)
      .maybeSingle();
    const existingPl = existingHead?.engine_snapshot?.pl ?? null;
    if (existingPl) {
      console.log(`  stored taxableProfit (OLD):      ${beforeFmt(existingPl.taxableProfit)}`);
      console.log(`  delta:                           ${beforeFmt(pl.taxableProfit - (existingPl.taxableProfit ?? 0))}`);
    }
    console.log("");

    if (!APPLY) continue;

    const upd = await admin
      .from("pch_cases")
      .update({ engine_snapshot: snapshot })
      .eq("case_id", c.caseId);
    if (upd.error) {
      console.error(`  write failed: ${upd.error.message}`);
      process.exit(1);
    }
    console.log(`  engine_snapshot overwritten.`);
    console.log("");
  }

  if (!APPLY) {
    console.log(`Re-run with --apply to overwrite engine_snapshot for the ${candidates.length} case(s) above.`);
  } else {
    console.log(`Recomputed ${candidates.length} case(s).`);
  }
}

await run();
console.log("Done.");
