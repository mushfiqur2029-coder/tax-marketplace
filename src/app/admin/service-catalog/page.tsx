import { requireRole } from "@/lib/auth";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { getAllTiers } from "@/lib/service-catalog";
import { updateServiceCatalogAction } from "@/app/admin/actions";
import { ServiceCatalogRow } from "./service-catalog-row";

export const dynamic = "force-dynamic";

export default async function AdminServiceCatalogPage() {
  await requireRole("admin");

  // Admin needs the full picture — inactive + admin-only tiers too.
  // The wizard filters inactive out at render time; this page is the
  // only surface where admin can bring one back.
  const all = await getAllTiers({
    includeInactive: true,
    includeAdminCreateOnly: true,
  });

  const personal = all.filter((t) => t.group === "personal");
  const company = all.filter((t) => t.group === "company");

  const update = updateServiceCatalogAction;

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="Service catalog"
        description="Edit the display copy + price for every service the client wizard and marketing site sells. New tiers still need a code change — this page only edits what's already here. Price edits do NOT affect existing cases: every case snapshots its fee at creation (cases.custom_fee_pence)."
      />

      <div className="space-y-10">
        <Section title={`Personal (${personal.length})`}>
          {personal.map((t) => (
            <ServiceCatalogRow key={t.id} tier={t} update={update} />
          ))}
        </Section>

        <Section title={`Limited Company (${company.length})`}>
          {company.map((t) => (
            <ServiceCatalogRow key={t.id} tier={t} update={update} />
          ))}
        </Section>
      </div>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2
        className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {title}
      </h2>
      <ul className="grid gap-3">
        {Array.isArray(children)
          ? children.map((child, i) => <li key={i}>{child}</li>)
          : <li>{children}</li>}
      </ul>
    </section>
  );
}
