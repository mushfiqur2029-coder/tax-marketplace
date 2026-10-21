"use client";

import { useMemo } from "react";
import { AdminSearchFilter } from "@/components/admin/admin-search-filter";
import { AdminPill, type AdminPillTone } from "@/components/admin/admin-pill";
import { formatDateTime } from "@/lib/format";
import { useLiveList } from "@/lib/realtime-live-merge";
import { EnquiryActions } from "./enquiry-actions";
import {
  BespokeCaseForm,
  BespokeCaseExistingLink,
} from "./bespoke-case-form";
import {
  UpcomingCallCard,
  type UpcomingBookingView,
} from "@/components/booking/upcoming-call-card";
import type { ActionResult } from "@/lib/action-result";

export type EnquiryRow = {
  id: string;
  client_id: string;
  service_key: string;
  company_name: string;
  company_number: string;
  company_status: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  status: "new" | "contacted" | "closed";
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type BespokeCaseLink = {
  id: string;
  custom_fee_pence: number;
};

export function AdminEnquiriesLive({
  initial,
  emailById,
  tierTitleByKey,
  caseByEnquiryId,
  bookingByEnquiryId,
  accountants,
  setStatus,
  createCase,
}: {
  initial: EnquiryRow[];
  emailById: Record<string, string>;
  tierTitleByKey: Record<string, string>;
  caseByEnquiryId: Record<string, BespokeCaseLink>;
  bookingByEnquiryId: Record<string, UpcomingBookingView>;
  accountants: { id: string; name: string | null; email: string }[];
  setStatus: (
    id: string,
    status: "new" | "contacted" | "closed",
    notes: string | null,
  ) => Promise<ActionResult>;
  createCase: (
    enquiryId: string,
    feeGbp: number,
    depositGbp: number,
    commissionGbp: number,
    accountantId: string,
    note: string | null,
  ) => Promise<ActionResult<{ caseId: string }>>;
}) {
  const rows = useLiveList<EnquiryRow>(initial, {
    table: "service_enquiries",
    channel: "admin-enquiries-live",
    map: (row) => ({
      id: row.id as string,
      client_id: row.client_id as string,
      service_key: row.service_key as string,
      company_name: (row.company_name as string) ?? "",
      company_number: (row.company_number as string) ?? "",
      company_status: (row.company_status as string | null) ?? null,
      contact_name: (row.contact_name as string) ?? "",
      contact_email: (row.contact_email as string) ?? "",
      contact_phone: (row.contact_phone as string) ?? "",
      status: row.status as "new" | "contacted" | "closed",
      admin_notes: (row.admin_notes as string | null) ?? null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    }),
  });

  const groups = useMemo(() => {
    const grouped = {
      new: rows.filter((r) => r.status === "new"),
      contacted: rows.filter((r) => r.status === "contacted"),
      closed: rows.filter((r) => r.status === "closed"),
    };
    const buildItems = (list: EnquiryRow[]) =>
      list.map((r) => ({
        searchText: [
          r.company_name,
          r.company_number,
          r.contact_name,
          r.contact_email,
          emailById[r.client_id],
        ]
          .filter(Boolean)
          .join(" "),
        node: (
          <EnquiryCard
            key={r.id}
            row={r}
            submittedByEmail={emailById[r.client_id] ?? null}
            serviceLabel={tierTitleByKey[r.service_key] ?? r.service_key}
            accountants={accountants}
            existingCase={caseByEnquiryId[r.id] ?? null}
            booking={bookingByEnquiryId[r.id] ?? null}
            setStatus={setStatus}
            createCase={createCase}
          />
        ),
      }));
    return [
      {
        key: "new",
        title: "New",
        emptyLine:
          "No new enquiries. The badge next to Enquiries in the nav turns on when one lands.",
        items: buildItems(grouped.new),
      },
      {
        key: "contacted",
        title: "Contacted",
        hidden: grouped.contacted.length === 0,
        items: buildItems(grouped.contacted),
      },
      {
        key: "closed",
        title: "Closed",
        hidden: grouped.closed.length === 0,
        items: buildItems(grouped.closed),
      },
    ];
  }, [rows, emailById, tierTitleByKey, caseByEnquiryId, bookingByEnquiryId, accountants, setStatus, createCase]);

  return (
    <AdminSearchFilter
      placeholder="Search by company, contact or email"
      ariaLabel="Search enquiries"
      groups={groups}
    />
  );
}

function EnquiryCard({
  row,
  submittedByEmail,
  serviceLabel,
  accountants,
  existingCase,
  booking,
  setStatus,
  createCase,
}: {
  row: EnquiryRow;
  submittedByEmail: string | null;
  serviceLabel: string;
  accountants: { id: string; name: string | null; email: string }[];
  existingCase: BespokeCaseLink | null;
  booking: UpcomingBookingView | null;
  setStatus: (
    id: string,
    status: "new" | "contacted" | "closed",
    notes: string | null,
  ) => Promise<ActionResult>;
  createCase: (
    enquiryId: string,
    feeGbp: number,
    depositGbp: number,
    commissionGbp: number,
    accountantId: string,
    note: string | null,
  ) => Promise<ActionResult<{ caseId: string }>>;
}) {
  const supportsBespoke = row.service_key === "vat_plus_accounts_200k";
  return (
    <li>
      <div className="card-sl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-ink">
                {row.company_name}
              </span>
              <span
                className="rounded bg-cloud px-1.5 py-0.5 text-[11px] font-semibold text-ink"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {row.company_number}
              </span>
              <StatusPill status={row.status} />
              {row.company_status &&
              row.company_status.toLowerCase() !== "active" &&
              row.company_status.toLowerCase() !== "unknown" ? (
                <CompanyStatusPill status={row.company_status} />
              ) : null}
            </div>
            <p
              className="mt-1 text-[11px] uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {serviceLabel}
            </p>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-slate">Contact</dt>
              <dd className="text-ink">{row.contact_name}</dd>
              <dt className="text-slate">Email</dt>
              <dd className="text-ink">
                <a
                  href={`mailto:${row.contact_email}`}
                  className="font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
                >
                  {row.contact_email}
                </a>
              </dd>
              <dt className="text-slate">Phone</dt>
              <dd className="text-ink">
                <a
                  href={`tel:${row.contact_phone.replace(/\s+/g, "")}`}
                  className="font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
                >
                  {row.contact_phone}
                </a>
              </dd>
              <dt className="text-slate">Submitted</dt>
              <dd className="text-ink">
                {formatDateTime(row.created_at)}
                {submittedByEmail ? (
                  <span className="ml-1 text-xs text-slate">
                    by {submittedByEmail}
                  </span>
                ) : null}
              </dd>
              {row.updated_at && row.updated_at !== row.created_at ? (
                <>
                  <dt className="text-slate">Last update</dt>
                  <dd className="text-ink">{formatDateTime(row.updated_at)}</dd>
                </>
              ) : null}
            </dl>
          </div>
        </div>

        {booking ? (
          <div className="mt-4">
            <h4
              className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Scoping call booked
            </h4>
            <UpcomingCallCard
              booking={booking}
              headline={`Call with ${row.contact_name}`}
            />
          </div>
        ) : null}

        <EnquiryActions
          id={row.id}
          status={row.status}
          initialNotes={row.admin_notes ?? ""}
          setStatus={setStatus}
        />

        {supportsBespoke ? (
          existingCase ? (
            <BespokeCaseExistingLink
              caseId={existingCase.id}
              feePence={existingCase.custom_fee_pence}
            />
          ) : (
            <BespokeCaseForm
              enquiryId={row.id}
              accountants={accountants}
              createCase={createCase}
            />
          )
        ) : null}
      </div>
    </li>
  );
}

function StatusPill({ status }: { status: "new" | "contacted" | "closed" }) {
  const map: Record<string, { label: string; tone: AdminPillTone }> = {
    new: { label: "New", tone: "blue" },
    contacted: { label: "Contacted", tone: "amber" },
    closed: { label: "Closed", tone: "grey" },
  };
  const cfg = map[status];
  return <AdminPill tone={cfg.tone} label={cfg.label} />;
}

function CompanyStatusPill({ status }: { status: string }) {
  const label = status
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <AdminPill tone="red" label={`Co: ${label}`} title="Companies House status" />
  );
}
