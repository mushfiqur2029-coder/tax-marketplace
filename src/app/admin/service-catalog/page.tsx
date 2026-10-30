import { requireRole, isPrimaryAdmin } from "@/lib/auth";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminListSection } from "@/components/admin/admin-list-section";
import { getAllTiers } from "@/lib/service-catalog";
import { updateServiceCatalogAction } from "@/app/admin/actions";
import { ServiceCatalogRow } from "./service-catalog-row";

export const dynamic = "force-dynamic";

export default async function AdminServiceCatalogPage() {
  const me = await requireRole("admin");
  const callerIsPrimary = isPrimaryAdmin(me);

  // Admin needs the full picture, inactive + admin-only tiers too.
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
        description="Edit the display copy + price for every service the client wizard and marketing site sells. New tiers still need a code change. This page only edits what's already here. Price and sale edits apply immediately to every pending (unpaid) case; already-paid cases are untouched because Stripe has captured the exact amount."
      />

      {!callerIsPrimary ? (
        <div
          role="status"
          className="mb-6 rounded-xl border px-4 py-3 text-sm"
          style={{
            background: "var(--color-info-bg)",
            borderColor: "var(--color-info-border)",
            color: "var(--navy-deep)",
          }}
        >
          Only the primary admin can edit the service catalog. You can view it below.
        </div>
      ) : null}

      <div className="space-y-10">
        <AdminListSection title={`Personal (${personal.length})`} wrapInLi>
          {personal.map((t) => (
            <ServiceCatalogRow key={t.id} tier={t} update={update} readOnly={!callerIsPrimary} />
          ))}
        </AdminListSection>

        <AdminListSection title={`Limited Company (${company.length})`} wrapInLi>
          {company.map((t) => (
            <ServiceCatalogRow key={t.id} tier={t} update={update} readOnly={!callerIsPrimary} />
          ))}
        </AdminListSection>
      </div>
    </>
  );
}
