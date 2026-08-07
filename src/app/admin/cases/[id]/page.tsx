import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSegment } from "@/lib/segments";
import { getTier } from "@/lib/plans";
import {
  sendMessageAction,
  uploadMessageAttachmentAction,
  getMessageAttachmentSignedUrl,
} from "@/app/messages";
import { reassignCaseAction } from "@/app/admin/actions";
import { DashboardShell } from "@/components/dashboard-shell";
import { StatusPill } from "@/components/case/status-pill";
import { DeadlinePill } from "@/components/case/deadline-pill";
import { ProgressBar } from "@/components/case/progress-bar";
import {
  MultiThreadChat,
  type ChatMessage,
  type ChatThread,
} from "@/components/case/multi-thread-chat";
import { ReassignForm } from "./reassign-form";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminCasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await requireRole("admin");
  const admin = createAdminClient();

  const { data: row } = await admin
    .from("cases")
    .select(
      "id, client_id, accountant_id, segment, tier, status, stripe_payment_status, intake_answers, submitted_at, created_at, deadline",
    )
    .eq("id", id)
    .single();
  if (!row) notFound();

  const seg = getSegment(row.segment);
  const tier = getTier(row.tier);
  if (!seg || !tier) notFound();

  const [{ data: client }, { data: acc }, { data: allAccs }, { data: docs }, { data: msgs }, { data: actions }] =
    await Promise.all([
      admin.from("users").select("id, email").eq("id", row.client_id).single(),
      row.accountant_id
        ? admin.from("users").select("id, email").eq("id", row.accountant_id).single()
        : Promise.resolve({ data: null }),
      admin.from("users").select("id, email").eq("role", "accountant").order("email"),
      admin
        .from("case_documents")
        .select("id, file_name, file_url, uploaded_at")
        .eq("case_id", id)
        .order("uploaded_at", { ascending: false }),
      admin
        .from("messages")
        .select("id, case_id, channel, sender_id, body, attachment_path, attachment_name, attachment_type, created_at")
        .eq("case_id", id)
        .order("created_at", { ascending: true }),
      admin
        .from("admin_actions")
        .select("id, target_user_id, action, note, created_at")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const all = (msgs ?? []) as ChatMessage[];
  // Admin sees three threads. Explicit sender labels so admin's own posts
  // (whether in Direct or a Support thread) always show as "You", and any
  // other sender is mapped to their role.
  const directSenders: Record<string, string> = {};
  if (client?.id) directSenders[client.id] = "Client";
  if (acc?.id) directSenders[acc.id] = "Accountant";

  const clientSupportSenders: Record<string, string> = client?.id
    ? { [client.id]: "Client" }
    : {};
  const accountantSupportSenders: Record<string, string> = acc?.id
    ? { [acc.id]: "Accountant" }
    : {};

  const threads: ChatThread[] = [
    {
      channel: "client_accountant",
      label: "Direct (client ↔ accountant)",
      senderLabels: directSenders,
      fallbackSenderLabel: "Admin",
      initial: all.filter((m) => m.channel === "client_accountant"),
    },
    {
      channel: "client_admin",
      label: `Support: ${client?.email?.split("@")[0] ?? "client"}`,
      senderLabels: clientSupportSenders,
      fallbackSenderLabel: "Admin",
      initial: all.filter((m) => m.channel === "client_admin"),
    },
    {
      channel: "accountant_admin",
      label: `Support: ${acc?.email?.split("@")[0] ?? "accountant"}`,
      senderLabels: accountantSupportSenders,
      fallbackSenderLabel: "Admin",
      initial: all.filter((m) => m.channel === "accountant_admin"),
    },
  ];

  const answers = (row.intake_answers ?? {}) as Record<string, string>;

  const send = async (input: Parameters<typeof sendMessageAction>[0]) => {
    "use server";
    return sendMessageAction(input);
  };
  const uploadAttachment = async (caseId: string, fd: FormData) => {
    "use server";
    return uploadMessageAttachmentAction(caseId, fd);
  };
  const getAttachmentUrl = async (path: string) => {
    "use server";
    return getMessageAttachmentSignedUrl(path);
  };
  const reassign = async (accountantId: string, note: string | null) => {
    "use server";
    await reassignCaseAction(id, accountantId, note);
  };

  return (
    <DashboardShell
      eyebrow={`${seg.title} · ${tier.title}`}
      title="Case oversight"
      description={`Client ${client?.email ?? "."} · Accountant ${acc?.email ?? "unassigned"}`}
      name={me.name}
      email={me.email}
      role={me.role}
    >
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusPill status={row.status} />
        {row.deadline ? <DeadlinePill deadline={row.deadline} /> : null}
      </div>

      <div className="mb-6">
        <ProgressBar status={row.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          {/* Reassign */}
          <section className="card-sl p-6 sm:p-8">
            <h3
              className="text-sm font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Assigned accountant
            </h3>
            <ReassignForm
              caseId={id}
              current={row.accountant_id}
              options={(allAccs ?? []).map((a) => ({
                id: a.id,
                email: a.email,
              }))}
              reassign={reassign}
            />
            {actions && actions.length > 0 ? (
              <ul className="mt-4 space-y-1 border-t border-line pt-3 text-xs text-slate">
                {actions.map((a) => (
                  <li key={a.id}>
                    <span className="mr-2 uppercase tracking-wider text-slate/70" style={{ fontFamily: "var(--font-mono)" }}>
                      {formatDateTime(a.created_at)}
                    </span>
                    {a.note}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* Intake */}
          <section className="card-sl p-6 sm:p-8">
            <h3
              className="text-sm font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Intake answers
            </h3>
            <dl className="mt-4 divide-y divide-line">
              {seg.intake.map((f) => {
                const val = answers[f.name];
                return (
                  <div key={f.name} className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[220px_1fr] sm:gap-4">
                    <dt className="text-xs font-semibold uppercase tracking-wider text-slate" style={{ fontFamily: "var(--font-mono)" }}>
                      {f.label}
                    </dt>
                    <dd className="text-sm text-ink">
                      {val
                        ? f.prefix
                          ? `${f.prefix}${val}`
                          : val
                        : <span className="text-slate italic">(not answered)</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>

          <section className="card-sl p-6 sm:p-8">
            <h3
              className="text-sm font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Documents ({docs?.length ?? 0})
            </h3>
            {!docs || docs.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-slate">
                No documents uploaded.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-paper">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center justify-between px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">{d.file_name}</div>
                      <div className="text-xs text-slate">
                        {formatDateTime(d.uploaded_at)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="card-sl p-4 sm:p-6">
          <span className="eyebrow">All chat threads</span>
          <div className="mt-3">
            <MultiThreadChat
              caseId={id}
              meId={me.id}
              threads={threads}
              send={send}
              uploadAttachment={uploadAttachment}
              getAttachmentUrl={getAttachmentUrl}
            />
          </div>
        </aside>
      </div>

      <div className="mt-8">
        <Link href="/admin" className="text-sm font-semibold text-navy-deep underline underline-offset-4 hover:text-sky">
          ← Back to all cases
        </Link>
      </div>
    </DashboardShell>
  );
}
