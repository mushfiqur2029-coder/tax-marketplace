"use server";

// Server actions for the rebuilt PCH client intake (migration 0113).
// Every input in sections 1-15 lives-saves through savePchHeadFieldAction
// (whitelisted single-column updates to pch_cases) or one of the
// repeatable-row actions (income/expense/gift-aid - land in phase C/D).
//
// All writes go through the admin client with the standard ownership
// guard: case belongs to this client, tier=uber_phv_automated, status
// in {submitted, in_review, prepared}, AND pch_cases.intake_submitted
// _at is still null (migration 0119: real lock point, independent of
// the accountant-side status lifecycle). The guard is centralised in
// requirePchIntakeEditable; every exported action threads through it
// so the policy stays in one place.

import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { randomUUID } from "node:crypto";
import { validateDateNotInFuture } from "@/lib/pch/validation";

type ActionOk = { ok: true };
type ActionErr = { ok: false; error: string };
export type IntakeActionResult = ActionOk | ActionErr;
export type IntakeActionResultWith<T> = (ActionOk & T) | ActionErr;

export async function requirePchIntakeEditable(caseId: string) {
  const me = await requireRole("client");
  const admin = createAdminClient();
  const [caseRes, pchRes] = await Promise.all([
    admin
      .from("cases")
      .select("id, client_id, status, tier")
      .eq("id", caseId)
      .single(),
    admin
      .from("pch_cases")
      .select("intake_submitted_at")
      .eq("case_id", caseId)
      .maybeSingle(),
  ]);
  if (caseRes.error || !caseRes.data) throw new Error("Case not found.");
  if (caseRes.data.client_id !== me.id) throw new Error("Not your case.");
  if (caseRes.data.tier !== "uber_phv_automated") throw new Error("Not a PCH case.");
  // Primary lock: migration 0119 flag. Independent of cases.status,
  // which stays at 'submitted' for the entire filling period and
  // keeps giving the wrong answer here.
  if (pchRes.data?.intake_submitted_at) {
    throw new Error(
      "Your return is submitted and locked. Message your accountant if something needs to change.",
    );
  }
  // Belt-and-braces for terminal / approval-stage status. By then
  // intake_submitted_at is always set too, but keep the explicit
  // check so a historical row with the flag mis-null still refuses.
  if (
    caseRes.data.status !== "submitted"
    && caseRes.data.status !== "in_review"
    && caseRes.data.status !== "prepared"
  ) {
    throw new Error(
      "This return has moved to the approval stage. Message your accountant if something needs to change.",
    );
  }
  return { me, admin, caseRow: caseRes.data };
}

// -------------------------------------------------------------------
// Head field saves (sections 1, 4-15 scalar fields)
// -------------------------------------------------------------------
//
// Allow-list of pch_cases columns the client is permitted to write.
// Anything NOT in this set is rejected; this both documents the
// client-writable surface of pch_cases and stops a UI bug from writing
// to an accountant-only column (engine_snapshot, bookkeeping_confirmed_*,
// approval_at, etc.) by typo.
const HEAD_FIELDS: Record<string, "string" | "integer_pence" | "boolean" | "string_enum"> = {
  // Section 1 identity
  cl_name: "string",
  cl_dob: "string",             // ISO date yyyy-mm-dd
  cl_address: "string",
  cl_postcode: "string",
  cl_phone: "string",
  cl_email: "string",
  cl_utr: "string",
  cl_nino: "string",

  // Section 4 (P11D benefits): numeric cash equivalent (migration 0116)
  // plus the free-text benefits_note (writable below).
  p11d_pence: "integer_pence",
  // Section 5 (Interest income)
  bank_interest_pence: "integer_pence",
  // Section 6 (Dividend income)
  dividend_income_pence: "integer_pence",
  // Section 7 (Capital gains)
  capital_gains_pence: "integer_pence",
  capital_gains_note: "string",
  // Section 8 (Rental)
  rental_profit_pence: "integer_pence",
  gross_rent_received_pence: "integer_pence",
  // Section 9 (Private pension)
  personal_pension_net_pence: "integer_pence",
  // Section 11 (Child benefit)
  child_benefit_pence: "integer_pence",
  // Section 12 (Overseas)
  overseas_income_pence: "integer_pence",
  overseas_tax_paid_pence: "integer_pence",
  // Section 13 (Student loan)
  student_loan_plan: "string",
  // Section 14 (anything else)
  anything_else_note: "string",
  // Section 15 (Last year's SA)
  last_year_sa_status: "string_enum",
  last_year_sa_paid: "boolean",

  // Keeping these writable too since they stay on the intake surface
  // from the old flow (not shown in sections 1-15 but accountant may
  // ask the client to fill them via chat): employment income + PAYE,
  // gift aid total, benefits note, marriage allowance, spouse details.
  employment_income_pence: "integer_pence",
  paye_pence: "integer_pence",
  gift_aid_net_pence: "integer_pence",
  benefits_note: "string",
};

