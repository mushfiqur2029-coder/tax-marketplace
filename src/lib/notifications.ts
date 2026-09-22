import { createAdminClient } from "@/lib/supabase/admin";

export type NotificationType =
  | "new_queue_case"
  | "new_message"
  | "case_status_change"
  | "profile_change_request"
  | "withdrawal_requested"
  | "withdrawal_paid";

export type NotificationRow = {
  id: string;
  recipient_id: string;
  type: NotificationType;
  case_id: string | null;
  message: string;
  read: boolean;
  created_at: string;
};

export type BellState = {
  unread: number;
  recent: NotificationRow[];
};

// Fetched by DashboardShell on every signed-in page. Cap at 30 per spec.
export async function getBellState(userId: string): Promise<BellState> {
  const admin = createAdminClient();
  const [{ data: recent }, { count: unread }] = await Promise.all([
    admin
      .from("notifications")
      .select("id, recipient_id, type, case_id, message, read, created_at")
      .eq("recipient_id", userId)
      .order("created_at", { ascending: false })
      .limit(30),
    admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", userId)
      .eq("read", false),
  ]);
  return {
    unread: unread ?? 0,
    recent: (recent ?? []) as NotificationRow[],
  };
}

// Server-side notification writes used by the entry points that don't have a
// DB trigger (profile change submissions and withdrawal flows).

export async function insertProfileChangeNotifications(params: {
  submitterEmail: string;
}) {
  const admin = createAdminClient();
  const { data: admins } = await admin
    .from("users")
    .select("id")
    .eq("role", "admin");
  if (!admins?.length) return;
  await admin.from("notifications").insert(
    admins.map((a) => ({
      recipient_id: a.id,
      type: "profile_change_request" as const,
      case_id: null,
      message: `${params.submitterEmail} submitted a profile change.`,
    })),
  );
}

export async function insertWithdrawalRequestedNotifications(params: {
  accountantEmail: string;
  amountPence: number;
}) {
  const admin = createAdminClient();
  const { data: admins } = await admin
    .from("users")
    .select("id")
    .eq("role", "admin");
  if (!admins?.length) return;
  await admin.from("notifications").insert(
    admins.map((a) => ({
      recipient_id: a.id,
      type: "withdrawal_requested" as const,
      case_id: null,
      message: `${params.accountantEmail} requested £${(params.amountPence / 100).toFixed(2)} withdrawal.`,
    })),
  );
}

export async function insertWithdrawalPaidNotification(params: {
  accountantId: string;
  amountPence: number;
}) {
  const admin = createAdminClient();
  await admin.from("notifications").insert({
    recipient_id: params.accountantId,
    type: "withdrawal_paid",
    case_id: null,
    message: `Your £${(params.amountPence / 100).toFixed(2)} withdrawal was paid.`,
  });
}
