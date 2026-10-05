"use client";

import { useRouter } from "next/navigation";
import { DocumentUploader } from "@/components/case/document-uploader";
import type { ActionResult } from "@/lib/action-result";

// Thin client wrapper around DocumentUploader that triggers a server-
// component refresh after each successful upload. The page itself is a
// server component so it can't call useRouter directly; delegating
// to this wrapper keeps the uploader generic and lets the list below
// pick up the new row without a manual page refresh.
export function UploadSection({
  action,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  return (
    <DocumentUploader
      action={action}
      onEachUploadSuccess={() => router.refresh()}
    />
  );
}
