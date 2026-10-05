import type { CaseData } from "@/lib/case";
import { periodDocsApplyToTier } from "@/lib/engagement/period-docs";
import type { TierId } from "@/lib/plans";
import type { Step } from "./step-tracker";

export type ClientFlowStepKey =
  | "engagement"
  | "checkout"
  | "onboarding"
  | "period_docs";

// Both Personal (new 9-up catalogue) and Limited Company follow the
// same shape: sign → pay → upload → (period docs for non-dormant LC) →
// submitted. The old personal path (intake → documents → checkout)
// has no cases on it and the routes were deleted alongside the
// restructure (migration 0045 + /client/new rewrite).
export function buildSteps(
  caseId: string,
  data: CaseData,
  current: ClientFlowStepKey | null,
): Step[] {
  const p = data.progress;
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