export async function savePchHeadFieldAction(
  caseId: string,
  field: string,
  value: string | number | boolean | null,
): Promise<IntakeActionResult> {
  try {
    const kind = HEAD_FIELDS[field];
    if (!kind) return { ok: false, error: "Field " + field + " is not writable." };

    // Normalise + validate value against the declared field kind.
    let dbValue: string | number | boolean | null = value;
    if (value === "" || value === undefined) dbValue = null;
    if (kind === "integer_pence" && dbValue !== null) {
      const n = typeof dbValue === "number" ? dbValue : Number(dbValue);
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: "Must be zero or more." };
      dbValue = Math.round(n);
    }
    if (kind === "boolean" && dbValue !== null) {
      dbValue = dbValue === true || dbValue === "true";
    }
    if (kind === "string_enum" && dbValue !== null && typeof dbValue !== "string") {
      return { ok: false, error: "Invalid value for " + field };
    }
    if (field === "last_year_sa_status" && dbValue !== null) {
      if (dbValue !== "yes" && dbValue !== "no" && dbValue !== "not_applicable") {
        return { ok: false, error: "Invalid last_year_sa_status value." };
      }
    }

    const { admin } = await requirePchIntakeEditable(caseId);
    const { error } = await admin
      .from("pch_cases")
      .update({ [field]: dbValue })
      .eq("case_id", caseId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

// -------------------------------------------------------------------
// Declaration status: sections 4-14 applicable / not_applicable toggle
// -------------------------------------------------------------------
const DECLARATION_KEYS = new Set([
  "p11d",
  "interest",
  "dividend",
  "capital_gains",
  "rental",
  "pension",
  "gift_aid",
  "child_benefit",
  "overseas",
  "student_loan",
  "anything_else",
  // Phase F: the "Income from another job (PAYE)" card. Writes against
  // the already-allow-listed employment_income_pence + paye_pence head
  // columns, no new schema needed.
  "other_employment",
]);

export async function setDeclarationStatusAction(
  caseId: string,
  sectionKey: string,
  status: "applicable" | "not_applicable",
): Promise<IntakeActionResult> {
  try {
    if (!DECLARATION_KEYS.has(sectionKey)) {
      return { ok: false, error: "Unknown section: " + sectionKey };
    }
    if (status !== "applicable" && status !== "not_applicable") {
      return { ok: false, error: "Invalid status." };
    }
    const { admin } = await requirePchIntakeEditable(caseId);
    const { data: head } = await admin
      .from("pch_cases")
      .select("cl_declaration_status")
      .eq("case_id", caseId)
      .single();
    const current = (head?.cl_declaration_status ?? {}) as Record<string, string>;
    current[sectionKey] = status;
    const { error } = await admin
      .from("pch_cases")
      .update({ cl_declaration_status: current })
      .eq("case_id", caseId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

// -------------------------------------------------------------------
// Single-field OCR autofill: section 1 UTR / NI inline uploads
// -------------------------------------------------------------------
//
// Spec: "upload -> extract -> prefill this one field, client can
// edit." We don't want the full extraction-review infrastructure for
// this; a one-shot vision call per upload is enough. Uploads land in
// the case-documents bucket with a non-slot requirement_key so the
// accountant can still open them on review.

const UTR_REGEX = /\b(\d{10})\b/;
const NINO_REGEX = /\b([A-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D])\b/i;

// Shared vision call for every short single-answer OCR prompt below
// (UTR/NINO, fixed-row amounts, attachment amounts, private-use
// amounts). One short prompt in, one short text answer out via
// OpenAI's Responses API - no structured-output schema needed for
// these, just like the old single-field Anthropic calls this
// replaces. Returns null on any failure (bad response, network
// error) so every caller can fall back the same way the file it's
// already saved still counts as a partial success.
const OCR_MODEL = "gpt-6.1-sol";

async function callOpenAiVision(
  apiKey: string,
  bytes: Uint8Array,
  mediaType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp",
  prompt: string,
  maxOutputTokens = 256,
): Promise<string | null> {
  try {
    const base64 = Buffer.from(bytes).toString("base64");
    const contentBlock: Record<string, unknown> =
      mediaType === "application/pdf"
        ? { type: "input_file", file_data: `data:application/pdf;base64,${base64}`, filename: "document.pdf" }
        : { type: "input_image", image_url: `data:${mediaType};base64,${base64}`, detail: "high" };

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: OCR_MODEL,
        max_output_tokens: maxOutputTokens,
        reasoning: { effort: "minimal" },
        input: [
          {
            role: "user",
            content: [contentBlock, { type: "input_text", text: prompt }],
          },
        ],
      }),
    });
    if (!resp.ok) return null;
    const body = (await resp.json()) as { output_text?: string };
    return typeof body.output_text === "string" ? body.output_text : null;
  } catch {
    return null;
  }
}

export async function extractUtrFromUploadAction(
  caseId: string,
  formData: FormData,
): Promise<IntakeActionResultWith<{ utr: string | null }>> {
  const r = await extractSingleField(caseId, formData, {
    label: "UTR",
    requirementKey: "intake-utr",
    headColumn: "cl_utr",
    prompt:
      "Find the UK Unique Taxpayer Reference (UTR) on this document. It is a 10-digit number, "
      + "usually printed on an HMRC letter after the word 'UTR' or 'Unique Taxpayer Reference'. "
      + "Return just the 10 digits, no spaces or punctuation. If you cannot find it, return null.",
    patternHint: UTR_REGEX,
    normalise: (v) => {
      const digits = v.replace(/\D/g, "");
      return digits.length === 10 ? digits : null;
    },
  });
  if (!r.ok) return r;
  return { ok: true, utr: r.value };
}

export async function extractNinoFromUploadAction(
  caseId: string,
  formData: FormData,
): Promise<IntakeActionResultWith<{ nino: string | null }>> {
  const r = await extractSingleField(caseId, formData, {
    label: "NI number",
    requirementKey: "intake-ni",
    headColumn: "cl_nino",
    prompt:
      "Find the UK National Insurance number on this document. It is formatted as two letters, "
      + "six digits, one trailing letter (A to D), e.g. 'AB 12 34 56 C'. Return just the nine "
      + "characters without spaces, uppercase. If you cannot find it, return null.",
    patternHint: NINO_REGEX,
    normalise: (v) => {
      const compact = v.replace(/\s/g, "").toUpperCase();
      return /^[A-Z]{2}\d{6}[A-D]$/.test(compact) ? compact : null;
    },
  });
  if (!r.ok) return r;
  return { ok: true, nino: r.value };
}

async function extractSingleField(
  caseId: string,
  formData: FormData,
  cfg: {
    label: string;
    requirementKey: string;
    headColumn: "cl_utr" | "cl_nino";
    prompt: string;
    patternHint: RegExp;
    normalise: (raw: string) => string | null;
  },
): Promise<IntakeActionResultWith<{ value: string | null }>> {
  try {
    const { me, admin } = await requirePchIntakeEditable(caseId);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Pick a file first." };
    }
    const MAX = 25 * 1024 * 1024;
    if (file.size > MAX) return { ok: false, error: "File is over 25 MB." };

    const typeLower = (file.type || "").toLowerCase();
    const nameLower = file.name.toLowerCase();
    const isPdf = typeLower === "application/pdf" || nameLower.endsWith(".pdf");
    const isJpeg = typeLower === "image/jpeg" || /\.jpe?g$/.test(nameLower);
    const isPng = typeLower === "image/png" || /\.png$/.test(nameLower);
    const isWebp = typeLower === "image/webp" || /\.webp$/.test(nameLower);
    if (!isPdf && !isJpeg && !isPng && !isWebp) {
      return { ok: false, error: "Upload a PDF, JPG, PNG or WebP." };
    }

    // Upload the file to storage first so it's recorded as a reference
    // for the accountant whether or not OCR succeeds.
    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_");
    const path = `${caseId}/intake/${cfg.requirementKey}-${randomUUID()}-${safe}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await admin.storage
      .from("case-documents")
      .upload(path, bytes, { contentType: file.type || "application/octet-stream" });
    if (up.error) return { ok: false, error: "Upload failed: " + up.error.message };

    const insert = await admin
      .from("case_documents")
      .insert({
        case_id: caseId,
        uploaded_by: me.id,
        file_name: file.name,
        file_url: path,
        requirement_key: cfg.requirementKey,
      })
      .select("id")
      .single();
    if (insert.error) return { ok: false, error: insert.error.message };

    // Run OCR via OpenAI vision. Keep the call shape minimal: one
    // field, one short prompt, no structured output.
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { ok: false, error: "OCR temporarily unavailable." };

    const mediaType = isPdf
      ? "application/pdf"
      : isPng
        ? "image/png"
        : isWebp
          ? "image/webp"
          : "image/jpeg";

    const raw = await callOpenAiVision(apiKey, bytes, mediaType, cfg.prompt);
    if (raw === null) {
      // Partial success: file is stored, OCR failed. Don't fail the
      // action; the client's typed value stays the source of truth.
      return { ok: true, value: null };
    }

    // Try to normalise the model's answer; fall back to pattern-match
    // against the full raw string in case the model wrapped the value
    // in prose instead of returning it bare.
    let normalised = cfg.normalise(raw.trim());
    if (!normalised) {
      const m = cfg.patternHint.exec(raw);
      if (m) normalised = cfg.normalise(m[1] ?? m[0]);
    }

    if (normalised) {
      const upd = await admin
        .from("pch_cases")
        .update({ [cfg.headColumn]: normalised })
        .eq("case_id", caseId);
      if (upd.error) return { ok: false, error: upd.error.message };
    }

    return { ok: true, value: normalised };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Extract failed." };
  }
}

// -------------------------------------------------------------------
// Income row upserts (section 2)
// -------------------------------------------------------------------
//
// Default rows (Uber / Bolt / Free Now) are seeded by ensurePchHeadRow
// on case creation; "Add income" lets the client add free-text-titled
// rows. source doubles as the free-text label per the Phase A plan;
// line_type stays 'Fares' for every intake-created row.

export async function upsertPchIncomeLineAction(
  caseId: string,
  lineId: string | null,
  patch: {
    source?: string;
    gross_takings_pence?: number | null;
  },
): Promise<IntakeActionResultWith<{ id: string }>> {
  try {
    const { admin } = await requirePchIntakeEditable(caseId);
    const row: Record<string, unknown> = {};
    if (patch.source !== undefined) row.source = patch.source;
    if (patch.gross_takings_pence !== undefined) {
      row.gross_takings_pence =
        patch.gross_takings_pence === null
          ? 0
          : Math.max(0, Math.round(patch.gross_takings_pence));
    }
    if (lineId) {
      const upd = await admin
        .from("pch_income_lines")
        .update({
          ...row,
          // Any direct client edit clears the "Auto-read, not yet
          // checked" badge: the figure now reflects an active
          // decision by the client. No-op for manual-path rows,
          // which were already treated as reviewed.
          client_reviewed: true,
        })
        .eq("id", lineId)
        .eq("case_id", caseId)
        .select("id")
        .single();
      if (upd.error) return { ok: false, error: upd.error.message };
      return { ok: true, id: upd.data.id as string };
    }
    const { data: existing } = await admin
      .from("pch_income_lines")
      .select("sort_order")
      .eq("case_id", caseId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSort = ((existing?.sort_order as number | undefined) ?? -1) + 1;
    const ins = await admin
      .from("pch_income_lines")
      .insert({
        case_id: caseId,
        source: patch.source ?? "",
        gross_takings_pence:
          patch.gross_takings_pence === null || patch.gross_takings_pence === undefined
            ? 0
            : Math.max(0, Math.round(patch.gross_takings_pence)),
        platform_fee_pence: 0,
        on_trip_miles: 0,
        dead_miles: 0,
        line_type: "Fares",
        sort_order: nextSort,
      })
      .select("id")
      .single();
    if (ins.error) return { ok: false, error: ins.error.message };
    return { ok: true, id: ins.data.id as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

// -------------------------------------------------------------------
// Expense row upserts (section 3)
// -------------------------------------------------------------------
//
// Section 3 has a fixed list of 12 named expense slots plus an
// airport-dropoff multi (one row per selected airport). Every slot
// maps to one row in pch_expense_lines; the client UI tracks each
// slot by label and upserts by label if a row exists for that
// (case_id, label).

const EXPENSE_CATEGORIES = new Set([
  "Vehicle running costs",
  "Vehicle hire, lease & finance",
  "Congestion, ULEZ, tolls & parking",
  "Licences & compliance",
  "Phone & technology",
  "Platform & card fees",
  "Finance & bank charges",
  "Accountancy & insurance",
  "Other expenses",
  "VAT paid (Flat Rate Scheme)",
]);
const SA103S_BOXES = new Set([12, 14, 16, 17, 18, 19]);
const CAR_COSTS = new Set(["Yes", "No", "Phone"]);

export async function upsertPchExpenseLineAction(
  caseId: string,
  lineId: string | null,
  row: {
    label: string;
    amount_paid_pence: number | null;
    category: string;
    sa103s_box: number;
    car_cost: "Yes" | "No" | "Phone";
  },
): Promise<IntakeActionResultWith<{ id: string }>> {
  try {
    if (!row.label || row.label.trim().length === 0) {
      return { ok: false, error: "Expense label is required." };
    }
    if (!EXPENSE_CATEGORIES.has(row.category)) {
      return { ok: false, error: "Unknown expense category." };
    }
    if (!SA103S_BOXES.has(row.sa103s_box)) {
      return { ok: false, error: "Unknown SA103S box." };
    }
    if (!CAR_COSTS.has(row.car_cost)) {
      return { ok: false, error: "Unknown car_cost value." };
    }
    const amount =
      row.amount_paid_pence === null
        ? 0
        : Math.max(0, Math.round(row.amount_paid_pence));
    const { admin } = await requirePchIntakeEditable(caseId);
    if (lineId) {
      const upd = await admin
        .from("pch_expense_lines")
        .update({
          label: row.label.trim(),
          amount_paid_pence: amount,
          category: row.category,
          sa103s_box: row.sa103s_box,
          car_cost: row.car_cost,
          // Any direct client edit clears the "Auto-read, not yet
          // checked" badge. See the matching comment on
          // upsertPchIncomeLineAction above.
          client_reviewed: true,
        })
        .eq("id", lineId)
        .eq("case_id", caseId)
        .select("id")
        .single();
      if (upd.error) return { ok: false, error: upd.error.message };
      return { ok: true, id: upd.data.id as string };
    }
    const { data: existing } = await admin
      .from("pch_expense_lines")
      .select("sort_order")
      .eq("case_id", caseId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSort = ((existing?.sort_order as number | undefined) ?? -1) + 1;
    const ins = await admin
      .from("pch_expense_lines")
      .insert({
        case_id: caseId,
        label: row.label.trim(),
        amount_paid_pence: amount,
        category: row.category,
        sa103s_box: row.sa103s_box,
        car_cost: row.car_cost,
        sort_order: nextSort,
      })
      .select("id")
      .single();
    if (ins.error) return { ok: false, error: ins.error.message };
    return { ok: true, id: ins.data.id as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

// -------------------------------------------------------------------
// Vehicle (section 3 subsection)
// -------------------------------------------------------------------
//
// Manual-form equivalent of what the deleted vehicle_CA chat used to
// capture. Writes a single pch_vehicle row keyed on case_id with the
// minimum field set engine-snapshot.ts actually reads for the capital
// allowance calc; see docs/comment in that file for the full list.

const VEHICLE_FIELDS: Record<string, "string" | "integer_pence" | "integer" | "boolean" | "string_enum" | "date" | "numeric"> = {
  status: "string_enum",
  fuel: "string_enum",
  make_model: "string",
  registration: "string",
  bought_this_year: "boolean",
  purchase_date: "date",
  purchase_price_pence: "integer_pence",
  new_or_used: "string_enum",
  odo_start: "integer",
  odo_end: "integer",
  other_business_miles: "integer",
  previous_method: "string_enum",
  wdv_brought_forward_pence: "integer_pence",
  // Phase F: private-use estimate (migration 0115). Phase G dropped
  // the client-facing Yes/No; private_use_declared is now derived
  // server-side as (amount > 0) in savePchVehicleFieldAction below,
  // so it is intentionally NOT allow-listed for direct client write.
  private_use_amount_pence: "integer_pence",
};

// Mirrors pch_vehicle.status check constraint as of migration 0103.
// Keep in step with STATUS_OPTIONS in section-3-vehicle.tsx; the
// DB-side check is the source of truth, this is the client-visible
// guard that gives a readable error before the write round-trips.
const VEHICLE_STATUSES = new Set([
  "Owned outright",
  "Hire purchase",
  "PCP",
  "Loan",
  "Leased",
  "Rented",
  "No vehicle",
]);
const VEHICLE_FUELS = new Set(["Petrol", "Diesel", "Hybrid", "Electric"]);
const VEHICLE_NEW_OR_USED = new Set(["New", "Used"]);
const VEHICLE_PREVIOUS_METHODS = new Set([
  "Simplified mileage",
  "Actual costs (capital allowances claimed)",
  "First year",
]);

export async function savePchVehicleFieldAction(
  caseId: string,
  field: string,
  value: string | number | boolean | null,
): Promise<IntakeActionResult> {
  try {
    const kind = VEHICLE_FIELDS[field];
    if (!kind) return { ok: false, error: "Field " + field + " is not writable." };

    let dbValue: string | number | boolean | null = value;
    if (value === "" || value === undefined) dbValue = null;
    if (kind === "integer_pence" && dbValue !== null) {
      const n = typeof dbValue === "number" ? dbValue : Number(dbValue);
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: "Must be zero or more." };
      dbValue = Math.round(n);
    }
    if (kind === "integer" && dbValue !== null) {
      const n = typeof dbValue === "number" ? dbValue : Number(dbValue);
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: "Must be zero or more." };
      dbValue = Math.round(n);
    }
    if (kind === "boolean" && dbValue !== null) {
      dbValue = dbValue === true || dbValue === "true";
    }
    if (field === "status" && dbValue !== null && !VEHICLE_STATUSES.has(dbValue as string)) {
      return { ok: false, error: "Unknown vehicle status." };
    }
    if (field === "fuel" && dbValue !== null && !VEHICLE_FUELS.has(dbValue as string)) {
      return { ok: false, error: "Unknown fuel type." };
    }
    if (field === "new_or_used" && dbValue !== null && !VEHICLE_NEW_OR_USED.has(dbValue as string)) {
      return { ok: false, error: "new_or_used must be 'New' or 'Used'." };
    }
    if (field === "previous_method" && dbValue !== null && !VEHICLE_PREVIOUS_METHODS.has(dbValue as string)) {
      return { ok: false, error: "Unknown previous_method." };
    }
    // purchase_date was the one "date"-kind field with no validation at
    // all in this per-field save path - a client could save a purchase
    // date next year (or any unparseable string) and it would flow
    // straight into the capital-allowances calc with nothing flagging
    // it before the figures reach the accountant/client-approval
    // screens. validateDateNotInFuture is the same check used
    // elsewhere in the intake for date fields (src/lib/pch/validation.ts).
    if (field === "purchase_date" && dbValue !== null) {
      const dateErr = validateDateNotInFuture(dbValue as string, "Purchase date");
      if (dateErr) return { ok: false, error: dateErr };
    }

    const { admin } = await requirePchIntakeEditable(caseId);
    // Phase G: the private-use card dropped its client-facing Yes/No.
    // The amount field is now the single source of truth; derive the
    // boolean flag server-side so the accountant side still has a
    // clean (amount, declared) pair to read off.
    const patch: Record<string, string | number | boolean | null> = { [field]: dbValue };
    if (field === "private_use_amount_pence") {
      patch.private_use_declared = typeof dbValue === "number" && dbValue > 0;
    }
    const upsert = await admin
      .from("pch_vehicle")
      .upsert(
        { case_id: caseId, ...patch },
        { onConflict: "case_id" },
      );
    if (upsert.error) return { ok: false, error: upsert.error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

// -------------------------------------------------------------------
// Row-evidence uploads: section 2 income rows + section 3 expense rows
// each have an optional doc-upload button that both stores the file
// as an accountant reference AND runs a single-field OCR for the
// row's money amount. Shape mirrors the UTR/NI single-field helper.
// -------------------------------------------------------------------

export async function extractIncomeAmountFromUploadAction(
  caseId: string,
  lineId: string,
  formData: FormData,
): Promise<IntakeActionResultWith<{ gross_takings_pence: number | null }>> {
  const r = await extractAmountForLine(caseId, lineId, formData, {
    label: "income",
    requirementKey: "intake-income",
    table: "pch_income_lines",
    moneyColumn: "gross_takings_pence",
    evidenceColumn: "evidence",
    prompt:
      "Find the TOTAL gross income (fares plus incentives, before fees) on this platform tax summary or statement. "
      + "Return a single number in pounds, no currency symbol and no commas. "
      + "If several totals are shown, pick the ANNUAL gross earnings total. "
      + "If you cannot find it, return null.",
  });
  if (!r.ok) return r;
  return { ok: true, gross_takings_pence: r.value };
}

export async function extractExpenseAmountFromUploadAction(
  caseId: string,
  lineId: string,
  formData: FormData,
): Promise<IntakeActionResultWith<{ amount_paid_pence: number | null }>> {
  const r = await extractAmountForLine(caseId, lineId, formData, {
    label: "expense",
    requirementKey: "intake-expense",
    table: "pch_expense_lines",
    moneyColumn: "amount_paid_pence",
    evidenceColumn: "evidence",
    prompt:
      "Find the TOTAL AMOUNT PAID on this receipt or invoice. "
      + "Return a single number in pounds, no currency symbol and no commas. "
      + "If several totals are shown, pick the final total paid including any VAT. "
      + "If you cannot find it, return null.",
  });
  if (!r.ok) return r;
  return { ok: true, amount_paid_pence: r.value };
}

const AMOUNT_REGEX = /£?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/;

async function extractAmountForLine(
  caseId: string,
  lineId: string,
  formData: FormData,
  cfg: {
    label: string;
    requirementKey: string;
    table: "pch_income_lines" | "pch_expense_lines";
    moneyColumn: string;
    evidenceColumn: string;
    prompt: string;
  },
): Promise<IntakeActionResultWith<{ value: number | null }>> {
  try {
    const { me, admin } = await requirePchIntakeEditable(caseId);

    // Make sure the line is really this case's line.
    const check = await admin
      .from(cfg.table)
      .select("id")
      .eq("id", lineId)
      .eq("case_id", caseId)
      .maybeSingle();
    if (check.error) return { ok: false, error: check.error.message };
    if (!check.data) return { ok: false, error: "Row not found." };

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Pick a file first." };
    }
    const MAX = 25 * 1024 * 1024;
    if (file.size > MAX) return { ok: false, error: "File is over 25 MB." };

    const typeLower = (file.type || "").toLowerCase();
    const nameLower = file.name.toLowerCase();
    const isPdf = typeLower === "application/pdf" || nameLower.endsWith(".pdf");
    const isJpeg = typeLower === "image/jpeg" || /\.jpe?g$/.test(nameLower);
    const isPng = typeLower === "image/png" || /\.png$/.test(nameLower);
    const isWebp = typeLower === "image/webp" || /\.webp$/.test(nameLower);
    if (!isPdf && !isJpeg && !isPng && !isWebp) {
      return { ok: false, error: "Upload a PDF, JPG, PNG or WebP." };
    }

    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_");
    const path = `${caseId}/intake/${cfg.requirementKey}-${lineId}-${randomUUID()}-${safe}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await admin.storage
      .from("case-documents")
      .upload(path, bytes, { contentType: file.type || "application/octet-stream" });
    if (up.error) return { ok: false, error: "Upload failed: " + up.error.message };

    const docIns = await admin
      .from("case_documents")
      .insert({
        case_id: caseId,
        uploaded_by: me.id,
        file_name: file.name,
        file_url: path,
        requirement_key: `${cfg.requirementKey}-${lineId}`,
      })
      .select("id")
      .single();
    if (docIns.error) return { ok: false, error: docIns.error.message };

    // Store the evidence path on the row immediately so the accountant
    // can open the file even if OCR fails.
    const evidenceUpdate = await admin
      .from(cfg.table)
      .update({ [cfg.evidenceColumn]: path })
      .eq("id", lineId)
      .eq("case_id", caseId);
    if (evidenceUpdate.error) return { ok: false, error: evidenceUpdate.error.message };

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { ok: true, value: null };

    const mediaType = isPdf
      ? "application/pdf"
      : isPng
        ? "image/png"
        : isWebp
          ? "image/webp"
          : "image/jpeg";

    const raw = await callOpenAiVision(apiKey, bytes, mediaType, cfg.prompt);
    if (raw === null) return { ok: true, value: null };

    // Model may wrap the figure in prose; pattern-match if needed.
    let candidate: string | null = null;
    const asNum = Number(raw.trim());
    if (Number.isFinite(asNum) && asNum >= 0) {
      candidate = String(asNum);
    } else {
      const m = AMOUNT_REGEX.exec(raw);
      if (m) candidate = m[1];
    }
    if (!candidate) return { ok: true, value: null };
    const pounds = Number(candidate.replace(/,/g, ""));
    if (!Number.isFinite(pounds) || pounds < 0) return { ok: true, value: null };
    const pence = Math.round(pounds * 100);

    const amountUpdate = await admin
      .from(cfg.table)
      .update({ [cfg.moneyColumn]: pence })
      .eq("id", lineId)
      .eq("case_id", caseId);
    if (amountUpdate.error) return { ok: false, error: amountUpdate.error.message };

    return { ok: true, value: pence };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Extract failed." };
  }
}

