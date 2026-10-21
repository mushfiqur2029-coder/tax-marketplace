import { requireApprovedAccountant } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAllTiers } from "@/lib/service-catalog";
import { PortalPageHeader } from "@/components/portal-page-header";
import {
  AccountantDashboardLive,
  type Row,
} from "./accountant-dashboard-live";
import type {
  CasesView,
  UrgencyFilter,
  FeeFilter,
  DateFilter,
} from "./cases-filter";
import { AccountantSuspensionBanner } from "./suspension-banner";

export const dynamic = "force-dynamic";

export default async function AccountantDashboard({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    urgency?: string;
    fee?: string;
    date?: string;
  }>;
}) {
  const raw = await searchParams;
  const view: CasesView =
    raw.view === "queue" ||
    raw.view === "completed" ||
    raw.view === "pending" ||
    raw.view === "assigned"
      ? raw.view
      : "live";
  const urgency: UrgencyFilter =
    raw.urgency === "safe" || raw.urgency === "soon" || raw.urgency === "urgent"
      ? raw.urgency
      : "all";
  const fee: FeeFilter =
    raw.fee === "under_300" ||
    raw.fee === "300_to_600" ||
    raw.fee === "over_600"
      ? raw.fee
      : "all";
  const date: DateFilter =
    raw.date === "7d" || raw.date === "30d" || raw.date === "90d"
      ? raw.date
      : "all";

  const me = await requireApprovedAccountant();
  const supabase = await createClient();

  // Queue filter: paid cases with no accountant assigned, regardless of
  // whether onboarding is submitted yet. Batch 3 originally gated the
  // limited-company carve-out on onboarding_submitted_at (accountant
  // waits for the client to finish Sections A/B/C/[D] before seeing the
  // case), but clients often need help filling that in, so we now
  // surface paid cases immediately. The card renders a "Onboarding in
  // progress" badge for limited-company cases without
  // onboarding_submitted_at so the accountant knows the case isn't yet
  // a fully-populated, ready-to-work queue entry.
  const [queueRes, mineRes] = await Promise.all([
    supabase
      .from("cases")
      .select(
        "id, segment, tier, status, stripe_payment_status, submitted_at, created_at, accountant_id, deadline, is_urgent, onboarding_submitted_at, intake_answers, custom_fee_pence",
      )
      .eq("status", "submitted")
      .eq("stripe_payment_status", "succeeded")
      .is("accountant_id", null)
      .order("submitted_at", { ascending: true }),
    supabase
      .from("cases")
      .select(
        "id, segment, tier, status, stripe_payment_status, submitted_at, created_at, accountant_id, deadline, is_urgent, onboarding_submitted_at, intake_answers, custom_fee_pence",
      )
      .eq("accountant_id", me.id)
      .order("created_at", { ascending: false }),
  ]);

  let queue = (queueRes.data ?? []) as Row[];
  const mine = (mineRes.data ?? []) as Row[];

  const tiers = await getAllTiers({ includeInactive: true, includeAdminCreateOnly: true });
  const tierEntries = tiers.map((t) => [t.id as string, t] as const);

  // Effective-deadline map used for the urgency sort below. For PCH
  // automated cases the HMRC filing deadline comes from the engine's
  // deadlinesForYear() (31 January after the tax year end); other
  // tiers fall back to cases.deadline (the client-chosen filing-by
  // date). Cases with no deadline at all are pushed to the back.
  //
  // The same query also carries engine_snapshot_at so the queue card
  // can render an "Intake in progress" badge on PCH cases where the
  // client paid but hasn't clicked Submit for review yet. Mirrors the
  // LC "Onboarding in progress" badge further down.
  const pchIds = [...queue, ...mine]
    .filter((c) => c.tier === "uber_phv_automated")
    .map((c) => c.id);
  const pchTaxYearEntries: Array<[string, string]> = [];
  const pchIntakeReadyEntries: Array<[string, boolean]> = [];
  if (pchIds.length > 0) {
    // Use the service-role client here. The RLS policy on pch_cases
    // (migration 0080) only lets an accountant SELECT when they are
    // ALREADY the assigned accountant (or the client). Queue cases are
    // by definition unassigned, so the session-authenticated client
    // would come back empty for every queued PCH id and the filter
    // below would drop every queued PCH case from view (silent empty
    // queue, no error). We only read two derived flags here (tax_year
    // for deadline sort, engine_snapshot_at for the submit-for-review
    // gate), so bypassing RLS for this lookup is scoped and safe.
    const admin = createAdminClient();
    const { data: pchHeads } = await admin
      .from("pch_cases")
      .select("case_id, tax_year, engine_snapshot_at")
      .in("case_id", pchIds);
    for (const h of pchHeads ?? []) {
      if (h.tax_year) pchTaxYearEntries.push([h.case_id as string, h.tax_year as string]);
      pchIntakeReadyEntries.push([h.case_id as string, !!h.engine_snapshot_at]);
    }
  }
  // A PCH case hits status='submitted' the moment Stripe confirms
  // payment, before the client has done anything beyond paying. It
  // used to join the open queue immediately at that point (with an
  // "Intake in progress" badge below), but that put unworked, half-
  // empty cases in front of every accountant the second a client paid.
  // Now the queue itself waits for the client's explicit "Submit for
  // review" (which stamps engine_snapshot_at); until then the case is
  // still visible on the client's own dashboard and editable as
  // normal, it just doesn't show up here yet.
  //
  // Personal and Limited Company are deliberately different: those are
  // manual-prep tiers (not PCH's automated intake), the client often
  // needs the accountant's help filling in the checklist itself, so
  // those cases stay visible in the open queue the moment payment
  // lands, same as before, regardless of onboarding_submitted_at.
  const pchIntakeReadyMap = new Map(pchIntakeReadyEntries);
  queue = queue.filter(
    (c) => c.tier !== "uber_phv_automated" || pchIntakeReadyMap.get(c.id),
  );

  return (
    <>
      <PortalPageHeader
        eyebrow="Accountant workspace"
        title="Cases"
        description="Pick up new cases from the queue and track everything you're working on."
      />
      <AccountantSuspensionBanner />
      <AccountantDashboardLive
        meId={me.id}
        initialMine={mine}
        initialQueue={queue}
        pchTaxYears={pchTaxYearEntries}
        pchIntakeReady={pchIntakeReadyEntries}
        tierEntries={tierEntries as Array<[string, typeof tiers[number]]>}
        view={view}
        urgency={urgency}
        fee={fee}
        date={date}
      />
    </>
  );
}
