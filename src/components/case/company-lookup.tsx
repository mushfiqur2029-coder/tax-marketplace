"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

// Lightweight structural equality for CompanyPick. Prevents the
// "reset local state when prop changes" effect from firing when the
// parent re-renders with a fresh object that carries identical values.
function pickEq(a: CompanyPick | null, b: CompanyPick | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.company_number === b.company_number &&
    a.company_name === b.company_name &&
    a.company_status === b.company_status
  );
}

export type CompanyPick = {
  company_number: string;
  company_name: string;
  company_status: string;
};

type Hit = CompanyPick & {
  address_snippet: string | null;
  date_of_creation: string | null;
};

type Props = {
  initial: CompanyPick | null;
  // Called after the user picks a company (either from the dropdown
  // or by submitting a manual-entry pair). The parent is responsible
  // for persisting the pair server-side. The widget stays in sync with
  // whatever `initial` the parent passes back next render.
  onPick: (pick: CompanyPick) => Promise<void> | void;
  onClear: () => Promise<void> | void;
  // Set by the parent when a save round-trip is in flight. We disable
  // Pick/Change controls so the user can't fire a second save on top.
  busy?: boolean;
  // When true, the "Change" link stops working and we show a lock
  // icon with the "contact support" copy — used on Section A once
  // engagement is signed.
  locked?: boolean;
};

const COMPANY_NUMBER_RE = /^(?:\d{8}|[A-Za-z]{2}\d{6})$/;
const COMPANY_NUMBER_MSG =
  "Company number must be 8 digits, or 2 letters followed by 6 digits (e.g. SC123456).";

// Debounce delay for the search input. 300ms is comfortable for typing
// without feeling laggy and keeps us well under the 600 req / 5 min
// Companies House rate limit even with aggressive typing.
const DEBOUNCE_MS = 300;

