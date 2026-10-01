# Limited Company Document Checklists

Transcribed from your three briefs (Dormant, Non-VAT Registered, VAT
Registered), combined into one spec since Sections A and B are identical
across all three. Defaults I've picked for the open questions are marked
**DEFAULT**, change any of them before building.

All three services: £400 flat (temporary, per your instruction).

---

## Shared: Section A — Company Details (all 3 services)

| Field | Required? |
|---|---|
| Company Authentication Code | Required. Show: "Without this we cannot make any changes or submit to Companies House." |
| Company UTR (from HMRC) | Required |
| VAT Registration Certificate | Required for VAT Registered. Optional for Dormant and Non-VAT Registered |
| PAYE Certificate | Optional, only if PAYE registered |
| HMRC letters | Optional |
| Companies House notices | Optional |
| Previous accountant's name and email | Optional, text fields, for professional clearance |

## Shared: Section B — Director's Details (all 3 services)

| Field | Required? |
|---|---|
| Passport | Required |
| Driving licence | Required (1st proof of address) |
| Bank statement or utility bill | Required (2nd proof of address) |
| National Insurance number | Required (NI card or letter) |
| Personal UTR | Optional |

## Shared: Section C — Registration Service (all 3 services)

- Question: "Do you need PAYE registration and monthly payslips?" (Yes / No)

**Footer message on every checklist:**
"Please provide all the information requested. Missing information will
delay your onboarding. Please also tell us as soon as possible if you have
any overdue Accounts, VAT, CIS or PAYE returns, so we can help you avoid
HMRC late filing penalties."

**Rule:** client cannot submit until every required item in their service's
sections is uploaded or filled in.

---

## Service 1: Dormant

After Sections A, B, C: **no further client-facing step.** Skip accounts
preparation documents entirely, not applicable for a dormant company.

Internal only, once onboarding is submitted:
1. Accountant prepares and uploads Annual Accounts and CT600 (both
   mandatory attachments) before the approval email can be sent.
2. Approval email sent to client (see email templates note below), client
   approves, accountant submits to Companies House and HMRC, case marked
   complete.

**DEFAULT:** since the £400 fee is already paid upfront on this platform
(unlike the original brief's "send a liability email" flow, which assumed
ongoing billing), the CT liability amount and payment reference becomes
informational content in the approval message/chat, not a new charge
through the platform. If CT is due, the message states the amount and
HMRC payment link, it does not trigger another Stripe payment.

---

## Service 2: Non-VAT Registered

After Sections A, B, C, client submits onboarding. Case goes to the
accountant queue as normal.

**Internal step (accountant):** confirms the company's accounting period
on Companies House, enters Period Start Date and Period End Date in the
case.

**Second client-facing step**, triggered once the accountant enters those
dates: a follow-up document request shown in the case, "Please upload the
following documents for the period {Period Start Date} to {Period End
Date}":

| Field | Required? |
|---|---|
| Company bank statements for the full period, PDF | Required |
| Company bank statements for the full period, CSV | Required |
| Company credit card statements | Optional |
| Sales documents / invoices | Optional |
| Purchase documents / invoices | Optional |
| Bill copies | Optional |
| PAYE summary | Required only if payroll registered (shows automatically if they uploaded a PAYE Certificate earlier, or the accountant marks them as payroll registered) |

**Rule:** client cannot submit this second step until both PDF and CSV
bank statements are uploaded.

Then: accountant prepares Annual Accounts + CT600 (both mandatory),
approval message to client (same CT-liability note as Dormant above),
client approves, accountant submits, case complete.

---

## Service 3: VAT Registered

Same as Non-VAT Registered (Sections A, B, C, then the accounting-period
documents step, then Annual Accounts + CT600 approval cycle), **plus**:

**Section D — VAT Details**, added to the initial onboarding (Section A-D
all shown together at signup, not a later step):

| Field | Required? |
|---|---|
| VAT Registration Number | Required. Must be exactly 9 digits, reject anything else |
| VAT Effective Date | Required, date field |
| Letter of VAT approval from HMRC | Required, upload |
| VAT return frequency | Required, dropdown: Monthly / Quarterly / Annually |
| VAT scheme | Required, dropdown: Flat Rate / Standard / Other. If "Other," show a free-text box for the scheme name |

**Internal step (accountant):** after reviewing the VAT approval letter,
enters the first VAT period end date. Future VAT periods are generated
automatically based on the chosen frequency (every 1, 3, or 12 months).
The recurring VAT cycle below cannot start until this date is entered.

**Recurring VAT cycle** (repeats every VAT period, runs alongside the
annual accounts cycle above, both live on the same case):

1. At the end of each period, client sees a document request: "Please
   upload the following documents for the VAT period {Start} to {End}":

   | Field | Required? |
   |---|---|
   | Company bank statement for this period | Required |
   | **DEFAULT, added:** Sales invoices / platform statements (for example Uber earnings statements) | Required, since output VAT comes from sales, this was missing from the original brief |
   | Purchase documents / invoices | Optional |
   | Bill copies | Optional |

2. Accountant prepares and uploads VAT Summary and VAT Detailed Report
   (both mandatory), and enters the VAT amount for the period.
3. Approval message to client, stating the VAT liability (or, if £0 or a
   refund, "No VAT is payable for this period, any repayment due will be
   paid by HMRC directly to the company's bank account"), **DEFAULT,
   added:** including a due date, VAT is normally due one month and seven
   days after the period ends, calculate this automatically.
4. Client approves, accountant submits to HMRC, period marked complete,
   cycle restarts at the next period end.

**DEFAULT on open format question:** VAT period bank statements are PDF
only (not PDF+CSV like the annual accounts step), since this repeats every
period and CSV is more useful for the once-a-year accounts prep than for a
quick VAT check. Change this if you'd rather match the annual accounts
format.

---

## On the liability/payment email content

The original briefs were written for a system that emails the client a
liability amount with HMRC bank details to pay HMRC directly, that part
stays as informational content (the client does owe HMRC, separately from
your £400 service fee), it does not trigger a second charge through
Stripe. Build it as a message or notification in the case, not a new
payment flow, unless you want it richer than that.
