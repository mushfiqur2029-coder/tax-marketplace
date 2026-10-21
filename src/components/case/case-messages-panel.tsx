"use client";

// Shared chat panel used on client, accountant, and admin PCH case
// workspaces. Renders the chronological thread + composer with:
//
//   - Realtime subscription on case_messages (own sends are appended
//     locally and optimistically instead, see Task #14 comments below).
//   - OS-aware shortcut hint (shows the right modifier key graphic
//     for the viewer's platform, not a raw "Ctrl/Cmd+Enter" string).
//   - Message bubbles aligned left vs right so the thread reads like
//     a real conversation rather than a flat list.
//   - Friendly empty state + distinct Sending/Send button state.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  sendCaseMessageAction,
  getCaseMessageAttachmentUrlAction,
} from "@/app/case-messages/actions";
import { createClient } from "@/lib/supabase/client";
import { markLocalMutation } from "@/lib/realtime-self-mutation";

export type CaseMessageAttachment = {
  path: string;
  name: string;
  mime: string;
  size_bytes: number;
};

export type CaseMessageView = {
  id: string;
  authorRole: "client" | "accountant" | "admin";
  authorLabel: string;         // Display name or email of the author
  body: string;
  createdAt: string;           // ISO
  attachments: CaseMessageAttachment[] | null;
  // Task #14: set on a message we've optimistically appended locally
  // right after our own send, before any attachment has a real storage
  // path to resolve a download URL from. Never set on a message that
  // came from the server.
  optimistic?: boolean;
};

const MAX_BODY_CHARS = 4000;
const WARN_FROM_CHARS = 3000;
const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

