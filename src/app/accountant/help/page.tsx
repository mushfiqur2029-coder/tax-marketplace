import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreateMyThreadAction } from "@/app/support/actions";
import { SupportChatPanel } from "@/components/support/support-chat-panel";
import { PortalPageHeader } from "@/components/portal-page-header";

// Phase 7 Slice 7.3: accountant-facing support channel. Mirror of the
// client /help page; same action, same panel, different copy and
// different sidebar entry.

export const dynamic = "force-dynamic";

export default async function AccountantHelpPage() {
  const me = await getCurrentUser();
  if (!me || me.role !== "accountant") redirect("/login?next=/accountant/help");

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
        For questions that don&apos;t belong on a specific case: payouts,
        wallet queries, platform bugs, or policy questions. Case-level
        clarifications with a client belong on that case&apos;s own thread.
      </p>
      <div className="mt-6">
        <SupportChatPanel
          threadId={result.thread.id}
          messages={result.thread.messages}
          viewerRole="accountant"
          viewerUserId={me.id}
          threadStatus={result.thread.status}
        />
      </div>
    </main>
  );
}
