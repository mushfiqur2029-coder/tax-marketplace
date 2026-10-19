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
type ExpenseLine = {
  label: string | null;
  amount_paid_pence: number | null;
  evidence: string | null;
  category: string | null;
  sa103s_box: number | null;
};
type BankTxn = {
  txn_date: string | null;
  category: string | null;
};
type Vehicle = Record<string, unknown>;

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
  try {
    await deriveExpenseVehicleCluster(caseId, admin, prefills);
  } catch (err) {
    console.warn("[deriveChecklistPrefills] expense/vehicle cluster failed:", err);
  }
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

// -------------------------------------------------------------------
// 7.5b: expense_lines + bank_txns + vehicle cluster
// -------------------------------------------------------------------
async function deriveExpenseVehicleCluster(
  caseId: string,
  admin: ReturnType<typeof createAdminClient>,
  prefills: Map<number, ChecklistPrefill>,
): Promise<void> {
  const [expenseQ, bankQ, vehicleQ, headQ] = await Promise.all([
    admin.from("pch_expense_lines")
      .select("label, amount_paid_pence, evidence, category, sa103s_box")
      .eq("case_id", caseId),
    admin.from("pch_bank_transactions")
      .select("txn_date, category")
      .eq("case_id", caseId),
    admin.from("pch_vehicle").select("*").eq("case_id", caseId).maybeSingle(),
    admin.from("pch_cases").select("tax_year").eq("case_id", caseId).maybeSingle(),
  ]);
  const expenses = (expenseQ.data ?? []) as ExpenseLine[];
  const bankTxns = (bankQ.data ?? []) as BankTxn[];
  const vehicle = (vehicleQ.data ?? null) as Vehicle | null;
  const taxYear = (headQ.data?.tax_year as string | undefined) ?? "2025/26";

  const p8 = deriveExpenseEvidence(expenses);         if (p8) prefills.set(8, p8);
  const p9 = deriveBankTxnDateRange(bankTxns, taxYear); if (p9) prefills.set(9, p9);
  const p10 = deriveExpenseExclusions(expenses, bankTxns); if (p10) prefills.set(10, p10);

  if (vehicle) {
    const p12 = deriveVehicleBusinessPct(vehicle);  if (p12) prefills.set(12, p12);
    const p13 = deriveVehicleCo2Rate(vehicle);      if (p13) prefills.set(13, p13);
    const p14 = deriveVehicleWdv(vehicle);          if (p14) prefills.set(14, p14);
    const p15 = deriveVehicleMethod(vehicle);       if (p15) prefills.set(15, p15);
  }
}

// Parse "YYYY/YY" -> { fromIso, toIso }. Mirrors parsePeriod in
// export-data.ts but kept local since that one is not exported. The
// UK tax year runs 6 April to 5 April of the following year.
function parseTaxYearRange(taxYear: string): { fromIso: string; toIso: string } {
  const m = /^(\d{4})\/(\d{2})$/.exec(taxYear);
  const startYear = m ? Number(m[1]) : new Date().getFullYear();
  return { fromIso: `${startYear}-04-06`, toIso: `${startYear + 1}-04-05` };
}

// Item 8: every positive-amount expense line has a non-empty evidence
// method. Mirrors the server-side canRequestFiling check so an
// accountant seeing green here matches what Advance to client approval
// will accept.
function deriveExpenseEvidence(expenses: ExpenseLine[]): ChecklistPrefill | null {
  const positive = expenses.filter((e) => (e.amount_paid_pence ?? 0) > 0);
  if (positive.length === 0) {
    return {
      item: 8,
      verdict: "nothing_to_show",
      evidence: "No positive-amount expense lines yet.",
      derivedAt: now(),
    };
  }
  const missing = positive.filter((e) => !(e.evidence && e.evidence.trim().length > 0));
  if (missing.length === 0) {
    return {
      item: 8,
      verdict: "pass",
      evidence: `All ${positive.length} expense line${positive.length === 1 ? "" : "s"} have an evidence method recorded.`,
      derivedAt: now(),
    };
  }
  return {
    item: 8,
    verdict: "warn",
    evidence:
      `${missing.length} of ${positive.length} line${positive.length === 1 ? "" : "s"} missing evidence (${missing.slice(0, 3).map((e) => e.label ?? "unlabelled").join(", ")}${missing.length > 3 ? ", ..." : ""}). Set a method on each before filing.`,
    derivedAt: now(),
  };
}

