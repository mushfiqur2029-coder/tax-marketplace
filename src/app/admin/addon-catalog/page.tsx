import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createAddonCatalogAction,
  updateAddonCatalogAction,
} from "@/app/admin/actions";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { CatalogRow } from "./catalog-row";
import { AddCatalogItemForm } from "./add-catalog-item-form";

export const dynamic = "force-dynamic";

export default async function AdminAddonCatalogPage() {
  await requireRole("admin");
  const admin = createAdminClient();

  // Active first, then inactive; alphabetical within each group.
  const { data: rows } = await admin
    .from("addon_catalog")
    .select("key, name, description, amount_pence, active, updated_at")
    .order("active", { ascending: false })
    .order("name", { ascending: true });

  const create = async (input: {
    key: string;
    name: string;
    description: string;
    amountPence: number;
  }) => {
    "use server";
    return createAddonCatalogAction(input);
  };

  const update = async (
    key: string,
    input: {
      name: string;
      description: string;
      amountPence: number;
      active: boolean;
    },
  ) => {
    "use server";
    return updateAddonCatalogAction(key, input);
  };

  const active = (rows ?? []).filter((r) => r.active);
  const inactive = (rows ?? []).filter((r) => !r.active);

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="Add-on catalog"
        description="Preset add-ons accountants can offer clients mid-case. Edits do not change historical add-ons. Existing case rows snapshot the price they were sold at."
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-8">
          <section>
            <h2
              className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Active ({active.length})
            </h2>
            {active.length === 0 ? (
              <p className="card-sl border-dashed p-6 text-center text-sm text-slate">
                No active add-ons. Add one on the right so accountants have
                something to pick from.
              </p>
            ) : (
              <ul className="grid gap-3">
                {active.map((r) => (
                  <li key={r.key}>
                    <CatalogRow row={r} update={update} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {inactive.length > 0 ? (
            <section>
              <h2
                className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Deactivated ({inactive.length})
              </h2>
              <ul className="grid gap-3">
                {inactive.map((r) => (
                  <li key={r.key}>
                    <CatalogRow row={r} update={update} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="card-sl h-fit p-6">
          <span className="eyebrow">Add a new add-on</span>
          <p className="mt-2 text-xs text-slate">
            The key is a stable identifier used internally. Use short lowercase
            slugs like <code className="rounded bg-cloud px-1 py-0.5 text-[10px] text-ink">extra_property</code>.
            You can&apos;t change it later.
          </p>
          <div className="mt-4">
            <AddCatalogItemForm create={create} />
          </div>
        </aside>
      </div>
    </>
  );
}
