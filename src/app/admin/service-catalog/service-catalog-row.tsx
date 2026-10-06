"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SLButton } from "@/components/sl-button";
import type { PlanTier } from "@/lib/plans";
import type { ActionResult } from "@/lib/action-result";
import type { ServiceCatalogPatch } from "@/lib/service-catalog";

type UpdateFn = (
  id: string,
  patch: ServiceCatalogPatch,
) => Promise<ActionResult>;

export function ServiceCatalogRow({
  tier,
  update,
}: {
  tier: PlanTier;
  update: UpdateFn;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(tier.title);
  const [tagline, setTagline] = useState(tier.tagline);
  const [priceGbp, setPriceGbp] = useState(String(tier.priceGbp));
  const [description, setDescription] = useState(tier.description ?? "");
  const [featuresText, setFeaturesText] = useState(
    (tier.features ?? []).join("\n"),
  );
  const [footerLine, setFooterLine] = useState(tier.footerLine ?? "");
  const [heroLine, setHeroLine] = useState(tier.heroLine ?? "");
  const [priceDisplay, setPriceDisplay] = useState(tier.priceDisplay ?? "");
  const [priceSubtitle, setPriceSubtitle] = useState(
    tier.priceGbpSubtitle ?? "",
  );
  const [featured, setFeatured] = useState(!!tier.featured);

  const resetToTier = () => {
    setTitle(tier.title);
    setTagline(tier.tagline);
    setPriceGbp(String(tier.priceGbp));
    setDescription(tier.description ?? "");
    setFeaturesText((tier.features ?? []).join("\n"));
    setFooterLine(tier.footerLine ?? "");
    setHeroLine(tier.heroLine ?? "");
    setPriceDisplay(tier.priceDisplay ?? "");
    setPriceSubtitle(tier.priceGbpSubtitle ?? "");
    setFeatured(!!tier.featured);
    setError(null);
  };

  const save = () => {
    setError(null);
    const parsedPrice = Number(priceGbp);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setError("Price must be a whole number of pounds (0 or more).");
      return;
    }
    const features = featuresText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    start(async () => {
      const res = await update(tier.id, {
        title: title.trim(),
        tagline: tagline.trim(),
        price_gbp: Math.round(parsedPrice),
        description: description.trim() || null,
        features: features.length > 0 ? features : null,
        footer_line: footerLine.trim() || null,
        hero_line: heroLine.trim() || null,
        price_display: priceDisplay.trim() || null,
        price_gbp_subtitle: priceSubtitle.trim() || null,
        featured,
      });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else setError(res.error);
    });
  };

  const isActive = tier.active !== false;

  const toggleActive = () => {
    setError(null);
    start(async () => {
      const res = await update(tier.id, { active: !isActive });
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  };

  return (
    <div
      className={
        "card-sl p-5 " +
        (!isActive ? "opacity-70 " : "") +
        (tier.featured && !editing ? "ring-1 ring-sky/40" : "")
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <code
          className="rounded bg-cloud px-1.5 py-0.5 text-[11px] text-ink"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {tier.id}
        </code>
        <span
          className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{
            background: "rgba(25,156,217,0.12)",
            color: "#1472A6",
            fontFamily: "var(--font-mono)",
          }}
        >
          {tier.group === "personal" ? "Personal" : "Company"}
        </span>
        {tier.requiresEnquiry ? (
          <span
            className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{
              background: "rgba(217,159,25,0.14)",
              color: "#B57E12",
              fontFamily: "var(--font-mono)",
            }}
          >
            Enquiry-only
          </span>
        ) : null}
        {tier.adminCreateOnly ? (
          <span
            className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{
              background: "rgba(217,25,129,0.14)",
              color: "#A61268",
              fontFamily: "var(--font-mono)",
            }}
          >
            Admin-only
          </span>
        ) : null}
        <span
          className="text-sm font-semibold text-ink"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {tier.priceDisplay ?? `£${tier.priceGbp}`}
        </span>
        <span
          className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{
            background: isActive
              ? "rgba(19,217,160,0.14)"
              : "rgba(220,38,38,0.14)",
            color: isActive ? "#0E9E77" : "#B01E1E",
            fontFamily: "var(--font-mono)",
          }}
        >
          {isActive ? "Active" : "Deactivated"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {!editing ? (
            <>
              <SLButton
                type="button"
                variant="outline"
                onClick={() => setEditing(true)}
                disabled={pending}
              >
                Edit
              </SLButton>
              <SLButton
                type="button"
                variant="outline"
                onClick={toggleActive}
                disabled={pending}
              >
                {isActive ? "Deactivate" : "Activate"}
              </SLButton>
            </>
          ) : (
            <>
              <SLButton
                type="button"
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  resetToTier();
                }}
                disabled={pending}
              >
                Cancel
              </SLButton>
              <SLButton
                type="button"
                variant="primary"
                onClick={save}
                disabled={pending}
              >
                {pending ? "Saving…" : "Save"}
              </SLButton>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title" value={title} onChange={setTitle} />
          <Field label="Tagline" value={tagline} onChange={setTagline} />
          <Field
            label="Price (£, whole pounds)"
            type="number"
            value={priceGbp}
            onChange={setPriceGbp}
          />
          <Field
            label="Price display override (optional)"
            value={priceDisplay}
            onChange={setPriceDisplay}
            placeholder='e.g. "Bespoke" to override "£0"'
          />
          <Field
            label="Price subtitle (optional)"
            value={priceSubtitle}
            onChange={setPriceSubtitle}
            placeholder='e.g. "one-off"'
          />
          <Field
            label="Hero line (optional)"
            value={heroLine}
            onChange={setHeroLine}
          />
          <label className="block sm:col-span-2">
            <span
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Description
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-sl min-h-[72px] resize-y"
              rows={3}
            />
          </label>
          <label className="block sm:col-span-2">
            <span
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Features (one per line)
            </span>
            <textarea
              value={featuresText}
              onChange={(e) => setFeaturesText(e.target.value)}
              className="input-sl min-h-[120px] resize-y"
              rows={5}
              placeholder="e.g.
Prepared and filed Self Assessment, signed off by a qualified accountant
Mileage and allowable vehicle costs reviewed with you"
            />
          </label>
          <Field
            label="Footer line (optional)"
            value={footerLine}
            onChange={setFooterLine}
          />
          <label className="flex items-center gap-2 self-end pb-1 text-sm text-ink">
            <input
              type="checkbox"
              checked={featured}
              onChange={(e) => setFeatured(e.target.checked)}
              className="h-4 w-4"
            />
            Featured (shows &ldquo;Most chosen&rdquo; badge)
          </label>
        </div>
      ) : (
        <>
          <div className="text-sm font-semibold text-ink">{tier.title}</div>
          <p className="mt-1 text-sm text-slate">{tier.tagline}</p>
          {tier.features && tier.features.length > 0 ? (
            <ul className="mt-3 space-y-1 text-xs text-slate">
              {tier.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-mint">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          ) : tier.description ? (
            <p className="mt-3 text-xs text-slate">{tier.description}</p>
          ) : null}
        </>
      )}

      {error ? (
        <p className="mt-3 text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span
        className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </span>
      <input
        type={type ?? "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input-sl"
      />
    </label>
  );
}
