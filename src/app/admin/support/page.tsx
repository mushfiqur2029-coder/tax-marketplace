import Link from "next/link";
import { listSupportThreadsAction } from "@/app/support/actions";
import { PortalPageHeader } from "@/components/portal-page-header";

// Phase 7 Slice 7.3: admin support inbox. Lists open threads first
// (sorted by last_message_at desc), with a tab-like toggle to see
// resolved threads too via ?status=resolved or ?status=all.

export const dynamic = "force-dynamic";

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
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <PortalPageHeader eyebrow="Admin" title="Support inbox" />

      <nav className="mb-5 flex flex-wrap gap-2 text-sm">
        {([
          ["open", "Open"],
          ["resolved", "Resolved"],
          ["all", "All"],
        ] as const).map(([value, label]) => (
          <Link
            key={value}
            href={value === "open" ? "/admin/support" : `/admin/support?status=${value}`}
            className={
              "rounded border px-3 py-1 "
              + (filter === value
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")
            }
          >
            {label}
          </Link>
        ))}
      </nav>

      {err ? (
        <p className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{err}</p>
      ) : null}

      {!err && threads.length === 0 ? (
        <p className="rounded border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
          {filter === "open"
            ? "Inbox clear. No open support threads."
            : filter === "resolved"
              ? "No resolved threads yet."
              : "No support threads yet."}
        </p>
      ) : null}

      {threads.length > 0 ? (
        <ul className="space-y-2">
          {threads.map((t) => (
            <li key={t.id}>
              <Link
                href={`/admin/support/${t.id}`}
                className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-400 hover:bg-slate-50"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {t.userLabel}
                      </span>
                      <span
                        className={
                          "rounded-full border px-1.5 py-0.5 text-[11px] font-medium "
                          + (t.userRole === "accountant"
                            ? "bg-sky-100 text-sky-800 border-sky-300"
                            : "bg-slate-100 text-slate-700 border-slate-300")
                        }
                      >
                        {t.userRole}
                      </span>
                      {t.status === "resolved" ? (
                        <span className="rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">
                          Resolved
                        </span>
                      ) : null}
                    </div>
                    {t.lastMessagePreview ? (
                      <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                        {t.lastMessagePreview}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs italic text-slate-400">
                        No messages yet.
                      </p>
                    )}
                  </div>
                  <time className="shrink-0 text-[11px] text-slate-500">
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
    </main>
  );
}
