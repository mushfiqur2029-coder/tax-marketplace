"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PERSONAL_TIERS,
  COMPANY_TIERS,
  type PlanTier,
  type TierId,
} from "@/lib/plans";
import { SLButton } from "@/components/sl-button";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  // On success the action redirects (never resolves normally). If it does
  // resolve, it returned an error which we render inline.
  action: (fd: FormData) => Promise<ActionResult>;
  // Pre-selected top-level mode from the URL (?mode=personal|company).
  // Marketing CTAs link straight into the right side so the user doesn't
  // have to click twice.
  initialMode?: Mode | null;
  // Soft hint keyed on the originating marketing page. Shown as an
  // info banner above the Personal tile grid; never auto-selects.
  hint?: PersonalHint | null;
};

type Mode = "personal" | "company";

// Keys match the marketing page slugs we route from.
export type PersonalHint =
  | "first-time-filers"
  | "self-employed"
  | "landlords"
  | "investors"
  | "high-earners"
  | "cis-construction";

const HINT_COPY: Record<PersonalHint, string> = {
  "first-time-filers":
    "First Self Assessment? Most first-timers pick Sole trader / self-employed or a Landlord option. All nine tiers include the same accurate preparation and accountant sign-off.",
  "self-employed":
    "Self-employed? Pick Sole trader / self-employed for general work, or one of the specialist tiers (Uber, delivery, CIS) if that fits closer.",
  landlords:
    "Letting UK property? Landlord (1-2 properties) covers most situations. Portfolio owners pick Landlord (multiple). Living overseas? Non-resident landlord handles NRLS.",
  investors:
    "Investment income or dividends? Freelancer / consultant covers dividends and side income. For foreign investment positions or treaty questions, pick Complex foreign / international.",
  "high-earners":
    "Higher-rate income from multiple sources? Freelancer / consultant fits most of these. If foreign residence or treaty questions apply, Complex foreign / international is the right pick.",
  "cis-construction":
    "CIS subcontractor filing? Pick CIS subcontractors. Most workers are owed a refund and we reconcile every deduction.",
};

