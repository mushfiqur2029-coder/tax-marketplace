// Create a test accountant account for live E2E and assign it to a
// specific case. Idempotent-ish: if the auth user already exists it
// reuses the existing row; still re-runs the approval flip and the
// case assignment.
//
// Usage:
//   node scripts/create-test-accountant.mjs <caseId>
//
// Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY in .env.local.
//
// What it does:
//   1. supabase.auth.admin.createUser(email, password, metadata)
//      metadata.role = 'accountant' is picked up by the public.handle_new_user
//      trigger from migration 0001, which inserts public.users + public.accountant_profiles.
//   2. UPDATE public.accountant_profiles SET approval_status = 'approved'
//      WHERE user_id = <new id>.
//      The trigger-inserted row defaults to 'pending' (migration 0007);
//      an approved profile is required for /accountant/* routes.
//   3. UPDATE public.cases SET accountant_id = <new id> WHERE id = <caseId>.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const EMAIL = "accountant@test.local";
const PASSWORD = "testpass123";
const NAME = "Test Accountant";

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
  console.error("Usage: node scripts/create-test-accountant.mjs <caseId>");
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

// 1. Create auth user (or reuse if already exists).
let userId;
const { data: created, error: createErr } = await sb.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
  user_metadata: { role: "accountant", name: NAME },
});

if (createErr) {
  if (/already (been )?registered|exists/i.test(createErr.message)) {
    console.log("Auth user already exists, looking up id...");
    const { data: list, error: listErr } = await sb.auth.admin.listUsers({ perPage: 200 });
    if (listErr) {
      console.error("listUsers failed:", listErr.message);
      process.exit(1);
    }
    const found = list.users.find((u) => (u.email || "").toLowerCase() === EMAIL);
    if (!found) {
      console.error("Said already registered, but not in listUsers. Aborting.");
      process.exit(1);
    }
    userId = found.id;
    // Make sure the password is what we expect.
    const { error: updErr } = await sb.auth.admin.updateUserById(userId, { password: PASSWORD });
    if (updErr) {
      console.error("Password reset failed:", updErr.message);
      process.exit(1);
    }
  } else {
    console.error("createUser failed:", createErr.message);
    process.exit(1);
  }
} else {
  userId = created.user.id;
  console.log("Created new auth user:", userId);
}

// 2. Make sure public.users + accountant_profiles rows exist and the role/approval are right.
// The handle_new_user trigger should have created them, but we tolerate the case
// where the user was created by hand without the role metadata.
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
  .upsert({ user_id: userId, name: NAME, approval_status: "approved" }, { onConflict: "user_id" });
if (profErr) {
  console.error("accountant_profiles upsert failed:", profErr.message);
  process.exit(1);
}

// 3. Assign the case.
const { data: caseRow, error: caseErr } = await sb
  .from("cases")
  .update({ accountant_id: userId })
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

console.log("OK.");
console.log("  user_id:       ", userId);
console.log("  email:         ", EMAIL);
console.log("  password:      ", PASSWORD);
console.log("  case assigned: ", caseRow.id, "(status:", caseRow.status + ")");
