"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { SLButton } from "@/components/sl-button";
import { formatTime } from "@/lib/format";
import type { MessageChannel } from "@/app/messages";
import type { ActionResult } from "@/lib/action-result";

export type MessageAttachment = {
  path: string;
  name: string;
  type: string;
};

export type ChatMessage = {
  id: string;
  case_id: string;
  channel: MessageChannel;
  sender_id: string;
  body: string;
  // Post-migration 0017 the array is authoritative. Legacy singular
  // columns are read only as a fallback (defence in depth if migration
  // hasn't run yet on some environment).
  attachments: MessageAttachment[];
  attachment_path?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  created_at: string;
};

// Given a message, return its attachments — prefers the new jsonb array,
// falls back to the legacy singular columns for unmigrated rows.
function attachmentsOf(m: ChatMessage): MessageAttachment[] {
  if (Array.isArray(m.attachments) && m.attachments.length > 0) {
    return m.attachments;
  }
  if (m.attachment_path && m.attachment_name) {
    return [
      {
        path: m.attachment_path,
        name: m.attachment_name,
        type: m.attachment_type ?? "",
      },
    ];
  }
  return [];
}

export type ChatThread = {
  channel: MessageChannel;
  label: string; // Tab label
  // Per-message sender label — map user id → display name (e.g. "Client",
  // "Accountant", "Admin"). Any sender not in the map falls back to
  // `fallbackSenderLabel`. "You" is applied automatically to the current user.
  senderLabels: Record<string, string>;
  fallbackSenderLabel: string;
  initial: ChatMessage[];
};

type Props = {
  caseId: string;
  meId: string;
  threads: ChatThread[];
  // Server actions:
  send: (input: {
    caseId: string;
    channel: MessageChannel;
    body: string;
    attachments?: MessageAttachment[];
  }) => Promise<ActionResult<ChatMessage>>;
  uploadAttachment: (
    caseId: string,
    fd: FormData,
  ) => Promise<ActionResult<{ path: string; name: string; type: string }>>;
  getAttachmentUrl: (path: string) => Promise<ActionResult<string>>;
};

// Same tiny WebAudio beep as the queue bell.
function beep() {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AC();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(990, now + 0.12);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
    setTimeout(() => ctx.close(), 500);
  } catch {
    // ignore
  }
}

// Kept in sync with MAX_ATTACHMENT_BYTES in src/app/messages.ts.
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// One item in the composer's pending-attachment tray. Each is uploaded to
// storage the moment it's added; only ones with status='done' can be sent.
type PendingAttachment = {
  id: string;
  file: File;
  status: "uploading" | "done" | "error";
  path?: string;
  serverName?: string;
  serverType?: string;
  error?: string;
};

// Small counter for stable local ids on pending files (React key + dedup key).
let _pendingSeq = 0;
const nextPendingId = () => `pf_${Date.now()}_${++_pendingSeq}`;

