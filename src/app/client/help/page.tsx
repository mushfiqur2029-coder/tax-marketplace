import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreateMyThreadAction } from "@/app/support/actions";
import { SupportChatPanel } from "@/components/support/support-chat-panel";
import { PortalPageHeader } from "@/components/portal-page-header";

// Phase 7 Slice 7.3: client-facing support channel. One ongoing thread
// per user, lazy-created on first visit. Shares the SupportChatPanel
// component with the accountant portal (/accountant/help) and the
// admin workspace (/admin/support/[id]).

export const dynamic = "force-dynamic";

export default async function ClientHelpPage() {
  const me = await getCurrentUser();
  if (!me || me.role !== "client") redirect("/login?next=/client/help");

  const result = await getOrCreateMyThreadAction();
  if (!result.ok) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <PortalPageHeader eyebrow="Support" title="Help & support" />
        <p className="mt-6 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {result.error}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <PortalPageHeader eyebrow="Support" title="Help & support" />
      <p className="mt-2 text-sm text-slate-600">
        For questions that don&apos;t belong on a specific case: billing,
        login, account changes, or anything else. Case-specific
        clarifications are better placed in the chat on that case so
        your accountant sees them.
      </p>
      <div className="mt-6">
        <SupportChatPanel
          threadId={result.thread.id}
          messages={result.thread.messages}
          viewerRole="client"
          viewerUserId={me.id}
          threadStatus={result.thread.status}
        />
      </div>
    </main>
  );
}
