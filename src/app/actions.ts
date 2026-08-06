"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type AuthState = {
  error?: string;
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
  const address = String(formData.get("address") ?? "").trim();
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
  if (role === "client" && !address) {
    return { error: "Address is required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
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
  if (error) return { error: error.message };

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

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
