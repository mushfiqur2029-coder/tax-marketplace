// Create a test accountant + optionally a test client + a submitted
// PCH case so E2E runs can start from a clean, reproducible state.
//
// Usage:
//
//   node scripts/create-test-accountant.mjs seed-all
//     Full E2E setup: accountant + client + PCH case (status=submitted,
//     assigned to the accountant). Prints both users' creds + the
//     new case id.
//
//   node scripts/create-test-accountant.mjs <caseId>
//     Legacy single-case mode: creates/updates the test accountant and
//     assigns to the given case id. Doesn't touch the client.
//
// Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY in .env.local.
//
// Shape:
//   accountant@test.local / testpass123    role=accountant, approved
//   e2e+pch@gmail.com    / testpass123    role=client
//   cases row: tier='uber_phv_automated', segment='personal',
//              status='submitted', client_id + accountant_id set
//   pch_cases head: case_id + tax_year default '2025/26' (cl_email
//              populated from client email; everything else null so
//              the client workspace renders the empty-state pattern
//              and the operator can drive the AI interviews afresh).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ACCT_EMAIL = "accountant@test.local";
const ACCT_PASSWORD = "testpass123";
const ACCT_NAME = "Test Accountant";

const CLIENT_EMAIL = "e2e+pch@gmail.com";
const CLIENT_PASSWORD = "testpass123";
const CLIENT_NAME = "E2E PCH Driver";

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

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node scripts/create-test-accountant.mjs seed-all");
  console.error("   or: node scripts/create-test-accountant.mjs <caseId>");
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

// --------------------------------------------------------------------
// Shared: create or reuse an auth user with a given role + password.
// --------------------------------------------------------------------
async function createOrReuseAuthUser({ email, password, role, name }) {
  const { data: created, error: createErr } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role, name },
  });
  if (!createErr) {
    console.log(`Created new ${role}:`, created.user.id, `(${email})`);
    return created.user.id;
  }
  if (!/already (been )?registered|exists/i.test(createErr.message)) {
    console.error(`createUser(${email}) failed:`, createErr.message);
    process.exit(1);
  }
  // Reuse. listUsers paginates in batches of 1000 by default.
  const { data: list, error: listErr } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) {
    console.error("listUsers failed:", listErr.message);
    process.exit(1);
  }
  const found = list.users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
  if (!found) {
    console.error(`Said already registered, but ${email} not in listUsers. Aborting.`);
    process.exit(1);
  }
  // Reset the password so the operator can always sign in with the known value.
  const { error: pwErr } = await sb.auth.admin.updateUserById(found.id, { password });
  if (pwErr) {
    console.error("Password reset failed:", pwErr.message);
    process.exit(1);
  }
  console.log(`Reused existing ${role}:`, found.id, `(${email})`);
  return found.id;
}

// --------------------------------------------------------------------
// Shared: ensure users row is on the right role + approved profile.
// --------------------------------------------------------------------
async function ensureAccountantProfile(userId) {
  const { error: userRoleErr } = await sb
    .from("users")
    .update({ role: "accountant", status: "active" })
    .eq("id", userId);
  if (userRoleErr) {
    console.error("users row update failed:", userRoleErr.message);
    process.exit(1);
  }
  const { error: profErr } = await sb
    .from("accountant_profiles")
    .upsert({ user_id: userId, name: ACCT_NAME, approval_status: "approved" }, { onConflict: "user_id" });
  if (profErr) {
    console.error("accountant_profiles upsert failed:", profErr.message);
    process.exit(1);
  }
}

async function ensureClientProfile(userId) {
  const { error: userRoleErr } = await sb
    .from("users")
    .update({ role: "client", status: "active" })
    .eq("id", userId);
  if (userRoleErr) {
    console.error("users row update failed:", userRoleErr.message);
    process.exit(1);
  }
  // The handle_new_user trigger (migration 0001) creates client_profiles
  // automatically; still upsert to make sure name is set for legacy rows.
  const { error: profErr } = await sb
    .from("client_profiles")
    .upsert({ user_id: userId, name: CLIENT_NAME }, { onConflict: "user_id" });
  if (profErr) {
    console.error("client_profiles upsert failed:", profErr.message);
    process.exit(1);
  }
}

