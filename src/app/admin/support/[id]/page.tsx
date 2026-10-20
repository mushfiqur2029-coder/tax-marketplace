import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import {
  getSupportThreadAction,
} from "@/app/support/actions";
import { SupportChatPanel } from "@/components/support/support-chat-panel";
import { PortalPageHeader } from "@/components/portal-page-header";
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
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <PortalPageHeader eyebrow="Admin" title="Support thread" />
        <p className="mt-6 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {result.error}
        </p>
      </main>
    );
  }

  const { thread, userLabel, caseShortId } = result;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="mb-4">
        <Link href="/admin/support" className="text-sm text-sky-700 underline">
          &larr; Back to inbox
        </Link>
      </div>
      <PortalPageHeader
        eyebrow="Support thread"
        title={userLabel}
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              "rounded-full border px-2 py-0.5 font-medium "
              + (thread.userRole === "accountant"
                ? "bg-sky-100 text-sky-800 border-sky-300"
                : "bg-slate-100 text-slate-700 border-slate-300")
            }
          >
            {thread.userRole}
          </span>
          <span
            className={
              "rounded-full border px-2 py-0.5 font-medium "
              + (thread.status === "open"
                ? "bg-amber-100 text-amber-800 border-amber-300"
                : "bg-emerald-100 text-emerald-800 border-emerald-300")
            }
          >
            {thread.status === "open" ? "Open" : "Resolved"}
          </span>
          <Link
            href={`/admin/cases/${thread.caseId}`}
            className="text-sky-700 underline"
          >
            View case <span className="font-mono">{caseShortId}</span>
          </Link>
          <span className="text-slate-500">
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
    </main>
  );
}
