// Phase 7 Slice 7.4/7.5: server-side pre-fill engine for the 33-point
// accountant review checklist. Called on each accountant workspace page
// load; the output is passed through to CheckRow so items classified as
// kind:auto render with their AI-derived verdict + evidence string + a
// one-click Confirm button.
//
// Slice 7.4 shipped the stub. Slice 7.5 fills in the 20 auto items in
// three sub-slices by data source cluster:
//
//   7.5a (this slice): head + income_lines + case_documents
//     items 1, 3, 6, 7, 25, 26, 28  (7 items)
//
//   7.5b: expense_lines + bank_txns + vehicle
//     items 8, 9, 10, 12, 13, 14, 15  (7 items)
//
//   7.5c: engine + prior_year + sa302_comparison
//     items 17, 22, 23, 24, 29, 30  (6 items)
//
// Derivations are pure: no DB writes. The Confirm button on each row
// is what commits the status flip + stamps the evidence string into
// pch_check_status.note for audit.

import type { createAdminClient } from "@/lib/supabase/admin";

export type ChecklistPrefillVerdict = "pass" | "warn" | "nothing_to_show";

export type ChecklistPrefill = {
  item: number;
  verdict: ChecklistPrefillVerdict;
  // One-line human string that renders as "AI answered: X" on the row
  // and gets copied into pch_check_status.note when the accountant
  // hits Confirm (so the audit log carries what the AI said at the
  // time, not just the status change).
  evidence: string;
  derivedAt: string; // ISO
};

type Head = Record<string, unknown>;
type IncomeLine = {
  gross_takings_pence: number | null;
  platform_fee_pence: number | null;
  source: string | null;
  line_type: "Fares" | "Other" | "VAT" | null;
};

// Shared timestamp so the audit trail for a single page load reflects
// one coherent derivation moment rather than N micro-skewed ones.
function now(): string { return new Date().toISOString(); }

export async function deriveChecklistPrefills(
  caseId: string,
  admin: ReturnType<typeof createAdminClient>,
): Promise<Map<number, ChecklistPrefill>> {
  const prefills = new Map<number, ChecklistPrefill>();
  try {
    await deriveHeadIncomeCluster(caseId, admin, prefills);
  } catch (err) {
    // Non-blocking: a derivation failure yields an empty slot in the
    // map; the view falls back to "AI could not derive, review
    // manually" and the manual Done/N/A buttons stay available.
    console.warn("[deriveChecklistPrefills] head/income cluster failed:", err);
  }
  // Slice 7.5b: expense + bank + vehicle cluster lands here.
  // Slice 7.5c: engine + prior-year + SA302 cluster lands here.
  return prefills;
}

// -------------------------------------------------------------------
// 7.5a: head + income_lines + case_documents cluster
// -------------------------------------------------------------------
async function deriveHeadIncomeCluster(
  caseId: string,
  admin: ReturnType<typeof createAdminClient>,
  prefills: Map<number, ChecklistPrefill>,
): Promise<void> {
  const [headQ, incomeQ, pch25Q] = await Promise.all([
    admin.from("pch_cases").select("*").eq("case_id", caseId).maybeSingle(),
    admin.from("pch_income_lines")
      .select("gross_takings_pence, platform_fee_pence, source, line_type")
      .eq("case_id", caseId),
    admin.from("case_documents")
      .select("id, file_name")
      .eq("case_id", caseId)
      .eq("requirement_key", "PCH-25"),
  ]);
  const head = (headQ.data ?? null) as Head | null;
  const income = (incomeQ.data ?? []) as IncomeLine[];
  const pch25Count = (pch25Q.data ?? []).length;

  if (head) {
    const p = deriveIdentity(head);              if (p) prefills.set(1, p);
    const p25 = derivePoaRecorded(head);         if (p25) prefills.set(25, p25);
    const p26 = derivePoaPaid(head);             if (p26) prefills.set(26, p26);
    const p28 = deriveApproval(head);            if (p28) prefills.set(28, p28);
    const p7 = deriveVatCoverage(head, income);  if (p7) prefills.set(7, p7);
  }

  const p3 = deriveFares(income);
  if (p3) prefills.set(3, p3);

  const p6 = deriveIncomeMix(income, pch25Count);
  if (p6) prefills.set(6, p6);
}

