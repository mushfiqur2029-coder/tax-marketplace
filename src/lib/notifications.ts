import { createAdminClient } from "@/lib/supabase/admin";

export type NotificationType =
  | "new_queue_case"
  | "new_message"
  | "case_status_change"
  | "profile_change_request"
  | "withdrawal_requested"
  | "withdrawal_paid"
  | "case_reassigned"
  | "accountant_approval_decision"
  | "addon_pending_admin"
  | "addon_ready_to_pay"
  | "addon_review_decision"
  | "addon_paid"
  | "case_period_entered"
  | "period_docs_submitted"
  | "vat_cycle_opened"
  | "vat_docs_submitted"
  | "vat_approval_ready"
  | "vat_filed"
  | "service_enquiry"
  | "booking_created"
  | "enquiry_contacted"
  | "enquiry_closed"
  | "enquiry_quoted"
  | "case_payment_stalled"
  | "addon_payment_stalled";

export type NotificationRow = {
  id: string;
  recipient_id: string;
  type: NotificationType;
  case_id: string | null;
  message: string;
  read: boolean;
  created_at: string;
};

export type BellState = {
  unread: number;
  recent: NotificationRow[];
};

// Fetched by DashboardShell on every signed-in page. Cap at 30 per spec.
export async function getBellState(userId: string): Promise<BellState> {
  const admin = createAdminClient();
  const [{ data: recent }, { count: unread }] = await Promise.all([
    admin
      .from("notifications")
      .select("id, recipient_id, type, case_id, message, read, created_at")
      .eq("recipient_id", userId)
      .order("created_at", { ascending: false })
      .limit(30),
    admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", userId)
      .eq("read", false),
  ]);
  return {
    unread: unread ?? 0,
    recent: (recent ?? []) as NotificationRow[],
  };
}

// Every helper below inserts on a best-effort basis: a failed notification
// must not roll back the underlying business action (paid withdrawal, taken
// case, etc.). But silent failures cost hours of debugging — see the
// missing `addon_pending_admin` enum value that shipped this behaviour to
// production and was invisible until someone asked "why didn't admin see
// this?". Any insert error is checked and logged with enough context to
// grep for later.
function logNotifyError(
  ctx: {
    type: NotificationType;
    caseId?: string | null;
    recipientCount?: number;
  },
  error: { message?: string; code?: string } | null,
) {
  if (!error) return;
  console.error(
    `[notifications] insert failed type=${ctx.type}` +
      (ctx.caseId ? ` case=${ctx.caseId}` : "") +
      (ctx.recipientCount !== undefined
        ? ` recipients=${ctx.recipientCount}`
        : "") +
      ` code=${error.code ?? "?"} message=${error.message ?? "?"}`,
  );
}

// Server-side notification writes used by the entry points that don't have a
// DB trigger (profile change submissions and withdrawal flows).

export async function insertProfileChangeNotifications(params: {
  submitterEmail: string;
}) {
  const admin = createAdminClient();
  const { data: admins } = await admin
    .from("users")
    .select("id")
    .eq("role", "admin");
  if (!admins?.length) return;
  const { error } = await admin.from("notifications").insert(
    admins.map((a) => ({
      recipient_id: a.id,
      type: "profile_change_request" as const,
      case_id: null,
      message: `${params.submitterEmail} submitted a profile change.`,
    })),
  );
  logNotifyError(
    { type: "profile_change_request", recipientCount: admins.length },
    error,
  );
}

export async function insertWithdrawalRequestedNotifications(params: {
  accountantEmail: string;
  amountPence: number;
}) {
  const admin = createAdminClient();
  const { data: admins } = await admin
    .from("users")
    .select("id")
    .eq("role", "admin");
  if (!admins?.length) return;
  const { error } = await admin.from("notifications").insert(
    admins.map((a) => ({
      recipient_id: a.id,
      type: "withdrawal_requested" as const,
      case_id: null,
      message: `${params.accountantEmail} requested £${(params.amountPence / 100).toFixed(2)} withdrawal.`,
    })),
  );
  logNotifyError(
    { type: "withdrawal_requested", recipientCount: admins.length },
    error,
  );
}