export function MultiThreadChat({
  caseId,
  meId,
  threads,
  send,
  uploadAttachment,
  getAttachmentUrl,
}: Props) {
  const [active, setActive] = useState<MessageChannel>(threads[0].channel);
  const [messagesByChannel, setMessagesByChannel] = useState<
    Record<MessageChannel, ChatMessage[]>
  >(() => {
    const out = {} as Record<MessageChannel, ChatMessage[]>;
    for (const t of threads) out[t.channel] = t.initial;
    return out;
  });
  const [unread, setUnread] = useState<Record<MessageChannel, number>>(() => {
    const out = {} as Record<MessageChannel, number>;
    for (const t of threads) out[t.channel] = 0;
    return out;
  });

  const supabase = useMemo(() => createClient(), []);
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // Realtime — one subscription for the whole case, filter client-side by
  // channel and by threads the user is actually a party to.
  useEffect(() => {
    const knownChannels = new Set(threads.map((t) => t.channel));
    const channel = supabase
      .channel(`case-messages-${caseId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `case_id=eq.${caseId}`,
        },
        (payload) => {
          const m = payload.new as ChatMessage;
          if (!knownChannels.has(m.channel)) return;
          setMessagesByChannel((prev) => {
            const list = prev[m.channel] ?? [];
            if (list.some((x) => x.id === m.id)) return prev;
            return { ...prev, [m.channel]: [...list, m] };
          });
          if (m.sender_id !== meId && m.channel !== activeRef.current) {
            setUnread((u) => ({ ...u, [m.channel]: (u[m.channel] ?? 0) + 1 }));
            beep();
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [caseId, meId, supabase, threads]);

  const switchTo = useCallback((c: MessageChannel) => {
    setActive(c);
    setUnread((u) => ({ ...u, [c]: 0 }));
  }, []);

  const activeThread = threads.find((t) => t.channel === active) ?? threads[0];
  const activeMessages = messagesByChannel[activeThread.channel] ?? [];

  return (
    <div className="flex h-[560px] flex-col">
      {threads.length > 1 ? (
        <div className="mb-3 inline-flex rounded-full border border-line bg-paper p-1 self-start">
          {threads.map((t) => {
            const isActive = t.channel === active;
            const badge = unread[t.channel] ?? 0;
            return (
              <button
                key={t.channel}
                type="button"
                onClick={() => switchTo(t.channel)}
                aria-pressed={isActive}
                className={
                  "flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition " +
                  (isActive
                    ? "bg-navy-deep text-white"
                    : "text-slate hover:text-navy-deep")
                }
              >
                {t.label}
                {badge > 0 && !isActive ? (
                  <span
                    className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                    style={{
                      background:
                        "linear-gradient(135deg, var(--sky), var(--mint))",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <ChatView
        caseId={caseId}
        meId={meId}
        thread={activeThread}
        messages={activeMessages}
        send={send}
        uploadAttachment={uploadAttachment}
        getAttachmentUrl={getAttachmentUrl}
        onSent={(m) =>
          setMessagesByChannel((prev) => {
            const list = prev[m.channel] ?? [];
            if (list.some((x) => x.id === m.id)) return prev;
            return { ...prev, [m.channel]: [...list, m] };
          })
        }
      />
    </div>
  );
}

function ChatView({
  caseId,
  meId,
  thread,
  messages,
  send,
  uploadAttachment,
  getAttachmentUrl,
  onSent,
}: {
  caseId: string;
  meId: string;
  thread: ChatThread;
  messages: ChatMessage[];
  send: Props["send"];
  uploadAttachment: Props["uploadAttachment"];
  getAttachmentUrl: Props["getAttachmentUrl"];
  onSent: (m: ChatMessage) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([]);
  const [dragDepth, setDragDepth] = useState(0);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, thread.channel]);

  // Add files to the pending tray and kick off upload for each immediately.
  // Client-side validation before hitting the server so we can show the
  // error state on the chip without a round-trip.
  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const items: PendingAttachment[] = files.map((file) => {
        const id = nextPendingId();
        if (file.size > MAX_ATTACHMENT_BYTES) {
          return {
            id,
            file,
            status: "error",
            error: `Over the ${formatBytes(MAX_ATTACHMENT_BYTES)} limit.`,
          };
        }
        return { id, file, status: "uploading" };
      });
      setPendingFiles((prev) => [...prev, ...items]);

      // Kick off uploads (only the ones that passed validation).
      for (const item of items) {
        if (item.status !== "uploading") continue;
        (async () => {
          const fd = new FormData();
          fd.set("file", item.file);
          const res = await uploadAttachment(caseId, fd);
          setPendingFiles((prev) =>
            prev.map((p) =>
              p.id !== item.id
                ? p
                : res.ok
                  ? {
                      ...p,
                      status: "done",
                      path: res.data.path,
                      serverName: res.data.name,
                      serverType: res.data.type,
                    }
                  : { ...p, status: "error", error: res.error },
            ),
          );
        })();
      }
    },
    [caseId, uploadAttachment],
  );

  const removePending = useCallback((id: string) => {
    setPendingFiles((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const hasUploading = pendingFiles.some((p) => p.status === "uploading");
  const readyAttachments = pendingFiles.filter((p) => p.status === "done");
  const anyContent = text.trim().length > 0 || readyAttachments.length > 0;
  const submitDisabled = pending || hasUploading || !anyContent;

  const submit = () => {
    if (submitDisabled) return;
    setError(null);
    const body = text.trim();
    startTransition(async () => {
      // Post-migration 0017: N attachments go into ONE message row (jsonb
      // array on messages). One row = one insert = one notification.
      const attachments: MessageAttachment[] = readyAttachments.map((a) => ({
        path: a.path ?? "",
        name: a.serverName ?? a.file.name,
        type: a.serverType ?? a.file.type,
      }));
      const res = await send({
        caseId,
        channel: thread.channel,
        body,
        attachments,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSent(res.data);
      setText("");
      // Clear only successfully-sent items; errored ones stay so the user
      // sees why and can dismiss them explicitly.
      setPendingFiles((prev) => prev.filter((p) => p.status === "error"));
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  };

  // Drag & drop over the whole chat panel. dragDepth counter avoids the
  // dragleave/dragenter flicker when the pointer crosses child elements.
  const onDragEnter = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDragDepth((d) => d + 1);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDragDepth((d) => Math.max(0, d - 1));
  };
  const onDrop = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDragDepth(0);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) addFiles(files);
  };

  // Clipboard paste on the textarea — pulls out any files (mostly images).
  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files ?? []);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };

  return (
    <div
      ref={panelRef}
      className="relative flex flex-1 flex-col"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-line bg-cloud/40 p-4"
      >
        {messages.length === 0 ? (
          <p className="mt-24 text-center text-sm text-slate">
            No messages yet. Say hello.
          </p>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              m={m}
              meId={meId}
              senderLabel={
                m.sender_id === meId
                  ? "You"
                  : (thread.senderLabels[m.sender_id] ??
                      thread.fallbackSenderLabel)
              }
              getAttachmentUrl={getAttachmentUrl}
            />
          ))
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="mt-3 space-y-2"
      >
        {pendingFiles.length > 0 ? (
          <ul
            className="flex flex-wrap gap-2"
            aria-label="Files ready to send"
          >
            {pendingFiles.map((p) => (
              <AttachmentChip
                key={p.id}
                item={p}
                onRemove={() => removePending(p.id)}
              />
            ))}
          </ul>
        ) : null}

        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            onPaste={onPaste}
            rows={2}
            placeholder="Type your message…"
            className="input-sl min-h-[52px] resize-none"
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="sr-only"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              addFiles(files);
              // Reset so selecting the same file twice re-triggers change.
              if (e.target) e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach files"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-navy-deep hover:border-sky/50 hover:bg-sky/5"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <SLButton
            type="submit"
            variant="primary"
            disabled={submitDisabled}
          >
            {pending
              ? "Sending…"
              : hasUploading
                ? "Uploading…"
                : "Send"}
          </SLButton>
        </div>
        {error ? (
          <p className="text-xs font-medium text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </form>

      {dragDepth > 0 ? (
        <div
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed"
          style={{
            background: "rgba(25,156,217,0.10)",
            borderColor: "rgba(25,156,217,0.55)",
            backdropFilter: "blur(1px)",
          }}
          aria-hidden="true"
        >
          <p
            className="text-sm font-bold uppercase tracking-widest text-navy-deep"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Drop files to attach
          </p>
        </div>
      ) : null}
    </div>
  );
}

function AttachmentChip({
  item,
  onRemove,
}: {
  item: PendingAttachment;
  onRemove: () => void;
}) {
  const isError = item.status === "error";
  const isDone = item.status === "done";
  const bg = isError
    ? "rgba(220,38,38,0.08)"
    : isDone
      ? "rgba(19,217,160,0.10)"
      : "var(--paper)";
  const borderColor = isError
    ? "rgba(220,38,38,0.35)"
    : isDone
      ? "rgba(19,217,160,0.35)"
      : "var(--color-line)";
  return (
    <li
      className="inline-flex max-w-full items-center gap-2 rounded-xl border px-2.5 py-1.5"
      style={{ background: bg, borderColor }}
    >
      <span aria-hidden="true">📎</span>
      <div className="min-w-0 max-w-[220px]">
        <div className="truncate text-xs font-semibold text-ink">
          {item.file.name}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-slate">
          <span>{formatBytes(item.file.size)}</span>
          {item.status === "uploading" ? (
            <span aria-live="polite">Uploading…</span>
          ) : isDone ? (
            <span
              className="inline-flex items-center gap-0.5 font-semibold"
              style={{ color: "#0E9E77" }}
              aria-label="Uploaded"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Ready
            </span>
          ) : (
            <span
              className="truncate font-semibold text-red-700"
              title={item.error}
            >
              {item.error ?? "Upload failed"}
            </span>
          )}
        </div>
        {item.status === "uploading" ? (
          <div
            className="mt-1 h-1 w-full overflow-hidden rounded-full"
            style={{ background: "rgba(25,156,217,0.15)" }}
            role="progressbar"
            aria-label="Upload progress"
          >
            <div
              className="h-full w-1/3 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full"
              style={{
                background:
                  "linear-gradient(135deg, var(--sky), var(--mint))",
              }}
            />
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${item.file.name}`}
        className="ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-slate hover:bg-slate/10 hover:text-navy-deep"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </li>
  );
}

function MessageBubble({
  m,
  meId,
  senderLabel,
  getAttachmentUrl,
}: {
  m: ChatMessage;
  meId: string;
  senderLabel: string;
  getAttachmentUrl: (path: string) => Promise<ActionResult<string>>;
}) {
  const isMe = m.sender_id === meId;
  return (
    <div className={"flex " + (isMe ? "justify-end" : "justify-start")}>
      <div
        className={
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm " +
          (isMe ? "text-white" : "bg-paper text-ink border border-line")
        }
        style={
          isMe
            ? {
                background:
                  "linear-gradient(135deg, var(--navy), var(--sky))",
              }
            : undefined
        }
      >
        <div
          className={
            "mb-0.5 text-[10px] font-semibold uppercase tracking-wider " +
            (isMe ? "text-white/70" : "text-slate")
          }
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {senderLabel} · {formatTime(m.created_at)}
        </div>
        {m.body ? <div className="whitespace-pre-wrap">{m.body}</div> : null}
        {attachmentsOf(m).map((a) => (
          <AttachmentLink
            key={a.path}
            path={a.path}
            name={a.name}
            type={a.type}
            isMe={isMe}
            getAttachmentUrl={getAttachmentUrl}
          />
        ))}
      </div>
    </div>
  );
}

function AttachmentLink({
  path,
  name,
  type,
  isMe,
  getAttachmentUrl,
}: {
  path: string;
  name: string;
  type: string;
  isMe: boolean;
  getAttachmentUrl: (path: string) => Promise<ActionResult<string>>;
}) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const res = await getAttachmentUrl(path);
      if (res.ok) window.open(res.data, "_blank", "noopener");
    } finally {
      setBusy(false);
    }
  };
  const surface = isMe ? "bg-white/15 hover:bg-white/25" : "bg-cloud/70 hover:bg-cloud";
  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className={
        "mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold transition " +
        surface
      }
    >
      <span aria-hidden="true">📎</span>
      <span className="truncate">{name}</span>
      <span className={"ml-auto shrink-0 " + (isMe ? "text-white/80" : "text-slate")}>
        {busy ? "Opening…" : type.startsWith("image/") ? "View" : "Open"}
      </span>
    </button>
  );
}