export function NewCaseForm({ action, initialMode = null, hint = null }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(initialMode);
  const [tier, setTier] = useState<TierId | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTier = useMemo<PlanTier | null>(() => {
    if (!tier) return null;
    const pool = mode === "company" ? COMPANY_TIERS : PERSONAL_TIERS;
    return pool.find((t) => t.id === tier) ?? null;
  }, [mode, tier]);

  // When the user flips the top-level mode, clear the tier so the
  // wrong-side state can't leak into the form submission.
  const onPickMode = (next: Mode) => {
    setMode(next);
    setTier(null);
    setError(null);
  };

  const canSubmit = !!mode && !!tier;

  // Enquiry-only tiers (bespoke LC) don't create a case — they jump
  // straight to the enquiry form at /client/new/enquiry.
  const isEnquiryTier = !!selectedTier?.requiresEnquiry;

  // Resolve the segment server-side from the tier; the form only
  // needs to send mode + tier.
  const segmentId = mode === "company" ? "limited_company_vat" : "personal";

  return (
    <form
      action={async (fd) => {
        setError(null);
        if (isEnquiryTier && selectedTier) {
          router.push(
            `/client/new/enquiry?service=${encodeURIComponent(selectedTier.id)}`,
          );
          return;
        }
        setPending(true);
        const res = await action(fd);
        setPending(false);
        if (!res.ok) setError(res.error);
        // ok path: server action redirected before returning; nothing to do
      }}
      className="space-y-10"
    >
      <input type="hidden" name="segment" value={segmentId} />
      <input type="hidden" name="tier" value={tier ?? ""} />

      {/* Step 1: top-level Personal vs Limited Company */}
      <section>
        <SectionHeading eyebrow="Step 1" title="Who's filing?" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <ModeCard
            active={mode === "personal"}
            onClick={() => onPickMode("personal")}
            title="Personal"
            tagline="Self Assessment for individuals. Nine flat-fee services by situation."
          />
          <ModeCard
            active={mode === "company"}
            onClick={() => onPickMode("company")}
            title="Limited Company"
            tagline="Annual accounts, Corporation Tax and VAT for UK limited companies."
          />
        </div>
      </section>

      {/* Personal flow: 9-tile picker, flat fee, no deadline step. */}
      {mode === "personal" ? (
        <section>
          <SectionHeading
            eyebrow="Step 2"
            title="Which best describes your situation?"
          />
          {hint && HINT_COPY[hint] ? (
            <p
              className="mt-4 rounded-xl border border-sky/30 bg-sky/5 p-4 text-sm text-ink"
              role="note"
            >
              <span
                className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-sky"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Suggestion
              </span>
              {HINT_COPY[hint]}
            </p>
          ) : null}
          <p className="mt-4 max-w-xl text-sm text-slate">
            Each service is a one-off flat fee. You&apos;ll sign a short
            engagement letter next, then pay. Once we have both, we upload
            your documents and get started.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {PERSONAL_TIERS.map((t) => (
              <TierButton
                key={t.id}
                tier={t}
                active={tier === t.id}
                onClick={() => setTier(t.id)}
              />
            ))}
          </div>
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
            <div />
            <OrderSummary
              selectedTier={selectedTier}
              emptyHint="Pick a service above to see the fee."
            />
          </div>
        </section>
      ) : null}

      {/* Limited company flow: three flat-fee service cards + one
          bespoke enquiry tile, no deadline. */}
      {mode === "company" ? (
        <section>
          <SectionHeading
            eyebrow="Step 2"
            title="Choose your limited-company service"
          />
          <p className="mt-2 max-w-xl text-sm text-slate">
            Flat-fee services (first three) sign the engagement letter and
            pay once we&apos;ve confirmed the fit. Larger-company engagements
            (bespoke) go through a short enquiry form instead.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {COMPANY_TIERS.map((t) => (
              <TierButton
                key={t.id}
                tier={t}
                active={tier === t.id}
                onClick={() => setTier(t.id)}
              />
            ))}
          </div>
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
            <div />
            <OrderSummary
              selectedTier={selectedTier}
              emptyHint="Pick a service above to see the fee."
            />
          </div>
        </section>
      ) : null}

      {error ? (
        <p
          className="rounded-lg px-3 py-2 text-sm font-medium text-red-700"
          role="alert"
          style={{ background: "rgba(220,38,38,0.08)" }}
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
        <SLButton
          type="submit"
          variant="primary"
          className="w-full sm:w-auto"
          disabled={pending || !canSubmit}
        >
          {pending
            ? "Creating…"
            : isEnquiryTier
              ? "Continue to enquiry"
              : "Continue"}
        </SLButton>
        <span className="text-sm text-slate">
          {isEnquiryTier
            ? "Short enquiry form next. We'll get back to you within one business day to arrange a call."
            : "You'll sign the engagement letter, pay the fee, then upload the required documents."}
        </span>
      </div>
    </form>
  );
}

function ModeCard({
  active,
  onClick,
  title,
  tagline,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  tagline: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "card-sl relative text-left transition p-7 " +
        (active
          ? "!border-sky/70 !shadow-[0_18px_38px_-18px_rgba(25,156,217,0.45)]"
          : "hover:border-sky/40 hover:-translate-y-0.5")
      }
    >
      <h3
        className="text-xl font-semibold text-ink"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {title}
      </h3>
      <p className="mt-2 text-sm text-slate">{tagline}</p>
      {active ? (
        <span
          className="absolute right-4 top-4 inline-flex h-6 w-6 items-center justify-center rounded-full text-white text-xs font-bold"
          style={{
            background: "linear-gradient(135deg, var(--sky), var(--mint))",
          }}
        >
          ✓
        </span>
      ) : null}
    </button>
  );
}

function TierButton({
  tier: t,
  active,
  onClick,
}: {
  tier: PlanTier;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "card-sl relative flex flex-col text-left p-6 transition " +
        (active
          ? "!border-sky/70 !shadow-[0_18px_38px_-18px_rgba(25,156,217,0.45)]"
          : "hover:border-sky/40 hover:-translate-y-0.5")
      }
    >
      <TierCardBody tier={t} />
      {active ? (
        <span
          className="absolute right-4 top-4 inline-flex h-6 w-6 items-center justify-center rounded-full text-white text-xs font-bold"
          style={{
            background: "linear-gradient(135deg, var(--sky), var(--mint))",
          }}
        >
          ✓
        </span>
      ) : null}
    </button>
  );
}