export async function insertWithdrawalPaidNotification(params: {
  accountantId: string;
  amountPence: number;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("notifications").insert({
    recipient_id: params.accountantId,
    type: "withdrawal_paid",
    case_id: null,
    message: `Your £${(params.amountPence / 100).toFixed(2)} withdrawal was paid.`,
  });
  logNotifyError({ type: "withdrawal_paid" }, error);
}

// Notify both sides of a case reassignment. Used by reassignCaseAction so
// the person losing the case AND the person gaining it both find out
// without having to poll their queue.
export async function insertReassignmentNotifications(params: {
  caseId: string;
  prevAccountantId: string | null;
  newAccountantId: string | null;
  note: string | null;
}) {
  const admin = createAdminClient();
  const rows: Array<{
    recipient_id: string;
    type: "case_reassigned";
    case_id: string;
    message: string;
  }> = [];
  const reason = params.note?.trim() ? ` (${params.note.trim()})` : "";
  if (
    params.prevAccountantId &&
    params.prevAccountantId !== params.newAccountantId
  ) {
    rows.push({
      recipient_id: params.prevAccountantId,
      type: "case_reassigned",
      case_id: params.caseId,
      message: `A case was reassigned away from you${reason}.`,
    });
  }
  if (
    params.newAccountantId &&
    params.newAccountantId !== params.prevAccountantId
  ) {
    rows.push({
      recipient_id: params.newAccountantId,
      type: "case_reassigned",
      case_id: params.caseId,
      message: `A case was assigned to you${reason}.`,
    });
  }
  if (!rows.length) return;
  const { error } = await admin.from("notifications").insert(rows);
  logNotifyError(
    {
      type: "case_reassigned",
      caseId: params.caseId,
      recipientCount: rows.length,
    },
    error,
  );
}

// Notify every admin when an accountant requests a custom add-on that needs
// review before the client can see it. Preset add-ons skip this — they go
// straight to the client for payment.
export async function insertAddonPendingAdminNotifications(params: {
  caseId: string;
  accountantEmail: string;
  amountPence: number;
  description: string;
}) {
  const admin = createAdminClient();
  const { data: admins } = await admin
    .from("users")
    .select("id")
    .eq("role", "admin");
  if (!admins?.length) return;
  const short =
    params.description.length > 80
      ? params.description.slice(0, 77) + "..."
      : params.description;
  const { error } = await admin.from("notifications").insert(
    admins.map((a) => ({
      recipient_id: a.id,
      type: "addon_pending_admin" as const,
      case_id: params.caseId,
      message: `${params.accountantEmail} requested a £${(
        params.amountPence / 100
      ).toFixed(2)} add-on: ${short}`,
    })),
  );
  logNotifyError(
    {
      type: "addon_pending_admin",
      caseId: params.caseId,
      recipientCount: admins.length,
    },
    error,
  );
}

// Notify the case's client that an add-on is ready to pay. Fires from two
// places: (1) accountant requests a preset (goes straight to pending_payment),
// (2) admin approves a custom (transitions to pending_payment). Both paths
// call this so the client's experience is identical.
export async function insertAddonReadyToPayNotification(params: {
  caseId: string;
  clientId: string;
  amountPence: number;
  description: string;
}) {
  const admin = createAdminClient();
  const short =
    params.description.length > 80
      ? params.description.slice(0, 77) + "..."
      : params.description;
  const { error } = await admin.from("notifications").insert({
    recipient_id: params.clientId,
    type: "addon_ready_to_pay" as const,
    case_id: params.caseId,
    message: `Your accountant added £${(
      params.amountPence / 100
    ).toFixed(2)} to pay: ${short}`,
  });
  logNotifyError(
    { type: "addon_ready_to_pay", caseId: params.caseId },
    error,
  );
}

// Notify the requesting accountant when admin approves or rejects a custom
// add-on. Same-type-for-both-outcomes shape mirrors
// accountant_approval_decision.
export async function insertAddonReviewDecisionNotification(params: {
  caseId: string;
  accountantId: string;
  decision: "approved" | "rejected";
  amountPence: number;
  description: string;
  note: string | null;
}) {
  const admin = createAdminClient();
  const short =
    params.description.length > 60
      ? params.description.slice(0, 57) + "..."
      : params.description;
  const money = `£${(params.amountPence / 100).toFixed(2)}`;
  const message =
    params.decision === "approved"
      ? `Admin approved your ${money} add-on (${short}). Sent to the client for payment.`
      : `Admin rejected your ${money} add-on (${short})${
          params.note?.trim() ? `: ${params.note.trim()}` : "."
        }`;
  const { error } = await admin.from("notifications").insert({
    recipient_id: params.accountantId,
    type: "addon_review_decision" as const,
    case_id: params.caseId,
    message,
  });
  logNotifyError(
    { type: "addon_review_decision", caseId: params.caseId },
    error,
  );
}

// Notify the requesting accountant when the client pays for an add-on.
// Fires from the Stripe checkout success path (webhook + fallback poll),
// separately from any wallet-credit trigger.
export async function insertAddonPaidNotification(params: {
  caseId: string;
  accountantId: string;
  amountPence: number;
  description: string;
}) {
  const admin = createAdminClient();
  const short =
    params.description.length > 60
      ? params.description.slice(0, 57) + "..."
      : params.description;
  const { error } = await admin.from("notifications").insert({
    recipient_id: params.accountantId,
    type: "addon_paid" as const,
    case_id: params.caseId,
    message: `Client paid £${(params.amountPence / 100).toFixed(2)} for ${short}.`,
  });
  logNotifyError({ type: "addon_paid", caseId: params.caseId }, error);
}

// Fires when the accountant enters the accounting period dates on a
// limited-company case. The client needs to come back and upload the
// second-stage documents for that period.
export async function insertCasePeriodEnteredNotification(params: {
  caseId: string;
  clientId: string;
  periodStart: string;
  periodEnd: string;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("notifications").insert({
    recipient_id: params.clientId,
    type: "case_period_entered" as const,
    case_id: params.caseId,
    message: `Your accountant set the accounting period: ${params.periodStart} to ${params.periodEnd}. Please upload the documents listed on your case.`,
  });
  logNotifyError(
    { type: "case_period_entered", caseId: params.caseId },
    error,
  );
}

// Fires when the client finishes uploading the second-stage docs for the
// accounting period. Accountant can now start on year-end accounts.
export async function insertPeriodDocsSubmittedNotification(params: {
  caseId: string;
  accountantId: string;
  clientEmail: string;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("notifications").insert({
    recipient_id: params.accountantId,
    type: "period_docs_submitted" as const,
    case_id: params.caseId,
    message: `${params.clientEmail} uploaded their period documents. Ready for accounts prep.`,
  });
  logNotifyError(
    { type: "period_docs_submitted", caseId: params.caseId },
    error,
  );
}

// ---------- VAT return cycle (Batch 5) ----------

export async function insertVatCycleOpenedNotification(params: {
  caseId: string;
  clientId: string;
  periodLabel: string;
  hmrcDueDate: string;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("notifications").insert({
    recipient_id: params.clientId,
    type: "vat_cycle_opened" as const,
    case_id: params.caseId,
    message: `New VAT period opened: ${params.periodLabel}. Due to HMRC by ${params.hmrcDueDate}. Please upload the required documents.`,
  });
  logNotifyError(
    { type: "vat_cycle_opened", caseId: params.caseId },
    error,
  );
}

export async function insertVatDocsSubmittedNotification(params: {
  caseId: string;
  accountantId: string;
  clientEmail: string;
  periodLabel: string;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("notifications").insert({
    recipient_id: params.accountantId,
    type: "vat_docs_submitted" as const,
    case_id: params.caseId,
    message: `${params.clientEmail} submitted VAT documents for ${params.periodLabel}. Ready to prepare the return.`,
  });
  logNotifyError(
    { type: "vat_docs_submitted", caseId: params.caseId },
    error,
  );
}

export async function insertVatApprovalReadyNotification(params: {
  caseId: string;
  clientId: string;
  periodLabel: string;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("notifications").insert({
    recipient_id: params.clientId,
    type: "vat_approval_ready" as const,
    case_id: params.caseId,
    message: `Your VAT return for ${params.periodLabel} is ready to review and approve.`,
  });
  logNotifyError(
    { type: "vat_approval_ready", caseId: params.caseId },
    error,
  );
}

export async function insertVatFiledNotification(params: {
  caseId: string;
  accountantId: string;
  clientEmail: string;
  periodLabel: string;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("notifications").insert({
    recipient_id: params.accountantId,
    type: "vat_filed" as const,
    case_id: params.caseId,
    message: `${params.clientEmail} approved and filed VAT for ${params.periodLabel}. Next cycle is open.`,
  });
  logNotifyError({ type: "vat_filed", caseId: params.caseId }, error);
}

// Notify every admin AND the calendar owner (looked up by email so
// the booking primer reaches whoever actually owns the Google
// calendar, even if they aren't an admin) the moment a scoping-call
// booking lands. This is load-bearing: the service-account path can't
// auto-attach a Meet link, so the owner has to add one manually to
// the newly-created event. Discovery-by-chance is the failure mode
// this notification exists to prevent.
export async function insertBookingCreatedNotifications(params: {
  attendeeEmail: string;
  attendeeName: string;
  serviceLabel: string;
  humanLabel: string; // e.g. "Monday 12 October 2026 at 10:30"
  calendarOwnerEmail: string;
  eventHtmlLink: string;
  // True when the booking was created via the OAuth2 owner path and
  // Google already auto-attached a Meet link + sent the native invite.
  // False (default) when the service-account fallback is in play and
  // the admin has to attach a Meet link manually.
  meetAttached?: boolean;
}) {
  const admin = createAdminClient();
  const { data: adminUsers } = await admin
    .from("users")
    .select("id, email")
    .eq("role", "admin");
  const { data: ownerUser } = await admin
    .from("users")
    .select("id, email")
    .eq("email", params.calendarOwnerEmail)
    .maybeSingle();

  const byId = new Map<string, { id: string; email: string }>();
  for (const a of adminUsers ?? []) byId.set(a.id, a);
  if (ownerUser) byId.set(ownerUser.id, ownerUser);
  if (byId.size === 0) return;

  const message = params.meetAttached
    ? `New scoping call booked for ${params.humanLabel}: ${params.attendeeName} ` +
      `<${params.attendeeEmail}> · ${params.serviceLabel}. ` +
      `Native calendar invite + Meet link have been sent to the client.`
    : `New scoping call booked for ${params.humanLabel}: ${params.attendeeName} ` +
      `<${params.attendeeEmail}> · ${params.serviceLabel}. ` +
      `Add a Google Meet link to the event and send it to the client.`;

  const rows = [...byId.values()].map((u) => ({
    recipient_id: u.id,
    type: "booking_created" as const,
    case_id: null,
    message,
  }));

  const { error } = await admin.from("notifications").insert(rows);
  logNotifyError(
    { type: "booking_created", recipientCount: rows.length },
    error,
  );
}

// Client-facing enquiry transitions. Admin flips status via
// setServiceEnquiryStatusAction; both 'contacted' and 'closed' need
// to reach the client so they aren't left wondering what happened.
// 'new' isn't exposed as a transition because the row starts there
// and admin never flips back.
export async function insertEnquiryStatusNotification(params: {
  clientId: string;
  status: "contacted" | "closed";
  serviceLabel: string;
}) {
  const admin = createAdminClient();
  const message =
    params.status === "contacted"
      ? `Someone from Sterling Ledger has picked up your ${params.serviceLabel} enquiry — look out for an email or call.`
      : `Your ${params.serviceLabel} enquiry has been closed. If you weren't expecting that, reply to our last email and we'll take another look.`;
  const { error } = await admin.from("notifications").insert({
    recipient_id: params.clientId,
    type:
      params.status === "contacted"
        ? ("enquiry_contacted" as const)
        : ("enquiry_closed" as const),
    case_id: null,
    message,
  });
  logNotifyError(
    {
      type:
        params.status === "contacted" ? "enquiry_contacted" : "enquiry_closed",
    },
    error,
  );
}

// Client-facing notification fired when admin turns a bespoke enquiry
// into a priced case. Lands the client on the new case page where they
// sign the engagement letter and pay the quoted fee.
export async function insertEnquiryQuotedNotification(params: {
  clientId: string;
  caseId: string;
  feeGbp: number;
  serviceLabel: string;
  note: string | null;
}) {
  const admin = createAdminClient();
  const noteSuffix = params.note?.trim() ? ` Note: ${params.note.trim()}` : "";
  const message =
    `Sterling Ledger has prepared a bespoke quote of £${params.feeGbp} for your ${params.serviceLabel} enquiry. ` +
    `Review and sign the engagement letter to continue.` +
    noteSuffix;
  const { error } = await admin.from("notifications").insert({
    recipient_id: params.clientId,
    type: "enquiry_quoted" as const,
    case_id: params.caseId,
    message,
  });
  logNotifyError({ type: "enquiry_quoted", caseId: params.caseId }, error);
}

// Notify the accountant when admin approves or rejects their application.
export async function insertAccountantApprovalNotification(params: {
  accountantId: string;
  decision: "approved" | "rejected";
  note: string | null;
}) {
  const admin = createAdminClient();
  const message =
    params.decision === "approved"
      ? "Your Sterling Ledger account has been approved. Welcome aboard."
      : `Your account application wasn't approved${
          params.note?.trim() ? `: ${params.note.trim()}` : "."
        }`;
  const { error } = await admin.from("notifications").insert({
    recipient_id: params.accountantId,
    type: "accountant_approval_decision",
    case_id: null,
    message,
  });
  logNotifyError({ type: "accountant_approval_decision" }, error);
}

// Admin fan-out when a Stripe Checkout session for a case either
// expires (abandoned) or fails async. The client-facing email is
// sent separately from the webhook; this notification gives staff
// visibility so someone can nudge the client manually if the
// automated "we'll delete it in 3 days" nudge isn't enough.
export async function insertCasePaymentStalledNotification(params: {
  caseId: string;
  clientName: string;
  clientEmail: string;
  serviceLabel: string;
  reason: "expired" | "failed";
}) {
  const admin = createAdminClient();
  const { data: admins } = await admin
    .from("users")
    .select("id")
    .eq("role", "admin");
  if (!admins?.length) return;
  const verb =
    params.reason === "expired"
      ? "abandoned checkout"
      : "declined payment";
  const message =
    `Payment stalled — ${params.clientName} <${params.clientEmail}> ` +
    `${verb} on ${params.serviceLabel}. Case is still draft; will be ` +
    `swept by the stale-draft deletion if no retry.`;
  const { error } = await admin.from("notifications").insert(
    admins.map((a) => ({
      recipient_id: a.id,
      type: "case_payment_stalled" as const,
      case_id: params.caseId,
      message,
    })),
  );
  logNotifyError(
    {
      type: "case_payment_stalled",
      caseId: params.caseId,
      recipientCount: admins.length,
    },
    error,
  );
}

// Admin fan-out when a Stripe Checkout session for an add-on either
// expires or fails. Deliberately NO client email here — add-ons
// aren't swept by the stale-draft job so there's no deletion
// threat to warn about, and the client already sees the pending
// status on their case page. This is admin visibility only, so
// someone can reach out manually if a stall persists.
export async function insertAddonPaymentStalledNotification(params: {
  caseId: string;
  addonDescription: string;
  amountPence: number;
  clientName: string;
  clientEmail: string;
  reason: "expired" | "failed";
}) {
  const admin = createAdminClient();
  const { data: admins } = await admin
    .from("users")
    .select("id")
    .eq("role", "admin");
  if (!admins?.length) return;
  const verb =
    params.reason === "expired"
      ? "abandoned checkout"
      : "declined payment";
  const money = `£${(params.amountPence / 100).toFixed(2)}`;
  const short =
    params.addonDescription.length > 60
      ? params.addonDescription.slice(0, 57) + "..."
      : params.addonDescription;
  const message =
    `Add-on payment stalled — ${params.clientName} ` +
    `<${params.clientEmail}> ${verb} on ${money} ${short}.`;
  const { error } = await admin.from("notifications").insert(
    admins.map((a) => ({
      recipient_id: a.id,
      type: "addon_payment_stalled" as const,
      case_id: params.caseId,
      message,
    })),
  );
  logNotifyError(
    {
      type: "addon_payment_stalled",
      caseId: params.caseId,
      recipientCount: admins.length,
    },
    error,
  );
}
