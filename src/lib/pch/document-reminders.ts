import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { siteUrl } from "@/lib/stripe";

// Daily sweep that nudges clients to upload still-missing required
// documents on their PCH automated case. Rules:
//
//   - Case must be a PCH automated case, status = submitted (once the
//     accountant takes over, reminders stop)
//   - Case was created at least 3 days ago (don't nag immediately
//     after payment, the client is still getting their docs together)
//   - At least one of the mandatory doc slots is still 'Awaiting'
//     (not uploaded, not marked Not applicable)
//   - last_doc_reminder_at is NULL or more than 7 days ago (weekly
//     cadence, not daily)
//
// One grouped email per case per sweep: lists every missing slot in a
// single message so the client sees the full outstanding list, not
// one nag per document.

// Mandatory slots we remind on. Deliberately excludes PCH-23 (signed
// approval, uploaded post-accountant-review, not during intake) and
// the conditional slots whose required_rule says "Required (actual-
// cost method)" etc.
const MANDATORY_SLOT_CODES = [
  "PCH-01", // Platform annual tax summary
  "PCH-04", // Vehicle insurance schedule
  "PCH-08", // MOT history odometer
  "PCH-12", // Licence fees
  "PCH-14", // Bank statements
] as const;

const INITIAL_DELAY_DAYS = 3;
const REPEAT_INTERVAL_DAYS = 7;

