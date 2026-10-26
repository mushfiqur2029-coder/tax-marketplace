// Preview-only harness. Mocks the server-only shim so we can render
// the letter HTML outside the Next.js runtime.
import Module from "node:module";
const require = Module.createRequire(import.meta.url);
Module._load_original = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return Module._load_original(request, parent, isMain);
};

const mod = await import("../src/lib/pch/sa-forwarding-letter.ts");
const { renderSaForwardingLetterHtml, FIRM_TRADING_NAME, FIRM_LEGAL_NAME, FIRM_ADDRESS, buildPaymentRef } = mod;

const snapshot = {
  tax: {
    totalTaxAndNic: 7842.60,
    balancingPayment: 7842.60,
    poaForNextYear: 3921.30,
    dueBy31Jan: 11763.90,
    dueBy31Jul: 3921.30,
  },
};

const html = renderSaForwardingLetterHtml({
  taxpayerName: "Alex Driver",
  address: "12 Example Street, Romford",
  postcode: "RM1 1AA",
  utr: "1234567890",
  taxYear: "2024/25",
  snapshot,
});

const text = html
  .replace(/<style[\s\S]*?<\/style>/g, "")
  .replace(/<br\s*\/?>/g, "\n")
  .replace(/<\/(p|div|h1|h2|li|span)>/g, "\n")
  .replace(/<[^>]+>/g, "")
  .replace(/\n[ \t]+/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .trim();

console.log(text);
console.log("\n--- derived values ---");
console.log("Payment ref:", buildPaymentRef("1234567890"));
console.log("Firm trading name:", FIRM_TRADING_NAME);
console.log("Firm legal name :", FIRM_LEGAL_NAME);
console.log("Firm address    :", FIRM_ADDRESS);
