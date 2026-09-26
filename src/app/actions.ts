"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type AuthState = {
  error?: string;
  // Optional link rendered next to the error message (e.g. "log in instead"
  // when the email is already registered). Kept separate from the string
  // so we don't have to embed markup in a translated/user-facing message.
  errorHref?: string;
  errorHrefLabel?: string;
  info?: string;
} | null;

const AVATAR_BUCKET = "avatars";

export async function signUpAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "");
  const contactNumber = String(formData.get("contact_number") ?? "").trim();
  // Address is now collected as structured fields for browser autofill.
  // Join into a single string for storage (client_profiles.address is text).
  const addressLine1 = String(formData.get("address_line1") ?? "").trim();
  const addressLine2 = String(formData.get("address_line2") ?? "").trim();
  const addressCity = String(formData.get("address_city") ?? "").trim();
  const addressPostcode = String(formData.get("address_postcode") ?? "").trim();
  const address = [addressLine1, addressLine2, addressCity, addressPostcode]
    .filter(Boolean)
    .join("\n");
  const companyEmail = String(formData.get("company_email") ?? "").trim();
  const companyName = String(formData.get("company_name") ?? "").trim();
  const avatar = formData.get("avatar");

  if (role !== "client" && role !== "accountant") {
    // "admin" is explicitly rejected — admins are only created by other admins
    // via the admin dashboard. See supabase/README.md for bootstrap.
    return { error: "Please choose an account type." };
  }
  if (!name) return { error: "Full name is required." };
  if (!email) return { error: "Email is required." };
  if (!contactNumber) return { error: "Contact number is required." };
  if (role === "client" && (!addressLine1 || !addressCity || !addressPostcode)) {
    return {
      error: "Address line 1, city, and postcode are all required.",
    };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  // Check public.users first — Supabase's own signUp with an existing
  // confirmed email silently no-ops (email-enumeration protection), which
  // leaves the user confused when they never receive a confirmation. This
  // is the same account-existence trade-off we already accept on
  // signInAction: readable error > silent failure.
  const preadmin = createAdminClient();
  const { data: existing } = await preadmin
    .from("users")
    .select("role")
    .ilike("email", email)
    .maybeSingle();
  if (existing) {
    const article = /^[aeiou]/i.test(existing.role) ? "an" : "a";
    return {
      error: `This email is already registered as ${article} ${existing.role}.`,
      errorHref: "/login",
      errorHrefLabel: "Log in instead",
    };
  }

  const metadata: Record<string, string> = {
    role,
    name,
    contact_number: contactNumber,
  };
  if (role === "client") {
    metadata.address = address;
  } else {
    if (companyEmail) metadata.company_email = companyEmail;
    if (companyName) metadata.company_name = companyName;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: metadata },
  });

  if (error) return { error: error.message };

  const userId = data.user?.id;

  // Upload avatar (optional) via admin client so it works even when the user
  // hasn't yet been session-authenticated (e.g. email confirmation required).
  if (avatar instanceof File && avatar.size > 0 && userId) {
    if (!avatar.type.startsWith("image/")) {
      return { error: "Avatar must be an image." };
    }
    if (avatar.size > 5 * 1024 * 1024) {
      return { error: "Avatar must be under 5 MB." };
    }
    const admin = createAdminClient();
    const ext = (avatar.name.split(".").pop() ?? "jpg").toLowerCase();
    const path = `${userId}/${Date.now()}.${ext.replace(/[^a-z0-9]/g, "")}`;
    const buf = new Uint8Array(await avatar.arrayBuffer());
    const { error: upErr } = await admin.storage
      .from(AVATAR_BUCKET)
      .upload(path, buf, {
        contentType: avatar.type,
        upsert: false,
      });
    if (upErr) {
      // Non-fatal — signup itself succeeded. Log and continue.
      console.warn("avatar upload failed:", upErr.message);
    } else {
      const table =
        role === "accountant" ? "accountant_profiles" : "client_profiles";
      await admin
        .from(table)
        .update({ avatar_path: path })
        .eq("user_id", userId);
    }
  }

  if (data.session) {
    // Accountants land on the pending screen if not yet approved. The
    // /accountant page itself checks approval and redirects.
    redirect(`/${role}`);
  }

  return {
    info: "Check your email for a confirmation link, then sign in.",
  };
}

export async function signInAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Distinguish "no such account" from "wrong password" so users can tell
    // whether to fix a typo, sign up, or hit Forgot password. Anything more
    // sensitive (suspended / pending approval) still gets the generic
    // "wrong password" phrasing here — those states have their own UI once
    // the user is actually signed in.
    //
    // Trade-off flagged in the spec: this makes account existence
    // enumerable through the login form. Accepted at this stage.
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("users")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (!existing) {
      return {
        error:
          "No account found with that email. Check the email or create an account.",
      };
    }
    return {
      error: "Incorrect password. Try again or use Forgot password.",
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in succeeded but no session was returned." };

  const { data: userRow, error: roleError } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (roleError || !userRow) {
    return {
      error:
        "Your account has no profile row yet. Ask the admin to run the migration or re-register.",
    };
  }

  redirect(`/${userRow.role}`);
}

// -------------------------------------------------------------------------
// Forgot password: send a reset link to the user's inbox.
//
// Intentionally returns the same "if it exists" info message regardless of
// whether the email is registered — Supabase's resetPasswordForEmail already
// behaves this way, and echoing account existence would let an attacker
// enumerate valid emails.
// -------------------------------------------------------------------------
export async function sendPasswordResetAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email address." };

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const redirectTo = `${site.replace(/\/+$/, "")}/reset-password`;

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  // Do not surface errors from resetPasswordForEmail — some (like "user not
  // found") would leak account existence. Rate-limit errors, if any, will
  // manifest as no email arriving, which is acceptable UX.

  return {
    info: "If that email exists, a reset link has been sent. Check your inbox.",
  };
}

// -------------------------------------------------------------------------
// Complete the password reset. Called from /reset-password after the user
// has landed there via the Supabase recovery link — which the client-side
// Supabase SDK converts into a valid session cookie automatically.
// updateUser then targets that session's user.
// -------------------------------------------------------------------------
export async function completePasswordResetAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    return { error: "New password must be at least 8 characters." };
  }
  if (password !== confirm) {
    return { error: "Passwords do not match." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error:
        "Reset link is invalid or expired. Request a fresh one from the login page.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  // Sign the recovery session out so the fresh password is the only path in.
  await supabase.auth.signOut();
  redirect("/login?reset=1");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
