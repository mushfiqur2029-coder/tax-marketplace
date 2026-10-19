// Teardown a PCH automated test case + every associated row from the
// live Supabase. Cascades handle most children; this script is explicit
// about everything so the operator can see exactly what gets removed.
//
// Usage:
//   node scripts/tear-down-pch-case.mjs <caseId>
//
// Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY in .env.local.
//
// Phase 6 Slice 7 ships this to clean up the e2e+pch test case
// f7b9702a-902a-44a2-ba64-5069d194ded0 after Phase 6 lands. Keep for
// future test-case teardowns; the Phase 6 schema (pch_bank_transactions
// + line-item audit columns + final-pack columns) is already covered
// via case_id cascade on every table.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const text = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  return out;
}

const caseId = process.argv[2];
if (!caseId) {
  console.error("Usage: node scripts/tear-down-pch-case.mjs <caseId>");
  process.exit(1);
}
if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(caseId)) {
  console.error("Case id must be a UUID.");
  process.exit(1);
}

const env = loadEnv();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY must be set in .env.local.");
  process.exit(1);
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Confirm the case exists + is a PCH automated case before deleting.
const { data: caseRow } = await sb
  .from("cases")
  .select("id, tier, status, client_id")
  .eq("id", caseId)
  .maybeSingle();
if (!caseRow) {
  console.log("No case with id", caseId, "- nothing to do.");
  process.exit(0);
}
console.log("Found case:", { id: caseRow.id, tier: caseRow.tier, status: caseRow.status });
if (caseRow.tier !== "uber_phv_automated") {
  console.error("Refusing to delete: tier is not uber_phv_automated. Delete manually if intentional.");
  process.exit(1);
}

// Order of deletion. Most relations are cascade-on-delete from cases,
// so deleting cases is usually enough. Being explicit here lets the
// operator see the counts for each table and catches any new relation
// that got added without a cascade.
const tables = [
  "pch_bank_transactions",
  "pch_doc_extractions",
  "pch_overrides",
  "pch_check_status",
  "pch_vehicle",
  "pch_expense_lines",
  "pch_income_lines",
  "pch_doc_status",
  "case_messages",
  "case_addons",
  "case_documents",
  "pch_cases",
  "notifications",
];

for (const table of tables) {
  const { count, error } = await sb
    .from(table)
    .delete({ count: "exact" })
    .eq("case_id", caseId);
  if (error) {
    console.warn("  !", table, "delete error:", error.message);
  } else {
    console.log("  -", table, "deleted", count ?? 0, "row(s)");
  }
}

// Finally delete the cases row itself.
const { error: caseErr } = await sb.from("cases").delete().eq("id", caseId);
if (caseErr) {
  console.error("cases delete failed:", caseErr.message);
  process.exit(1);
}
console.log("cases row deleted.");
console.log("Done.");