// Mirrors ALLOWED_EXT_RE in src/app/case-messages/actions.ts. Shown
// in the hover title on the Attach button so clients know up front
// what the composer will accept.
const ATTACHMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.csv,.xlsx,.xls,application/pdf,image/*,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

export function CaseMessagesPanel({
  caseId,
  messages,
  viewerRole,
  viewerUserId,
}: {
  caseId: string;
  messages: CaseMessageView[];
  viewerRole: "client" | "accountant" | "admin";
  viewerUserId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Task #14: router.refresh() is confirmed unreliable on this app (see
  // pch-client-workspace.tsx), and it can't be replaced with a reload
  // here (that would defeat the point of a live chat panel). The realtime
  // subscription already handles the other side's messages; here we
  // optimistically append our own send locally the moment it succeeds,
  // since we know its body and author role, even though we don't have a
  // server-issued id/timestamp or (for any attachments) a resolvable
  // storage path yet.
  const [localMessages, setLocalMessages] = useState<CaseMessageView[]>([]);
  const allMessages = useMemo(
    () => [...messages, ...localMessages],
    [messages, localMessages],
  );

  // Realtime: when the other side posts a message, append it locally so
  // the thread stays live without a reload.
  useEffect(() => {
    const channel = supabase
      .channel(`case-messages-panel-${caseId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "case_messages",
          filter: `case_id=eq.${caseId}`,
        },
        (payload) => {
          const row = payload.new as {
            id?: string;
            author_id?: string;
            author_role?: "client" | "accountant" | "admin";
            body?: string;
            created_at?: string;
            attachments?: CaseMessageAttachment[] | null;
          };
          if (row.author_id && row.author_id === viewerUserId) return;
          if (!row.id || !row.author_role || !row.body || !row.created_at) return;
          setLocalMessages((prev) => [
            ...prev,
            {
              id: row.id!,
              authorRole: row.author_role!,
              // Realtime payloads are raw table rows: no joined email
              // like the server-rendered list has. Mirror the same
              // fallback the server uses (`loadCaseMessages` above) so
              // this isn't blank; it'll show the real label next time
              // this page is freshly loaded.
              authorLabel: row.author_id ? row.author_id.slice(0, 8) : "",
              body: row.body!,
              createdAt: row.created_at!,
              attachments: row.attachments ?? null,
            },
          ]);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, caseId, viewerUserId]);

  // Auto-scroll to the newest message when the list grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [allMessages.length, pending]);

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
      const r = await sendCaseMessageAction(caseId, fd);
      if (!r.ok) { setErr(r.error); return; }
      markLocalMutation();
      setLocalMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          authorRole: viewerRole,
          authorLabel: "",
          body,
          createdAt: new Date().toISOString(),
          attachments: attachments.map((f) => ({
            path: "",
            name: f.name,
            mime: f.type,
            size_bytes: f.size,
          })),
          optimistic: true,
        },
      ]);
      setDraft("");
      setAttachments([]);
      inputRef.current?.focus();
    });
  };

  const canSend = !pending && draft.trim().length > 0;
  const charCount = draft.length;
  const showCharWarn = charCount > WARN_FROM_CHARS;
  const charsLeft = MAX_BODY_CHARS - charCount;

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-5 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold text-slate-900">Messages</h2>
          {allMessages.length > 0 ? (
            <span className="text-xs text-slate-500">
              {allMessages.length}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-slate-500">
          A record of every clarification on this case. Both sides get an email when a new message arrives.
        </p>
      </header>

      <div ref={scrollRef} className="max-h-96 overflow-y-auto px-5 py-4">
        {allMessages.length === 0 ? (
          <EmptyState viewerRole={viewerRole} />
        ) : (
          <ul className="space-y-3">
            {allMessages.map((m) => (
              <MessageRow key={m.id} message={m} viewerRole={viewerRole} />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-slate-100 px-5 py-4">
        <div className="relative">
          <textarea
            ref={inputRef}
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_BODY_CHARS))}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canSend) submit();
            }}
            placeholder={viewerRole === "client"
              ? "Message your accountant..."
              : viewerRole === "accountant"
                ? "Message the client..."
                : "Message the client or accountant..."}
            className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed shadow-inner placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending}
            maxLength={MAX_BODY_CHARS}
            aria-label="Write a message"
          />
        </div>

        {attachments.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {attachments.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
              >
                <PaperclipIcon />
                <span className="max-w-[14rem] truncate" title={f.name}>{f.name}</span>
                <span className="text-slate-400">{formatBytes(f.size)}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  disabled={pending}
                  aria-label={`Remove ${f.name}`}
                  className="rounded-full p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-50"
                >
                  <CloseIcon />
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
              <PaperclipIcon />
              {attachments.length === 0
                ? "Attach"
                : `${attachments.length}/${MAX_ATTACHMENTS}`}
            </button>
            {showCharWarn ? (
              <span className={charsLeft < 100 ? "text-amber-700" : "text-slate-500"}>
                {charsLeft} characters left
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            {err ? (
              <span className="text-xs text-rose-700" role="alert">{err}</span>
            ) : null}
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              title="Ctrl/Cmd + Enter to send"
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {pending ? (
                <>
                  <Spinner />
                  Sending
                </>
              ) : (
                "Send"
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.3" strokeWidth="4" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function EmptyState({ viewerRole }: { viewerRole: "client" | "accountant" | "admin" }) {
  const body = viewerRole === "client"
    ? "Anything you want to flag to your accountant goes here, PAYE queries, missing paperwork, questions on a figure. They'll be notified by email too."
    : viewerRole === "accountant"
      ? "Use this thread for anything you need to clarify with the client. They get an email ping as soon as you send."
      : "No messages yet. Both the client and accountant post here; admin posts land for both sides.";
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center">
      <ChatIcon />
      <div className="max-w-sm text-sm text-slate-600">{body}</div>
    </div>
  );
}

function ChatIcon() {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-slate-400"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function MessageRow({ message, viewerRole }: {
  message: CaseMessageView;
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
          <time dateTime={message.createdAt}>
            {formatTime(message.createdAt)}
          </time>
          {mine ? <span className="text-slate-400">You</span> : null}
        </div>
        <div
          className={
            "space-y-2 rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm " +
            (mine
              ? "rounded-tr-sm bg-slate-900 text-white"
              : "rounded-tl-sm border border-slate-200 bg-white text-slate-800")
          }
        >
          <div className="whitespace-pre-wrap">{message.body}</div>
          {attachments.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {attachments.map((a, i) => (
                <li key={a.path || `${message.id}-${i}`}>
                  {message.optimistic ? (
                    <InertAttachmentChip attachment={a} mine={mine} />
                  ) : (
                    <AttachmentChip messageId={message.id} attachment={a} mine={mine} />
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function AttachmentChip({
  messageId, attachment, mine,
}: {
  messageId: string;
  attachment: CaseMessageAttachment;
  mine: boolean;
}) {
  const [opening, setOpening] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = () => {
    if (opening) return;
    setOpening(true);
    setErr(null);
    void (async () => {
      try {
        const r = await getCaseMessageAttachmentUrlAction(messageId, attachment.path);
        if (!r.ok) { setErr(r.error); return; }
        window.open(r.url, "_blank", "noopener,noreferrer");
      } finally {
        setOpening(false);
      }
    })();
  };
  const chipStyle = mine
    ? "border-white/30 bg-white/10 text-white hover:bg-white/20"
    : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100";
  return (
    <button
      type="button"
      onClick={open}
      disabled={opening}
      title={attachment.name}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition disabled:opacity-60 " + chipStyle
      }
    >
      <PaperclipIcon />
      <span className="max-w-[12rem] truncate">{attachment.name}</span>
      <span className={mine ? "text-white/60" : "text-slate-400"}>
        {formatBytes(attachment.size_bytes)}
      </span>
      {err ? <span className="text-rose-200">{err}</span> : null}
    </button>
  );
}

// Task #14: our own just-sent message is shown optimistically before its
// attachments have a real storage path to resolve a signed URL from (the
// send action doesn't return one). Render as an inert chip rather than
// one that would error when clicked; it becomes a real, clickable
// AttachmentChip the next time this page is freshly loaded.
function InertAttachmentChip({
  attachment, mine,
}: {
  attachment: CaseMessageAttachment;
  mine: boolean;
}) {
  const chipStyle = mine
    ? "border-white/30 bg-white/10 text-white"
    : "border-slate-300 bg-slate-50 text-slate-700";
  return (
    <span
      title={`${attachment.name} (uploading…)`}
      className={"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs " + chipStyle}
    >
      <PaperclipIcon />
      <span className="max-w-[12rem] truncate">{attachment.name}</span>
      <span className={mine ? "text-white/60" : "text-slate-400"}>
        {formatBytes(attachment.size_bytes)}
      </span>
    </span>
  );
}

function RolePill({ role }: { role: "client" | "accountant" | "admin" }) {
  const style =
    role === "client" ? "bg-sky-100 text-sky-800"
      : role === "accountant" ? "bg-emerald-100 text-emerald-800"
      : "bg-amber-100 text-amber-800";
  const label =
    role === "client" ? "Client"
      : role === "accountant" ? "Accountant"
      : "Admin";
  return (
    <span className={"inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide " + style}>
      {label}
    </span>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function PaperclipIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
