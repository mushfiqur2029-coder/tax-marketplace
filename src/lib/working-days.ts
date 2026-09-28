import fallback from "./uk-holidays-fallback.json";

// Minimum working days before the earliest standard deadline (excluding today).
// Consumed by the wizard, the create-case server action, and the checkout
// recheck. Change here and both UI + enforcement move together.
export const MIN_WORKING_DAYS = 5;

// Constant the urgent fee is stored at per-row on cases.urgent_fee_pence.
// Server-side authoritative — never read this from a form field.
export const URGENT_FEE_PENCE = 100_00;

// UK (England and Wales) bank holidays. Fetched from gov.uk with a 24h
// in-memory cache; falls back to a bundled list if the fetch fails so a
// gov.uk outage doesn't take deadline validation down with it.
let cache: { fetchedAt: number; dates: Set<string> } | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function getUkHolidays(): Promise<Set<string>> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.dates;
  try {
    const res = await fetch("https://www.gov.uk/bank-holidays.json", {
      // Next.js fetch cache honours 24h freshness. Also protects a spike of
      // create-case requests from hammering gov.uk.
      next: { revalidate: CACHE_TTL_MS / 1000 },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        "england-and-wales"?: { events?: Array<{ date: string }> };
      };
      const events = data["england-and-wales"]?.events ?? [];
      const dates = new Set<string>(events.map((e) => e.date));
      // Merge in the fallback in case gov.uk trims older / very-future dates
      // — cheap belt-and-braces, doesn't hurt correctness.
      for (const d of fallback.dates) dates.add(d);
      cache = { fetchedAt: now, dates };
      return dates;
    }
  } catch {
    // ignore; fall through to bundled fallback
  }
  cache = { fetchedAt: now, dates: new Set(fallback.dates) };
  return cache.dates;
}

// -----------------------------------------------------------------------
// London-calendar-date helpers. Everything works in YYYY-MM-DD strings so
// we don't accidentally shift a day at midnight BST/GMT transitions.
// -----------------------------------------------------------------------

// Given a Date (UTC internally) return its London calendar date as YYYY-MM-DD.
export function toLondonDateString(d: Date): string {
  // "en-CA" formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// Return today's date in Europe/London as YYYY-MM-DD.
export function todayLondon(): string {
  return toLondonDateString(new Date());
}

// Add n calendar days to a YYYY-MM-DD string. Works via a UTC-anchored Date
// so DST doesn't perturb the arithmetic — we're incrementing civil day
// count, not wall-clock seconds.
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// 0 = Sunday ... 6 = Saturday, using UTC to avoid TZ perturbation.
function weekday(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export async function isWorkingDay(ymd: string): Promise<boolean> {
  const dow = weekday(ymd);
  if (dow === 0 || dow === 6) return false;
  const holidays = await getUkHolidays();
  return !holidays.has(ymd);
}

// The nth working day strictly after the given date (i.e. today itself is
// never counted). Used both for standard earliest (n=5) and urgent
// earliest (n=1).
export async function addWorkingDaysAfter(
  from: string,
  n: number,
): Promise<string> {
  const holidays = await getUkHolidays();
  let cur = from;
  let added = 0;
  while (added < n) {
    cur = addDays(cur, 1);
    const dow = weekday(cur);
    if (dow === 0 || dow === 6) continue;
    if (holidays.has(cur)) continue;
    added += 1;
  }
  return cur;
}

export async function earliestStandardDeadline(): Promise<string> {
  return addWorkingDaysAfter(todayLondon(), MIN_WORKING_DAYS);
}

export async function earliestUrgentDeadline(): Promise<string> {
  return addWorkingDaysAfter(todayLondon(), 1);
}

// Server-side validation gate. `deadline` is a YYYY-MM-DD string (day
// picker) or a Date/ISO timestamp (existing case rows). Returns { ok }
// or a specific reason so callers can surface an actionable error.
export type DeadlineCheck =
  | { ok: true }
  | { ok: false; reason: "too_early_standard" | "too_early_urgent"; earliest: string };

export async function validateDeadline(
  deadline: string | Date,
  isUrgent: boolean,
): Promise<DeadlineCheck> {
  const dateStr =
    typeof deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(deadline)
      ? deadline
      : toLondonDateString(
          typeof deadline === "string" ? new Date(deadline) : deadline,
        );
  const earliest = isUrgent
    ? await earliestUrgentDeadline()
    : await earliestStandardDeadline();
  if (dateStr < earliest) {
    return {
      ok: false,
      reason: isUrgent ? "too_early_urgent" : "too_early_standard",
      earliest,
    };
  }
  return { ok: true };
}