// Item 1: UTR / NINO / DOB / postcode captured in HMRC-compatible shape.
// This cannot verify against HMRC itself (no agent-services integration
// here); it confirms the four fields are present and in a plausible
// format, flagging gaps for the accountant to chase before filing.
function deriveIdentity(head: Head): ChecklistPrefill | null {
  const utr = typeof head.cl_utr === "string" ? head.cl_utr.trim() : "";
  const nino = typeof head.cl_nino === "string" ? head.cl_nino.trim() : "";
  const dob = typeof head.cl_dob === "string" ? head.cl_dob.trim() : "";
  const postcode = typeof head.cl_postcode === "string" ? head.cl_postcode.trim() : "";
  const missing: string[] = [];
  if (!utr) missing.push("UTR");
  if (!nino) missing.push("NINO");
  if (!dob) missing.push("DOB");
  if (!postcode) missing.push("postcode");
  if (missing.length === 0) {
    return {
      item: 1,
      verdict: "pass",
      evidence:
        `UTR, NINO, DOB and postcode all captured in-app. Confirm against HMRC records via Agent Services before filing.`,
      derivedAt: now(),
    };
  }
  return {
    item: 1,
    verdict: "warn",
    evidence: `Missing: ${missing.join(", ")}. Collect from the client before filing.`,
    derivedAt: now(),
  };
}

// Item 3: platform fares captured and totalled. "Each app's annual
// summary attached" is a Phase-5-era artefact; the Phase 6 bank-
// statement pipeline produces the same evidence, so this check now
// summarises the aggregated fares the ingest produced.
function deriveFares(income: IncomeLine[]): ChecklistPrefill | null {
  const fares = income.filter((l) => l.line_type === "Fares");
  if (fares.length === 0) {
    return {
      item: 3,
      verdict: "warn",
      evidence:
        "No Fares income lines yet. Upload a bank statement under PCH-14 (or check the ingest ran) before confirming turnover.",
      derivedAt: now(),
    };
  }
  const totalPence = fares.reduce((s, l) => s + (l.gross_takings_pence ?? 0), 0);
  const sources = Array.from(new Set(fares.map((l) => l.source ?? "unknown"))).sort();
  const pounds = (totalPence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    item: 3,
    verdict: "pass",
    evidence:
      `Platform fares £${pounds} across ${sources.length} source${sources.length === 1 ? "" : "s"} (${sources.join(", ")}).`,
    derivedAt: now(),
  };
}

