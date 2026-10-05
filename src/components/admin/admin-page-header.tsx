// Shared top block for every admin page — eyebrow + h1 + description.
// Replaces the per-page copy of this block that used to live inside
// DashboardShell when admin pages still used that shell. The admin
// layout provides the surrounding sidebar + main-area chrome, so the
// page just emits this header + its content.

export function AdminPageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-6 sm:mb-10">
      <span className="eyebrow">{eyebrow}</span>
      <h1
        className="mt-2 text-2xl sm:mt-3 sm:text-4xl"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {title}
      </h1>
      {description ? (
        <p className="mt-2 max-w-xl text-sm text-slate sm:text-base">
          {description}
        </p>
      ) : null}
    </div>
  );
}
