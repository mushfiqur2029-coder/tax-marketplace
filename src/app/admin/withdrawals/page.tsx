import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
  markWithdrawalPaidAction,
  getReceiptSignedUrl,
  revealWithdrawalBankAction,
} from "@/app/admin/actions";
import Link from "next/link";
import {
  AdminWithdrawalsLive,
  type WithdrawalRow,
} from "./admin-withdrawals-live";

export const dynamic = "force-dynamic";

export default async function AdminWithdrawalsPage() {
  await requireRole("admin");
  const admin = createAdminClient();

  const { data: reqs } = await admin
    .from("withdrawal_requests")
    .select(
      "id, accountant_id, amount_pence, account_name, sort_code, account_number, status, receipt_path, requested_at, paid_at",
    )
    .order("requested_at", { ascending: false });

  const all = (reqs ?? []) as WithdrawalRow[];
  const accIds = Array.from(new Set(all.map((r) => r.accountant_id)));
  const { data: users } = accIds.length
    ? await admin.from("users").select("id, email").in("id", accIds)
    : { data: [] as { id: string; email: string }[] };
  const emailById: Record<string, string> = Object.fromEntries(
    (users ?? []).map((u) => [u.id, u.email as string]),
  );

  const markPaid = async (requestId: string, fd: FormData) => {
    "use server";
    return markWithdrawalPaidAction(requestId, fd);
  };
  const signReceipt = async (path: string) => {
    "use server";
    return getReceiptSignedUrl(path);
  };
  const revealBank = async (requestId: string) => {
    "use server";
    return revealWithdrawalBankAction(requestId);
  };

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="Withdrawal requests"
        description="Pay from your own banking, then upload the receipt to close the request."
      />
      <div className="mb-6 text-sm">
        <Link
          href="/admin/withdrawals/reveals"
          className="font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
        >
          View reveal audit log to
        </Link>
      </div>
      <AdminWithdrawalsLive
        initial={all}
        emailById={emailById}
        markPaid={markPaid}
        signReceipt={signReceipt}
        revealBank={revealBank}
      />
    </>
  );
}
