"use client";

import { useState } from "react";
import type { ActionResult } from "@/lib/action-result";

export function ReceiptLink({
  path,
  sign,
}: {
  path: string;
  sign: (path: string) => Promise<ActionResult<string>>;
}) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const res = await sign(path);
      if (res.ok) window.open(res.data, "_blank", "noopener");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-navy-deep transition hover:border-sky/50 hover:bg-sky/5"
    >
      {busy ? "Opening…" : "Receipt"}
    </button>
  );
}
