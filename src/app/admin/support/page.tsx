import Link from "next/link";
import { listSupportThreadsAction } from "@/app/support/actions";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminPill } from "@/components/admin/admin-pill";

// Phase 7 Slice 7.3: admin support inbox. Lists open threads first
// (sorted by last_message_at desc), with a tab-like toggle to see
// resolved threads too via ?status=resolved or ?status=all.
//
// Brought into the standard admin chrome (AdminPageHeader + the
// layout's own main-area frame, card-sl row styling, shared AdminPill)
// - this page used to be the one admin surface still wrapping itself in
// a centered <main max-w-4xl> with PortalPageHeader, which made it look
// like a different app next to the rest of /admin.

export const dynamic = "force-dynamic";

const TABS = [
  ["open", "Open"],
  ["resolved", "Resolved"],
  ["all", "All"],
] as const;

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const filter: "open" | "resolved" | "all" =
    status === "resolved" ? "resolved" : status === "all" ? "all" : "open";

  const result = await listSupportThreadsAction(filter);
  const threads = result.ok ? result.threads : [];
  const err = result.ok ? null : result.error;

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="Support inbox"
        description="Direct support threads opened by clients and accountants."
      />

      <div className="mb-6 inline-flex rounded-full border border-line bg-paper p-1">
        {TABS.map(([value, label]) => {
          const isActive = filter === value;
          return (
            <Link
              key={value}
              href={value === "open" ? "/admin/support" : `/admin/support?status=${value}`}
              aria-pressed={isActive}
              className={
                "inline-flex items-center rounded-full px-4 py-1.5 text-xs font-semibold transition " +
                (isActive
                  ? "bg-navy-deep text-white"
                  : "text-slate hover:text-navy-deep")
              }
            >
              {label}
            </Link>
          );
        })}
      </div>

      {err ? (
        <p className="card-sl border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {err}
        </p>
      ) : null}

      {!err && threads.length === 0 ? (
        <p className="card-sl border-dashed p-6 text-center text-sm text-slate">
          {filter === "open"
            ? "Inbox clear. No open support threads."
            : filter === "resolved"
              ? "No resolved threads yet."
              : "No support threads yet."}
        </p>
      ) : null}

      {threads.length > 0 ? (
        <ul className="grid gap-3">
          {threads.map((t) => (
            <li key={t.id}>
              <Link
                href={`/admin/support/${t.id}`}
                className="card-sl block p-5 transition hover:border-sky/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-ink">
                        {t.userLabel}
                      </span>
                      <AdminPill
                        tone={t.userRole === "accountant" ? "blue" : "grey"}
                        label={t.userRole}
                      />
                      <span className="text-[11px] text-slate">
                        on Case <span className="font-mono">{t.caseShortId}</span>
                      </span>
                      {t.status === "resolved" ? (
                        <AdminPill tone="green" label="Resolved" />
                      ) : null}
                    </div>
                    {t.lastMessagePreview ? (
                      <p className="mt-1 line-clamp-2 text-xs text-slate">
                        {t.lastMessagePreview}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs italic text-slate">
                        No messages yet.
                      </p>
                    )}
                  </div>
                  <time className="shrink-0 text-[11px] text-slate">
                    {t.lastMessageAt
                      ? new Date(t.lastMessageAt).toLocaleString("en-GB", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : new Date(t.createdAt).toLocaleDateString("en-GB")}
                  </time>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
