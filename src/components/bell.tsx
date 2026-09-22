import { getBellState } from "@/lib/notifications";
import { NotificationBell } from "@/components/case/notification-bell";
import {
  markNotificationReadAction,
  markAllNotificationsReadAction,
} from "@/app/notification-actions";
import type { Role } from "@/lib/auth";

// Server-component wrapper. Fetches the initial bell state (unread count +
// most recent 30) and hands it to the client Bell. Rendered inside
// DashboardShell so every signed-in page gets the bell for free.
export async function Bell({
  userId,
  role,
}: {
  userId: string;
  role: Role;
}) {
  const initial = await getBellState(userId);
  return (
    <NotificationBell
      userId={userId}
      role={role}
      initial={initial}
      markRead={markNotificationReadAction}
      markAllRead={markAllNotificationsReadAction}
    />
  );
}
