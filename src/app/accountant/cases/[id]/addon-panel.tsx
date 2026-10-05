"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SLButton } from "@/components/sl-button";
import type { ActionResult } from "@/lib/action-result";
import { formatDateTime } from "@/lib/format";

export type AddonRow = {
  id: string;
  kind: "preset" | "custom";
  description: string;
  amount_pence: number;
  status: "pending_admin" | "pending_payment" | "paid" | "rejected";
  created_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  paid_at: string | null;
};

export type CatalogOption = {
  key: string;
  name: string;
  description: string;
  amount_pence: number;
};

type Props = {
  addons: AddonRow[];
  catalog: CatalogOption[];
  requestPreset: (presetKey: string) => Promise<ActionResult>;
  requestCustom: (input: {
    description: string;
    amountPence: number;
  }) => Promise<ActionResult>;
  disabled: boolean; // true when case is complete or accountant suspended
  disabledReason?: string;
};

export function AddonPanel({
  addons,
  catalog,
  requestPreset,
  requestCustom,
  disabled,
  disabledReason,
}: Props) {
  const [tab, setTab] = useState<"preset" | "custom">("preset");

  return (
    <div className="space-y-4">
      {addons.length > 0 ? (
        <ul className="grid gap-2">
          {addons.map((a) => (
            <li key={a.id} className="rounded-xl border border-line bg-paper p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">
                    £{(a.amount_pence / 100).toFixed(2)}{" "}
                    <span className="text-xs font-normal text-slate">
                      · {a.kind === "preset" ? "Preset" : "Custom"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-slate">{a.description}</p>
                  <p className="mt-1 text-[11px] text-slate">
                    Requested {formatDateTime(a.created_at)}
                    {a.reviewed_at ? (
                      <> · reviewed {formatDateTime(a.reviewed_at)}</>
                    ) : null}
                    {a.paid_at ? (
                      <> · paid {formatDateTime(a.paid_at)}</>
                    ) : null}
                    {a.review_note ? <> · &ldquo;{a.review_note}&rdquo;</> : null}
                  </p>
                </div>
                <AddonStatusPill status={a.status} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-line px-4 py-4 text-center text-xs text-slate">
          No add-ons on this case yet.
        </p>
      )}

      {disabled ? (
        <p className="rounded-lg border border-line bg-cloud px-3 py-2 text-xs text-slate">
          {disabledReason ??
            "Add-on requests are locked at this stage of the case."}
        </p>
      ) : (
        <div>
          {/* Tabs */}
          <div
            role="tablist"
            className="inline-flex rounded-full border border-line bg-paper p-1 text-xs font-semibold"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            <TabButton
              active={tab === "preset"}
              onClick={() => setTab("preset")}
            >
              Choose a service
            </TabButton>
            <TabButton
              active={tab === "custom"}
              onClick={() => setTab("custom")}
            >
              Other
            </TabButton>
          </div>

          <div className="mt-3">
            {tab === "preset" ? (
              <PresetForm catalog={catalog} requestPreset={requestPreset} />
            ) : (
              <CustomForm requestCustom={requestCustom} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        "rounded-full px-3 py-1 uppercase tracking-wider transition " +
        (active ? "bg-navy-deep text-white" : "text-slate hover:text-navy-deep")
      }
    >
      {children}
    </button>
  );
}

function PresetForm({
  catalog,
  requestPreset,
}: {
  catalog: CatalogOption[];
  requestPreset: (presetKey: string) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [key, setKey] = useState<string>(catalog[0]?.key ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const selected = catalog.find((c) => c.key === key);

  if (catalog.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line px-3 py-3 text-xs text-slate">
        No add-ons in the catalog yet. Admin can add some at{" "}
        <code className="rounded bg-cloud px-1 py-0.5 text-[10px] text-ink">/admin/addon-catalog</code>.
      </p>
    );
  }

  return (
    <form
      action={() => {
        setError(null);
        setOk(null);
        start(async () => {
          const res = await requestPreset(key);
          if (res.ok) {
            setOk("Sent to the client for payment.");
            // Addons list on this page is server-rendered from
            // case_addons — refresh so the newly requested row appears
            // without needing a manual reload.
            router.refresh();
          } else setError(res.error);
        });
      }}
      className="space-y-3"
    >
      <label className="block">
        <span
          className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Service
        </span>
        <select
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="input-sl"
        >
          {catalog.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name} — £{(c.amount_pence / 100).toFixed(2)}
            </option>
          ))}
        </select>
      </label>
      {selected ? (
        <p className="text-xs text-slate">{selected.description}</p>
      ) : null}
      {error ? (
        <p className="text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p
          className="rounded-lg px-2.5 py-2 text-[12px] font-medium"
          style={{ background: "rgba(19,217,160,0.14)", color: "#0E9E77" }}
          role="status"
        >
          {ok}
        </p>
      ) : null}
      <SLButton
        type="submit"
        variant="primary"
        className="w-full sm:w-auto"
        disabled={pending || !key}
      >
        {pending ? "Sending…" : "Send to client for payment"}
      </SLButton>
    </form>
  );
}

function CustomForm({
  requestCustom,
}: {
  requestCustom: (input: {
    description: string;
    amountPence: number;
  }) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [amountGbp, setAmountGbp] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  return (
    <form
      action={() => {
        setError(null);
        setOk(null);
        start(async () => {
          const pence = Math.round(parseFloat(amountGbp) * 100);
          const res = await requestCustom({ description, amountPence: pence });
          if (res.ok) {
            setOk("Sent to admin for approval.");
            setDescription("");
            setAmountGbp("");
            router.refresh();
          } else {
            setError(res.error);
          }
        });
      }}
      className="space-y-3"
    >
      <label className="block">
        <span
          className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Describe the extra work
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="input-sl min-h-[72px] resize-y"
          rows={3}
          required
        />
      </label>
      <label className="block max-w-[160px]">
        <span
          className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Amount (£)
        </span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={amountGbp}
          onChange={(e) => setAmountGbp(e.target.value)}
          className="input-sl"
          required
        />
      </label>
      <p className="text-[11px] text-slate">
        Admin has to approve custom add-ons before the client sees them.
      </p>
      {error ? (
        <p className="text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p
          className="rounded-lg px-2.5 py-2 text-[12px] font-medium"
          style={{ background: "rgba(19,217,160,0.14)", color: "#0E9E77" }}
          role="status"
        >
          {ok}
        </p>
      ) : null}
      <SLButton
        type="submit"
        variant="primary"
        className="w-full sm:w-auto"
        disabled={pending || !description.trim() || !amountGbp}
      >
        {pending ? "Sending…" : "Send to admin for approval"}
      </SLButton>
    </form>
  );
}

function AddonStatusPill({ status }: { status: AddonRow["status"] }) {
  const map: Record<
    AddonRow["status"],
    { label: string; bg: string; color: string }
  > = {
    pending_admin: {
      label: "Pending admin",
      bg: "rgba(217,159,25,0.14)",
      color: "#B57E12",
    },
    pending_payment: {
      label: "Pending payment",
      bg: "rgba(25,156,217,0.14)",
      color: "var(--sky)",
    },
    paid: {
      label: "Paid",
      bg: "rgba(19,217,160,0.14)",
      color: "#0E9E77",
    },
    rejected: {
      label: "Rejected",
      bg: "rgba(220,38,38,0.12)",
      color: "#B91C1C",
    },
  };
  const { label, bg, color } = map[status];
  return (
    <span
      className="shrink-0 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
      style={{ background: bg, color, fontFamily: "var(--font-mono)" }}
    >
      {label}
    </span>
  );
}
