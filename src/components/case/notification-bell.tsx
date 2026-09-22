"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { playNotificationBeep } from "@/lib/notification-sound";
import type { NotificationRow, NotificationType } from "@/lib/notifications";
import type { Role } from "@/lib/auth";

type Props = {
  userId: string;
  role: Role;
  initial: {
    unread: number;
    recent: NotificationRow[];
  };
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
};

// Where each notification takes the user when clicked. Composed on the client
// from the recipient's role + the notification's type + optional case_id.
function linkFor(n: NotificationRow, role: Role): string {
  switch (n.type) {
    case "profile_change_request":
      return "/admin/profile-changes";
    case "withdrawal_requested":
      return "/admin/withdrawals";
    case "withdrawal_paid":
      return "/accountant/wallet";
    case "new_queue_case":
      return `/accountant/cases/${n.case_id}`;
    case "new_message":
    case "case_status_change":
      if (!n.case_id) return `/${role}`;
      return `/${role}/cases/${n.case_id}`;
    default:
      return `/${role}`;
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.round((now - then) / 1000);
  if (s < 45) return "just now";
  if (s < 90) return "a minute ago";
  const m = Math.round(s / 60);
  if (m < 45) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationBell({
  userId,
  role,
  initial,
  markRead,
  markAllRead,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [items, setItems] = useState<NotificationRow[]>(initial.recent);
  const [unread, setUnread] = useState(initial.unread);
  const [pulse, setPulse] = useState(false);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const applyNew = useCallback((row: NotificationRow) => {
    setItems((prev) => {
      if (prev.some((p) => p.id === row.id)) return prev;
      return [row, ...prev].slice(0, 30);
    });
    if (!row.read) setUnread((n) => n + 1);
    setPulse(true);
    playNotificationBeep();
    window.setTimeout(() => setPulse(false), 900);
  }, []);

  // Realtime subscription: postgres_changes on this user's notifications.
  useEffect(() => {
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as NotificationRow;
          applyNew(row);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, userId, applyNew]);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(t) &&
        buttonRef.current &&
        !buttonRef.current.contains(t)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onNotifClick = async (n: NotificationRow) => {
    const href = linkFor(n, role);
    setOpen(false);
    if (!n.read) {
      setItems((prev) =>
        prev.map((p) => (p.id === n.id ? { ...p, read: true } : p)),
      );
      setUnread((c) => Math.max(0, c - 1));
      try {
        await markRead(n.id);
      } catch {
        // best-effort; if it fails the next reload will reconcile
      }
    }
    router.push(href);
  };

  const onMarkAll = async () => {
    if (unread === 0) return;
    setItems((prev) => prev.map((p) => ({ ...p, read: true })));
    setUnread(0);
    try {
      await markAllRead();
    } catch {
      router.refresh();
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          unread > 0
            ? `${unread} unread notification${unread === 1 ? "" : "s"}`
            : "No unread notifications"
        }
        aria-expanded={open}
        aria-haspopup="true"
        className={
          "relative inline-flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-paper text-navy-deep transition hover:border-sky/50 hover:bg-sky/5 " +
          (pulse ? "animate-[pulse_.9s_ease-in-out]" : "")
        }
        title={open ? "Close notifications" : "Notifications"}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 ? (
          <span
            className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold text-white"
            style={{
              background: "linear-gradient(135deg, var(--sky), var(--mint))",
              fontFamily: "var(--font-mono)",
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-line bg-paper shadow-xl sm:w-96"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div
              className="text-xs font-semibold uppercase tracking-widest text-navy-deep"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Notifications
              {unread > 0 ? (
                <span className="ml-2 text-slate">({unread} unread)</span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onMarkAll}
              disabled={unread === 0}
              className="text-xs font-semibold text-sky hover:underline disabled:cursor-not-allowed disabled:text-slate/60 disabled:no-underline"
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate">
                Nothing yet. New activity will show up here.
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => onNotifClick(n)}
                      className={
                        "block w-full px-4 py-3 text-left transition hover:bg-sky/5 " +
                        (n.read ? "" : "bg-sky/[0.03]")
                      }
                    >
                      <div className="flex items-start gap-3">
                        {!n.read ? (
                          <span
                            className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                            style={{ background: "linear-gradient(135deg, var(--sky), var(--mint))" }}
                            aria-hidden="true"
                          />
                        ) : (
                          <span className="mt-1.5 inline-block h-2 w-2 shrink-0" aria-hidden="true" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className={n.read ? "text-sm text-slate" : "text-sm font-semibold text-ink"}>
                            {n.message}
                          </p>
                          <p
                            className="mt-0.5 text-[11px] uppercase tracking-wider text-slate/70"
                            style={{ fontFamily: "var(--font-mono)" }}
                          >
                            {typeLabel(n.type)} · {relativeTime(n.created_at)}
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function typeLabel(t: NotificationType): string {
  switch (t) {
    case "new_queue_case":
      return "Queue";
    case "new_message":
      return "Message";
    case "case_status_change":
      return "Status";
    case "profile_change_request":
      return "Profile change";
    case "withdrawal_requested":
      return "Withdrawal";
    case "withdrawal_paid":
      return "Payout";
  }
}
