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

export type ChatMessage = {
  id: string;
  case_id: string;
  channel: MessageChannel;
  sender_id: string;
  body: string;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  created_at: string;
};

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
    attachmentPath?: string | null;
    attachmentName?: string | null;
    attachmentType?: string | null;
  }) => Promise<ChatMessage>;
  uploadAttachment: (
    caseId: string,
    fd: FormData,
  ) => Promise<{ path: string; name: string; type: string }>;
  getAttachmentUrl: (path: string) => Promise<string>;
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
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, thread.channel]);

  const submit = () => {
    const body = text.trim();
    if (!body && !pendingFile) return;
    setError(null);
    startTransition(async () => {
      try {
        let attachmentPath: string | null = null;
        let attachmentName: string | null = null;
        let attachmentType: string | null = null;
        if (pendingFile) {
          const fd = new FormData();
          fd.set("file", pendingFile);
          const up = await uploadAttachment(caseId, fd);
          attachmentPath = up.path;
          attachmentName = up.name;
          attachmentType = up.type;
        }
        const inserted = await send({
          caseId,
          channel: thread.channel,
          body,
          attachmentPath,
          attachmentName,
          attachmentType,
        });
        onSent(inserted);
        setText("");
        setPendingFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not send.");
      }
    });
  };

  return (
    <>
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
        {pendingFile ? (
          <div className="flex items-center justify-between rounded-lg border border-line bg-paper px-3 py-2 text-xs">
            <span className="truncate font-semibold text-ink">📎 {pendingFile.name}</span>
            <button
              type="button"
              onClick={() => {
                setPendingFile(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              className="ml-2 text-slate hover:text-red-600"
            >
              Remove
            </button>
          </div>
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
            rows={2}
            placeholder="Type your message…"
            className="input-sl min-h-[52px] resize-none"
          />
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach file"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-line text-navy-deep hover:border-sky/50 hover:bg-sky/5"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <SLButton
            type="submit"
            variant="primary"
            disabled={pending || (!text.trim() && !pendingFile)}
          >
            {pending ? "Sending…" : "Send"}
          </SLButton>
        </div>
        {error ? (
          <p className="text-xs font-medium text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </>
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
  getAttachmentUrl: (path: string) => Promise<string>;
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
        {m.attachment_path && m.attachment_name ? (
          <AttachmentLink
            path={m.attachment_path}
            name={m.attachment_name}
            type={m.attachment_type ?? ""}
            isMe={isMe}
            getAttachmentUrl={getAttachmentUrl}
          />
        ) : null}
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
  getAttachmentUrl: (path: string) => Promise<string>;
}) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const url = await getAttachmentUrl(path);
      window.open(url, "_blank", "noopener");
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
