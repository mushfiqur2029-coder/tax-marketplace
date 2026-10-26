"use client";

// Phase 7 Slice 7.3b: tabbed wrapper that puts the existing accountant
// chat (CaseMessagesPanel) and the admin / support chat (SupportChatPanel)
// behind an Accountant | Support toggle inside a single case card.
// Replaces every standalone CaseMessagesPanel call site with this one.
//
// Support thread is lazy-created on first visit to the Support tab OR
// on first send. The server-rendered page passes `supportThread` as
// null when nothing exists yet; the tab shows a short start CTA that
// calls getOrCreateCaseSupportThreadAction, which returns the created
// thread directly (Task #14: no router.refresh(), it's unreliable on
// this app, see pch-client-workspace.tsx) so we store it locally.

import { useState, useTransition } from "react";
import {
  CaseMessagesPanel,
  type CaseMessageView,
} from "./case-messages-panel";
import { SupportChatPanel } from "@/components/support/support-chat-panel";
import { getOrCreateCaseSupportThreadAction } from "@/app/support/actions";
import type { SupportThreadView } from "@/lib/support/types";

type Tab = "accountant" | "support";

export function CaseConversationsPanel({
  caseId,
  caseMessages,
  supportThread,
  viewerRole,
  viewerUserId,
}: {
  caseId: string;
  caseMessages: CaseMessageView[];
  supportThread: SupportThreadView | null;
  viewerRole: "client" | "accountant" | "admin";
  viewerUserId: string;
}) {
  const [tab, setTab] = useState<Tab>("accountant");
  const [starting, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [localSupportThread, setLocalSupportThread] =
    useState<SupportThreadView | null>(supportThread);

  const supportCount = localSupportThread?.messages.length ?? 0;
  const supportUnreadMarker =
    localSupportThread && localSupportThread.status === "open" ? "" : "";

  const openSupport = () => {
    setTab("support");
    if (localSupportThread) return;
    if (viewerRole === "admin") return;
    start(async () => {
      setErr(null);
      const r = await getOrCreateCaseSupportThreadAction(caseId);
      if (!r.ok) setErr(r.error);
      else setLocalSupportThread(r.thread);
    });
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2 text-sm" role="tablist" aria-label="Case conversations">
        <TabButton
          active={tab === "accountant"}
          label={viewerRole === "client" ? "Accountant" : "Client"}
          onClick={() => setTab("accountant")}
          count={caseMessages.length}
        />
        <TabButton
          active={tab === "support"}
          label="Support"
          onClick={openSupport}
          count={supportCount}
          suffix={supportUnreadMarker}
          disabled={viewerRole === "admin" && !localSupportThread}
          disabledTitle={viewerRole === "admin" && !localSupportThread
            ? "No support thread opened by this user yet."
            : undefined}
        />
      </div>

      {tab === "accountant" ? (
        <CaseMessagesPanel
          caseId={caseId}
          messages={caseMessages}
          viewerRole={viewerRole}
          viewerUserId={viewerUserId}
        />
      ) : localSupportThread ? (
        <SupportChatPanel
          caseId={caseId}
          threadId={localSupportThread.id}
          messages={localSupportThread.messages}
          viewerRole={viewerRole}
          viewerUserId={viewerUserId}
          threadStatus={localSupportThread.status}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
          {viewerRole === "admin" ? (
            <p className="text-sm text-slate-600">
              No support thread on this case yet. The client or accountant
              will create one from their tab if they need admin help.
            </p>
          ) : (
            <>
              <p className="text-sm text-slate-700">
                {viewerRole === "client"
                  ? "Need to flag something that isn't right for your accountant? Billing, account changes, or an escalation about this case, start a support thread with our team."
                  : "Need admin help on this case? Payout questions, platform issues, or anything that doesn't belong in the client chat, start a support thread."}
              </p>
              <button
                type="button"
                onClick={openSupport}
                disabled={starting}
                className="mt-4 rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {starting ? "Opening..." : "Start a support thread"}
              </button>
              {err ? <p className="mt-3 text-xs text-rose-700">{err}</p> : null}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function TabButton({
  active, label, count, onClick, disabled, disabledTitle, suffix,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
  disabled?: boolean;
  disabledTitle?: string;
  suffix?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledTitle : undefined}
      className={
        "rounded-full border px-3 py-1 font-medium transition "
        + (active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")
        + (disabled ? " cursor-not-allowed opacity-50" : "")
      }
    >
      {label}
      {count > 0 ? (
        <span className={"ml-1.5 text-xs " + (active ? "text-slate-200" : "text-slate-500")}>
          {count}{suffix ?? ""}
        </span>
      ) : null}
    </button>
  );
}
