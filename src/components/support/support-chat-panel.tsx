"use client";

// Phase 7 Slice 7.3: shared chat panel for the admin / support channel.
// Used from three places:
//   - /client/help           viewerRole="client"
//   - /accountant/help       viewerRole="accountant"
//   - /admin/support/[id]    viewerRole="admin"
//
// Mirrors the behaviour of case-messages-panel.tsx (realtime subscribe,
// composer with attachments, OS-aware send shortcut) but talks to the
// support_messages table and the support actions. Deliberately a
// separate component rather than a shared primitive: the two surfaces
// have small structural differences (no case context, attachment
// paths under support/ instead of case/, "support" tone copy) that
// would make an abstract-now shared component awkward.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  sendSupportMessageAction,
  sendAdminSupportReplyAction,
  getSupportMessageAttachmentUrlAction,
} from "@/app/support/actions";
import type { SupportMessageView } from "@/lib/support/types";
import { createClient } from "@/lib/supabase/client";

const MAX_BODY_CHARS = 4000;
const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ATTACHMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.csv,.xlsx,.xls,application/pdf,image/*,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

export function SupportChatPanel({
  caseId,
  threadId,
  messages,
  viewerRole,
  viewerUserId,
  threadStatus,
}: {
  // Phase 7 Slice 7.3b: caseId required so the user-side send action
  // can resolve (or lazy-create) the per-(case,user) thread server-side.
  // Admin reply ignores caseId; it writes against threadId directly.
  caseId: string;
  threadId: string;
  messages: SupportMessageView[];
  viewerRole: "client" | "accountant" | "admin";
  viewerUserId: string;
  threadStatus: "open" | "resolved";
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const channel = supabase
      .channel(`support-messages-${threadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "support_messages",
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          const row = payload.new as { author_id?: string };
          if (row.author_id && row.author_id === viewerUserId) return;
          router.refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, threadId, viewerUserId, router]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending]);

  const addAttachments = (incoming: File[]) => {
    if (incoming.length === 0) return;
    setErr(null);
    setAttachments((prev) => {
      const combined = [...prev];
      for (const f of incoming) {
        if (combined.length >= MAX_ATTACHMENTS) {
          setErr(`Max ${MAX_ATTACHMENTS} attachments per message.`);
          break;
        }
        if (f.size > MAX_FILE_BYTES) {
          setErr(`"${f.name}" is over 50 MB.`);
          continue;
        }
        combined.push(f);
      }
      return combined;
    });
  };
  const removeAttachment = (idx: number) =>
    setAttachments((prev) => prev.filter((_, i) => i !== idx));

  const submit = () => {
    const body = draft.trim();
    if (body.length === 0) return;
    start(async () => {
      setErr(null);
      const fd = new FormData();
      fd.set("body", body);
      for (const f of attachments) fd.append("file", f);
      const r = viewerRole === "admin"
        ? await sendAdminSupportReplyAction(threadId, fd)
        : await sendSupportMessageAction(caseId, fd);
      if (!r.ok) { setErr(r.error); return; }
      setDraft("");
      setAttachments([]);
      inputRef.current?.focus();
      router.refresh();
    });
  };

  const canSend = !pending && draft.trim().length > 0;
  const charsLeft = MAX_BODY_CHARS - draft.length;
  const resolvedLock = viewerRole !== "admin" && threadStatus === "resolved";

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-5 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold text-slate-900">
            {viewerRole === "admin" ? "Support thread" : "Help & support"}
          </h2>
          {messages.length > 0 ? (
            <span className="text-xs text-slate-500">{messages.length}</span>
          ) : null}
          {threadStatus === "resolved" ? (
            <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
              Resolved
            </span>
          ) : null}
        </div>
        <p className="text-xs text-slate-500">
          {viewerRole === "admin"
            ? "Admin reply, visible only to the thread owner."
            : "Message the support team. Our team is notified immediately."}
        </p>
      </header>

      <div ref={scrollRef} className="max-h-[480px] overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <EmptyState viewerRole={viewerRole} />
        ) : (
          <ul className="space-y-3">
            {messages.map((m) => (
              <MessageRow key={m.id} message={m} viewerRole={viewerRole} />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-slate-100 px-5 py-4">
        {resolvedLock ? (
          <p className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            This thread is marked resolved. If something else comes up,
            an admin can reopen it and you&apos;ll be able to send again.
          </p>
        ) : (
          <>
            <textarea
              ref={inputRef}
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX_BODY_CHARS))}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canSend) submit();
              }}
              placeholder={viewerRole === "admin"
                ? "Reply to this thread..."
                : "What do you need help with?"}
              className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed shadow-inner placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={pending}
              maxLength={MAX_BODY_CHARS}
              aria-label="Write a support message"
            />

            {attachments.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {attachments.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
                  >
                    <span className="max-w-[14rem] truncate" title={f.name}>{f.name}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      disabled={pending}
                      aria-label={`Remove ${f.name}`}
                      className="rounded-full px-1 text-slate-500 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-50"
                    >
                      x
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT}
              className="hidden"
              disabled={pending}
              onChange={(e) => {
                addAttachments(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={pending || attachments.length >= MAX_ATTACHMENTS}
                  title={`Attach a file (PDF, images, CSV, Excel; max ${MAX_ATTACHMENTS} per message)`}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {attachments.length === 0 ? "Attach" : `${attachments.length}/${MAX_ATTACHMENTS}`}
                </button>
                {draft.length > 3000 ? (
                  <span className={charsLeft < 100 ? "text-amber-700" : "text-slate-500"}>
                    {charsLeft} characters left
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                {err ? <span className="text-xs text-rose-700" role="alert">{err}</span> : null}
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSend}
                  title="Ctrl/Cmd + Enter to send"
                  className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {pending ? "Sending..." : viewerRole === "admin" ? "Send reply" : "Send"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function EmptyState({ viewerRole }: { viewerRole: "client" | "accountant" | "admin" }) {
  const body = viewerRole === "admin"
    ? "No messages yet. The owner has opened a thread but hasn't posted."
    : viewerRole === "client"
      ? "Ask us anything, billing, login, something odd on a case, or a question that doesn't fit a specific case thread. We'll reply here and email you when we do."
      : "Ask us anything, payout questions, platform issues, policy questions. We'll reply here and email you when we do.";
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center text-sm text-slate-600">
      {body}
    </div>
  );
}

function MessageRow({ message, viewerRole }: {
  message: SupportMessageView;
  viewerRole: "client" | "accountant" | "admin";
}) {
  const mine = message.authorRole === viewerRole;
  const attachments = message.attachments ?? [];
  return (
    <li className={"flex " + (mine ? "justify-end" : "justify-start")}>
      <div className="max-w-[85%] space-y-1">
        <div className={"flex items-baseline gap-2 text-[11px] text-slate-500 " + (mine ? "justify-end" : "")}>
          {!mine ? (
            <>
              <span className="font-medium text-slate-700">{message.authorLabel}</span>
              <RolePill role={message.authorRole} />
            </>
          ) : null}
          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
        </div>
        <div
          className={
            "rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap "
            + (mine
              ? "bg-slate-900 text-white rounded-tr-sm"
              : message.authorRole === "admin"
                ? "bg-indigo-50 text-indigo-900 border border-indigo-200 rounded-tl-sm"
                : "bg-slate-100 text-slate-900 rounded-tl-sm")
          }
        >
          {message.body}
        </div>
        {attachments.length > 0 ? (
          <ul className={"flex flex-wrap gap-1.5 " + (mine ? "justify-end" : "")}>
            {attachments.map((a) => (
              <AttachmentChip key={a.path} messageId={message.id} attachment={a} />
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

function AttachmentChip({ messageId, attachment }: {
  messageId: string;
  attachment: { path: string; name: string; mime: string; size_bytes: number };
}) {
  const [opening, setOpening] = useState(false);
  const open = async () => {
    setOpening(true);
    const r = await getSupportMessageAttachmentUrlAction(messageId, attachment.path);
    setOpening(false);
    if (r.ok) window.open(r.url, "_blank", "noopener");
    else alert(r.error);
  };
  return (
    <li>
      <button
        type="button"
        onClick={open}
        disabled={opening}
        className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        <span className="max-w-[14rem] truncate" title={attachment.name}>
          {opening ? "Opening..." : attachment.name}
        </span>
      </button>
    </li>
  );
}

function RolePill({ role }: { role: "client" | "accountant" | "admin" }) {
  const map = {
    client: { label: "Client", cls: "bg-slate-100 text-slate-700 border-slate-300" },
    accountant: { label: "Accountant", cls: "bg-sky-100 text-sky-800 border-sky-300" },
    admin: { label: "Admin", cls: "bg-indigo-100 text-indigo-800 border-indigo-300" },
  }[role];
  return (
    <span className={"rounded-full border px-1.5 py-0.5 text-[10px] font-medium " + map.cls}>
      {map.label}
    </span>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
