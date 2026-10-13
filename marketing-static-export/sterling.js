// Vanilla replacements for the three bits that need JS once the
// Next hydration scripts are stripped: mobile nav toggle, FAQ
// accordion, audience tabs on the homepage. Plus the live pricing
// fetcher that keeps displayed prices synced with the admin catalog.
(function () {
  "use strict";

  var API_PRICING_URL = "https://apisterlingledger.co.uk/api/public/pricing";

  // --- Mobile nav toggle -----------------------------------------
  // Looks for a button with [data-mobile-menu-toggle] and a target
  // element with [data-mobile-menu]. The Next render uses aria-expanded
  // on the toggle button; we flip it + a .open class on the target.
  document.addEventListener("click", function (e) {
    var toggle = e.target.closest && e.target.closest("[data-mobile-menu-toggle]");
    if (!toggle) return;
    var target = document.querySelector("[data-mobile-menu]");
    if (!target) return;
    var open = target.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  // --- FAQ accordion ---------------------------------------------
  // Each FAQ item is a <details> element in the SSR HTML; browsers
  // handle open/close natively. Nothing to do, but we add a smooth
  // transition hook if the page uses a different structure.
  document.addEventListener("click", function (e) {
    var trigger = e.target.closest && e.target.closest("[data-faq-trigger]");
    if (!trigger) return;
    var item = trigger.closest("[data-faq-item]");
    if (!item) return;
    item.classList.toggle("open");
  });

  // --- Audience tabs on homepage ---------------------------------
  document.addEventListener("click", function (e) {
    var tab = e.target.closest && e.target.closest("[data-audience-tab]");
    if (!tab) return;
    var key = tab.getAttribute("data-audience-tab");
    var tabs = document.querySelectorAll("[data-audience-tab]");
    var panels = document.querySelectorAll("[data-audience-panel]");
    tabs.forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-audience-tab") === key);
    });
    panels.forEach(function (p) {
      p.hidden = p.getAttribute("data-audience-panel") !== key;
    });
  });

  // --- Pricing toggle (Personal / Business) ----------------------
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("[data-pricing-mode]");
    if (!btn) return;
    var mode = btn.getAttribute("data-pricing-mode");
    document.querySelectorAll("[data-pricing-mode]").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-pricing-mode") === mode);
    });
    document.querySelectorAll("[data-pricing-panel]").forEach(function (p) {
      p.hidden = p.getAttribute("data-pricing-panel") !== mode;
    });
  });

  // --- Live pricing fetcher --------------------------------------
  // Looks for elements marked data-tier-price="{tierId}" and swaps in
  // the latest price from the admin-edited catalog. When salePriceGbp
  // is set, renders strike-through was/now styling.
  //
  // Attribute conventions (apply during static-export post-processing
  // or hand-markup if you edit the HTML directly):
  //   <span data-tier-price="sole_trader">£199</span>
  //   <span data-tier-sub="sole_trader">one-off</span>
  //
  // If an element isn't present for a tier, we skip it silently so
  // this is additive — pages without pricing render fine.
  function renderPrice(el, tier) {
    if (tier.priceDisplay) {
      el.textContent = tier.priceDisplay;
      return;
    }
    if (tier.salePriceGbp != null) {
      // was/now with Sale badge. CSS lives at the end of styles.css.
      el.innerHTML =
        '<span class="price-was">£' + tier.priceGbp + '</span>' +
        '<span class="price-now">£' + tier.salePriceGbp + '</span>' +
        '<span class="price-sale-badge">Sale</span>';
    } else {
      el.textContent = "£" + tier.priceGbp;
    }
  }

  function fetchPricing() {
    fetch(API_PRICING_URL, { credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !Array.isArray(data.tiers)) return;
        data.tiers.forEach(function (tier) {
          document
            .querySelectorAll('[data-tier-price="' + tier.id + '"]')
            .forEach(function (el) { renderPrice(el, tier); });
        });
      })
      .catch(function () {
        // Silent failure — the HTML already has the price at build
        // time as a fallback. User still sees a number.
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fetchPricing);
  } else {
    fetchPricing();
  }
})();
