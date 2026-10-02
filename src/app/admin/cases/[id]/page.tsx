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
import {
  getEngagementAssetSignedUrl,
  revealCompanyAuthCodeAction,
} from "@/app/client/engagement-actions";
import { SignedEngagementPanel } from "@/components/engagement/signed-engagement-panel";
import { OnboardingAnswersPanel } from "@/components/engagement/onboarding-answers-panel";
import {
  sectionsForTier,
  fieldsForTier,
} from "@/lib/engagement/checklist";
import type { TierId } from "@/lib/plans";
import { DashboardShell } from "@/components/dashboard-shell";
import { StatusPill } from "@/components/case/status-pill";
import { DeadlinePill } from "@/components/case/deadline-pill";
import { UrgentPill } from "@/components/case/urgent-pill";
import { ProgressBar } from "@/components/case/progress-bar";
import {
  MultiThreadChat,
  type ChatMessage,
  type ChatThread,
} from "@/components/case/multi-thread-chat";
import { ReassignForm } from "./reassign-form";
import { formatDateTime } from "@/lib/format";
import { AdminNav } from "@/app/admin/admin-nav";
import { getAdminNavCounts } from "@/app/admin/admin-counts";
import { Bell } from "@/components/bell";

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
      "id, client_id, accountant_id, segment, tier, status, stripe_payment_status, intake_answers, submitted_at, created_at, deadline, is_urgent, urgent_fee_pence, engagement_signed_at, onboarding_submitted_at, company_auth_code_encrypted",
    )
    .eq("id", id)
    .single();
  if (!row) notFound();

  const seg = getSegment(row.segment);
  const tier = getTier(row.tier);
  if (!seg || !tier) notFound();

  const [{ data: client }, { data: acc }, { data: allAccs }, { data: docs }, { data: msgs }, { data: actions }, { data: addons }, navCounts] =
    await Promise.all([
      admin.from("users").select("id, email").eq("id", row.client_id).single(),
      row.accountant_id
        ? admin.from("users").select("id, email").eq("id", row.accountant_id).single()
        : Promise.resolve({ data: null }),
      admin.from("users").select("id, email").eq("role", "accountant").order("email"),
      admin
        .from("case_documents")
        .select("id, file_name, file_url, uploaded_at, requirement_key")
        .eq("case_id", id)
        .order("uploaded_at", { ascending: false }),
      admin
        .from("messages")
        .select("id, case_id, channel, sender_id, body, attachments, attachment_path, attachment_name, attachment_type, created_at")
        .eq("case_id", id)
        .order("created_at", { ascending: true }),
      admin
        .from("admin_actions")
        .select("id, target_user_id, action, note, created_at")
        .order("created_at", { ascending: false })
        .limit(5),
      admin
        .from("case_addons")
        .select("id, kind, description, amount_pence, status, review_note, created_at, reviewed_at, paid_at")
        .eq("case_id", id)
        .order("created_at", { ascending: false }),
      getAdminNavCounts(),
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
    return reassignCaseAction(id, accountantId, note);
  };
  const getEngagementPdf = async () => {
    "use server";
    return getEngagementAssetSignedUrl(id, "pdf");
  };
  const getEngagementSignature = async () => {
    "use server";
    return getEngagementAssetSignedUrl(id, "signature");
  };
  // Signed URL for an onboarding doc. Admin-level: cross-check that the
  // path is on this case before signing, since the client gives us an
  // arbitrary string.
  const getOnboardingDocUrl = async (
    path: string,
  ): Promise<import("@/lib/action-result").ActionResult<string>> => {
    "use server";
    const admin2 = createAdminClient();
    const { data: doc } = await admin2
      .from("case_documents")
      .select("case_id")
      .eq("file_url", path)
      .single();
    if (!doc || doc.case_id !== id) {
      return { ok: false, error: "Document not on this case." };
    }
    const { data, error } = await admin2.storage
      .from("case-documents")
      .createSignedUrl(path, 60);
    if (error || !data) {
      return { ok: false, error: error?.message ?? "Could not sign URL." };
    }
    return { ok: true, data: data.signedUrl };
  };
  const revealAuthCode = async () => {
    "use server";
    return revealCompanyAuthCodeAction(id);
  };

  return (
    <DashboardShell
      eyebrow={`${seg.title} · ${tier.title}`}
      title="Case oversight"
      description={`Client ${client?.email ?? "."} · Accountant ${acc?.email ?? "unassigned"}`}
      name={me.name}
      email={me.email}
      role={me.role}
      subnav={<AdminNav counts={navCounts} />}
      bell={<Bell userId={me.id} role={me.role} />}
    >
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusPill status={row.status} />
        {row.is_urgent ? <UrgentPill /> : null}
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

          {row.engagement_signed_at ? (
            <section className="card-sl p-6 sm:p-8">
              <h3
                className="text-sm font-semibold uppercase tracking-wider text-slate"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Engagement letter
              </h3>
              <div className="mt-4">
                <SignedEngagementPanel
                  signedAt={row.engagement_signed_at}
                  getPdfUrl={getEngagementPdf}
                  getSignatureUrl={getEngagementSignature}
                />
              </div>
            </section>
          ) : null}

          {row.onboarding_submitted_at &&
          row.segment === "limited_company_vat" ? (
            <section className="card-sl p-6 sm:p-8">
              <h3
                className="text-sm font-semibold uppercase tracking-wider text-slate"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Onboarding checklist
              </h3>
              <div className="mt-4">
                <OnboardingAnswersPanel
                  sections={sectionsForTier(tier.id as TierId)}
                  fields={fieldsForTier(tier.id as TierId)}
                  answers={answers}
                  docs={(docs ?? []).filter((d) => d.requirement_key)}
                  authCodeAvailable={!!row.company_auth_code_encrypted}
                  getDocUrl={getOnboardingDocUrl}
                  revealAuthCode={revealAuthCode}
                />
              </div>
            </section>
          ) : null}

          {/* Legacy intake — personal cases only. Limited-company data lives
              in the Onboarding checklist card above. */}
          {row.segment !== "limited_company_vat" ? (
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
          ) : null}

          <section className="card-sl p-6 sm:p-8">
            <h3
              className="text-sm font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Add-ons ({addons?.length ?? 0})
            </h3>
            {!addons || addons.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-slate">
                No add-ons on this case.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-paper">
                {addons.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ink">
                        £{(a.amount_pence / 100).toFixed(2)}{" "}
                        <span className="text-xs font-normal text-slate">
                          · {a.kind === "preset" ? "Preset" : "Custom"}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm text-slate">{a.description}</p>
                      <p className="mt-1 text-[11px] text-slate">
                        Requested {formatDateTime(a.created_at)}
                        {a.reviewed_at ? <> · reviewed {formatDateTime(a.reviewed_at)}</> : null}
                        {a.paid_at ? <> · paid {formatDateTime(a.paid_at)}</> : null}
                        {a.review_note ? <> · &ldquo;{a.review_note}&rdquo;</> : null}
                      </p>
                    </div>
                    <AddonStatusPill status={a.status} />
                  </li>
                ))}
              </ul>
            )}
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

    </DashboardShell>
  );
}

function AddonStatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    pending_admin: {
      label: "Pending admin",
      bg: "rgba(217,159,25,0.14)",
      color: "#B57E12",
    },
    pending_payment: {
      label: "Pending payment",
      bg: "rgba(25,156,217,0.14)",
      color: "var(--sky)",
    },
    paid: {
      label: "Paid",
      bg: "rgba(19,217,160,0.14)",
      color: "#0E9E77",
    },
    rejected: {
      label: "Rejected",
      bg: "rgba(220,38,38,0.12)",
      color: "#B91C1C",
    },
  };
  const cfg = map[status] ?? {
    label: status,
    bg: "rgba(15,30,77,0.08)",
    color: "var(--navy-deep)",
  };
  return (
    <span
      className="shrink-0 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
      style={{ background: cfg.bg, color: cfg.color, fontFamily: "var(--font-mono)" }}
    >
      {cfg.label}
    </span>
  );
}
