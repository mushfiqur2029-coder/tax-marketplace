import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard-shell";
import { Bell } from "@/components/bell";
import { SEGMENTS } from "@/lib/segments";
import { createCaseAction } from "@/app/client/actions";
import { NewCaseForm } from "./new-case-form";

export default async function NewCasePage() {
  const me = await requireRole("client");

  return (
    <DashboardShell
      eyebrow="New tax return"
      title="Pick your situation and plan"
      description="One flat fee, no surprises. Every plan includes a qualified accountant and our accuracy guarantee."
      name={me.name}
      email={me.email}
      role={me.role}
      bell={<Bell userId={me.id} role={me.role} />}
    >
      <NewCaseForm segments={SEGMENTS} action={createCaseAction} />
      <p className="mt-8 text-sm text-slate">
        Changed your mind?{" "}
        <Link href="/client" className="font-semibold text-navy-deep underline underline-offset-4 hover:text-sky">
          Back to your dashboard
        </Link>
      </p>
    </DashboardShell>
  );
}