// -------------------------------------------------------------------
// Phase K: multi-file attachments for "Others income" (section 2) and
// "Other expense" (section 3). Each upload lands as its OWN
// case_documents row (so a second upload doesn't clobber the first)
// and the extracted amount is returned to the client instead of
// written to pch_income_lines / pch_expense_lines. The client sums
// the extracted amounts into the row's £ total via its existing
// debounced save path.
//
// The single-file extractAmountForLine above is unchanged; the other
// four income rows and twelve expense rows still use it.
// -------------------------------------------------------------------

type IntakeAttachLineType = "income" | "expense";

function attachRequirementKey(lineType: IntakeAttachLineType, lineId: string): string {
  return `intake-${lineType}-attach-${lineId}`;
}

const INCOME_ATTACH_PROMPT =
  "Find the TOTAL gross income (fares plus incentives, before fees) on this platform tax summary or statement. "
  + "Return a single number in pounds, no currency symbol and no commas. "
  + "If several totals are shown, pick the ANNUAL gross earnings total. "
  + "If you cannot find it, return null.";

const EXPENSE_ATTACH_PROMPT =
  "Find the TOTAL AMOUNT PAID on this receipt or invoice. "
  + "Return a single number in pounds, no currency symbol and no commas. "
  + "If several totals are shown, pick the final total paid including any VAT. "
  + "If you cannot find it, return null.";

