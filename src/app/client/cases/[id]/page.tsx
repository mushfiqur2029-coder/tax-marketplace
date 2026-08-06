import Link from "next/link";
import { loadClientCase } from "@/lib/case";
import { reconcilePaymentAction } from "@/app/client/actions";
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
  searchParams: Promise<{ paid?: string }>;
}) {
  const { id } = await params;
  const { paid } = await searchParams;

  if (paid === "1") {
    try {
      await reconcilePaymentAction(id);
    } catch {}
  }

  const data = await loadClientCase(id);
  const isDraft = data.row.status === "draft";
  const nextHref = `/client/cases/${id}/${data.progress.nextStep === "done" ? "" : data.progress.nextStep}`;

  // Load client's chat threads: direct (client_accountant) and support (client_admin).
  let threads: ChatThread[] = [];
  if (!isDraft) {
    const supabase = await createClient();
    const { data: msgs } = await supabase
      .from("messages")
      .select("id, case_id, channel, sender_id, body, attachment_path, attachment_name, attachment_type, created_at")
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
  const uploadAttachment = async (caseId: string, fd: FormData) => {
    "use server";
    return uploadMessageAttachmentAction(caseId, fd);
  };
  const getAttachmentUrl = async (path: string) => {
    "use server";
    return getMessageAttachmentSignedUrl(path);
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
      email={data.me.email}
      role={data.me.role}
    >
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
          Payment received — your case is in the queue. An accountant will pick it up shortly.
        </div>
      ) : null}

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <StatusPill status={data.row.status} />
        {data.row.deadline ? <DeadlinePill deadline={data.row.deadline} /> : null}
        {isDraft ? (
          <SLLink href={nextHref} variant="primary">
            Resume — {stepLabel(data.progress.nextStep)}
          </SLLink>
        ) : null}
      </div>

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

function stepLabel(step: "intake" | "documents" | "checkout" | "done") {
  switch (step) {
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
