import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  approveAddonAction,
  rejectAddonAction,
} from "@/app/admin/actions";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { formatDateTime } from "@/lib/format";
import { ReviewActions } from "@/app/admin/profile-changes/review-actions";

export const dynamic = "force-dynamic";

const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;

export default async function AdminAddonRequestsPage() {
  await requireRole("admin");
  const admin = createAdminClient();

  // Only custom add-ons ever enter admin review. Presets go straight to
  // pending_payment at insert. Include reviewed rows in a second section
  // so admins can see history + the reviewer's note.
  const { data: rows } = await admin
    .from("case_addons")
    .select(
      "id, case_id, accountant_id, kind, description, amount_pence, status, review_note, created_at, reviewed_at, reviewed_by",
    )
    .eq("kind", "custom")
    .order("created_at", { ascending: false });

  const all = rows ?? [];
  const pending = all.filter((r) => r.status === "pending_admin");
  const reviewed = all.filter((r) => r.status !== "pending_admin");

  // Fetch accountant emails so the queue is readable at a glance.
  const accountantIds = Array.from(
    new Set(all.map((r) => r.accountant_id).filter(Boolean)),
  );
  const { data: accountants } = accountantIds.length
    ? await admin.from("users").select("id, email").in("id", accountantIds)
    : { data: [] as { id: string; email: string }[] };
  const accEmail = new Map((accountants ?? []).map((a) => [a.id, a.email]));

  const approve = async (id: string, note: string | null) => {
    "use server";
    return approveAddonAction(id, note);
  };
  const reject = async (id: string, note: string | null) => {
    "use server";
    return rejectAddonAction(id, note);
  };

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="Add-on requests"
        description="Custom add-ons that need approval before the client sees them. Preset add-ons skip review and go straight to the client."
      />
      <section className="mb-10">
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Pending ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="card-sl border-dashed p-6 text-center text-sm text-slate">
            No pending add-on requests.
          </p>
        ) : (
          <ul className="grid gap-3">
            {pending.map((r) => (
              <li key={r.id} className="card-sl p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-ink">
                    {accEmail.get(r.accountant_id) ?? r.accountant_id}
                  </span>
                  <span
                    className="text-lg font-bold text-ink"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {money(r.amount_pence)}
                  </span>
                  <Link
                    href={`/admin/cases/${r.case_id}`}
                    className="text-xs font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
                  >
                    View case
                  </Link>
                  <span className="ml-auto text-xs text-slate">
                    requested {formatDateTime(r.created_at)}
                  </span>
                </div>
                <p className="rounded-lg border border-line bg-cloud/40 p-3 text-sm text-ink">
                  {r.description}
                </p>
                <div className="mt-4">
                  <ReviewActions id={r.id} approve={approve} reject={reject} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Reviewed ({reviewed.length})
        </h2>
        {reviewed.length === 0 ? (
          <p className="card-sl border-dashed p-6 text-center text-sm text-slate">
            Nothing reviewed yet.
          </p>
        ) : (
          <ul className="grid gap-2">
            {reviewed.slice(0, 30).map((r) => (
              <li
                key={r.id}
                className="card-sl flex items-center justify-between gap-3 p-4 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-ink">
                    {money(r.amount_pence)} ·{" "}
                    {accEmail.get(r.accountant_id) ?? r.accountant_id}
                  </div>
                  <div className="truncate text-xs text-slate">
                    {r.description}
                  </div>
                  <div className="text-[11px] text-slate">
                    reviewed{" "}
                    {r.reviewed_at ? formatDateTime(r.reviewed_at) : "."}
                    {r.review_note ? <> · &ldquo;{r.review_note}&rdquo;</> : null}
                  </div>
                </div>
                <StatusPill status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    pending_payment: {
      label: "Approved",
      bg: "rgba(19,217,160,0.14)",
      color: "#0E9E77",
    },
    paid: {
      label: "Paid",
      bg: "rgba(25,156,217,0.14)",
      color: "var(--sky)",
    },
    rejected: {
      label: "Rejected",
      bg: "rgba(220,38,38,0.12)",
      color: "#B91C1C",
    },
  };
  const cfg = map[status] ?? {
    label: status,
    bg: "rgba(15,30,77,0.08)",
    color: "var(--navy-deep)",
  };
  return (
    <span
      className="shrink-0 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
      style={{ background: cfg.bg, color: cfg.color, fontFamily: "var(--font-mono)" }}
    >
      {cfg.label}
    </span>
  );
}
