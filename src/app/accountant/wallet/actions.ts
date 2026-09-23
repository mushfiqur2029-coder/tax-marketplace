"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedAccountant } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { insertWithdrawalRequestedNotifications } from "@/lib/notifications";
import { type ActionResult, fail } from "@/lib/action-result";

export type { ActionResult };

export async function requestWithdrawalAction(input: {
  accountName: string;
  sortCode: string;
  accountNumber: string;
}): Promise<ActionResult> {
  try {
  const me = await requireApprovedAccountant();
  const accountName = input.accountName.trim();
  const sortCode = input.sortCode.trim();
  const accountNumber = input.accountNumber.trim();

  if (!accountName) throw new Error("Account name is required.");
  if (!/^\d{2}-?\d{2}-?\d{2}$/.test(sortCode))
    throw new Error("Sort code should be 6 digits (e.g. 12-34-56).");
  if (!/^\d{6,10}$/.test(accountNumber))
    throw new Error("Account number should be 6 to 10 digits.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_withdrawal", {
    p_account_name: accountName,
    p_sort_code: sortCode,
    p_account_number: accountNumber,
  });
  if (error) throw new Error(error.message);

  // Notify admins. Look up the amount from the just-created request
  // (request_withdrawal doesn't return it) — read the accountant's most
  // recent pending row.
  const admin = createAdminClient();
  const { data: latest } = await admin
    .from("withdrawal_requests")
    .select("amount_pence")
    .eq("accountant_id", me.id)
    .eq("status", "pending")
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest?.amount_pence) {
    await insertWithdrawalRequestedNotifications({
      accountantEmail: me.email,
      amountPence: latest.amount_pence,
    });
  }

  revalidatePath("/accountant/wallet");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
