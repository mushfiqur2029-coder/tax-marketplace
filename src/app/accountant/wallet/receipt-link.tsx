"use client";

import { useState } from "react";

export function ReceiptLink({
  path,
  sign,
}: {
  path: string;
  sign: (path: string) => Promise<string>;
}) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const url = await sign(path);
      window.open(url, "_blank", "noopener");
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
