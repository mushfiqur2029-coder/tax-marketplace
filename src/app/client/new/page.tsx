import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { PortalPageHeader } from "@/components/portal-page-header";
import { ClientSuspensionBanner } from "@/app/client/suspension-banner";
import { redirect } from "next/navigation";
import { createCaseAction } from "@/app/client/actions";
import {
  earliestStandardDeadline,
  earliestUrgentDeadline,
  URGENT_FEE_PENCE,
} from "@/lib/working-days";
import {
  getPersonalTiers,
  getCompanyTiers,
} from "@/lib/service-catalog";
import { NewCaseForm, type PersonalHint } from "./new-case-form";

type Mode = "personal" | "company";

const HINT_KEYS: PersonalHint[] = [
  "first-time-filers",
  "self-employed",
  "landlords",
  "investors",
  "high-earners",
  "cis-construction",
];

export default async function NewCasePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; hint?: string }>;
}) {
  const me = await requireRole("client");
  // Suspended clients can't start new cases; kick them back to their
  // dashboard where the banner explains the state.
  if (me.status === "suspended") redirect("/client");

  const sp = await searchParams;
  const initialMode: Mode | null =
    sp.mode === "personal" || sp.mode === "company" ? sp.mode : null;
  const hint: PersonalHint | null =
    sp.hint && (HINT_KEYS as string[]).includes(sp.hint)
      ? (sp.hint as PersonalHint)
      : null;

  // Compute earliest standard + urgent deadlines server-side (Europe/London,
  // UK bank holidays excluded). The Personal step 3 picker uses these for
  // its `min` and for the helper copy — client clocks can't move the gate.
  const [earliestStandard, earliestUrgent, personalTiers, companyTiers] =
    await Promise.all([
      earliestStandardDeadline(),
      earliestUrgentDeadline(),
      getPersonalTiers(),
      getCompanyTiers(),
    ]);

  return (
    <>
      <PortalPageHeader
        eyebrow="New tax return"
        title="Pick your situation"
        description="One flat fee, no surprises. Every service includes a qualified accountant and our accuracy guarantee."
      />
      <ClientSuspensionBanner />
      <NewCaseForm
        action={createCaseAction}
        initialMode={initialMode}
        hint={hint}
        earliestStandard={earliestStandard}
        earliestUrgent={earliestUrgent}
        urgentFeePence={URGENT_FEE_PENCE}
        personalTiers={personalTiers}
        companyTiers={companyTiers}
      />
      <p className="mt-8 text-sm text-slate">
        Changed your mind?{" "}
        <Link href="/client" className="font-semibold text-navy-deep underline underline-offset-4 hover:text-sky">
          Back to your dashboard
        </Link>
      </p>
    </>
  );
}
