// Shared top block for every signed-in-portal page — eyebrow + h1 +
// optional description. Pages emit this inside the portal layout, which
// supplies the sidebar + top bar.

export function PortalPageHeader({
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
