import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Avatar } from "@/components/avatar";

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

// Page size for the clients list. 25 is small enough that the
// in-memory group-by (active vs suspended) stays trivial and large
// enough that admin isn't paginating constantly for the common case.
const PAGE_SIZE = 25;

export default async function AdminClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  await requireRole("admin");
  const admin = createAdminClient();

  const { page: pageRaw, q: qRaw } = await searchParams;
  const pageParam = Number(pageRaw ?? "1");
  const page =
    Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  // Trim and cap search length defensively; ilike with a huge needle
  // just wastes DB time. 100 chars is more than any real email.
  const q = (qRaw ?? "").trim().slice(0, 100);

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // Build the users query. Email ilike for search; the client_profiles
  // name search would require a two-step round trip and the email is
  // sufficient for admin triage (clients are listed by their account
  // identity on the auth side). If name search becomes essential we'd
  // add a text-search index on client_profiles.name and query it
  // separately for the first page's user ids.
  let usersQuery = admin
    .from("users")
    .select("id, email, status, created_at", { count: "exact" })
    .eq("role", "client");
  if (q) {
    usersQuery = usersQuery.ilike("email", `%${q}%`);
  }
  const { data: users, count: totalCount } = await usersQuery
    .order("created_at", { ascending: false })
    .range(from, to);

  const rows = (users ?? []) as UserRow[];
  const total = totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const visibleIds = rows.map((r) => r.id);

  // Only fetch profiles + case counts for the users actually on this
  // page. Previously these were full-table pulls (every profile row,
  // every case row), which stops being free as the data grows.
  const [{ data: profiles }, { data: cases }] = visibleIds.length
    ? await Promise.all([
        admin
          .from("client_profiles")
          .select("user_id, name, contact_number, avatar_path")
          .in("user_id", visibleIds),
        admin
          .from("cases")
          .select("client_id")
          .in("client_id", visibleIds),
      ])
    : [{ data: [] as ProfileRow[] }, { data: [] as { client_id: string }[] }];

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

  const groups = {
    active: rows.filter((r) => r.status !== "suspended"),
    suspended: rows.filter((r) => r.status === "suspended"),
  };

  const qParam = q ? `&q=${encodeURIComponent(q)}` : "";
  const prevHref = page > 1 ? `?page=${page - 1}${qParam}` : null;
  const nextHref = page < pageCount ? `?page=${page + 1}${qParam}` : null;

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="Clients"
        description="Every client on the platform. Click through for full profile, case history, and payments."
      />

      <form className="mb-6 flex flex-wrap items-center gap-2" method="get">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by email."
          className="input-sl flex-1 min-w-0 sm:max-w-xs"
          aria-label="Search clients by email"
        />
        <button
          type="submit"
          className="rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink hover:border-sky/50"
        >
          Search
        </button>
        {q ? (
          <Link
            href="?"
            className="rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-slate hover:border-sky/50"
          >
            Clear
          </Link>
        ) : null}
      </form>

      <p className="mb-3 text-xs text-slate">
        {total === 0
          ? q
            ? `No clients match "${q}".`
            : "No clients yet."
          : `Showing ${from + 1}–${Math.min(to + 1, total)} of ${total}${q ? ` for "${q}"` : ""}.`}
      </p>

      <Section
        title={`Active (${groups.active.length})`}
        emptyLine="No active clients on this page."
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

      {pageCount > 1 ? (
        <nav
          className="mt-6 flex items-center justify-between gap-3"
          aria-label="Pagination"
        >
          {prevHref ? (
            <Link
              href={prevHref}
              className="rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink hover:border-sky/50"
            >
              &larr; Prev
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-slate">
            Page {page} of {pageCount}
          </span>
          {nextHref ? (
            <Link
              href={nextHref}
              className="rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink hover:border-sky/50"
            >
              Next &rarr;
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
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
            {profile?.contact_number ? <> &middot; {profile.contact_number}</> : null}
            <> &middot; {caseCount} case{caseCount === 1 ? "" : "s"}</>
          </div>
        </div>
      </div>
    </li>
  );
}