// Item 9: every bank transaction's txn_date falls inside the case's
// tax year. Catches statement-overrun uploads (e.g. a Dec-to-Mar
// statement that crosses year end) and typos. Does not look at
// pch_income_lines / pch_expense_lines because those are already
// derived from bank_txns.
function deriveBankTxnDateRange(bankTxns: BankTxn[], taxYear: string): ChecklistPrefill | null {
  if (bankTxns.length === 0) {
    return {
      item: 9,
      verdict: "nothing_to_show",
      evidence: "No bank transactions ingested yet.",
      derivedAt: now(),
    };
  }
  const { fromIso, toIso } = parseTaxYearRange(taxYear);
  const outside = bankTxns.filter((t) => {
    const d = t.txn_date;
    if (!d) return false;
    return d < fromIso || d > toIso;
  });
  if (outside.length === 0) {
    const [startYear, endYear] = [fromIso.slice(0, 4), toIso.slice(0, 4)];
    return {
      item: 9,
      verdict: "pass",
      evidence: `All ${bankTxns.length} bank transactions dated 6 April ${startYear} to 5 April ${endYear} inclusive.`,
      derivedAt: now(),
    };
  }
  return {
    item: 9,
    verdict: "warn",
    evidence:
      `${outside.length} of ${bankTxns.length} transactions dated outside ${fromIso} to ${toIso}. Check for statement overrun or carry-over.`,
    derivedAt: now(),
  };
}

// Item 10: no fines/PCNs or capital/HP-principal items leaking into
// expenses. The categoriser marks `fine` as direction=excluded so by
// construction these are already out of pch_expense_lines, but we
// still surface the count so the accountant sees we found some and
// discarded them (zero gives silent reassurance). Also scans
// pch_expense_lines labels for capital-sounding keywords in case a
// manual edit introduced one.
function deriveExpenseExclusions(expenses: ExpenseLine[], bankTxns: BankTxn[]): ChecklistPrefill | null {
  const fineCount = bankTxns.filter((t) => (t.category ?? "").toLowerCase() === "fine").length;
  const CAPITAL_RE = /\b(purchase|deposit|principal|balloon|part[- ]exchange)\b/i;
  const suspicious = expenses.filter((e) => CAPITAL_RE.test(e.label ?? ""));
  if (suspicious.length === 0 && fineCount === 0) {
    return {
      item: 10,
      verdict: "pass",
      evidence: "No fines or capital/HP-principal items detected in expenses.",
      derivedAt: now(),
    };
  }
  if (suspicious.length === 0) {
    return {
      item: 10,
      verdict: "pass",
      evidence: `${fineCount} fine/PCN transaction${fineCount === 1 ? "" : "s"} detected and excluded from expenses by the categoriser.`,
      derivedAt: now(),
    };
  }
  return {
    item: 10,
    verdict: "warn",
    evidence:
      `${suspicious.length} expense line${suspicious.length === 1 ? "" : "s"} look capital-ish (${suspicious.slice(0, 3).map((e) => e.label).join(", ")}${suspicious.length > 3 ? ", ..." : ""}). Confirm these are allowable or move to capital allowances.`,
    derivedAt: now(),
  };
}

// Item 12: business use % evidenced on the pch_vehicle row from the
// VEHICLE_CA interview or mileage odometer readings.
function deriveVehicleBusinessPct(vehicle: Vehicle): ChecklistPrefill | null {
  const status = typeof vehicle.status === "string" ? vehicle.status : null;
  if (status === "Leased" || status === "Rented" || status === "No vehicle") {
    return {
      item: 12,
      verdict: "nothing_to_show",
      evidence: `Vehicle status: ${status}. No capital-allowance business %  needed.`,
      derivedAt: now(),
    };
  }
  const pctOverride = Number(vehicle.business_pct_override ?? 0);
  const odoStart = Number(vehicle.odo_start ?? 0);
  const odoEnd = Number(vehicle.odo_end ?? 0);
  if (pctOverride > 0) {
    const pct = Math.round(pctOverride * 100);
    return {
      item: 12,
      verdict: "pass",
      evidence: `Business use ${pct}% recorded via the VEHICLE_CA interview override.`,
      derivedAt: now(),
    };
  }
  if (odoStart > 0 && odoEnd > odoStart) {
    const total = odoEnd - odoStart;
    return {
      item: 12,
      verdict: "pass",
      evidence: `Odometer start ${odoStart.toLocaleString()} / end ${odoEnd.toLocaleString()} (${total.toLocaleString()} miles total). Engine computes business % from app miles vs total.`,
      derivedAt: now(),
    };
  }
  return {
    item: 12,
    verdict: "warn",
    evidence:
      "No business % override and no odometer readings. Run the VEHICLE_CA interview and set the business-use percentage.",
    derivedAt: now(),
  };
}

