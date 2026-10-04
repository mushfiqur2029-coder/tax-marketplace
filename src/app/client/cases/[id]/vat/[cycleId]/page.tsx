import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DashboardShell } from "@/components/dashboard-shell";
import { Bell } from "@/components/bell";
import { ClientSuspensionBanner } from "@/app/client/suspension-banner";
import {
  VAT_CYCLE_UPLOAD_FIELDS,
  isVatUploadRequired,
  getVatRegistrationNumber,
  VAT_PERIOD_FOOTER_NOTE,
  ACCOUNTANT_VAT_RETURN_DOC_KEY,
  type VatApprovalPayload,
} from "@/lib/vat/cycle";
import {
  uploadVatCycleDocAction,
  removeVatCycleDocAction,
  submitVatCycleDocsAction,
  approveAndFileVatCycleAction,
  getVatCycleDocSignedUrl,
} from "@/app/client/vat-actions";
import { VatCycleUploadForm } from "./vat-cycle-upload-form";
import { VatApprovalReviewCard } from "./vat-approval-review-card";

export const dynamic = "force-dynamic";

function formatYmd(ymd: string | null | undefined): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function VatCyclePage({
  params,
}: {
  params: Promise<{ id: string; cycleId: string }>;
}) {
  const { id, cycleId } = await params;
  const me = await requireRole("client");
  const admin = createAdminClient();

  const { data: cycle } = await admin
    .from("vat_return_cycles")
    .select(
      "id, case_id, cycle_number, period_label, cycle_start_date, cycle_end_date, cycle_hmrc_due_date, status, client_docs_submitted_at, approval_payload, filed_at",
    )
    .eq("id", cycleId)
    .single();
  if (!cycle || cycle.case_id !== id) notFound();

  const { data: caseRow } = await admin
    .from("cases")
    .select("id, client_id, segment, tier, intake_answers")
    .eq("id", id)
    .single();
  if (!caseRow || caseRow.client_id !== me.id) notFound();
  if (
    caseRow.segment !== "limited_company_vat" ||
    caseRow.tier !== "vat_reg"
  ) {
    notFound();
  }

  const vatRegistrationNumber = getVatRegistrationNumber(
    caseRow.intake_answers as Record<string, string> | null,
  );

  const { data: docs } = await admin
    .from("case_documents")
    .select("id, file_name, file_url, uploaded_at, requirement_key")
    .eq("vat_cycle_id", cycleId)
    .order("uploaded_at", { ascending: true });
  const docList = (docs ?? []) as Array<{
    id: string;
    file_name: string;
    file_url: string;
    uploaded_at: string;
    requirement_key: string | null;
  }>;

  const docsByKey: Record<
    string,
    { id: string; file_name: string; uploaded_at: string }[]
  > = {};
  for (const d of docList) {
    if (!d.requirement_key) continue;
    const arr = docsByKey[d.requirement_key] ?? [];
    arr.push({
      id: d.id,
      file_name: d.file_name,
      uploaded_at: d.uploaded_at,
    });
    docsByKey[d.requirement_key] = arr;
  }

  const requiredCount = VAT_CYCLE_UPLOAD_FIELDS.filter((f) =>
    isVatUploadRequired(f.id),
  ).length;
  const requiredDone = VAT_CYCLE_UPLOAD_FIELDS.filter(
    (f) =>
      isVatUploadRequired(f.id) && (docsByKey[f.id]?.length ?? 0) > 0,
  ).length;

  const accountantReturnDocs = docList.filter(
    (d) => d.requirement_key === ACCOUNTANT_VAT_RETURN_DOC_KEY,
  );

  const uploadDoc = async (requirementKey: string, fd: FormData) => {
    "use server";
    return uploadVatCycleDocAction(cycleId, requirementKey, fd);
  };
  const removeDoc = async (docId: string) => {
    "use server";
    return removeVatCycleDocAction(cycleId, docId);
  };
  const submit = async () => {
    "use server";
    return submitVatCycleDocsAction(cycleId);
  };
  const approve = async () => {
    "use server";
    return approveAndFileVatCycleAction(cycleId);
  };
  const getDocUrl = async (path: string) => {
    "use server";
    return getVatCycleDocSignedUrl(cycleId, path);
  };

  const headerDescription = `Period: ${formatYmd(cycle.cycle_start_date)} to ${formatYmd(cycle.cycle_end_date)} · HMRC due ${formatYmd(cycle.cycle_hmrc_due_date)}`;

  return (
    <DashboardShell
      eyebrow={`VAT return · ${cycle.period_label}`}
      title={
        cycle.status === "client_approval"
          ? "Review and approve your VAT return"
          : cycle.status === "filed"
            ? "VAT period filed"
            : cycle.status === "in_review"
              ? "Your accountant is preparing your VAT return"
              : "Upload documents for this VAT period"
      }
      description={headerDescription}
      name={me.name}
      email={me.email}
      role={me.role}
      bell={<Bell userId={me.id} role={me.role} />}
    >
      <ClientSuspensionBanner />

      {cycle.status === "awaiting_client_docs" ? (
        <VatCycleUploadForm
          fields={VAT_CYCLE_UPLOAD_FIELDS}
          docsByKey={docsByKey}
          requiredCount={requiredCount}
          requiredDone={requiredDone}
          footer={VAT_PERIOD_FOOTER_NOTE}
          uploadDoc={uploadDoc}
          removeDoc={removeDoc}
          submit={submit}
        />
      ) : null}

      {cycle.status === "in_review" ? (
        <div className="card-sl p-6 sm:p-8 text-sm text-slate">
          Your documents are in. Your accountant will prepare the VAT
          return and send it to you to approve before filing. You&apos;ll
          get a notification here the moment it&apos;s ready.
        </div>
      ) : null}

      {cycle.status === "client_approval" ? (
        <VatApprovalReviewCard
          payload={cycle.approval_payload as VatApprovalPayload}
          periodLabel={cycle.period_label}
          hmrcDueDate={cycle.cycle_hmrc_due_date}
          vatRegistrationNumber={vatRegistrationNumber}
          returnDocs={accountantReturnDocs.map((d) => ({
            id: d.id,
            file_name: d.file_name,
            file_url: d.file_url,
            uploaded_at: d.uploaded_at,
          }))}
          getDocUrl={getDocUrl}
          approve={approve}
          disabled={me.status === "suspended"}
        />
      ) : null}

      {cycle.status === "filed" ? (
        <div className="card-sl p-6 sm:p-8">
          <h3
            className="text-sm font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Filed
          </h3>
          <p className="mt-2 text-sm text-ink">
            This VAT return was filed on {formatYmd(cycle.filed_at?.slice(0, 10) ?? null)}.
          </p>
        </div>
      ) : null}

      <div className="mt-10">
        <Link
          href={`/client/cases/${id}`}
          className="text-sm font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
        >
          ← Back to the case
        </Link>
      </div>
    </DashboardShell>
  );
}
