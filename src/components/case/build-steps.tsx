import type { CaseData } from "@/lib/case";
import type { Step } from "./step-tracker";

export type ClientFlowStepKey =
  | "engagement"
  | "intake"
  | "documents"
  | "checkout"
  | "onboarding";

export function buildSteps(
  caseId: string,
  data: CaseData,
  current: ClientFlowStepKey | null,
): Step[] {
  const p = data.progress;
  const isCompany = data.segment.id === "limited_company_vat";

  // Limited-company clients see: sign → pay → onboarding checklist →
  // submitted. The per-service onboarding (Sections A/B/C/D) lands
  // post-payment and gates the "visible in accountant queue" step.
  if (isCompany) {
    return [
      {
        key: "engagement",
        label: "Sign engagement letter",
        href: `/client/cases/${caseId}/engagement`,
        done: p.engagementSigned,
        current: current === "engagement",
      },
      {
        key: "checkout",
        label: "Pay",
        href: `/client/cases/${caseId}/checkout`,
        done: p.paid,
        current: current === "checkout",
      },
      {
        key: "onboarding",
        label: "Upload documents",
        href: `/client/cases/${caseId}/onboarding`,
        done: p.onboardingSubmitted,
        current: current === "onboarding",
      },
      {
        key: "submitted",
        label: "Submitted",
        href: `/client/cases/${caseId}`,
        done: p.onboardingSubmitted,
        current: false,
      },
    ];
  }

  return [
    {
      key: "intake",
      label: "Answer questions",
      href: `/client/cases/${caseId}/intake`,
      done: p.intakeDone,
      current: current === "intake",
    },
    {
      key: "documents",
      label: "Upload documents",
      href: `/client/cases/${caseId}/documents`,
      done: p.hasDocs,
      current: current === "documents",
    },
    {
      key: "checkout",
      label: "Pay",
      href: `/client/cases/${caseId}/checkout`,
      done: p.paid,
      current: current === "checkout",
    },
    {
      key: "submitted",
      label: "Submitted",
      href: `/client/cases/${caseId}`,
      done: data.row.status !== "draft",
      current: false,
    },
  ];
}
