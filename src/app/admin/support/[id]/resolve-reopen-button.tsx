"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  markSupportThreadResolvedAction,
  reopenSupportThreadAction,
} from "@/app/support/actions";

export function ResolveReopenButton({
  threadId, status,
}: {
  threadId: string;
  status: "open" | "resolved";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const toggle = () => start(async () => {
    const r = status === "open"
      ? await markSupportThreadResolvedAction(threadId)
      : await reopenSupportThreadAction(threadId);
    if (r.ok) router.refresh();
    else alert(r.error);
  });
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className={
        "rounded border px-3 py-1 text-xs font-medium disabled:opacity-50 "
        + (status === "open"
          ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
          : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100")
      }
    >
      {pending
        ? "Saving..."
        : status === "open"
          ? "Mark resolved"
          : "Reopen thread"}
    </button>
  );
}
