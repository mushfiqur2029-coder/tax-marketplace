import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import {
  getSupportThreadAction,
} from "@/app/support/actions";
import { SupportChatPanel } from "@/components/support/support-chat-panel";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminPill } from "@/components/admin/admin-pill";
import { ResolveReopenButton } from "./resolve-reopen-button";

// Phase 7 Slice 7.3: admin support thread detail. Loads the thread
// (owner metadata + full message history) and renders the shared chat
// panel with viewerRole="admin". Resolve / reopen lives in a client
// island (ResolveReopenButton) so the server page stays pure data.

export const dynamic = "force-dynamic";

export default async function AdminSupportThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireRole("admin");
  const { id } = await params;

  const result = await getSupportThreadAction(id);
  if (!result.ok) {
    if (result.error === "Thread not found.") notFound();
    return (
      <>
        <AdminPageHeader eyebrow="Admin console" title="Support thread" />
        <p className="card-sl border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {result.error}
        </p>
      </>
    );
  }

  const { thread, userLabel, caseShortId } = result;
  return (
    <>
      <AdminPageHeader
        eyebrow="Support thread"
        title={userLabel}
        rightSlot={
          <Link
            href="/admin/support"
            className="text-sm font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
          >
            ← Back to inbox
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate">
        <div className="flex flex-wrap items-center gap-2">
          <AdminPill
            tone={thread.userRole === "accountant" ? "blue" : "grey"}
            label={thread.userRole}
          />
          <AdminPill
            tone={thread.status === "open" ? "amber" : "green"}
            label={thread.status === "open" ? "Open" : "Resolved"}
          />
          <Link
            href={`/admin/cases/${thread.caseId}`}
            className="font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
          >
            View case <span className="font-mono">{caseShortId}</span>
          </Link>
          <span className="text-slate">
            Opened {new Date(thread.createdAt).toLocaleDateString("en-GB")}
          </span>
        </div>
        <ResolveReopenButton threadId={thread.id} status={thread.status} />
      </div>

      <SupportChatPanel
        caseId={thread.caseId}
        threadId={thread.id}
        messages={thread.messages}
        viewerRole="admin"
        viewerUserId={me.id}
        threadStatus={thread.status}
      />
    </>
  );
}
