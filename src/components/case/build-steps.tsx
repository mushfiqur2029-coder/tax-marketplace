import type { CaseData } from "@/lib/case";
import { periodDocsApplyToTier } from "@/lib/engagement/period-docs";
import type { TierId } from "@/lib/plans";
import type { Step } from "./step-tracker";

export type ClientFlowStepKey =
  | "engagement"
  | "intake"
  | "documents"
  | "checkout"
  | "onboarding"
  | "period_docs";

export function buildSteps(
  caseId: string,
  data: CaseData,
  current: ClientFlowStepKey | null,
): Step[] {
  const p = data.progress;
  const isCompany = data.segment.id === "limited_company_vat";

  // Limited-company clients see: sign → pay → onboarding checklist →
  // (period docs for non-dormant) → submitted. Dormant short-circuits
  // after onboarding — there's no trading period to document.
  if (isCompany) {
    const needsPeriodDocs = periodDocsApplyToTier(data.tier.id as TierId);
    const steps: Step[] = [
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
    ];
    if (needsPeriodDocs) {
      steps.push({
        key: "period_docs",
        label: "Period documents",
        href: `/client/cases/${caseId}/period-docs`,
        done: p.periodDocsSubmitted,
        current: current === "period_docs",
      });
    }
    steps.push({
      key: "submitted",
      label: "Submitted",
      href: `/client/cases/${caseId}`,
      done: needsPeriodDocs ? p.periodDocsSubmitted : p.onboardingSubmitted,
      current: false,
    });
    return steps;
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