// Item 13: CO2 recorded + implied allowance rate correct. 2025/26
// bands: 0 g/km (new EV) qualifies for 100% FYA; 1-50 g/km uses the
// main pool at 18%; 51+ g/km uses the special-rate pool at 6%.
function deriveVehicleCo2Rate(vehicle: Vehicle): ChecklistPrefill | null {
  const status = typeof vehicle.status === "string" ? vehicle.status : null;
  if (status === "Leased" || status === "Rented" || status === "No vehicle") {
    return {
      item: 13,
      verdict: "nothing_to_show",
      evidence: `Vehicle status: ${status}. CO2 band irrelevant without a CA pool.`,
      derivedAt: now(),
    };
  }
  const co2Raw = vehicle.co2_gpkm;
  if (co2Raw == null) {
    return {
      item: 13,
      verdict: "warn",
      evidence: "CO2 not recorded. Run the VEHICLE_CA interview and capture g/km from the V5C logbook.",
      derivedAt: now(),
    };
  }
  const co2 = Number(co2Raw);
  const impliedRate = co2 === 0 ? "100% FYA (zero-emission)"
    : co2 <= 50 ? "18% WDA (main pool)"
    : "6% WDA (special rate pool)";
  const overrideRaw = vehicle.ca_rate_override;
  if (overrideRaw != null && overrideRaw !== "") {
    const over = Number(overrideRaw);
    return {
      item: 13,
      verdict: "warn",
      evidence: `CO2 ${co2} g/km implies ${impliedRate}; accountant override set to ${(over * 100).toFixed(0)}%. Confirm override is deliberate.`,
      derivedAt: now(),
    };
  }
  return {
    item: 13,
    verdict: "pass",
    evidence: `CO2 ${co2} g/km recorded. Implied allowance: ${impliedRate}.`,
    derivedAt: now(),
  };
}

// Item 14: WDV brought forward recorded on the pch_vehicle row. The
// prior-year carry-forward comparison lands in the engine/prior-year
// cluster (7.5c); here we just confirm the figure is present and
// surface the amount for the accountant to cross-check.
function deriveVehicleWdv(vehicle: Vehicle): ChecklistPrefill | null {
  const status = typeof vehicle.status === "string" ? vehicle.status : null;
  if (status === "Leased" || status === "Rented" || status === "No vehicle") {
    return {
      item: 14,
      verdict: "nothing_to_show",
      evidence: `Vehicle status: ${status}. No CA pool, no WDV to carry forward.`,
      derivedAt: now(),
    };
  }
  const wdvPence = Number(vehicle.wdv_brought_forward_pence ?? 0);
  const previousMethod = typeof vehicle.previous_method === "string" ? vehicle.previous_method : null;
  if (previousMethod === "First year" || (wdvPence === 0 && !previousMethod)) {
    return {
      item: 14,
      verdict: "nothing_to_show",
      evidence: "First year on this vehicle (per the VEHICLE_CA interview). No WDV brought forward applicable.",
      derivedAt: now(),
    };
  }
  if (wdvPence === 0) {
    return {
      item: 14,
      verdict: "warn",
      evidence:
        `Previous method: ${previousMethod ?? "unknown"}. WDV brought forward is £0, confirm this against last year's tax computation (fully written down, or figure not yet transferred).`,
      derivedAt: now(),
    };
  }
  const pounds = (wdvPence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    item: 14,
    verdict: "pass",
    evidence: `WDV brought forward £${pounds} recorded. Confirm against last year's SA302 or carry-forward schedule.`,
    derivedAt: now(),
  };
}

// Item 15: mileage vs actual compared; method allowed. The VEHICLE_CA
// interview captures method_choice; the engine's recommendedMethod is
// then available in the snapshot (handled in 7.5c for the comparison).
// Here we just confirm method is chosen.
function deriveVehicleMethod(vehicle: Vehicle): ChecklistPrefill | null {
  const status = typeof vehicle.status === "string" ? vehicle.status : null;
  if (status === "Leased" || status === "Rented" || status === "No vehicle") {
    return {
      item: 15,
      verdict: "nothing_to_show",
      evidence: `Vehicle status: ${status}. Lease rent and running costs go through expenses directly, no method choice needed.`,
      derivedAt: now(),
    };
  }
  const method = typeof vehicle.method_choice === "string" ? vehicle.method_choice : null;
  const previousMethod = typeof vehicle.previous_method === "string" ? vehicle.previous_method : null;
  if (!method) {
    return {
      item: 15,
      verdict: "warn",
      evidence:
        "Method not chosen in the VEHICLE_CA interview. Decide between Simplified mileage and Actual costs before filing.",
      derivedAt: now(),
    };
  }
  // Rule: if last year's method was "Actual costs (CAs claimed)" the
  // client cannot switch to simplified mileage.
  if (method === "Simplified mileage" && previousMethod === "Actual costs (capital allowances claimed)") {
    return {
      item: 15,
      verdict: "warn",
      evidence:
        "Method set to Simplified mileage but last year was Actual costs with CAs claimed, switching to simplified mileage is not allowed on the same vehicle. Keep Actual costs or confirm the vehicle changed.",
      derivedAt: now(),
    };
  }
  return {
    item: 15,
    verdict: "pass",
    evidence:
      `Method: ${method}${previousMethod ? ` (previous year: ${previousMethod})` : ""}. Allowed for this vehicle.`,
    derivedAt: now(),
  };
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
