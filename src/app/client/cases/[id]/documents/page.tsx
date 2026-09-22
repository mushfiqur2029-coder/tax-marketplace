import Link from "next/link";
import { redirect } from "next/navigation";
import { loadClientCase } from "@/lib/case";
import {
  uploadDocumentAction,
  deleteDocumentAction,
} from "@/app/client/actions";
import { DashboardShell } from "@/components/dashboard-shell";
import { Bell } from "@/components/bell";
import { SLButton } from "@/components/sl-button";
import { StepTracker } from "@/components/case/step-tracker";
import { buildSteps } from "@/components/case/build-steps";
import { DocumentUploader } from "./document-uploader";
import { DocumentList } from "./document-list";

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadClientCase(id);

  if (data.row.status !== "draft") {
    redirect(`/client/cases/${id}`);
  }

  const uploadBound = async (fd: FormData) => {
    "use server";
    await uploadDocumentAction(id, fd);
  };
  const deleteBound = async (docId: string) => {
    "use server";
    await deleteDocumentAction(id, docId);
  };

  return (
    <DashboardShell
      eyebrow={`${data.segment.title} · ${data.tier.title}`}
      title="Upload your documents"
      description="Bank-level secure storage. Add what you have now. you can add more after payment."
      name={data.me.name}
      email={data.me.email}
      role={data.me.role}
      bell={<Bell userId={data.me.id} role={data.me.role} />}
    >
      <div className="mb-8">
        <StepTracker steps={buildSteps(id, data, "documents")} />
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="card-sl p-6 sm:p-8">
          <DocumentUploader action={uploadBound} />
          <div className="mt-8">
            <h3
              className="text-sm font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Uploaded ({data.docs.length})
            </h3>
            <div className="mt-3">
              <DocumentList docs={data.docs} onDelete={deleteBound} />
            </div>
          </div>
        </div>

        <aside className="card-sl bg-cloud/60 p-6">
          <span className="eyebrow">Suggested for {data.segment.title.toLowerCase()}</span>
          <ul className="mt-3 space-y-2 text-sm text-ink">
            {data.segment.suggestedDocs.map((d) => (
              <li key={d} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-sky" />
                {d}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-slate">
            Missing something? Your accountant can request it in chat after your case is submitted.
          </p>
        </aside>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Link href={`/client/cases/${id}/checkout`} className="btn-sl btn-sl-primary">
          Continue to payment
        </Link>
        <Link href={`/client/cases/${id}/intake`} className="btn-sl btn-sl-ghost">
          Back
        </Link>
      </div>
    </DashboardShell>
  );
}
