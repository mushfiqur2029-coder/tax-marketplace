// Shared "titled list with an empty state" wrapper used across admin
// list pages (accountants, enquiries, clients all had byte-identical
// copies of this; service-catalog had a slightly simpler variant).
// Renders a section eyebrow heading, then either the children as a
// card-list <ul>, or a dashed empty-state line when there's nothing
// to show.

import type { ReactNode } from "react";

export function AdminListSection({
  title,
  emptyLine,
  wrapInLi = false,
  children,
}: {
  title: string;
  emptyLine?: string;
  // Each child is already an <li> in most call sites (the row component
  // renders its own <li> root). Set this when the row component instead
  // renders a <div> (e.g. ServiceCatalogRow) so the section wraps it.
  wrapInLi?: boolean;
  children: ReactNode;
}) {
  const childArr = Array.isArray(children) ? children : [children];
  const hasAny = childArr.filter(Boolean).length > 0;
  return (
    <section className="mb-10">
      <h2
        className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {title}
      </h2>
      {hasAny ? (
        <ul className="grid gap-3">
          {wrapInLi
            ? childArr.map((child, i) => <li key={i}>{child}</li>)
            : childArr}
        </ul>
      ) : emptyLine ? (
        <p className="card-sl border-dashed p-6 text-center text-sm text-slate">
          {emptyLine}
        </p>
      ) : null}
    </section>
  );
}