type CandidateCase = {
  caseId: string;
  clientEmail: string;
  clientName: string;
  firmName: string;
  firmAddress: string | null;
  missingSlots: { code: string; displayName: string; whyWeNeedIt: string | null }[];
  caseLink: string;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Pure detector: given the raw DB rows, return which cases should get
// a reminder right now. Separated from the sender so the cron route
// can also do a dry-run.
export async function findPchCasesNeedingReminder(now: Date = new Date()): Promise<CandidateCase[]> {
  const admin = createAdminClient();
  const initialThreshold = new Date(now.getTime() - INITIAL_DELAY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const repeatThreshold = new Date(now.getTime() - REPEAT_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Candidate cases: PCH automated, status=submitted, old enough, not
  // reminded recently. .or() clause lets us express "never reminded OR
  // last reminder older than threshold".
  const { data: cases } = await admin
    .from("cases")
    .select("id, client_id, accountant_id, created_at, last_doc_reminder_at")
    .eq("tier", "uber_phv_automated")
    .eq("status", "submitted")
    .lte("created_at", initialThreshold)
    .or(`last_doc_reminder_at.is.null,last_doc_reminder_at.lte.${repeatThreshold}`);
  if (!cases || cases.length === 0) return [];

  // Per-case: list of mandatory slots not yet in Uploaded or Not
  // applicable state. Default status when no row exists is Awaiting,
  // which counts as missing.
  const [{ data: slotStatus }, { data: slotDefs }] = await Promise.all([
    admin
      .from("pch_doc_status")
      .select("case_id, slot_code, status")
      .in("case_id", cases.map((c) => c.id))
      .in("slot_code", [...MANDATORY_SLOT_CODES]),
    admin
      .from("pch_doc_slots")
      .select("code, display_name, why_we_need_it")
      .in("code", [...MANDATORY_SLOT_CODES]),
  ]);
  const defByCode = new Map((slotDefs ?? []).map((d) => [d.code, d]));
  const statusByCaseSlot = new Map<string, string>();
  for (const s of slotStatus ?? []) statusByCaseSlot.set(s.case_id + ":" + s.slot_code, s.status);

  // Firm block + client email for every candidate case.
  const clientIds = cases.map((c) => c.client_id);
  const accountantIds = cases.map((c) => c.accountant_id).filter(Boolean) as string[];
  const [{ data: clients }, { data: heads }, { data: profiles }] = await Promise.all([
    admin.from("users").select("id, email").in("id", clientIds),
    admin.from("pch_cases").select("case_id, cl_name, cl_email").in("case_id", cases.map((c) => c.id)),
    accountantIds.length
      ? admin
          .from("accountant_profiles")
          .select("user_id, trading_name, company_name, legal_name, name, address")
          .in("user_id", accountantIds)
      : Promise.resolve({ data: [] as { user_id: string; trading_name: string | null; company_name: string | null; legal_name: string | null; name: string | null; address: string | null }[] }),
  ]);
  const clientById = new Map((clients ?? []).map((u) => [u.id, u]));
  const headByCase = new Map((heads ?? []).map((h) => [h.case_id, h]));
  const profileById = new Map((profiles ?? []).map((p) => [p.user_id, p]));
  const base = siteUrl().replace(/\/$/, "");

  const candidates: CandidateCase[] = [];
  for (const c of cases) {
    const missing: CandidateCase["missingSlots"] = [];
    for (const code of MANDATORY_SLOT_CODES) {
      const current = statusByCaseSlot.get(c.id + ":" + code) ?? "Awaiting";
      if (current === "Uploaded" || current === "Not applicable") continue;
      const def = defByCode.get(code);
      missing.push({
        code,
        displayName: def?.display_name ?? code,
        whyWeNeedIt: def?.why_we_need_it ?? null,
      });
    }
    if (missing.length === 0) continue;
    const head = headByCase.get(c.id);
    const client = clientById.get(c.client_id);
    const clientEmail = head?.cl_email ?? client?.email ?? null;
    if (!clientEmail) continue;
    const clientName = head?.cl_name ?? client?.email?.split("@")[0] ?? "there";
    const profile = c.accountant_id ? profileById.get(c.accountant_id) : null;
    const firmName =
      profile?.trading_name ?? profile?.company_name ?? profile?.legal_name ?? profile?.name ?? "Sterling Ledger";
    const firmAddress = profile?.address ?? null;
    candidates.push({
      caseId: c.id,
      clientEmail,
      clientName,
      firmName,
      firmAddress,
      missingSlots: missing,
      caseLink: `${base}/client/cases/${c.id}/pch`,
    });
  }
  return candidates;
}

function buildReminderHtml(c: CandidateCase): string {
  const slotRows = c.missingSlots
    .map((s) => `
      <li style="margin:6px 0;">
        <strong>${esc(s.displayName)}</strong>
        ${s.whyWeNeedIt ? `<div style="color:#64748b;font-size:12px;">${esc(s.whyWeNeedIt)}</div>` : ""}
      </li>`)
    .join("");
  const firmAddressHtml = c.firmAddress
    ? c.firmAddress.split(/\r?\n/).map((line) => `<div>${esc(line)}</div>`).join("")
    : "";
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;">
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;">A few documents still to upload</h1>
    <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.5;">
      Hi ${esc(c.clientName)}, we're ready to prepare your return as soon as these are in:
    </p>
    <ul style="margin:0 0 24px;padding-left:18px;color:#334155;font-size:14px;line-height:1.5;">
      ${slotRows}
    </ul>
    <p style="margin:0 0 24px;color:#475569;font-size:14px;">
      If any of these don't apply to you, open your case and mark the slot "Not applicable" so we know you've seen it.
    </p>
    <p style="margin:0 0 32px;">
      <a href="${esc(c.caseLink)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px;">
        Open your case
      </a>
    </p>
    <div style="border-top:1px solid #e2e8f0;padding-top:16px;color:#64748b;font-size:12px;">
      <div><strong style="color:#334155;">${esc(c.firmName)}</strong></div>
      ${firmAddressHtml}
    </div>
  </div>
</body>
</html>`;
}

export type SweepResult = {
  found: number;
  sent: number;
  failed: number;
  skippedNoEmail: number;
};

export async function runPchDocumentReminderSweep(now: Date = new Date()): Promise<SweepResult> {
  const admin = createAdminClient();
  const candidates = await findPchCasesNeedingReminder(now);
  let sent = 0, failed = 0, skippedNoEmail = 0;
  for (const c of candidates) {
    try {
      const r = await sendEmail({
        to: c.clientEmail,
        subject: `${c.missingSlots.length} document${c.missingSlots.length === 1 ? "" : "s"} still needed for your tax return`,
        html: buildReminderHtml(c),
      });
      if (r.ok && !r.skipped) {
        sent += 1;
        await admin
          .from("cases")
          .update({ last_doc_reminder_at: now.toISOString() })
          .eq("id", c.caseId);
      } else if (r.ok && r.skipped) {
        skippedNoEmail += 1;
      } else {
        failed += 1;
        // Mark the attempt anyway so a hard-bouncing address doesn't
        // get retried every day; the client can message support if
        // they stopped getting mail.
        await admin
          .from("cases")
          .update({ last_doc_reminder_at: now.toISOString() })
          .eq("id", c.caseId);
      }
    } catch {
      failed += 1;
    }
  }
  return { found: candidates.length, sent, failed, skippedNoEmail };
}
