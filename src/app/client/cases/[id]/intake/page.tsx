import { redirect } from "next/navigation";
import { loadClientCase } from "@/lib/case";
import { updateIntakeAction } from "@/app/client/actions";
import { DashboardShell } from "@/components/dashboard-shell";
import { Bell } from "@/components/bell";
import { ClientSuspensionBanner } from "@/app/client/suspension-banner";
import { IntakeForm } from "./intake-form";
import { StepTracker } from "@/components/case/step-tracker";
import { buildSteps } from "@/components/case/build-steps";

export default async function IntakePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadClientCase(id);

  if (data.row.status !== "draft") {
    redirect(`/client/cases/${id}`);
  }
  // Limited-company cases don't have an intake form — they go
  // engagement → checkout → per-service document checklist. If anyone
  // lands here (stale bookmark, old step tracker), bounce them to the
  // next step they actually need to complete.
  if (data.segment.id === "limited_company_vat") {
    redirect(
      data.progress.engagementSigned
        ? `/client/cases/${id}/checkout`
        : `/client/cases/${id}/engagement`,
    );
  }

  const bound = async (fd: FormData) => {
    "use server";
    return updateIntakeAction(id, fd);
  };

  return (
    <DashboardShell
      eyebrow={`${data.segment.title} · ${data.tier.title}`}
      title="Tell us about your year"
      description="A few quick questions so your accountant has what they need. This takes 2 to 3 minutes."
      name={data.me.name}
      email={data.me.email}
      role={data.me.role}
      bell={<Bell userId={data.me.id} role={data.me.role} />}
    >
      <ClientSuspensionBanner />
      <div className="mb-8">
        <StepTracker steps={buildSteps(id, data, "intake")} />
      </div>
      <div className="card-sl p-6 sm:p-8">
        <IntakeForm segment={data.segment} initial={data.row.intake_answers ?? {}} action={bound} />
      </div>
    </DashboardShell>
  );
}
