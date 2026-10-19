"use client";

// Phase 6 Slice 4: vehicle / capital allowances chat UI. Phase 7 Slice
// 7.6a lifted the chat shell into the shared AiInterviewPanel so the
// four new interview flows (RELIEFS, INCOME_PROBE, EXPENSES_PROBE,
// FILING_DETAILS) can reuse the same UI; this file is now a thin
// wrapper that supplies the vehicle-specific labels + server actions.
//
// Conversation state lives in the browser so an abandoned chat costs
// nothing. On commit, the server re-runs the finalising turn so the
// values written to pch_vehicle are the AI's output, never something
// the browser could have hand-crafted.

import {
  startPchVehicleInterviewAction,
  advancePchVehicleInterviewAction,
  commitPchVehicleInterviewAction,
} from "@/app/client/pch/vehicle-interview-actions";
import { AiInterviewPanel } from "@/components/case/ai-interview-panel";

type Props = {
  caseId: string;
  onClose: () => void;
};

export function VehicleInterviewPanel({ caseId, onClose }: Props) {
  return (
    <AiInterviewPanel
      caseId={caseId}
      onClose={onClose}
      flowLabel="Vehicle conversation"
      flowSubtitle="Capital allowances explained in plain English"
      finishedMessage="Thanks, that's everything on the vehicle. Saving your answers now."
      commitButtonLabel="Save vehicle details"
      commitPendingLabel="Saving your vehicle details..."
      start={startPchVehicleInterviewAction}
      advance={advancePchVehicleInterviewAction}
      commit={commitPchVehicleInterviewAction}
    />
  );
}
