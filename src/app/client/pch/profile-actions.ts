"use server";

// Phase 6 Slice 1: this file is reduced to a single helper,
// syncPchProfileFromUserAction, that copies registration PII into
// pch_cases on first visit. The PROFILE AI interview + its three
// server actions were removed because:
//
//   - DOB and address now land via the Photo ID vision pass (PCH-24).
//   - UTR + NI are collected on the compact IdentitySection card.
//   - Marriage Allowance / pension / Gift Aid are deferred to the
//     bank-statement AI pass + accountant confirmation.
//
// Keeping the registration sync preserves prefill for cl_name /
// cl_phone / cl_address / cl_postcode / cl_email so the Photo ID
// confirmation starts from the client's known-good values and only
// updates on diff.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionOk<T = Record<never, never>> = { ok: true } & T;
type ActionErr = { ok: false; error: string };
type ActionResult<T = Record<never, never>> = ActionOk<T> | ActionErr;

async function requireClientPchCase(caseId: string) {
  const me = await requireRole("client");
  const admin = createAdminClient();
  const { data } = await admin
    .from("cases")
    .select("id, client_id, status, tier")
    .eq("id", caseId)
    .single();
  if (!data) throw new Error("Case not found.");
  if (data.client_id !== me.id) throw new Error("Not your case.");
  if (data.tier !== "uber_phv_automated") {
    throw new Error("Not a PCH automated case.");
  }
  return { me, caseRow: data, admin };
}

export async function syncPchProfileFromUserAction(
  caseId: string,
): Promise<ActionResult> {
  try {
    const { me, admin } = await requireClientPchCase(caseId);
    const [{ data: profile }, { data: head }] = await Promise.all([
      admin
        .from("client_profiles")
        .select("name, contact_number, address")
        .eq("user_id", me.id)
        .maybeSingle(),
      admin
        .from("pch_cases")
        .select("cl_name, cl_phone, cl_address, cl_postcode, cl_email")
        .eq("case_id", caseId)
        .maybeSingle(),
    ]);
    if (!profile) return { ok: true };

    // Address was stored as a multi-line join of line1 \n line2 \n city
    // \n postcode (see signUpAction). Peel the postcode off the end so
    // the identity confirmation card can display it as its own field.
    const addrLines = ((profile.address ?? "") as string)
      .split(/\r?\n/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);
    const postcode = addrLines.length > 1 ? addrLines[addrLines.length - 1] : "";
    const addressRest =
      postcode.length > 0 ? addrLines.slice(0, -1).join(", ") : addrLines.join(", ");

    const patch: Record<string, string> = {};
    if (!head?.cl_name && profile.name) patch.cl_name = profile.name;
    if (!head?.cl_phone && profile.contact_number) patch.cl_phone = profile.contact_number;
    if (!head?.cl_address && addressRest) patch.cl_address = addressRest;
    if (!head?.cl_postcode && postcode) patch.cl_postcode = postcode;
    if (!head?.cl_email && me.email) patch.cl_email = me.email;

    if (Object.keys(patch).length === 0) return { ok: true };

    const { error } = await admin
      .from("pch_cases")
      .update(patch)
      .eq("case_id", caseId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Profile sync failed." };
  }
}
