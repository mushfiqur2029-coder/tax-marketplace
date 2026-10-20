// Read-only identity card shown at the top of the PCH accountant
// workspace. The accountant sees the same four facts the client
// confirmed off the Photo ID (name, DOB, address, postcode) plus the
// HMRC references the client typed (UTR, NI) and the contact details
// they signed up with (phone, email). All six fields come off the
// pch_cases head row that's already loaded in page.tsx, so this panel
// adds zero extra DB queries.
//
// Everything is read-only. Corrections live in the client workspace
// (extraction review card for the Photo ID fields; HMRC references
// card for UTR + NI). An accountant who needs a change messages the
// client via the chat panel.

export type IdentityPanelProps = {
  name: string | null;
  dob: string | null;
  address: string | null;
  postcode: string | null;
  utr: string | null;
  nino: string | null;
  phone: string | null;
  email: string | null;
};

export function IdentityPanel(props: IdentityPanelProps) {
  const rows: { label: string; value: string | null }[] = [
    { label: "Full name", value: props.name },
    { label: "Date of birth", value: fmtDate(props.dob) },
    { label: "Residential address", value: props.address },
    { label: "Postcode", value: props.postcode },
    { label: "UTR", value: props.utr },
    { label: "NI number", value: props.nino },
    { label: "Phone", value: props.phone },
    { label: "Email", value: props.email },
  ];
  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Client identity</h2>
        <span className="text-[11px] text-slate-500">
          Read-only. Client edits on their own workspace.
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((r) => (
          <div
            key={r.label}
            className="rounded border border-slate-100 bg-slate-50/60 p-2"
          >
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {r.label}
            </dt>
            <dd className="mt-0.5 break-words text-sm text-slate-900">
              {r.value && r.value.trim().length > 0 ? (
                r.value
              ) : (
                <span className="italic text-slate-400">Not captured yet</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function fmtDate(d: string | null): string | null {
  if (!d) return null;
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
