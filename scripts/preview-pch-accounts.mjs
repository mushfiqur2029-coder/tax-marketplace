import Module from "node:module";
Module._load_original = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return Module._load_original(request, parent, isMain);
};

const mod = await import("../src/lib/pch/pch-accounts-pdf.ts");
const { renderPchAccountsHtml } = mod;

const snapshot = {
  pl: {
    turnover: 36500,
    expensesTotal: 12300,
    netProfit: 24200,
    capitalAllowances: 1800,
    taxableProfit: 22400,
    rows: {
      fares: 34000,
      otherTrading: 1500,
      vatReceived: 1000,
      vehicleRunningCosts: 4500,
      vehicleHireLeaseFinance: 0,
      mileageAllowance: 0,
      congestionUlezTollsParking: 1200,
      licencesCompliance: 400,
      phoneTechnology: 300,
      platformCardFees: 2800,
      financeBankCharges: 0,
      accountancyInsurance: 2100,
      otherExpenses: 700,
      vatPaidFrs: 300,
    },
  },
  tax: {
    totalTaxAndNic: 3842.60,
    personalAllowance: 12570,
    taxableIncome: 9830,
    balancingPayment: 3842.60,
    poaForNextYear: 1921.30,
    dueBy31Jan: 5763.90,
    dueBy31Jul: 1921.30,
  },
};

const html = renderPchAccountsHtml({
  taxpayerName: "Alex Driver",
  address: "12 Example Street, Romford",
  postcode: "RM1 1AA",
  utr: "1234567890",
  taxYear: "2024/25",
  snapshot,
  // Preview-only sample lines; the real action pulls these from
  // pch_income_lines / pch_expense_lines. Keeping them empty here is
  // fine - the P&L page then shows every fixed slot at £0.
  incomeLines: [],
  expenseLines: [],
  declarationStatuses: {
    p11d: "applicable",
    interest: "not_applicable",
    dividend: "not_applicable",
    capital_gains: "not_applicable",
    rental: "not_applicable",
    pension: "applicable",
    gift_aid: "applicable",
    child_benefit: "not_applicable",
    overseas: "not_applicable",
    student_loan: "applicable",
    anything_else: "not_applicable",
  },
  decl: {
    p11dPence: 125000,
    employmentIncomePence: 850000,
    benefitsNote: "Company car + private medical",
    bankInterestPence: 0,
    dividendIncomePence: 0,
    capitalGainsPence: 0,
    capitalGainsNote: "",
    grossRentReceivedPence: 0,
    rentalProfitPence: 0,
    personalPensionNetPence: 80000,
    giftAidNetPence: 15000,
    childBenefitPence: 0,
    overseasIncomePence: 0,
    overseasTaxPaidPence: 0,
    studentLoanPlan: "Plan 2",
    anythingElseNote: "",
    giftAidEntries: [
      { charity_name: "British Red Cross", donation_date: "2024-12-20", amount_pence: 10000 },
      { charity_name: "Shelter",           donation_date: "2025-02-14", amount_pence: 5000 },
    ],
  },
  clientApproval: null,
  generatedAt: new Date("2026-10-26T10:00:00Z"),
});

// Strip HTML to a plain-text approximation. Preserve page breaks.
const text = html
  .replace(/<style[\s\S]*?<\/style>/g, "")
  .replace(/<section class="page[^"]*"[^>]*>/g, "\n\n========================\n")
  .replace(/<\/section>/g, "")
  .replace(/<br\s*\/?>/g, "\n")
  .replace(/<\/(p|div|h1|h2|h3|li|tr)>/g, "\n")
  .replace(/<\/td>/g, "   ")
  .replace(/<\/th>/g, "   ")
  .replace(/<[^>]+>/g, "")
  .replace(/\n[ \t]+/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .replace(/&amp;/g, "&")
  .replace(/&middot;/g, "·")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .trim();

console.log(text);
