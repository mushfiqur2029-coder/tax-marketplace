"use client";

import { useMemo, useState } from "react";
import { AdminListSection } from "./admin-list-section";

// Instant, client-side search box for admin list pages. The server
// component does its usual full fetch + render (these lists are small
// enough today that an unbounded fetch is fine - see the audit note on
// pagination for when that stops being true) and hands this component
// the already-rendered row nodes grouped by section, plus a plain-text
// field to match against per row. Filtering happens in the browser with
// no round trip, mirroring the UX of the clients-list search bar without
// needing every page to grow its own ?q= server round trip.

export type AdminSearchItem = {
  // Lowercased match text is computed internally; pass the raw text.
  searchText: string;
  node: React.ReactNode;
};

export type AdminSearchGroup = {
  key: string;
  title: string;
  emptyLine?: string;
  // Precomputed by the caller: omit this whole group regardless of the
  // search text (e.g. accountants' "Rejected" section only shows up once
  // at least one rejection has ever happened).
  hidden?: boolean;
  items: AdminSearchItem[];
};

export function AdminSearchFilter({
  groups,
  placeholder,
  ariaLabel,
  noMatchesLine = "No matches for that search.",
}: {
  groups: AdminSearchGroup[];
  placeholder: string;
  ariaLabel: string;
  noMatchesLine?: string;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();

  const visibleGroups = groups.filter((g) => !g.hidden);
  const filteredGroups = useMemo(() => {
    if (!needle) return visibleGroups;
    return visibleGroups.map((g) => ({
      ...g,
      items: g.items.filter((i) => i.searchText.toLowerCase().includes(needle)),
    }));
    // visibleGroups is derived fresh each render from groups/needle inputs;
    // including it would just re-run this every render anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, needle]);

  const totalShown = filteredGroups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="input-sl flex-1 min-w-0 sm:max-w-xs"
          aria-label={ariaLabel}
        />
        {q ? (
          <button
            type="button"
            onClick={() => setQ("")}
            className="rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-slate hover:border-sky/50"
          >
            Clear
          </button>
        ) : null}
      </div>
      {needle && totalShown === 0 ? (
        <p className="card-sl border-dashed p-6 text-center text-sm text-slate">
          {noMatchesLine}
        </p>
      ) : (
        filteredGroups.map((g) => (
          <AdminListSection
            key={g.key}
            title={`${g.title} (${g.items.length})`}
            emptyLine={g.emptyLine}
          >
            {g.items.map((i) => i.node)}
          </AdminListSection>
        ))
      )}
    </>
  );
}
