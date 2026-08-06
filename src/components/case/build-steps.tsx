import type { CaseData } from "@/lib/case";
import type { Step } from "./step-tracker";

export function buildSteps(
  caseId: string,
  data: CaseData,
  current: "intake" | "documents" | "checkout" | null,
): Step[] {
  const p = data.progress;
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
