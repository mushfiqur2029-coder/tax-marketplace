"use client";

// Shared chat panel used on both the client and accountant PCH case
// workspaces. Renders the chronological thread + composer. Author
// labels are coloured so the client can tell at a glance which turn
// is theirs vs the accountant.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendCaseMessageAction } from "@/app/case-messages/actions";
import { createClient } from "@/lib/supabase/client";

export type CaseMessageView = {
  id: string;
  authorRole: "client" | "accountant" | "admin";
  authorLabel: string;         // Display name or email of the author
  body: string;
  createdAt: string;           // ISO
};

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
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Realtime: when the other side posts a message, re-fetch the server
  // component so the thread refreshes with the real author label +
  // chronological ordering. Our own sends are already handled by submit()
  // via router.refresh(), so we skip the self-echo to avoid a double-fetch.
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
          const row = payload.new as { author_id?: string };
          if (row.author_id && row.author_id === viewerUserId) return;
          router.refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, caseId, viewerUserId, router]);

  const submit = () => {
    const body = draft.trim();
    if (body.length === 0) return;
    start(async () => {
      setErr(null);
      const r = await sendCaseMessageAction(caseId, body);
      if (!r.ok) { setErr(r.error); return; }
      setDraft("");
      inputRef.current?.focus();
      router.refresh();
    });
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold">Messages</h2>
        <span className="text-xs text-slate-500">
          Keep clarifications here so the whole thread stays on file.
        </span>
      </header>

      {messages.length === 0 ? (
        <p className="rounded border border-dashed border-slate-200 p-3 text-xs text-slate-500">
          No messages yet. Use this thread to ask the other side anything about this case.
          Both sides get an email when a new message arrives.
        </p>
      ) : (
        <ul className="mb-3 space-y-2">
          {messages.map((m) => (
            <MessageRow key={m.id} message={m} viewerRole={viewerRole} />
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <textarea
          ref={inputRef}
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") submit();
          }}
          placeholder="Write a message. Ctrl/Cmd+Enter to send."
          className="w-full resize-y rounded border border-slate-300 bg-white px-3 py-2 text-sm"
          disabled={pending}
        />
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-slate-500">
            {draft.length > 3500 ? `${4000 - draft.length} characters left` : " "}
          </span>
          <div className="flex items-center gap-2">
            {err ? <span className="text-rose-700">{err}</span> : null}
            <button
              type="button"
              onClick={submit}
              disabled={pending || draft.trim().length === 0}
              className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-50"
            >
              {pending ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function MessageRow({ message, viewerRole }: {
  message: CaseMessageView;
  viewerRole: "client" | "accountant" | "admin";
}) {
  const mine = message.authorRole === viewerRole;
  const roleChip = roleStyle(message.authorRole);
  return (
    <li
      className={
        "rounded-lg border p-3 text-sm " +
        (mine ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white")
      }
    >
      <header className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-slate-800">{message.authorLabel}</span>
          <span className={"rounded px-1.5 py-0.5 font-medium " + roleChip}>
            {roleLabel(message.authorRole)}
          </span>
          {mine ? <span className="text-slate-500">(you)</span> : null}
        </div>
        <time className="text-xs text-slate-500" dateTime={message.createdAt}>
          {new Date(message.createdAt).toLocaleString("en-GB")}
        </time>
      </header>
      <div className="whitespace-pre-wrap text-slate-800">{message.body}</div>
    </li>
  );
}

function roleStyle(role: "client" | "accountant" | "admin"): string {
  switch (role) {
    case "client": return "bg-sky-100 text-sky-800";
    case "accountant": return "bg-emerald-100 text-emerald-800";
    case "admin": return "bg-amber-100 text-amber-800";
  }
}
function roleLabel(role: "client" | "accountant" | "admin"): string {
  switch (role) {
    case "client": return "Client";
    case "accountant": return "Accountant";
    case "admin": return "Admin";
  }
}