export async function uploadIntakeAttachmentAction(
  caseId: string,
  lineType: IntakeAttachLineType,
  lineId: string,
  formData: FormData,
): Promise<
  IntakeActionResultWith<{
    doc_id: string;
    file_name: string;
    extracted_pence: number | null;
  }>
> {
  try {
    if (lineType !== "income" && lineType !== "expense") {
      return { ok: false, error: "Unknown lineType." };
    }
    const { me, admin } = await requirePchIntakeEditable(caseId);

    const table = lineType === "income" ? "pch_income_lines" : "pch_expense_lines";
    const check = await admin
      .from(table)
      .select("id")
      .eq("id", lineId)
      .eq("case_id", caseId)
      .maybeSingle();
    if (check.error) return { ok: false, error: check.error.message };
    if (!check.data) return { ok: false, error: "Row not found." };

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Pick a file first." };
    }
    const MAX = 25 * 1024 * 1024;
    if (file.size > MAX) return { ok: false, error: "File is over 25 MB." };

    const typeLower = (file.type || "").toLowerCase();
    const nameLower = file.name.toLowerCase();
    const isPdf = typeLower === "application/pdf" || nameLower.endsWith(".pdf");
    const isJpeg = typeLower === "image/jpeg" || /\.jpe?g$/.test(nameLower);
    const isPng = typeLower === "image/png" || /\.png$/.test(nameLower);
    const isWebp = typeLower === "image/webp" || /\.webp$/.test(nameLower);
    if (!isPdf && !isJpeg && !isPng && !isWebp) {
      return { ok: false, error: "Upload a PDF, JPG, PNG or WebP." };
    }

    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_");
    const requirementKey = attachRequirementKey(lineType, lineId);
    const path = `${caseId}/intake/${requirementKey}-${randomUUID()}-${safe}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await admin.storage
      .from("case-documents")
      .upload(path, bytes, { contentType: file.type || "application/octet-stream" });
    if (up.error) return { ok: false, error: "Upload failed: " + up.error.message };

    const docIns = await admin
      .from("case_documents")
      .insert({
        case_id: caseId,
        uploaded_by: me.id,
        file_name: file.name,
        file_url: path,
        requirement_key: requirementKey,
      })
      .select("id, file_name")
      .single();
    if (docIns.error) return { ok: false, error: docIns.error.message };

    const docId = docIns.data.id as string;
    const fileName = docIns.data.file_name as string;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { ok: true, doc_id: docId, file_name: fileName, extracted_pence: null };
    }

    const prompt = lineType === "income" ? INCOME_ATTACH_PROMPT : EXPENSE_ATTACH_PROMPT;
    const mediaType = isPdf
      ? "application/pdf"
      : isPng
        ? "image/png"
        : isWebp
          ? "image/webp"
          : "image/jpeg";

    const raw = await callOpenAiVision(apiKey, bytes, mediaType, prompt);
    if (raw === null) {
      return { ok: true, doc_id: docId, file_name: fileName, extracted_pence: null };
    }

    let candidate: string | null = null;
    const asNum = Number(raw.trim());
    if (Number.isFinite(asNum) && asNum >= 0) {
      candidate = String(asNum);
    } else {
      const m = AMOUNT_REGEX.exec(raw);
      if (m) candidate = m[1];
    }
    if (!candidate) {
      return { ok: true, doc_id: docId, file_name: fileName, extracted_pence: null };
    }
    const pounds = Number(candidate.replace(/,/g, ""));
    if (!Number.isFinite(pounds) || pounds < 0) {
      return { ok: true, doc_id: docId, file_name: fileName, extracted_pence: null };
    }
    const pence = Math.round(pounds * 100);
    return { ok: true, doc_id: docId, file_name: fileName, extracted_pence: pence };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed." };
  }
}

export async function deleteIntakeAttachmentAction(
  caseId: string,
  docId: string,
): Promise<IntakeActionResult> {
  try {
    const { admin } = await requirePchIntakeEditable(caseId);
    const { data: row, error: readErr } = await admin
      .from("case_documents")
      .select("file_url, case_id, requirement_key")
      .eq("id", docId)
      .maybeSingle();
    if (readErr) return { ok: false, error: readErr.message };
    if (!row) return { ok: false, error: "Attachment not found." };
    if (row.case_id !== caseId) return { ok: false, error: "Not your attachment." };
    const key = (row.requirement_key as string | null) ?? "";
    if (
      !key.startsWith("intake-income-attach-")
      && !key.startsWith("intake-expense-attach-")
      && key !== "intake-private-use-attach"
    ) {
      return { ok: false, error: "Not a removable intake attachment." };
    }

    const path = row.file_url as string | null;
    if (path) {
      await admin.storage.from("case-documents").remove([path]);
    }
    const del = await admin
      .from("case_documents")
      .delete()
      .eq("id", docId)
      .eq("case_id", caseId);
    if (del.error) return { ok: false, error: del.error.message };

    // If this was the representative file stamped on pch_vehicle for
    // the private-use card, repoint it at any other surviving
    // attachment or clear it so historical readers of that column
    // don't dangle at a now-deleted path.
    if (key === "intake-private-use-attach" && path) {
      const veh = await admin
        .from("pch_vehicle")
        .select("private_use_evidence")
        .eq("case_id", caseId)
        .maybeSingle();
      if (veh.data?.private_use_evidence === path) {
        const next = await admin
          .from("case_documents")
          .select("file_url")
          .eq("case_id", caseId)
          .eq("requirement_key", "intake-private-use-attach")
          .order("uploaded_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        const nextPath = (next.data?.file_url as string | null) ?? null;
        await admin
          .from("pch_vehicle")
          .update({ private_use_evidence: nextPath })
          .eq("case_id", caseId);
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Remove failed." };
  }
}

// -------------------------------------------------------------------
// Gift Aid entries (section 10): one row per donation. Re-syncs the
// total into pch_cases.gift_aid_net_pence after every upsert/delete
// so the engine (which reads that single column) stays accurate.
// -------------------------------------------------------------------

async function resyncGiftAidTotal(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
): Promise<{ error?: string }> {
  const { data, error } = await admin
    .from("pch_gift_aid_entries")
    .select("amount_pence")
    .eq("case_id", caseId);
  if (error) return { error: error.message };
  const total = (data ?? []).reduce(
    (sum, r) => sum + Number(r.amount_pence ?? 0),
    0,
  );
  const upd = await admin
    .from("pch_cases")
    .update({ gift_aid_net_pence: total })
    .eq("case_id", caseId);
  if (upd.error) return { error: upd.error.message };
  return {};
}

export async function upsertPchGiftAidEntryAction(
  caseId: string,
  entryId: string | null,
  patch: {
    charity_name?: string | null;
    donation_date?: string | null;
    amount_pence?: number | null;
  },
): Promise<IntakeActionResultWith<{ id: string }>> {
  try {
    const { admin } = await requirePchIntakeEditable(caseId);
    const row: Record<string, unknown> = {};
    if (patch.charity_name !== undefined) {
      row.charity_name =
        patch.charity_name === null || patch.charity_name.trim() === ""
          ? null
          : patch.charity_name.trim();
    }
    if (patch.donation_date !== undefined) {
      row.donation_date =
        patch.donation_date === null || patch.donation_date === ""
          ? null
          : patch.donation_date;
    }
    if (patch.amount_pence !== undefined) {
      row.amount_pence =
        patch.amount_pence === null
          ? null
          : Math.max(0, Math.round(patch.amount_pence));
    }
    let id = entryId;
    if (id) {
      const upd = await admin
        .from("pch_gift_aid_entries")
        .update(row)
        .eq("id", id)
        .eq("case_id", caseId)
        .select("id")
        .single();
      if (upd.error) return { ok: false, error: upd.error.message };
    } else {
      const { data: existing } = await admin
        .from("pch_gift_aid_entries")
        .select("sort_order")
        .eq("case_id", caseId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextSort = ((existing?.sort_order as number | undefined) ?? -1) + 1;
      const ins = await admin
        .from("pch_gift_aid_entries")
        .insert({ case_id: caseId, sort_order: nextSort, ...row })
        .select("id")
        .single();
      if (ins.error) return { ok: false, error: ins.error.message };
      id = ins.data.id as string;
    }
    const sync = await resyncGiftAidTotal(admin, caseId);
    if (sync.error) return { ok: false, error: sync.error };
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

export async function deletePchGiftAidEntryAction(
  caseId: string,
  entryId: string,
): Promise<IntakeActionResult> {
  try {
    const { admin } = await requirePchIntakeEditable(caseId);
    const del = await admin
      .from("pch_gift_aid_entries")
      .delete()
      .eq("id", entryId)
      .eq("case_id", caseId);
    if (del.error) return { ok: false, error: del.error.message };
    const sync = await resyncGiftAidTotal(admin, caseId);
    if (sync.error) return { ok: false, error: sync.error };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed." };
  }
}

// -------------------------------------------------------------------
// Section 4-15 evidence uploads: one storage path per pch_cases
// evidence column. Whitelisted so a bad UI call can't type its way
// into writing storage paths into a non-evidence column.
// -------------------------------------------------------------------

const EVIDENCE_COLUMNS = new Set([
  "p11d_evidence",
  "interest_evidence",
  "dividend_evidence",
  "capital_gains_evidence",
  "rental_evidence",
  "pension_evidence",
  "child_benefit_evidence",
  "overseas_evidence",
  "student_loan_evidence",
  "last_year_sa302_evidence",
  // Phase G: optional P60/payslip for the simplified "Income from
  // another job" card (migration 0117).
  "other_employment_evidence",
]);

export async function uploadPchSectionEvidenceAction(
  caseId: string,
  column: string,
  formData: FormData,
): Promise<IntakeActionResultWith<{ path: string }>> {
  try {
    if (!EVIDENCE_COLUMNS.has(column)) {
      return { ok: false, error: "Not a whitelisted evidence column." };
    }
    const { me, admin } = await requirePchIntakeEditable(caseId);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Pick a file first." };
    }
    const MAX = 25 * 1024 * 1024;
    if (file.size > MAX) return { ok: false, error: "File is over 25 MB." };

    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_");
    const path = `${caseId}/intake/${column}-${randomUUID()}-${safe}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await admin.storage
      .from("case-documents")
      .upload(path, bytes, { contentType: file.type || "application/octet-stream" });
    if (up.error) return { ok: false, error: "Upload failed: " + up.error.message };

    const ins = await admin
      .from("case_documents")
      .insert({
        case_id: caseId,
        uploaded_by: me.id,
        file_name: file.name,
        file_url: path,
        requirement_key: "intake-" + column,
      });
    if (ins.error) return { ok: false, error: ins.error.message };

    const upd = await admin
      .from("pch_cases")
      .update({ [column]: path })
      .eq("case_id", caseId);
    if (upd.error) return { ok: false, error: upd.error.message };
    return { ok: true, path };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed." };
  }
}