function OrderSummary({
  selectedTier,
  emptyHint,
}: {
  selectedTier: PlanTier | null;
  emptyHint: string;
}) {
  return (
    <aside className="card-sl h-fit p-5">
      <span
        className="text-[11px] font-semibold uppercase tracking-widest text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Order summary
      </span>
      {selectedTier ? (
        selectedTier.requiresEnquiry ? (
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-ink">{selectedTier.title}</span>
              <span className="font-semibold text-ink">
                {selectedTier.priceDisplay ?? "Bespoke"}
              </span>
            </div>
            <p className="text-[11px] text-slate">
              Price confirmed on a short scoping call. No upfront charge.
            </p>
          </div>
        ) : (
          <>
            <dl className="mt-4 space-y-2.5 text-sm">
              <div className="flex items-baseline justify-between">
                <dt className="text-ink">{selectedTier.title}</dt>
                <dd className="font-semibold text-ink">
                  £{selectedTier.priceGbp}
                </dd>
              </div>
              <div className="flex items-baseline justify-between border-t border-line pt-2.5">
                <dt
                  className="text-[11px] font-bold uppercase tracking-widest text-slate"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  Total
                </dt>
                <dd
                  className="text-lg font-bold text-ink"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  £{selectedTier.priceGbp}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] text-slate">
              Charged at checkout. Nothing today.
            </p>
          </>
        )
      ) : (
        <>
          <p className="mt-4 text-xs text-slate">{emptyHint}</p>
          <p className="mt-3 text-[11px] text-slate">
            Charged at checkout. Nothing today.
          </p>
        </>
      )}
    </aside>
  );
}

function TierCardBody({ tier: t }: { tier: PlanTier }) {
  return (
    <>
      {t.featured ? (
        <span
          className="absolute -top-3 left-6 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white"
          style={{
            background: "linear-gradient(120deg, var(--navy), var(--sky))",
            fontFamily: "var(--font-mono)",
          }}
        >
          Most chosen
        </span>
      ) : null}
      <h3 className="text-lg font-semibold text-ink">{t.title}</h3>
      <p className="mt-1 text-sm text-slate">{t.tagline}</p>
      <div
        className="mt-4 flex items-baseline gap-2"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {t.originalGbp && t.originalGbp !== t.priceGbp ? (
          <span className="text-lg font-semibold text-slate line-through decoration-slate/60">
            £{t.originalGbp}
          </span>
        ) : null}
        {t.priceDisplay ? (
          <span className="text-3xl font-bold text-ink">{t.priceDisplay}</span>
        ) : (
          <span className="text-3xl font-bold text-ink">£{t.priceGbp}</span>
        )}
        {t.priceSuffix ? (
          <span className="text-sm font-semibold text-slate">
            {t.priceSuffix}
          </span>
        ) : null}
        {t.pricePer ? (
          <span className="text-sm font-semibold text-slate">
            {t.pricePer}
          </span>
        ) : null}
        {t.saveGbp ? (
          <span
            className="ml-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
            style={{
              background: "rgba(19, 217, 160, 0.14)",
              color: "#0E9E77",
              fontFamily: "var(--font-mono)",
            }}
          >
            Save £{t.saveGbp}
          </span>
        ) : null}
      </div>
      {t.features && t.features.length > 0 ? (
        <ul className="mt-4 space-y-2 text-sm text-ink">
          {t.features.map((f) => (
            <li key={f} className="flex gap-2">
              <span className="text-mint">✓</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      ) : t.description ? (
        <p className="mt-4 text-sm text-slate">{t.description}</p>
      ) : null}
      {t.footerLine ? (
        <p className="mt-4 pt-3 border-t border-line text-[11px] italic text-slate">
          {t.footerLine}
        </p>
      ) : null}
    </>
  );
}

function SectionHeading({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <div>
      <span className="eyebrow">{eyebrow}</span>
      <h2
        className="mt-3 text-2xl"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        {title}
      </h2>
    </div>
  );
}