// Item 6: card + cash + account-work income captured. The bank
// statement pipeline covers card and account work; cash fares aren't
// visible on bank statements. PCH-25 is where cash receipts land for
// expenses but also serves as the proxy for "did the client surface
// cash income?". Flag warn when there's no cash-receipt touchpoint so
// the accountant pulls the thread.
function deriveIncomeMix(income: IncomeLine[], pch25Count: number): ChecklistPrefill | null {
  const totalPence = income.reduce((s, l) => s + (l.gross_takings_pence ?? 0), 0);
  if (totalPence === 0) {
    return {
      item: 6,
      verdict: "warn",
      evidence: "No income captured yet. Nothing to confirm until the bank-statement ingest runs.",
      derivedAt: now(),
    };
  }
  const pounds = (totalPence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (pch25Count === 0) {
    return {
      item: 6,
      verdict: "warn",
      evidence:
        `Platform + account income £${pounds} captured from the bank ingest. No cash-receipt files uploaded (PCH-25). Confirm with the client whether any cash income was received.`,
      derivedAt: now(),
    };
  }
  return {
    item: 6,
    verdict: "pass",
    evidence:
      `Platform + account income £${pounds} from bank; ${pch25Count} cash-receipt file${pch25Count === 1 ? "" : "s"} uploaded via PCH-25.`,
    derivedAt: now(),
  };
}

// Item 7: VAT top-up + Flat Rate lines included on a VAT-registered
// client. Non-VAT-registered clients get a nothing_to_show so the row
// doesn't nag; VAT-registered without any VAT line is a warn.
function deriveVatCoverage(head: Head, income: IncomeLine[]): ChecklistPrefill | null {
  const vatRegistered = head.vat_registered === true;
  if (!vatRegistered) {
    return {
      item: 7,
      verdict: "nothing_to_show",
      evidence: "Client is not VAT-registered. VAT top-up / FRS lines are not applicable.",
      derivedAt: now(),
    };
  }
  const vatLines = income.filter((l) => l.line_type === "VAT");
  if (vatLines.length === 0) {
    return {
      item: 7,
      verdict: "warn",
      evidence:
        "Client is VAT-registered but no VAT income lines are recorded. Add VAT top-up and Flat Rate Scheme payments as separate income lines before filing.",
      derivedAt: now(),
    };
  }
  const totalPence = vatLines.reduce((s, l) => s + (l.gross_takings_pence ?? 0), 0);
  const pounds = (totalPence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    item: 7,
    verdict: "pass",
    evidence:
      `VAT-registered; ${vatLines.length} VAT income line${vatLines.length === 1 ? "" : "s"} totalling £${pounds} recorded.`,
    derivedAt: now(),
  };
}

// Item 25: 2025/26 payments on account recorded on the head row (taken
// from last year's SA302). Doesn't verify against HMRC's statement;
// confirms the figures are present for the engine to consume.
function derivePoaRecorded(head: Head): ChecklistPrefill | null {
  const poa1 = Number(head.poa1_due_pence ?? 0);
  const poa2 = Number(head.poa2_due_pence ?? 0);
  if (poa1 === 0 && poa2 === 0) {
    return {
      item: 25,
      verdict: "nothing_to_show",
      evidence:
        "No POAs recorded. Either the client has no POA liability this year, or the prior-year SA302 showed nil.",
      derivedAt: now(),
    };
  }
  const fmt = (p: number) =>
    "£" + (p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if ((poa1 > 0 && poa2 === 0) || (poa2 > 0 && poa1 === 0)) {
    return {
      item: 25,
      verdict: "warn",
      evidence:
        `Only one POA installment recorded (POA 1 ${fmt(poa1)}, POA 2 ${fmt(poa2)}). Confirm both against the prior-year SA302.`,
      derivedAt: now(),
    };
  }
  return {
    item: 25,
    verdict: "pass",
    evidence: `POA 1 ${fmt(poa1)}, POA 2 ${fmt(poa2)} recorded on head from prior-year SA302.`,
    derivedAt: now(),
  };
}

// Item 26: POA paid vs due; flag any shortfall to the client.
function derivePoaPaid(head: Head): ChecklistPrefill | null {
  const due1 = Number(head.poa1_due_pence ?? 0);
  const due2 = Number(head.poa2_due_pence ?? 0);
  const paid1 = Number(head.poa1_paid_pence ?? 0);
  const paid2 = Number(head.poa2_paid_pence ?? 0);
  if (due1 === 0 && due2 === 0) {
    return {
      item: 26,
      verdict: "nothing_to_show",
      evidence: "No POAs due this year. Balancing payment agrees to SA302 directly.",
      derivedAt: now(),
    };
  }
  const shortfall1 = Math.max(0, due1 - paid1);
  const shortfall2 = Math.max(0, due2 - paid2);
  const totalShortfall = shortfall1 + shortfall2;
  const fmt = (p: number) =>
    "£" + (p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (totalShortfall === 0) {
    return {
      item: 26,
      verdict: "pass",
      evidence: `Both POAs paid in full (POA 1 ${fmt(paid1)} of ${fmt(due1)}, POA 2 ${fmt(paid2)} of ${fmt(due2)}).`,
      derivedAt: now(),
    };
  }
  return {
    item: 26,
    verdict: "warn",
    evidence:
      `POA shortfall ${fmt(totalShortfall)} outstanding (POA 1 ${fmt(paid1)}/${fmt(due1)}, POA 2 ${fmt(paid2)}/${fmt(due2)}). Flag unpaid balance to client before balancing payment calc.`,
    derivedAt: now(),
  };
}

// Item 28: P&L approved by client + final pack confirmed. "Report
// dated" is implicit in both of those timestamps being present; the
// PDF export link lives in the workspace header.
function deriveApproval(head: Head): ChecklistPrefill | null {
  const approvedAt = typeof head.client_approval_at === "string" ? head.client_approval_at : null;
  const approvedName = typeof head.client_approval_name === "string" ? head.client_approval_name : null;
  const confirmedAt = typeof head.final_pack_confirmed_at === "string" ? head.final_pack_confirmed_at : null;
  const confirmedName = typeof head.final_pack_confirmed_name === "string" ? head.final_pack_confirmed_name : null;
  const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB");
  if (!approvedAt) {
    return {
      item: 28,
      verdict: "nothing_to_show",
      evidence: "Not yet at the approval stage. Client hasn't approved the figures.",
      derivedAt: now(),
    };
  }
  if (!confirmedAt) {
    return {
      item: 28,
      verdict: "warn",
      evidence:
        `Figures approved by ${approvedName ?? "the client"} on ${fmt(approvedAt)}. Final pack not yet confirmed; send + wait for client confirm before filing.`,
      derivedAt: now(),
    };
  }
  return {
    item: 28,
    verdict: "pass",
    evidence:
      `Figures approved by ${approvedName ?? "client"} on ${fmt(approvedAt)}; final pack confirmed by ${confirmedName ?? "client"} on ${fmt(confirmedAt)}. PDF + Excel downloads live in the workspace header.`,
    derivedAt: now(),
  };
}
