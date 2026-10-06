import { requireRole, PRIMARY_ADMIN_EMAIL } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAdminAction, removeAdminAction } from "@/app/admin/actions";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { formatDateTime } from "@/lib/format";
import { AddAdminForm } from "./add-admin-form";
import { RemoveAdminButton } from "./remove-admin-button";

export const dynamic = "force-dynamic";

export default async function AdminAdminsPage() {
  const me = await requireRole("admin");
  const admin = createAdminClient();
  // Only the primary admin can remove other admins. The server action
  // also enforces this; the UI gate is just so the Remove button
  // doesn't show for non-primary admins.
  const callerIsPrimary =
    me.email.toLowerCase() === PRIMARY_ADMIN_EMAIL;

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
  const remove = async (targetUserId: string) => {
    "use server";
    return removeAdminAction(targetUserId);
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
            {(admins ?? []).map((a) => {
              const isPrimary = a.email.toLowerCase() === PRIMARY_ADMIN_EMAIL;
              return (
                <li key={a.id} className="card-sl p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-ink">
                          {a.email}
                        </span>
                        {isPrimary ? (
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                            style={{
                              background:
                                "linear-gradient(135deg, rgba(25,156,217,0.14), rgba(19,217,160,0.14))",
                              color: "var(--navy-deep)",
                              fontFamily: "var(--font-mono)",
                            }}
                            title="Permanent primary admin. Cannot be removed or demoted."
                          >
                            Primary
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-xs text-slate">
                        Added {formatDateTime(a.created_at)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
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
                      {callerIsPrimary && !isPrimary ? (
                        <RemoveAdminButton
                          targetUserId={a.id}
                          targetEmail={a.email}
                          removeAdmin={remove}
                        />
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
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