// Case-level multi-file attachments for the "Less: Private use" box
// in section 3 (moved out of the Vehicle section). Writes go to
// case_documents with a single case-scoped requirement_key (no line
// id suffix: there is no pch_expense_lines row for this, the amount
// lives on pch_vehicle.private_use_amount_pence via savePchVehicle
// FieldAction). OCR mirrors the expense multi-file flow: we read the
// amount off the receipt so the running total accumulates per file.
// pch_vehicle.private_use_evidence stays as a representative-first-
// attachment path so historical readers that pick up that column
// still see something sensible after the single-file flow is gone.
const PRIVATE_USE_REQUIREMENT_KEY = "intake-private-use-attach";

export async function uploadPrivateUseAttachmentAction(
  caseId: string,
  formData: FormData,
): Promise<
  IntakeActionResultWith<{
    doc_id: string;
    file_name: string;
    extracted_pence: number | null;
  }>
> {
  try {
    const { me, admin } = await requirePchIntakeEditable(caseId);

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Pick a file first." };
    }
    const MAX = 25 * 1024 * 1024;
    if (file.size > MAX) return { ok: false, error: "File is over 25 MB." };

    const typeLower = (file.type || "").toLowerCase();
    const nameLower = file.name.toLowerCase();
    const isPdf = typeLower === "application/pdf" || nameLower.endsWith(".pdf");
    const isJpeg = typeLower === "image/jpeg" || /\.jpe?g$/.test(nameLower);
    const isPng = typeLower === "image/png" || /\.png$/.test(nameLower);
    const isWebp = typeLower === "image/webp" || /\.webp$/.test(nameLower);
    if (!isPdf && !isJpeg && !isPng && !isWebp) {
      return { ok: false, error: "Upload a PDF, JPG, PNG or WebP." };
    }

    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_");
    const path = `${caseId}/intake/${PRIVATE_USE_REQUIREMENT_KEY}-${randomUUID()}-${safe}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await admin.storage
      .from("case-documents")
      .upload(path, bytes, { contentType: file.type || "application/octet-stream" });
    if (up.error) return { ok: false, error: "Upload failed: " + up.error.message };

    const docIns = await admin
      .from("case_documents")
      .insert({
        case_id: caseId,
        uploaded_by: me.id,
        file_name: file.name,
        file_url: path,
        requirement_key: PRIVATE_USE_REQUIREMENT_KEY,
      })
      .select("id, file_name")
      .single();
    if (docIns.error) return { ok: false, error: docIns.error.message };

    const docId = docIns.data.id as string;
    const fileName = docIns.data.file_name as string;

    // Stamp a representative evidence path on the vehicle row the
    // first time any attachment lands, so pch_vehicle.private_use_
    // evidence (which the accountant side historically read) still
    // points at a real file. Later uploads leave it alone; later
    // deletes clear it only if the removed doc was the one named.
    const existing = await admin
      .from("pch_vehicle")
      .select("private_use_evidence")
      .eq("case_id", caseId)
      .maybeSingle();
    if (!existing.error && !existing.data?.private_use_evidence) {
      const upsert = await admin
        .from("pch_vehicle")
        .upsert(
          { case_id: caseId, private_use_evidence: path },
          { onConflict: "case_id" },
        );
      if (upsert.error) return { ok: false, error: upsert.error.message };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { ok: true, doc_id: docId, file_name: fileName, extracted_pence: null };
    }

    const mediaType = isPdf
      ? "application/pdf"
      : isPng
        ? "image/png"
        : isWebp
          ? "image/webp"
          : "image/jpeg";

    const raw = await callOpenAiVision(apiKey, bytes, mediaType, EXPENSE_ATTACH_PROMPT);
    if (raw === null) {
      return { ok: true, doc_id: docId, file_name: fileName, extracted_pence: null };
    }

    let candidate: string | null = null;
    const asNum = Number(raw.trim());
    if (Number.isFinite(asNum) && asNum >= 0) {
      candidate = String(asNum);
    } else {
      const m = AMOUNT_REGEX.exec(raw);
      if (m) candidate = m[1];
    }
    if (!candidate) {
      return { ok: true, doc_id: docId, file_name: fileName, extracted_pence: null };
    }
    const pounds = Number(candidate.replace(/,/g, ""));
    if (!Number.isFinite(pounds) || pounds < 0) {
      return { ok: true, doc_id: docId, file_name: fileName, extracted_pence: null };
    }
    const pence = Math.round(pounds * 100);
    return { ok: true, doc_id: docId, file_name: fileName, extracted_pence: pence };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed." };
  }
}

// -------------------------------------------------------------------
// Final section: general multi-file dropzone (bank statements and
// any other receipts/invoices/documents relevant to the return).
// Deliberately NOT a slot write; files just land in case_documents
// with requirement_key='intake-general' and the accountant can open
// them on review.
// -------------------------------------------------------------------

export async function uploadPchGeneralDocumentAction(
  caseId: string,
  formData: FormData,
): Promise<IntakeActionResultWith<{ id: string; file_name: string }>> {
  try {
    const { me, admin } = await requirePchIntakeEditable(caseId);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Pick a file first." };
    }
    const MAX = 50 * 1024 * 1024;
    if (file.size > MAX) return { ok: false, error: "File is over 50 MB." };

    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_");
    const path = `${caseId}/intake/general-${randomUUID()}-${safe}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await admin.storage
      .from("case-documents")
      .upload(path, bytes, { contentType: file.type || "application/octet-stream" });
    if (up.error) return { ok: false, error: "Upload failed: " + up.error.message };

    const ins = await admin
      .from("case_documents")
      .insert({
        case_id: caseId,
        uploaded_by: me.id,
        file_name: file.name,
        file_url: path,
        requirement_key: "intake-general",
      })
      .select("id, file_name")
      .single();
    if (ins.error) return { ok: false, error: ins.error.message };
    return {
      ok: true,
      id: ins.data.id as string,
      file_name: ins.data.file_name as string,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed." };
  }
}