export function CompanyLookup({
  initial,
  onPick,
  onClear,
  busy,
  locked,
}: Props) {
  // "selected" is the active pick. When set the widget shows the locked
  // panel with Change. When null we show either the search (default) or
  // manual-entry (if the user clicked "Enter manually" or the API is in
  // fallback mode).
  //
  // We mirror `initial` into local state so the pick responds instantly
  // on click without waiting for the server round-trip. React's "adjust
  // state during render" pattern (preferred over an effect) keeps the
  // widget in sync when the parent re-renders with a saved value — the
  // sentinel ref holds the last initial we've reconciled so we don't
  // bounce the user's local pick on an unrelated re-render.
  const [selected, setSelected] = useState<CompanyPick | null>(initial);
  const [lastInitial, setLastInitial] = useState<CompanyPick | null>(initial);
  if (!pickEq(lastInitial, initial)) {
    setLastInitial(initial);
    setSelected(initial);
  }
  const [mode, setMode] = useState<"search" | "manual">("search");
  // Fallback latches to true if the API ever returns 503 — once we've
  // seen an outage, don't keep hitting it in the same session; drop
  // straight into manual mode.
  const [fallback, setFallback] = useState<boolean>(false);

  const inputId = useId();
  const listboxId = useId();

  const [query, setQuery] = useState<string>("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [open, setOpen] = useState<boolean>(false);

  const [manualName, setManualName] = useState<string>("");
  const [manualNumber, setManualNumber] = useState<string>("");
  const [manualError, setManualError] = useState<string | null>(null);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length < 3) {
        setHits([]);
        setSearchError(null);
        setLoading(false);
        return;
      }
      if (abortRef.current) abortRef.current.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      setSearchError(null);
      try {
        const r = await fetch(
          `/api/companies-house/search?q=${encodeURIComponent(trimmed)}`,
          { signal: ac.signal, cache: "no-store" },
        );
        const json = await r.json();
        if (ac.signal.aborted) return;
        if (r.status === 503 && json?.fallback) {
          setFallback(true);
          setMode("manual");
          setOpen(false);
          setLoading(false);
          return;
        }
        if (!r.ok || json?.ok === false) {
          setSearchError(json?.error ?? "Search failed.");
          setHits([]);
          setLoading(false);
          return;
        }
        setHits((json.items as Hit[]) ?? []);
        setActiveIndex(-1);
        setLoading(false);
      } catch (err) {
        if (ac.signal.aborted) return;
        // Treat any thrown error as transient — show a tiny inline
        // message, don't flip to manual mode permanently.
        setSearchError(err instanceof Error ? err.message : "Search failed.");
        setLoading(false);
      }
    },
    [],
  );

  const onQueryChange = (v: string) => {
    setQuery(v);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSearch(v);
    }, DEBOUNCE_MS);
  };

  const choose = async (hit: Hit) => {
    setOpen(false);
    setQuery("");
    setHits([]);
    setActiveIndex(-1);
    const pick: CompanyPick = {
      company_number: hit.company_number,
      company_name: hit.company_name,
      company_status: hit.company_status,
    };
    setSelected(pick);
    await onPick(pick);
  };

  const submitManual = async () => {
    setManualError(null);
    const name = manualName.trim();
    const number = manualNumber.trim().toUpperCase();
    if (!name) {
      setManualError("Enter the company name.");
      return;
    }
    if (!COMPANY_NUMBER_RE.test(number)) {
      setManualError(COMPANY_NUMBER_MSG);
      return;
    }
    const pick: CompanyPick = {
      company_number: number,
      company_name: name,
      // Manual-entry can't verify status — mark unknown so downstream
      // code doesn't claim we checked.
      company_status: "unknown",
    };
    setSelected(pick);
    setManualName("");
    setManualNumber("");
    await onPick(pick);
  };

  const change = async () => {
    if (locked || busy) return;
    setSelected(null);
    setMode(fallback ? "manual" : "search");
    setQuery("");
    setHits([]);
    setManualName("");
    setManualNumber("");
    await onClear();
  };

  // ---- Rendered states ----

  if (selected) {
    return (
      <div className="rounded-xl border border-line bg-paper p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div
              className="text-[10px] font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Company
            </div>
            <div className="mt-1 text-base font-semibold text-ink">
              {selected.company_name}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate">
              <span
                className="rounded bg-cloud px-1.5 py-0.5 font-semibold text-ink"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {selected.company_number}
              </span>
              <StatusPill status={selected.company_status} />
            </div>
          </div>
          {locked ? (
            <span
              className="text-[10px] font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Locked
            </span>
          ) : (
            <button
              type="button"
              onClick={change}
              disabled={busy}
              className="text-xs font-semibold text-navy-deep underline underline-offset-4 hover:text-sky disabled:opacity-50"
            >
              Change
            </button>
          )}
        </div>
        {selected.company_status &&
        selected.company_status.toLowerCase() !== "active" &&
        selected.company_status.toLowerCase() !== "unknown" ? (
          <div
            role="alert"
            className="mt-3 rounded-lg border px-3 py-2 text-xs"
            style={{
              background: "rgba(217,159,25,0.10)",
              borderColor: "rgba(217,159,25,0.45)",
              color: "#8a5c05",
            }}
          >
            Companies House lists this company as{" "}
            <strong>{labelFor(selected.company_status)}</strong>. We can&apos;t
            typically act for companies that aren&apos;t active. If this is
            wrong, pick a different company, enter it manually, or contact
            support.
          </div>
        ) : null}
        {locked ? (
          <p className="mt-3 text-[11px] text-slate">
            Captured when you signed the engagement letter. Contact support
            if this needs changing.
          </p>
        ) : null}
      </div>
    );
  }

  if (mode === "manual") {
    return (
      <div className="rounded-xl border border-line bg-paper p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div
              className="text-[10px] font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Enter company details manually
            </div>
          </div>
          {fallback ? null : (
            <button
              type="button"
              onClick={() => setMode("search")}
              disabled={busy}
              className="text-xs font-semibold text-navy-deep underline underline-offset-4 hover:text-sky disabled:opacity-50"
            >
              Search Companies House instead
            </button>
          )}
        </div>
        {fallback ? (
          <p className="mt-2 text-[11px] text-slate">
            Companies House search is unavailable right now. Enter the
            details manually and we&apos;ll verify them later.
          </p>
        ) : null}

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_200px]">
          <label className="block">
            <span
              className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Company name
            </span>
            <input
              type="text"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              className="input-sl"
              autoComplete="organization"
            />
          </label>
          <label className="block">
            <span
              className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Company number
            </span>
            <input
              type="text"
              value={manualNumber}
              onChange={(e) => setManualNumber(e.target.value)}
              className="input-sl uppercase"
              placeholder="e.g. 12345678 or SC123456"
              maxLength={8}
            />
          </label>
        </div>

        {manualError ? (
          <p className="mt-2 text-xs font-medium text-red-700" role="alert">
            {manualError}
          </p>
        ) : null}

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={submitManual}
            disabled={busy}
            className="btn-sl btn-sl-primary w-full sm:w-auto"
          >
            {busy ? "Saving…" : "Use these details"}
          </button>
        </div>
      </div>
    );
  }

  // Search mode (default)
  const activeHit = activeIndex >= 0 ? hits[activeIndex] : null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(-1, i - 1));
    } else if (e.key === "Enter") {
      if (activeHit) {
        e.preventDefault();
        void choose(activeHit);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <label htmlFor={inputId} className="block">
        <span
          className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Find your company
        </span>
        <input
          id={inputId}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={() => {
            if (query.trim().length >= 3) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search by name or 8-character company number"
          className="input-sl"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          autoComplete="off"
        />
      </label>

      {open && query.trim().length >= 3 ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 z-20 mt-1 max-h-80 overflow-auto rounded-xl border border-line bg-white shadow-[0_12px_32px_-14px_rgba(15,30,77,0.25)]"
        >
          {loading ? (
            <div className="px-4 py-3 text-xs text-slate">Searching…</div>
          ) : searchError ? (
            <div className="px-4 py-3 text-xs font-medium text-red-700">
              {searchError}
            </div>
          ) : hits.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate">
              No matches.{" "}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setMode("manual");
                }}
                className="font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
              >
                Enter manually
              </button>
            </div>
          ) : (
            <ul>
              {hits.map((h, i) => (
                <li
                  key={`${h.company_number}-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                >
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => void choose(h)}
                    className={
                      "flex w-full items-start justify-between gap-3 px-4 py-2.5 text-left transition " +
                      (i === activeIndex ? "bg-cloud" : "hover:bg-cloud")
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink">
                        {h.company_name}
                      </div>
                      {h.address_snippet ? (
                        <div className="mt-0.5 truncate text-[11px] text-slate">
                          {h.address_snippet}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span
                        className="rounded bg-cloud px-1.5 py-0.5 text-[11px] font-semibold text-ink"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        {h.company_number}
                      </span>
                      <StatusPill status={h.company_status} size="xs" />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate">
        <span>Type at least 3 characters, or paste a company number.</span>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setMode("manual");
          }}
          className="font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
        >
          Can&apos;t find it? Enter manually
        </button>
      </div>
    </div>
  );
}

function labelFor(status: string): string {
  const map: Record<string, string> = {
    active: "Active",
    dissolved: "Dissolved",
    liquidation: "In liquidation",
    receivership: "In receivership",
    administration: "In administration",
    "voluntary-arrangement": "Voluntary arrangement",
    "insolvency-proceedings": "Insolvency proceedings",
    "converted-closed": "Converted / closed",
    removed: "Removed",
    open: "Open",
    closed: "Closed",
    registered: "Registered",
    unknown: "Unverified",
  };
  return map[status.toLowerCase()] ?? status.replace(/-/g, " ");
}

function StatusPill({
  status,
  size = "sm",
}: {
  status: string;
  size?: "xs" | "sm";
}) {
  const s = status.toLowerCase();
  let bg = "rgba(15,30,77,0.08)";
  let color = "var(--navy-deep)";
  if (s === "active") {
    bg = "rgba(19,217,160,0.14)";
    color = "#0E9E77";
  } else if (
    s === "dissolved" ||
    s === "liquidation" ||
    s === "receivership"
  ) {
    bg = "rgba(220,38,38,0.10)";
    color = "#B91C1C";
  } else if (
    s === "administration" ||
    s === "voluntary-arrangement" ||
    s === "insolvency-proceedings" ||
    s === "unknown"
  ) {
    bg = "rgba(217,159,25,0.14)";
    color = "#8a5c05";
  }
  return (
    <span
      className={
        (size === "xs" ? "text-[10px] " : "text-[11px] ") +
        "rounded-full px-1.5 py-0.5 font-bold uppercase tracking-wider"
      }
      style={{ background: bg, color, fontFamily: "var(--font-mono)" }}
    >
      {labelFor(status)}
    </span>
  );
}
