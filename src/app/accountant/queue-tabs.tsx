"use client";

import { useState, type ReactNode } from "react";

type Row = { id: string; node: ReactNode };

type Props = {
  queueCount: number;
  mineCount: number;
  queue: Row[];
  mine: Row[];
};

export function QueueTabs({ queueCount, mineCount, queue, mine }: Props) {
  const [tab, setTab] = useState<"queue" | "mine">(
    queueCount > 0 || mineCount === 0 ? "queue" : "mine",
  );

  return (
    <div>
      <div className="mb-6 inline-flex rounded-full border border-line bg-paper p-1">
        <TabButton active={tab === "queue"} onClick={() => setTab("queue")}>
          Queue
          <Count n={queueCount} />
        </TabButton>
        <TabButton active={tab === "mine"} onClick={() => setTab("mine")}>
          My cases
          <Count n={mineCount} />
        </TabButton>
      </div>

      {tab === "queue" ? (
        queue.length === 0 ? (
          <EmptyPanel
            title="No cases in the queue right now."
            hint="You'll get a bell notification when a new paid case lands."
          />
        ) : (
          <ul className="grid gap-3">{queue.map((r) => <li key={r.id}>{r.node}</li>)}</ul>
        )
      ) : mine.length === 0 ? (
        <EmptyPanel
          title="You haven't taken any cases yet."
          hint="Grab one from the queue when you're ready."
        />
      ) : (
        <ul className="grid gap-3">{mine.map((r) => <li key={r.id}>{r.node}</li>)}</ul>
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
      onClick={onClick}
      aria-pressed={active}
      className={
        "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition " +
        (active
          ? "bg-navy-deep text-white shadow-[0_10px_24px_-12px_rgba(15,30,77,0.5)]"
          : "text-slate hover:text-navy-deep")
      }
    >
      {children}
    </button>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/15 px-1.5 text-[11px] font-bold"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {n}
    </span>
  );
}

function EmptyPanel({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="card-sl border-dashed p-10 text-center sm:p-12">
      <p className="text-lg font-semibold text-ink">{title}</p>
      <p className="mt-2 text-sm text-slate">{hint}</p>
    </div>
  );
}