// -------------------------------------------------------------------
// Auto-apply the latest completed PCH-24 (photo ID) extraction so
// the identity inputs populate the moment the vision call finishes.
// Called by the UI once it sees the extraction row flip to status=done.
// Writes extracted fields straight to pch_cases.cl_name / cl_dob /
// cl_address / cl_postcode and marks the extraction row as applied
// so the accountant-side review surface doesn't re-prompt for it.
// -------------------------------------------------------------------
export async function autoApplyPch24ExtractionAction(
  caseId: string,
): Promise<IntakeActionResultWith<{ applied: Record<string, string> }>> {
  try {
    const { admin } = await requirePchIntakeEditable(caseId);
    // Only pick extractions we haven't applied before. The applied_at
    // boolean marker is the one source of truth; status stays on the
    // enum ('pending' | 'done' | 'error' | 'skipped') the rest of the
    // extraction pipeline relies on. See migration 0114.
    const { data: ext, error: readErr } = await admin
      .from("pch_doc_extractions")
      .select("id, fields, status, photo_id_side, applied_at")
      .eq("case_id", caseId)
      .eq("slot_code", "PCH-24")
      .eq("status", "done")
      .is("applied_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (readErr) return { ok: false, error: readErr.message };
    if (!ext) return { ok: true, applied: {} };

    const fields = (ext.fields ?? {}) as Record<string, { value?: unknown }>;
    const headPatch: Record<string, string> = {};
    const applied: Record<string, string> = {};
    const copy = (key: string, col: string) => {
      const raw = fields[key]?.value;
      if (typeof raw === "string" && raw.trim().length > 0) {
        headPatch[col] = raw.trim();
        applied[col] = raw.trim();
      }
    };
    copy("fullName", "cl_name");
    copy("dateOfBirth", "cl_dob");
    copy("address", "cl_address");
    copy("postcode", "cl_postcode");
    if (Object.keys(headPatch).length > 0) {
      const headUpdate = await admin
        .from("pch_cases")
        .update(headPatch)
        .eq("case_id", caseId);
      if (headUpdate.error) {
        return { ok: false, error: headUpdate.error.message };
      }
    }
    // Mark the extraction as applied either way: a 'done' extraction
    // with no copyable fields (model returned nothing useful) should
    // still be considered handled so we don't re-check it on every
    // page load. Clients can re-upload if they need another pass.
    const markUpdate = await admin
      .from("pch_doc_extractions")
      .update({ applied_at: new Date().toISOString() })
      .eq("id", ext.id);
    if (markUpdate.error) {
      return { ok: false, error: markUpdate.error.message };
    }
    return { ok: true, applied };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Apply failed." };
  }
}
