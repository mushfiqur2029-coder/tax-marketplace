import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAdminAction } from "@/app/admin/actions";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { formatDateTime } from "@/lib/format";
import { AddAdminForm } from "./add-admin-form";

export const dynamic = "force-dynamic";

export default async function AdminAdminsPage() {
  await requireRole("admin");
  const admin = createAdminClient();

  const { data: admins } = await admin
    .from("users")
    .select("id, email, created_at, status")
    .eq("role", "admin")
    .order("created_at", { ascending: true });

  const create = async (input: {
    name: string;
    email: string;
    password: string;
  }) => {
    "use server";
    return createAdminAction(input);
  };

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="Sterling Ledger admins"
        description="Public registration only creates clients and accountants. Admin accounts are created here, by an existing admin."
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <section>
          <h2
            className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Current admins ({admins?.length ?? 0})
          </h2>
          <ul className="grid gap-3">
            {(admins ?? []).map((a) => (
              <li key={a.id} className="card-sl p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-ink">{a.email}</div>
                    <div className="text-xs text-slate">
                      Added {formatDateTime(a.created_at)}
                    </div>
                  </div>
                  <span
                    className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
                    style={{
                      background: "rgba(15,30,77,0.08)",
                      color: "var(--navy-deep)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    Admin
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <aside className="card-sl p-6">
          <span className="eyebrow">Add an admin</span>
          <p className="mt-2 text-xs text-slate">
            The new admin can sign in with the temporary password below and
            change it later from their profile.
          </p>
          <div className="mt-4">
            <AddAdminForm create={create} />
          </div>
          <p className="mt-4 text-[11px] text-slate">
            Bootstrap the very first admin via SQL. see{" "}
            <code className="rounded bg-cloud px-1 py-0.5 text-[10px] text-ink">supabase/README.md</code>
            .
          </p>
        </aside>
      </div>
    </>
  );
}
