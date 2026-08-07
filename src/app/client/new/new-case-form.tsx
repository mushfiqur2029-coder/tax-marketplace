"use client";

import { useMemo, useState } from "react";
import type { Segment, SegmentId } from "@/lib/segments";
import { tiersForSegment, type PlanTier, type TierId } from "@/lib/plans";
import { SLButton } from "@/components/sl-button";

type Props = {
  segments: Segment[];
  action: (fd: FormData) => Promise<void>;
};

export function NewCaseForm({ segments, action }: Props) {
  const [segment, setSegment] = useState<SegmentId | null>(null);
  const [tier, setTier] = useState<TierId | null>(null);
  const [deadline, setDeadline] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tiers = useMemo(() => tiersForSegment(segment), [segment]);

  const handleSegment = (nextId: SegmentId) => {
    setSegment(nextId);
    // Reset the selected tier when switching between personal / company sets.
    const nextTiers = tiersForSegment(nextId);
    const stillValid = tier ? nextTiers.some((t) => t.id === tier) : false;
    if (!stillValid) {
      const featured = nextTiers.find((t) => t.featured);
      setTier(featured?.id ?? nextTiers[0]?.id ?? null);
    }
  };

  return (
    <form
      action={async (fd) => {
        setError(null);
        setPending(true);
        try {
          await action(fd);
        } catch (e) {
          setPending(false);
          setError(e instanceof Error ? e.message : "Something went wrong.");
        }
      }}
      className="space-y-10"
    >
      <input type="hidden" name="segment" value={segment ?? ""} />
      <input type="hidden" name="tier" value={tier ?? ""} />
      <input type="hidden" name="deadline" value={deadline} />

      {/* Segment picker */}
      <section>
        <SectionHeading eyebrow="Step 1" title="Which best describes you?" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {segments.map((s) => {
            const active = segment === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSegment(s.id)}
                aria-pressed={active}
                className={
                  "card-sl group relative text-left transition p-6 " +
                  (active
                    ? "!border-sky/70 !shadow-[0_18px_38px_-18px_rgba(25,156,217,0.45)]"
                    : "hover:border-sky/40 hover:-translate-y-0.5")
                }
              >
                <div
                  className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl text-white text-lg font-bold"
                  style={{
                    background:
                      "linear-gradient(135deg, var(--navy), var(--sky))",
                  }}
                >
                  {s.numeral}
                </div>
                <h3 className="text-base font-semibold text-ink">{s.title}</h3>
                <p className="mt-1 text-sm text-slate">{s.tagline}</p>
                {active ? (
                  <span
                    className="absolute right-4 top-4 inline-flex h-6 w-6 items-center justify-center rounded-full text-white text-xs font-bold"
                    style={{
                      background:
                        "linear-gradient(135deg, var(--sky), var(--mint))",
                    }}
                  >
                    ✓
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      {/* Tier picker — hidden until a segment is chosen */}
      {segment ? (
        <section>
          <SectionHeading
            eyebrow="Step 2"
            title={
              segment === "limited_company_vat"
                ? "Choose a company plan"
                : "Choose a plan"
            }
          />
          <div
            className={
              "mt-6 grid gap-4 " +
              (tiers.length > 3
                ? "sm:grid-cols-2 lg:grid-cols-3"
                : "lg:grid-cols-3")
            }
          >
            {tiers.map((t) => {
              const active = tier === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTier(t.id)}
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
                        background:
                          "linear-gradient(135deg, var(--sky), var(--mint))",
                      }}
                    >
                      ✓
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Deadline */}
      <section>
        <SectionHeading eyebrow="Step 3" title="When do you need it filed by?" />
        <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="block max-w-xs">
            <span
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Filing deadline (optional)
            </span>
            <input
              type="date"
              className="input-sl"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
            />
          </label>
          <p className="text-xs text-slate">
            Your accountant sees this as a coloured urgency indicator.
          </p>
        </div>
      </section>

      {error ? (
        <p className="rounded-lg px-3 py-2 text-sm font-medium text-red-700" role="alert" style={{ background: "rgba(220,38,38,0.08)" }}>
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <SLButton
          type="submit"
          variant="primary"
          disabled={pending || !segment || !tier}
        >
          {pending ? "Creating…" : "Continue"}
        </SLButton>
        <span className="text-sm text-slate">
          You'll answer a few questions next. Payment is the final step.
        </span>
      </div>
    </form>
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
        <span className="text-3xl font-bold text-ink">£{t.priceGbp}</span>
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
