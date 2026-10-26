// One-shot sweep for the row-creation race the user found on
// pch_expense_lines (case 89820041, Phase M+1 report). Groups
// pch_income_lines by (case_id, source) and pch_expense_lines by
// (case_id, label); any group with count > 1 is a bug state since
// both tables are fixed-slot lists post-Phase J.
//
// Prints what would be deleted but doesn't delete anything unless
// --apply is passed. Keeps the newer row of each pair (whichever was
// typed last) and deletes the older ones, matching the manual fix
// the user already applied to the test case.
//
// Usage:
//   npx tsx scripts/pch-duplicate-rows-sweep.mjs            # dry run
//   npx tsx scripts/pch-duplicate-rows-sweep.mjs --apply    # actually delete
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY in env (the
// same vars src/lib/supabase/admin.ts uses).

import { createClient } from "@supabase/supabase-js";

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

async function sweep({ table, groupKey, labelField }) {
  console.log(`\n== ${table} ==`);
  const { data: rows, error } = await admin
    .from(table)
    .select(`id, case_id, ${labelField}, created_at, edited_at`)
    .order("created_at", { ascending: true });
  if (error) {
    console.error(`  read failed: ${error.message}`);
    return;
  }
  const buckets = new Map();
  for (const r of rows ?? []) {
    const label = (r[labelField] ?? "").trim();
    if (!label) continue;
    const key = `${r.case_id}|${label}`;
    const list = buckets.get(key) ?? [];
    list.push(r);
    buckets.set(key, list);
  }
  const dupeGroups = [...buckets.entries()].filter(([, list]) => list.length > 1);
  if (dupeGroups.length === 0) {
    console.log("  no duplicates found.");
    return;
  }
  console.log(`  ${dupeGroups.length} duplicate group(s):`);
  const toDelete = [];
  for (const [key, list] of dupeGroups) {
    const [caseId, label] = key.split("|");
    // Keep whichever was edited most recently (edited_at), tiebreak by
    // created_at. Matches the manual fix the user already applied.
    const sorted = [...list].sort((a, b) => {
      const ae = a.edited_at ? Date.parse(a.edited_at) : Date.parse(a.created_at);
      const be = b.edited_at ? Date.parse(b.edited_at) : Date.parse(b.created_at);
      return be - ae; // newest first
    });
    const keep = sorted[0];
    const drop = sorted.slice(1);
    console.log(
      `  case=${caseId} ${groupKey}="${label}" -> ${list.length} rows, keep ${keep.id} (edited_at=${keep.edited_at ?? "null"}), drop ${drop.map((r) => r.id).join(", ")}`,
    );
    for (const r of drop) toDelete.push(r.id);
  }
  if (!APPLY) {
    console.log(`\n  dry run: would delete ${toDelete.length} rows. Re-run with --apply to actually delete.`);
    return;
  }
  // Delete in one shot. Supabase chunks large IN clauses internally.
  const { error: delErr } = await admin.from(table).delete().in("id", toDelete);
  if (delErr) {
    console.error(`  delete failed: ${delErr.message}`);
    return;
  }
  console.log(`\n  deleted ${toDelete.length} rows.`);
}

await sweep({
  table: "pch_income_lines",
  groupKey: "source",
  labelField: "source",
});
await sweep({
  table: "pch_expense_lines",
  groupKey: "label",
  labelField: "label",
});

console.log("\nDone.");
