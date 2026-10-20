"use client";

import { useMemo, useState } from "react";

// Same instant client-side search idea as AdminSearchFilter, but for the
// one admin list page that renders a <table> instead of a card list
// (admin/pch). Takes the already-built <thead> and a flat list of
// pre-rendered <tr> rows plus their search text, and owns the table
// shell + search box so the page component just supplies rows.

export function AdminTableFilter({
  thead,
  rows,
  colSpan,
  placeholder,
  ariaLabel,
  emptyLine,
  noMatchesLine = "No matches for that search.",
}: {
  thead: React.ReactNode;
  rows: { searchText: string; node: React.ReactNode }[];
  colSpan: number;
  placeholder: string;
  ariaLabel: string;
  emptyLine: string;
  noMatchesLine?: string;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      needle
        ? rows.filter((r) => r.searchText.toLowerCase().includes(needle))
        : rows,
    [rows, needle],
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
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
      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          {thead}
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="py-8 px-3 text-center text-slate-500 text-sm">
                  {emptyLine}
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="py-8 px-3 text-center text-slate-500 text-sm">
                  {noMatchesLine}
                </td>
              </tr>
            ) : (
              filtered.map((r) => r.node)
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
