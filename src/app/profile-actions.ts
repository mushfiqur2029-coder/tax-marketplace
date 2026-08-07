"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Name / Contact number / Email are REQUIRED on every edit.
// A future phase will add SMS + email verification via a confirmation code,
// so we cannot allow these fields to be blanked out. Do not soften this
// validation without adding the corresponding verification flow first.

export type ClientProfileEdit = {
  name: string;
  contact_number: string;
  email: string;
  address: string;
};

export type AccountantProfileEdit = {
  name: string;
  contact_number: string;
  email: string;
  company_name?: string;
  company_email?: string;
};

// Submit a client profile edit. Creates a pending_profile_changes row.
// The change only takes effect after an admin approves it.
export async function submitClientProfileChangeAction(edit: ClientProfileEdit) {
  const me = await requireRole("client");
  const supabase = await createClient();

  const name = edit.name.trim();
  const contactNumber = edit.contact_number.trim();
  const email = edit.email.trim();
  const address = edit.address.trim();

  if (!name) throw new Error("Name is required.");
  if (!contactNumber) throw new Error("Contact number is required.");
  if (!email) throw new Error("Email is required.");

  // Withdraw any previously-pending change from this user so only the latest
  // request sits in the admin queue.
  await supabase
    .from("pending_profile_changes")
    .delete()
    .eq("user_id", me.id)
    .eq("status", "pending");

  const { error } = await supabase.from("pending_profile_changes").insert({
    user_id: me.id,
    role: "client",
    proposed: {
      name,
      contact_number: contactNumber,
      email,
      address,
    },
  });
  if (error) throw new Error(error.message);

  revalidatePath("/client/profile");
  revalidatePath("/admin/profile-changes");
}

export async function submitAccountantProfileChangeAction(
  edit: AccountantProfileEdit,
) {
  const me = await requireRole("accountant");
  const supabase = await createClient();

  const name = edit.name.trim();
  const contactNumber = edit.contact_number.trim();
  const email = edit.email.trim();
  const companyName = edit.company_name?.trim() ?? "";
  const companyEmail = edit.company_email?.trim() ?? "";

  if (!name) throw new Error("Name is required.");
  if (!contactNumber) throw new Error("Contact number is required.");
  if (!email) throw new Error("Email is required.");

  await supabase
    .from("pending_profile_changes")
    .delete()
    .eq("user_id", me.id)
    .eq("status", "pending");

  const { error } = await supabase.from("pending_profile_changes").insert({
    user_id: me.id,
    role: "accountant",
    proposed: {
      name,
      contact_number: contactNumber,
      email,
      company_name: companyName,
      company_email: companyEmail,
    },
  });
  if (error) throw new Error(error.message);

  revalidatePath("/accountant/profile");
  revalidatePath("/admin/profile-changes");
}

// Admin: apply or reject a pending change via the security-definer RPCs.
export async function approveProfileChangeAction(
  changeId: string,
  note: string | null,
) {
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_profile_change", {
    p_change_id: changeId,
    p_note: note,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/profile-changes");
}

export async function rejectProfileChangeAction(
  changeId: string,
  note: string | null,
) {
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_profile_change", {
    p_change_id: changeId,
    p_note: note,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/profile-changes");
}
