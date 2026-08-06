"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedAccountant } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function requestWithdrawalAction(input: {
  accountName: string;
  sortCode: string;
  accountNumber: string;
}) {
  await requireApprovedAccountant();
  const accountName = input.accountName.trim();
  const sortCode = input.sortCode.trim();
  const accountNumber = input.accountNumber.trim();

  if (!accountName) throw new Error("Account name is required.");
  if (!/^\d{2}-?\d{2}-?\d{2}$/.test(sortCode))
    throw new Error("Sort code should be 6 digits (e.g. 12-34-56).");
  if (!/^\d{6,10}$/.test(accountNumber))
    throw new Error("Account number should be 6–10 digits.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_withdrawal", {
    p_account_name: accountName,
    p_sort_code: sortCode,
    p_account_number: accountNumber,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/accountant/wallet");
}
