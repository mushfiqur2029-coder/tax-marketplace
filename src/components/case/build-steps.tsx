import type { CaseData } from "@/lib/case";
import type { Step } from "./step-tracker";

export type ClientFlowStepKey =
  | "engagement"
  | "intake"
  | "documents"
  | "checkout";

export function buildSteps(
  caseId: string,
  data: CaseData,
  current: ClientFlowStepKey | null,
): Step[] {
  const p = data.progress;
  const isCompany = data.segment.id === "limited_company_vat";

  // Limited-company clients see a shorter stepper: sign → pay →
  // submitted. The per-service document checklist (Sections A/B/C/D)
  // lives post-payment in a later batch, so it's deliberately absent
  // here — the client's attention needs to be on getting the engagement
  // signed and the fee paid first.
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
        key: "submitted",
        label: "Submitted",
        href: `/client/cases/${caseId}`,
        done: data.row.status !== "draft",
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