// --------------------------------------------------------------------
// Mode A: legacy single-case assign.
// --------------------------------------------------------------------
async function assignToExistingCase(caseId) {
  const acctId = await createOrReuseAuthUser({
    email: ACCT_EMAIL, password: ACCT_PASSWORD, role: "accountant", name: ACCT_NAME,
  });
  await ensureAccountantProfile(acctId);
  const { data: caseRow, error: caseErr } = await sb
    .from("cases")
    .update({ accountant_id: acctId })
    .eq("id", caseId)
    .select("id, client_id, accountant_id, status")
    .maybeSingle();
  if (caseErr) {
    console.error("cases update failed:", caseErr.message);
    process.exit(1);
  }
  if (!caseRow) {
    console.error("No case with id", caseId);
    process.exit(1);
  }
  console.log("\nOK.");
  console.log("  accountant: ", ACCT_EMAIL, "/", ACCT_PASSWORD);
  console.log("  case:       ", caseRow.id, "(status:", caseRow.status + ")");
}

// --------------------------------------------------------------------
// Mode B: full seed: accountant + client + PCH case.
// --------------------------------------------------------------------
async function seedAll() {
  const acctId = await createOrReuseAuthUser({
    email: ACCT_EMAIL, password: ACCT_PASSWORD, role: "accountant", name: ACCT_NAME,
  });
  await ensureAccountantProfile(acctId);

  const clientId = await createOrReuseAuthUser({
    email: CLIENT_EMAIL, password: CLIENT_PASSWORD, role: "client", name: CLIENT_NAME,
  });
  await ensureClientProfile(clientId);

  // Find or create a submitted PCH case for this client. Reuse if one
  // already exists so repeat runs don't accumulate test cases.
  const { data: existing } = await sb
    .from("cases")
    .select("id, status, accountant_id")
    .eq("client_id", clientId)
    .eq("tier", "uber_phv_automated")
    .order("created_at", { ascending: false })
    .limit(1);
  let caseId;
  if (existing && existing[0]) {
    caseId = existing[0].id;
    // Make sure it's submitted + assigned to the test accountant.
    const { error: upErr } = await sb
      .from("cases")
      .update({ status: "submitted", accountant_id: acctId })
      .eq("id", caseId);
    if (upErr) {
      console.error("cases update failed:", upErr.message);
      process.exit(1);
    }
    console.log("Reused existing case:", caseId);
  } else {
    const { data: inserted, error: insErr } = await sb
      .from("cases")
      .insert({
        client_id: clientId,
        accountant_id: acctId,
        tier: "uber_phv_automated",
        segment: "personal",
        status: "submitted",
      })
      .select("id")
      .single();
    if (insErr) {
      console.error("cases insert failed:", insErr.message);
      process.exit(1);
    }
    caseId = inserted.id;
    console.log("Created new case:", caseId);
  }

  // pch_cases head row. The handle_new_user trigger doesn't create one
  // (it's a client-workspace-level artefact), so upsert here.
  const { error: pchErr } = await sb
    .from("pch_cases")
    .upsert({ case_id: caseId, cl_email: CLIENT_EMAIL }, { onConflict: "case_id" });
  if (pchErr) {
    console.error("pch_cases upsert failed:", pchErr.message);
    process.exit(1);
  }

  console.log("\nOK, test world ready.");
  console.log("  accountant: ", ACCT_EMAIL, "/", ACCT_PASSWORD);
  console.log("  client:     ", CLIENT_EMAIL, "/", CLIENT_PASSWORD);
  console.log("  case:       ", caseId);
}

if (arg === "seed-all") {
  await seedAll();
} else if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(arg)) {
  await assignToExistingCase(arg);
} else {
  console.error("Argument must be 'seed-all' or a case UUID.");
  console.error("  node scripts/create-test-accountant.mjs seed-all");
  console.error("  node scripts/create-test-accountant.mjs <caseId>");
  process.exit(1);
}
