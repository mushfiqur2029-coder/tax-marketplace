import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { setAccountantApprovalAction } from "@/app/admin/actions";
import { DashboardShell } from "@/components/dashboard-shell";
import { Avatar } from "@/components/avatar";
import { ApprovalActions } from "./approval-actions";
import { AdminNav } from "@/app/admin/admin-nav";
import { getAdminNavCounts } from "@/app/admin/admin-counts";

export const dynamic = "force-dynamic";

type Row = {
  user_id: string;
  name: string | null;
  contact_number: string | null;
  company_name: string | null;
  avatar_path: string | null;
  approval_status: "pending" | "approved" | "rejected";
};

export default async function AccountantsPage() {
  const me = await requireRole("admin");
  const admin = createAdminClient();

  const [{ data: profiles }, navCounts] = await Promise.all([
    admin
      .from("accountant_profiles")
      .select("user_id, name, contact_number, company_name, avatar_path, approval_status"),
    getAdminNavCounts(),
  ]);

  const rows = (profiles ?? []) as Row[];

  const emailById = new Map<string, string>();
  if (rows.length) {
    const { data: users } = await admin
      .from("users")
      .select("id, email")
      .in("id", rows.map((r) => r.user_id));
    for (const u of users ?? []) emailById.set(u.id, u.email);
  }

  // Case counts per accountant.
  const { data: cases } = await admin
    .from("cases")
    .select("accountant_id")
    .not("accountant_id", "is", null);
  const casesByAcc = new Map<string, number>();
  for (const c of cases ?? []) {
    if (c.accountant_id) {
      casesByAcc.set(c.accountant_id, (casesByAcc.get(c.accountant_id) ?? 0) + 1);
    }
  }

  const decide = async (
    accountantId: string,
    decision: "approved" | "rejected",
    note: string | null,
  ) => {
    "use server";
    await setAccountantApprovalAction(accountantId, decision, note);
  };

  const groups = {
    pending: rows.filter((r) => r.approval_status === "pending"),
    approved: rows.filter((r) => r.approval_status === "approved"),
    rejected: rows.filter((r) => r.approval_status === "rejected"),
  };

  return (
    <DashboardShell
      eyebrow="Admin console"
      title="Accountants"
      description="Approve new accountants and drill into any of them for full details."
      name={me.name}
      email={me.email}
      role={me.role}
      subnav={<AdminNav active="accountants" counts={navCounts} />}
    >
      <Section
        title={`Pending (${groups.pending.length})`}
        emptyLine="No accountants awaiting approval."
      >
        {groups.pending.map((r) => (
          <RowCard
            key={r.user_id}
            row={r}
            email={emailById.get(r.user_id) ?? ""}
            caseCount={casesByAcc.get(r.user_id) ?? 0}
            actions={<ApprovalActions accountantId={r.user_id} decide={decide} />}
          />
        ))}
      </Section>

      <Section
        title={`Approved (${groups.approved.length})`}
        emptyLine="No approved accountants yet."
      >
        {groups.approved.map((r) => (
          <RowCard
            key={r.user_id}
            row={r}
            email={emailById.get(r.user_id) ?? ""}
            caseCount={casesByAcc.get(r.user_id) ?? 0}
          />
        ))}
      </Section>

      {groups.rejected.length > 0 ? (
        <Section
          title={`Rejected (${groups.rejected.length})`}
          emptyLine=""
        >
          {groups.rejected.map((r) => (
            <RowCard
              key={r.user_id}
              row={r}
              email={emailById.get(r.user_id) ?? ""}
              caseCount={casesByAcc.get(r.user_id) ?? 0}
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
  row,
  email,
  caseCount,
  actions,
}: {
  row: Row;
  email: string;
  caseCount: number;
  actions?: React.ReactNode;
}) {
  return (
    <li>
      <div className="card-sl flex flex-wrap items-center gap-4 p-5">
        <Avatar
          path={row.avatar_path}
          name={row.name}
          email={email}
          size={44}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/admin/accountants/${row.user_id}`}
              className="text-sm font-semibold text-ink hover:text-sky"
            >
              {row.name ?? email}
            </Link>
            {row.company_name ? (
              <span className="text-xs text-slate">· {row.company_name}</span>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-slate">
            {email}
            {row.contact_number ? <> · {row.contact_number}</> : null}
            <> · {caseCount} case{caseCount === 1 ? "" : "s"}</>
          </div>
        </div>
        {actions}
      </div>
    </li>
  );
}
