// Returns-owed helper. Service-agnostic (applies to every automated
// self-assessment flow, not just PCH drivers).
//
// Given a client's trading start date (and optional stop date), the
// list of years they have already filed for, and today's date, this
// function lists every UK tax year they still owe a return for, with
// each year's HMRC deadlines and overdue flags.
//
// Rules (per gov.uk/self-assessment-tax-returns/deadlines):
//   - UK tax year runs 6 April to 5 April
//   - Registration deadline for a new taxpayer: 5 October after the
//     END of the first tax year they traded in
//   - Online filing deadline: 31 January after the end of the tax year
//   - Balancing payment deadline: 31 January (same as filing)
//
// The caller provides `alreadyFiledYears` as a list of tax-year strings
// in "YYYY/YY" format (e.g. "2024/25"). The helper omits those years
// from its output. Years owed are returned oldest first.

import type { ReturnsOwed, UkTaxYear, ReturnOwedForYear } from "./types";

// Convert a Date to a UK tax year label. Dates on or after 6 April of
// year N belong to tax year N/N+1; dates before 6 April belong to N-1/N.
export function dateToTaxYear(d: Date): UkTaxYear {
  const y = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0 = Jan
  const day = d.getUTCDate();
  const onOrAfterApr6 =
    month > 3 || (month === 3 && day >= 6); // month 3 = April
  const startYear = onOrAfterApr6 ? y : y - 1;
  const endYear = startYear + 1;
  return startYear + "/" + String(endYear).slice(-2);
}

// Opposite direction: tax-year string → { yearStart, yearEnd } Date pair
// (both at UTC midnight on 6 April).
export function taxYearBounds(ty: UkTaxYear): { yearStart: Date; yearEnd: Date } {
  const m = ty.match(/^(\d{4})\/(\d{2})$/);
  if (!m) throw new Error("Invalid tax year label (want YYYY/YY): " + ty);
  const startYear = Number(m[1]);
  const yearStart = new Date(Date.UTC(startYear, 3, 6)); // 6 April startYear
  const yearEnd = new Date(Date.UTC(startYear + 1, 3, 5));
  return { yearStart, yearEnd };
}

// Deadlines are keyed off the tax-year end:
//   registration: 5 October of the calendar year the tax year ended in
//                 (first year of trading only — subsequent years do not
//                 have a separate registration deadline, so we still
//                 emit it per-year but only flag "missed" for the first)
//   filing:       31 January of the calendar year AFTER the tax year end
//   payment:      31 January of the same date
function deadlinesForYear(ty: UkTaxYear): {
  registrationDeadline: Date;
  filingDeadline: Date;
  paymentDeadline: Date;
} {
  const { yearEnd } = taxYearBounds(ty);
  const endYear = yearEnd.getUTCFullYear();
  return {
    registrationDeadline: new Date(Date.UTC(endYear, 9, 5)), // 5 October endYear
    filingDeadline: new Date(Date.UTC(endYear + 1, 0, 31)),  // 31 January endYear+1
    paymentDeadline: new Date(Date.UTC(endYear + 1, 0, 31)),
  };
}

export type ReturnsOwedInput = {
  tradingStartDate: Date;
  tradingEndDate?: Date | null;
  alreadyFiledYears: UkTaxYear[];
  asOf?: Date;
};

export function computeReturnsOwed(input: ReturnsOwedInput): ReturnsOwed {
  const asOf = input.asOf ?? new Date();
  const filedSet = new Set(input.alreadyFiledYears);

  const firstYear = dateToTaxYear(input.tradingStartDate);
  // Last year the client has traded in. If they stopped, use that year.
  // Otherwise use the tax year of today — but ONLY once that year has
  // ended, because you cannot owe a return for a year that is still in
  // progress. For a year still in progress we include it only when the
  // trading has stopped before 5 April (i.e. end of year), i.e. the
  // tradingEndDate branch.
  const stopYear = input.tradingEndDate
    ? dateToTaxYear(input.tradingEndDate)
    : null;

  // Build the inclusive range of candidate tax years. For an ongoing
  // trader, we only consider tax years that have ENDED (yearEnd < asOf).
  const candidates: UkTaxYear[] = [];
  let cursorYear = Number(firstYear.split("/")[0]);
  const upperYear = stopYear
    ? Number(stopYear.split("/")[0])
    : (() => {
        // Most recent fully-ended tax year as of `asOf`.
        const curTy = dateToTaxYear(asOf);
        const curStart = Number(curTy.split("/")[0]);
        const { yearEnd } = taxYearBounds(curTy);
        // If the current year has ended already (asOf > 5 April), include it
        return asOf.getTime() > yearEnd.getTime() ? curStart : curStart - 1;
      })();
  while (cursorYear <= upperYear) {
    const ty = cursorYear + "/" + String(cursorYear + 1).slice(-2);
    candidates.push(ty);
    cursorYear += 1;
  }

  const years: ReturnOwedForYear[] = [];
  let anyOverdue = false;
  let anyRegMissed = false;
  for (const ty of candidates) {
    if (filedSet.has(ty)) continue;
    const { yearStart, yearEnd } = taxYearBounds(ty);
    const { registrationDeadline, filingDeadline, paymentDeadline } =
      deadlinesForYear(ty);
    const filingOverdue = asOf.getTime() > filingDeadline.getTime();
    // Registration deadline flag is only meaningful on the FIRST year
    // of trading; later years do not have a separate registration step.
    const isFirstYear = ty === firstYear;
    const registrationDeadlinePassed =
      isFirstYear && asOf.getTime() > registrationDeadline.getTime();
    if (filingOverdue) anyOverdue = true;
    if (registrationDeadlinePassed) anyRegMissed = true;
    years.push({
      taxYear: ty,
      yearStart,
      yearEnd,
      registrationDeadline,
      registrationDeadlinePassed,
      filingDeadline,
      filingOverdue,
      paymentDeadline,
    });
  }

  return {
    years,
    oldestOutstandingYear: years[0]?.taxYear ?? null,
    anyOverdue,
    anyRegistrationDeadlineMissed: anyRegMissed,
  };
}
