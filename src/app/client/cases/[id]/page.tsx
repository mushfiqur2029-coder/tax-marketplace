import Link from "next/link";
import { loadClientCase } from "@/lib/case";
import {
  reconcilePaymentAction,
  approveAndFileAction,
  startAddonCheckoutAction,
  reconcileAddonPaymentAction,
} from "@/app/client/actions";
import { ApproveAndFileButton } from "./approve-and-file-button";
import { AddonPayBanner } from "./addon-pay-banner";
import { Bell } from "@/components/bell";
import { ClientSuspensionBanner } from "@/app/client/suspension-banner";
import {
  sendMessageAction,
  uploadMessageAttachmentAction,
  getMessageAttachmentSignedUrl,
} from "@/app/messages";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard-shell";
import { SLLink } from "@/components/sl-button";
import { StatusPill } from "@/components/case/status-pill";
import { DeadlinePill } from "@/components/case/deadline-pill";
import { UrgentPill } from "@/components/case/urgent-pill";
import { StepTracker } from "@/components/case/step-tracker";
import { buildSteps } from "@/components/case/build-steps";
import { ProgressBar } from "@/components/case/progress-bar";
import {
  MultiThreadChat,
  type ChatMessage,
  type ChatThread,
} from "@/components/case/multi-thread-chat";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string; addon_paid?: string }>;
}) {
  const { id } = await params;
  const { paid, addon_paid } = await searchParams;

  if (paid === "1") {
    try {
      await reconcilePaymentAction(id);
    } catch {}
  }
  // Fallback reconcile for add-on payments — the Stripe webhook usually
  // wins, but on local dev / slow webhooks the page-load poll picks up
  // the paid state and fires the accountant notification.
  if (addon_paid) {
    try {
      await reconcileAddonPaymentAction(addon_paid);
    } catch {}
  }

  const data = await loadClientCase(id);
  const isDraft = data.row.status === "draft";
  const nextHref = `/client/cases/${id}/${data.progress.nextStep === "done" ? "" : data.progress.nextStep}`;

  // Load add-ons on this case. Clients see:
  //   • pending_payment as a prominent pay banner near the top
  //   • paid / rejected in the history section below documents
  // Custom rows in pending_admin never surface here — admin holds them.
  type AddonRow = {
    id: string;
    kind: "preset" | "custom";
    description: string;
    amount_pence: number;
    status: "pending_admin" | "pending_payment" | "paid" | "rejected";
    created_at: string;
    paid_at: string | null;
    review_note: string | null;
  };
  let addons: AddonRow[] = [];
  if (!isDraft) {
    const supabase = await createClient();
    const { data: addonRows } = await supabase
      .from("case_addons")
      .select(
        "id, kind, description, amount_pence, status, created_at, paid_at, review_note",
      )
      .eq("case_id", id)
      .in("status", ["pending_payment", "paid", "rejected"])
      .order("created_at", { ascending: false });
    addons = (addonRows ?? []) as AddonRow[];
  }
  const pendingPayAddons = addons.filter((a) => a.status === "pending_payment");
  const historyAddons = addons.filter((a) => a.status !== "pending_payment");

  // Load client's chat threads: direct (client_accountant) and support (client_admin).
  let threads: ChatThread[] = [];
  if (!isDraft) {
    const supabase = await createClient();
    const { data: msgs } = await supabase
      .from("messages")
      .select("id, case_id, channel, sender_id, body, attachments, attachment_path, attachment_name, attachment_type, created_at")
      .eq("case_id", id)
      .in("channel", ["client_accountant", "client_admin"])
      .order("created_at", { ascending: true });
    const all = (msgs ?? []) as ChatMessage[];
    // On the direct thread the client may see two other senders: their
    // accountant and (occasionally) an admin. Map the accountant explicitly so
    // an admin post is clearly labelled "Admin".
    const directLabels: Record<string, string> = data.row.accountant_id
      ? { [data.row.accountant_id]: "Accountant" }
      : {};
    threads = [
      {
        channel: "client_accountant",
        label: "Accountant",
        senderLabels: directLabels,
        fallbackSenderLabel: "Admin",
        initial: all.filter((m) => m.channel === "client_accountant"),
      },
      {
        channel: "client_admin",
        label: "Support",
        senderLabels: {},
        fallbackSenderLabel: "Admin",
        initial: all.filter((m) => m.channel === "client_admin"),
      },
    ];
  }

  const send = async (input: Parameters<typeof sendMessageAction>[0]) => {
    "use server";
    return sendMessageAction(input);
  };
  const approve = async () => {
    "use server";
    return approveAndFileAction(id);
  };
  const uploadAttachment = async (caseId: string, fd: FormData) => {
    "use server";
    return uploadMessageAttachmentAction(caseId, fd);
  };
  const getAttachmentUrl = async (path: string) => {
    "use server";
    return getMessageAttachmentSignedUrl(path);
  };
  const startAddonCheckout = async (addonId: string) => {
    "use server";
    return startAddonCheckoutAction(addonId);
  };

  return (
    <DashboardShell
      eyebrow={`${data.segment.title} · ${data.tier.title}`}
      title={isDraft ? "Finish your submission" : "Case dashboard"}
      description={
        isDraft
          ? "You're a few steps away from submitting."
          : "Track progress and message your accountant here."
      }
      name={data.me.name}
      email={data.me.email}
      role={data.me.role}
      bell={<Bell userId={data.me.id} role={data.me.role} />}
    >
      <ClientSuspensionBanner />
      {paid === "1" && data.progress.paid ? (
        <div
          role="status"
          className="mb-6 rounded-xl border px-4 py-3 text-sm"
          style={{
            background: "rgba(19, 217, 160, 0.10)",
            borderColor: "rgba(19, 217, 160, 0.4)",
            color: "#0E7B57",
          }}
        >
          Payment received. your case is in the queue. An accountant will pick it up shortly.
        </div>
      ) : null}

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <StatusPill status={data.row.status} />
        {data.row.is_urgent ? <UrgentPill /> : null}
        {data.row.deadline ? <DeadlinePill deadline={data.row.deadline} /> : null}
        {isDraft ? (
          <SLLink href={nextHref} variant="primary">
            Resume. {stepLabel(data.progress.nextStep)}
          </SLLink>
        ) : null}
      </div>

      {data.row.status === "client_approval" && data.me.status !== "suspended" ? (
        <ApproveAndFileButton approve={approve} />
      ) : null}

      {!isDraft && data.me.status !== "suspended"
        ? pendingPayAddons.map((a) => (
            <AddonPayBanner
              key={a.id}
              addonId={a.id}
              amountPence={a.amount_pence}
              description={a.description}
              startCheckout={startAddonCheckout}
            />
          ))
        : null}

      {isDraft ? (
        <>
          <div className="mb-8">
            <StepTracker steps={buildSteps(id, data, null)} />
          </div>
          <div className="card-sl p-6 text-sm text-slate">
            <p>
              Your accountant will only see the case once payment succeeds. Nothing is charged until you click Pay on the checkout step.
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="mb-6">
            <ProgressBar status={data.row.status} />
          </div>
          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <div className="space-y-6">
              <div className="card-sl p-6 sm:p-8">
                <h3
                  className="text-sm font-semibold uppercase tracking-wider text-slate"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  Documents ({data.docs.length})
                </h3>
                {data.docs.length === 0 ? (
                  <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-slate">
                    No documents uploaded.
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-paper">
                    {data.docs.map((d) => (
                      <li key={d.id} className="flex items-center justify-between px-4 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-ink">{d.file_name}</div>
                          <div className="text-xs text-slate">{formatDateTime(d.uploaded_at)}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {historyAddons.length > 0 ? (
                <div className="card-sl p-6 sm:p-8">
                  <h3
                    className="text-sm font-semibold uppercase tracking-wider text-slate"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    Add-ons ({historyAddons.length})
                  </h3>
                  <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-paper">
                    {historyAddons.map((a) => (
                      <li key={a.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                        <div className="min-w-0">
                          <div className="font-semibold text-ink">
                            £{(a.amount_pence / 100).toFixed(2)}
                          </div>
                          <p className="mt-0.5 text-slate">{a.description}</p>
                          <p className="mt-1 text-[11px] text-slate">
                            {a.paid_at ? <>Paid {formatDateTime(a.paid_at)}</> : null}
                            {a.status === "rejected" ? (
                              <>Rejected · &ldquo;{a.review_note ?? "no reason given"}&rdquo;</>
                            ) : null}
                          </p>
                        </div>
                        <ClientAddonStatusPill status={a.status} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <aside className="card-sl p-4 sm:p-6">
              <span className="eyebrow">Chat</span>
              <p className="mt-2 text-xs text-slate">
                Message your accountant, or contact Sterling Ledger support.
              </p>
              <div className="mt-3">
                <MultiThreadChat
                  caseId={id}
                  meId={data.me.id}
                  threads={threads}
                  send={send}
                  uploadAttachment={uploadAttachment}
                  getAttachmentUrl={getAttachmentUrl}
                />
              </div>
            </aside>
          </div>
        </>
      )}

      <div className="mt-8">
        <Link href="/client" className="text-sm font-semibold text-navy-deep underline underline-offset-4 hover:text-sky">
          ← Back to all cases
        </Link>
      </div>
    </DashboardShell>
  );
}

function stepLabel(
  step: "engagement" | "intake" | "documents" | "checkout" | "done",
) {
  switch (step) {
    case "engagement":
      return "Sign engagement letter";
    case "intake":
      return "Answer questions";
    case "documents":
      return "Upload documents";
    case "checkout":
      return "Pay and submit";
    default:
      return "Continue";
  }
}

function ClientAddonStatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
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
