import "server-only";

// Companies House public data API wrapper.
//
// Auth: HTTP Basic with the API key as the username and an empty password.
// Confirmed from Companies House's own authorisation guide — the base64
// payload is literally `<key>:` (trailing colon, no password).
//
// Two call shapes:
//   • search by name  → GET /search/companies?q=<q>
//   • lookup by number → GET /company/{number}
//
// We decide which to use by shape: an input that already matches a UK
// company-number pattern (8 digits or 2 letters + 6 digits) is treated
// as a 1:1 lookup; everything else is a name search. This matches the
// one-search-box UX in the onboarding widget.
//
// Rate limit: Companies House allows 600 req / 5 min per key. Debounce
// in the client plus a short in-memory cache here keeps us comfortably
// under that even with chatty typing.

export type CompaniesHouseHit = {
  company_number: string;
  company_name: string;
  company_status: string; // "active" | "dissolved" | "liquidation" | "receivership" | "administration" | "voluntary-arrangement" | "converted-closed" | "insolvency-proceedings" | "registered" | "removed" | "open" | "closed"
  address_snippet: string | null;
  date_of_creation: string | null;
};

export type LookupResult =
  | { ok: true; items: CompaniesHouseHit[] }
  // fallback=true tells the client "API is unavailable, drop to manual
  // entry silently". Covers missing env var and 5xx responses — anything
  // that would prevent *all* lookups from working, not just one query.
  | { ok: false; fallback: true }
  // 4xx: specific to this query (bad input, rate-limited). Surface the
  // message but keep the lookup widget available.
  | { ok: false; error: string };

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: CompaniesHouseHit[] }>();

const COMPANY_NUMBER_RE = /^(?:\d{8}|[A-Za-z]{2}\d{6})$/;

export function isCompanyNumberLike(q: string): boolean {
  return COMPANY_NUMBER_RE.test(q.trim());
}

function authHeader(key: string): string {
  const b64 = Buffer.from(`${key}:`, "utf-8").toString("base64");
  return `Basic ${b64}`;
}

type CompanyProfileJson = {
  company_number?: string;
  company_name?: string;
  company_status?: string;
  date_of_creation?: string;
  registered_office_address?: {
    address_line_1?: string;
    locality?: string;
    postal_code?: string;
  };
};

type SearchItemJson = {
  company_number?: string;
  title?: string;
  company_status?: string;
  address_snippet?: string;
  date_of_creation?: string;
};

export async function searchCompanies(
  rawQuery: string,
): Promise<LookupResult> {
  const q = rawQuery.trim();
  if (q.length < 3) return { ok: true, items: [] };

  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) return { ok: false, fallback: true };

  const cached = cache.get(q);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ok: true, items: cached.value };
  }

  const headers = { Authorization: authHeader(key) };

  try {
    if (isCompanyNumberLike(q)) {
      // 1:1 lookup. Company numbers are uppercase-prefixed (SC/NI/OC).
      const normalized = q.toUpperCase();
      const url = `https://api.company-information.service.gov.uk/company/${encodeURIComponent(normalized)}`;
      const r = await fetch(url, { headers, cache: "no-store" });
      if (r.status === 404) {
        cache.set(q, { at: Date.now(), value: [] });
        return { ok: true, items: [] };
      }
      if (!r.ok) {
        if (r.status >= 500) return { ok: false, fallback: true };
        return {
          ok: false,
          error: `Companies House responded ${r.status}.`,
        };
      }
      const json = (await r.json()) as CompanyProfileJson;
      const hit: CompaniesHouseHit = {
        company_number: json.company_number ?? normalized,
        company_name: json.company_name ?? "",
        company_status: json.company_status ?? "unknown",
        address_snippet: addressSnippetFromProfile(json),
        date_of_creation: json.date_of_creation ?? null,
      };
      cache.set(q, { at: Date.now(), value: [hit] });
      return { ok: true, items: [hit] };
    }

    const url = `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(q)}&items_per_page=10`;
    const r = await fetch(url, { headers, cache: "no-store" });
    if (!r.ok) {
      if (r.status >= 500) return { ok: false, fallback: true };
      return {
        ok: false,
        error: `Companies House responded ${r.status}.`,
      };
    }
    const json = (await r.json()) as { items?: SearchItemJson[] };
    const items: CompaniesHouseHit[] = (json.items ?? []).map((it) => ({
      company_number: it.company_number ?? "",
      company_name: it.title ?? "",
      company_status: it.company_status ?? "unknown",
      address_snippet: it.address_snippet ?? null,
      date_of_creation: it.date_of_creation ?? null,
    }));
    cache.set(q, { at: Date.now(), value: items });
    return { ok: true, items };
  } catch (err) {
    // Network error / aborted fetch. Treat as outage → fallback mode.
    console.error(
      `[companies-house] fetch failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { ok: false, fallback: true };
  }
}

function addressSnippetFromProfile(j: CompanyProfileJson): string | null {
  const parts = [
    j.registered_office_address?.address_line_1,
    j.registered_office_address?.locality,
    j.registered_office_address?.postal_code,
  ].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(", ") : null;
}

// Human-friendly label for a company_status value. We keep the raw value
// in the DB and derive the label here so the API stays canonical and
// the UI can swap wording later without a migration.
export function companyStatusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case "active":
      return "Active";
    case "dissolved":
      return "Dissolved";
    case "liquidation":
      return "In liquidation";
    case "receivership":
      return "In receivership";
    case "administration":
      return "In administration";
    case "voluntary-arrangement":
      return "Voluntary arrangement";
    case "insolvency-proceedings":
      return "Insolvency proceedings";
    case "converted-closed":
      return "Converted / closed";
    case "removed":
      return "Removed";
    case "open":
      return "Open";
    case "closed":
      return "Closed";
    case "registered":
      return "Registered";
    default:
      return status.replace(/-/g, " ");
  }
}

export function isActiveStatus(status: string): boolean {
  return status.toLowerCase() === "active";
}
