import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DashboardShell } from "@/components/dashboard-shell";
import { Bell } from "@/components/bell";
import { Avatar } from "@/components/avatar";
import { AdminNav } from "@/app/admin/admin-nav";
import { getAdminNavCounts } from "@/app/admin/admin-counts";

export const dynamic = "force-dynamic";

type ProfileRow = {
  user_id: string;
  name: string | null;
  contact_number: string | null;
  avatar_path: string | null;
};

type UserRow = {
  id: string;
  email: string;
  status: "active" | "warned" | "suspended";
};

export default async function AdminClientsPage() {
  const me = await requireRole("admin");
  const admin = createAdminClient();

  const [{ data: users }, { data: profiles }, { data: cases }, navCounts] =
    await Promise.all([
      admin
        .from("users")
        .select("id, email, status, created_at")
        .eq("role", "client")
        .order("created_at", { ascending: false }),
      admin
        .from("client_profiles")
        .select("user_id, name, contact_number, avatar_path"),
      admin
        .from("cases")
        .select("client_id"),
      getAdminNavCounts(),
    ]);

  const profileById = new Map<string, ProfileRow>(
    (profiles ?? []).map((p) => [p.user_id, p as ProfileRow]),
  );
  const caseCountByClient = new Map<string, number>();
  for (const c of cases ?? []) {
    caseCountByClient.set(
      c.client_id,
      (caseCountByClient.get(c.client_id) ?? 0) + 1,
    );
  }

  const rows = (users ?? []) as UserRow[];
  const groups = {
    active: rows.filter((r) => r.status !== "suspended"),
    suspended: rows.filter((r) => r.status === "suspended"),
  };

  return (
    <DashboardShell
      eyebrow="Admin console"
      title="Clients"
      description="Every client on the platform. Click through for full profile, case history, and payments."
      name={me.name}
      email={me.email}
      role={me.role}
      subnav={<AdminNav active="clients" counts={navCounts} />}
      bell={<Bell userId={me.id} role={me.role} />}
    >
      <Section
        title={`Active (${groups.active.length})`}
        emptyLine="No active clients."
      >
        {groups.active.map((r) => (
          <RowCard
            key={r.id}
            user={r}
            profile={profileById.get(r.id)}
            caseCount={caseCountByClient.get(r.id) ?? 0}
          />
        ))}
      </Section>

      {groups.suspended.length > 0 ? (
        <Section
          title={`Suspended (${groups.suspended.length})`}
          emptyLine=""
        >
          {groups.suspended.map((r) => (
            <RowCard
              key={r.id}
              user={r}
              profile={profileById.get(r.id)}
              caseCount={caseCountByClient.get(r.id) ?? 0}
            />
          ))}
        </Section>
      ) : null}
    </DashboardShell>
  );
}

function Section({
  title,
  emptyLine,
  children,
}: {
  title: string;
  emptyLine: string;
  children: React.ReactNode;
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
        <ul className="grid gap-3">{childArr}</ul>
      ) : emptyLine ? (
        <p className="card-sl border-dashed p-6 text-center text-sm text-slate">
          {emptyLine}
        </p>
      ) : null}
    </section>
  );
}

function RowCard({
  user,
  profile,
  caseCount,
}: {
  user: UserRow;
  profile?: ProfileRow;
  caseCount: number;
}) {
  const isSuspended = user.status === "suspended";
  return (
    <li>
      <div className="card-sl flex flex-wrap items-center gap-4 p-5">
        <Avatar
          path={profile?.avatar_path ?? null}
          name={profile?.name ?? null}
          email={user.email}
          size={44}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/admin/clients/${user.id}`}
              className="text-sm font-semibold text-ink hover:text-sky"
            >
              {profile?.name ?? user.email}
            </Link>
            {isSuspended ? (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                style={{
                  background: "rgba(220,38,38,0.10)",
                  color: "#B91C1C",
                  fontFamily: "var(--font-mono)",
                }}
              >
                Suspended
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-slate">
            {user.email}
            {profile?.contact_number ? <> · {profile.contact_number}</> : null}
            <> · {caseCount} case{caseCount === 1 ? "" : "s"}</>
          </div>
        </div>
      </div>
    </li>
  );
}
