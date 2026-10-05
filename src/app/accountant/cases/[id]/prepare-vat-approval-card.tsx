"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SLButton } from "@/components/sl-button";
import { DocumentUploader } from "@/components/case/document-uploader";
import { formatDateTime } from "@/lib/format";
import type { ActionResult } from "@/lib/action-result";

type ReturnDoc = {
  id: string;
  file_name: string;
  uploaded_at: string;
};

type Props = {
  cycleId: string;
  initialReturnDocs: ReturnDoc[];
  uploadReturnDoc: (
    cycleId: string,
    fd: FormData,
  ) => Promise<ActionResult>;
  removeReturnDoc: (
    cycleId: string,
    docId: string,
  ) => Promise<ActionResult>;
  prepare: (
    cycleId: string,
    input: {
      box1Pounds: number;
      box2Pounds: number;
      box3Pounds: number;
      box4Pounds: number;
      box5Pounds: number;
      box6Pounds: number;
      box7Pounds: number;
      box8Pounds: number;
      box9Pounds: number;
      note: string;
    },
  ) => Promise<ActionResult>;
};

// Prepare VAT return approval. 9 box inputs + a note + the single
// return PDF slot. On submit, server validates arithmetic + presence
// and transitions the cycle to client_approval.
export function PrepareVatApprovalCard({
  cycleId,
  initialReturnDocs,
  uploadReturnDoc,
  removeReturnDoc,
  prepare,
}: Props) {
  const router = useRouter();
  const [returnDocs, setReturnDocs] =
    useState<ReturnDoc[]>(initialReturnDocs);
  const [box1, setBox1] = useState("");
  const [box2, setBox2] = useState("");
  const [box3, setBox3] = useState("");
  const [box4, setBox4] = useState("");
  const [box5, setBox5] = useState("");
  const [box6, setBox6] = useState("");
  const [box7, setBox7] = useState("");
  const [box8, setBox8] = useState("");
  const [box9, setBox9] = useState("");
  const [note, setNote] = useState("");
  const [submitting, startSubmit] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const num = (v: string) => Number(v);
  const allFilled = [box1, box2, box3, box4, box5, box6, box7, box8, box9].every(
    (v) => v.trim().length > 0 && !Number.isNaN(Number(v)),
  );
  const canSubmit = returnDocs.length > 0 && allFilled && !submitting;

  const handleSubmit = () => {
    setError(null);
    startSubmit(async () => {
      const res = await prepare(cycleId, {
        box1Pounds: num(box1),
        box2Pounds: num(box2),
        box3Pounds: num(box3),
        box4Pounds: num(box4),
        box5Pounds: num(box5),
        box6Pounds: num(box6),
        box7Pounds: num(box7),
        box8Pounds: num(box8),
        box9Pounds: num(box9),
        note,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <VatReturnDocSlot
        cycleId={cycleId}
        docs={returnDocs}
        onUploaded={(d) => setReturnDocs((prev) => [...prev, d])}
        onRemoved={(id) =>
          setReturnDocs((prev) => prev.filter((d) => d.id !== id))
        }
        uploadReturnDoc={uploadReturnDoc}
        removeReturnDoc={removeReturnDoc}
      />

      <div className="rounded-xl border border-line bg-paper p-4">
        <h4
          className="text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          VAT100 box values (£, enter whole pounds and pence)
        </h4>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <BoxInput label="Box 1" hint="VAT due on sales" value={box1} setValue={setBox1} />
          <BoxInput label="Box 2" hint="VAT due on EU acquisitions" value={box2} setValue={setBox2} />
          <BoxInput label="Box 3" hint="Total VAT due (1 + 2)" value={box3} setValue={setBox3} />
          <BoxInput label="Box 4" hint="VAT reclaimed on purchases" value={box4} setValue={setBox4} />
          <BoxInput label="Box 5" hint="Net VAT (3 − 4). Negative = refund" value={box5} setValue={setBox5} />
          <BoxInput label="Box 6" hint="Total sales ex VAT" value={box6} setValue={setBox6} />
          <BoxInput label="Box 7" hint="Total purchases ex VAT" value={box7} setValue={setBox7} />
          <BoxInput label="Box 8" hint="EU sales ex VAT" value={box8} setValue={setBox8} />
          <BoxInput label="Box 9" hint="EU acquisitions ex VAT" value={box9} setValue={setBox9} />
        </div>
      </div>

      <label className="block">
        <span
          className="text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Note to client (optional)
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="input-sl mt-1"
          placeholder="Anything the client should read before approving."
        />
      </label>

      {error ? (
        <p
          role="alert"
          className="rounded-lg px-3 py-2 text-sm font-medium text-red-700"
          style={{ background: "rgba(220,38,38,0.08)" }}
        >
          {error}
        </p>
      ) : null}

      <SLButton
        type="button"
        variant="primary"
        block
        onClick={handleSubmit}
        disabled={!canSubmit}
      >
        {submitting ? "Sending…" : "Send for client approval"}
      </SLButton>
    </div>
  );
}

function BoxInput({
  label,
  hint,
  value,
  setValue,
}: {
  label: string;
  hint: string;
  value: string;
  setValue: (v: string) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {label}
        </span>
        <span className="text-[10px] text-slate">{hint}</span>
      </div>
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="0.00"
        className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink"
      />
    </label>
  );
}

function VatReturnDocSlot({
  cycleId,
  docs,
  onUploaded,
  onRemoved,
  uploadReturnDoc,
  removeReturnDoc,
}: {
  cycleId: string;
  docs: ReturnDoc[];
  onUploaded: (doc: ReturnDoc) => void;
  onRemoved: (id: string) => void;
  uploadReturnDoc: (
    cycleId: string,
    fd: FormData,
  ) => Promise<ActionResult>;
  removeReturnDoc: (
    cycleId: string,
    docId: string,
  ) => Promise<ActionResult>;
}) {
  const [removing, startRemove] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const slotAction = useCallback(
    async (fd: FormData): Promise<ActionResult> => {
      setError(null);
      const res = await uploadReturnDoc(cycleId, fd);
      if (res.ok) {
        const file = fd.get("file");
        if (file instanceof File) {
          onUploaded({
            id: `optimistic-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
            file_name: file.name,
            uploaded_at: new Date().toISOString(),
          });
        }
      } else {
        setError(res.error);
      }
      return res;
    },
    [cycleId, uploadReturnDoc, onUploaded],
  );

  const handleRemove = (docId: string) => {
    setError(null);
    startRemove(async () => {
      const res = await removeReturnDoc(cycleId, docId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onRemoved(docId);
    });
  };

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span
          className="text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          VAT return document
        </span>
        <span
          className="text-[10px] uppercase tracking-wider"
          style={{ color: "#B91C1C", fontFamily: "var(--font-mono)" }}
        >
          Required
        </span>
      </div>
      {docs.length === 0 ? (
        <div className="mt-2">
          <DocumentUploader
            action={slotAction}
            multiple={false}
            accept=".pdf,application/pdf"
            hint="PDF of the completed VAT return (VAT100 / HMRC filing printout)."
          />
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-paper">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 px-4 py-2.5"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">
                  {d.file_name}
                </div>
                <div className="text-xs text-slate">
                  {formatDateTime(d.uploaded_at)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(d.id)}
                disabled={removing || d.id.startsWith("optimistic-")}
                className="text-xs font-semibold text-red-700 underline underline-offset-4 hover:text-red-900 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
