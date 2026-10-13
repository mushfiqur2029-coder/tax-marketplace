// Verify the password-reset flow sends emails whose links point at
// the new domain. Flow:
//   1. Create a test user via admin API.
//   2. Ask Supabase to generate a recovery link with the same
//      redirectTo the production app uses (siteUrl() + "/reset-password",
//      which with the new NEXT_PUBLIC_SITE_URL is
//      https://apisterlingledger.co.uk/reset-password).
//   3. Inspect the returned link — confirm its redirect_to parameter
//      is the new host.
//   4. Delete the test user.
// This mirrors what src/app/actions.ts forgotPasswordAction does, minus
// the actual email send. Supabase embeds the same redirect_to in the
// real email, so verifying it here tells us what users will click.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

const email = `e2e-pwreset-mv7a2b3c@local.test`;
const PWD = "TestPass123!";
const SITE = "https://apisterlingledger.co.uk";

console.log(`Creating test user ${email}...`);
let uid;
{
  const { data: existing } = await sb.from("users").select("id").eq("email", email).maybeSingle();
  if (existing) {
    uid = existing.id;
  } else {
    const { data, error } = await sb.auth.admin.createUser({ email, password: PWD, email_confirm: true });
    if (error) throw new Error(error.message);
    uid = data.user.id;
  }
}
console.log(`  uid: ${uid}`);

console.log(`\nGenerating recovery link (redirectTo = ${SITE}/reset-password)...`);
const { data: link, error: linkErr } = await sb.auth.admin.generateLink({
  type: "recovery",
  email,
  options: { redirectTo: `${SITE}/reset-password` },
});
if (linkErr) {
  console.log("  FAIL:", linkErr.message);
  process.exit(1);
}

const url = link.properties?.action_link ?? "";
console.log(`\nGenerated link:\n  ${url}\n`);

// Verify: does the link include the new host as redirect_to?
if (!url.includes(encodeURIComponent(`${SITE}/reset-password`))) {
  console.log(`FAIL: expected ${SITE}/reset-password encoded in link, not found`);
  process.exit(1);
}
console.log(`PASS: redirect_to contains ${SITE}/reset-password`);

// Also verify Supabase's own hosted redirect target.
const parsed = new URL(url);
console.log(`\nSupabase action host: ${parsed.host}`);
console.log(`Supabase action type:  ${parsed.searchParams.get("type") ?? "(embedded)"}`);
const redirectTo = parsed.searchParams.get("redirect_to");
console.log(`redirect_to param:     ${redirectTo}`);

if (redirectTo !== `${SITE}/reset-password`) {
  console.log(`\nFAIL: redirect_to not exactly the expected value`);
  process.exit(1);
}
console.log(`\nALL CHECKS PASS — reset emails will land users at ${SITE}/reset-password`);

console.log(`\nCleaning up test user ${email}...`);
await sb.auth.admin.deleteUser(uid);
console.log("  deleted");
