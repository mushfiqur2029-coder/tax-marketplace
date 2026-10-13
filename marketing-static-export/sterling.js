// Vanilla replacements for the three bits that need JS once the
// Next hydration scripts are stripped: mobile nav toggle, FAQ
// accordion, audience tabs on the homepage. Plus the live pricing
// fetcher that keeps displayed prices synced with the admin catalog.
(function () {
  "use strict";

  var API_PRICING_URL = "https://apisterlingledger.co.uk/api/public/pricing";
  var CONTACT_FORM_URL = "https://script.google.com/macros/s/AKfycbyCpxrGTxr5C19pPUjkoJsO19LuHzKRjZwa_ZE2u4v0E8Zho4N8q23BDCjWbP4OkNrr/exec";

  // --- Contact form submit ---------------------------------------
  // Posts to the Apps Script Web App which appends a row to the
  // contact-form Google Sheet. Uses form-encoded body (no custom
  // Content-Type header) + mode:"no-cors" so the browser doesn't
  // trigger a preflight AND doesn't try to read the opaque redirect
  // response (Apps Script 302s to a googleusercontent URL whose CORS
  // headers we can't rely on). Success is inferred from no network
  // error — the row-append already happened server-side by then.
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form || !form.matches || !form.matches("[data-contact-form]")) return;
    e.preventDefault();
    var statusEl = form.querySelector("[data-contact-status]");
    var submitBtn = form.querySelector("button[type='submit']");
    var fields = {
      name: (form.querySelector("[name='name']") || {}).value || "",
      phone: (form.querySelector("[name='phone']") || {}).value || "",
      email: (form.querySelector("[name='email']") || {}).value || "",
      message: (form.querySelector("[name='message']") || {}).value || "",
    };
    if (!fields.message.trim()) {
      setStatus(statusEl, "Please add a message so we know what you're asking.", "error");
      return;
    }
    if (!fields.name.trim() && !fields.email.trim() && !fields.phone.trim()) {
      setStatus(statusEl, "Add your name, email, or phone so we can get back to you.", "error");
      return;
    }
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Sending..."; }
    setStatus(statusEl, "", null);

    var body = new URLSearchParams(fields);
    fetch(CONTACT_FORM_URL, { method: "POST", mode: "no-cors", body: body })
      .then(function () {
        // no-cors response is opaque; if we got here without throwing,
        // the request reached Apps Script and doPost ran. Confirm with
        // a success message.
        form.reset();
        setStatus(
          statusEl,
          "Thanks — we've got your message. We'll be in touch within one working day.",
          "ok",
        );
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Send message"; }
      })
      .catch(function () {
        setStatus(
          statusEl,
          "Couldn't send that just now. Try again in a minute, or email us at info@sterlingledger.co.uk.",
          "error",
        );
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Send message"; }
      });
  });

  function setStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text;
    el.classList.remove("ok", "error");
    if (kind) el.classList.add(kind);
    el.hidden = !text;
  }

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
    var open = item.classList.toggle("open");
    // Flip aria-expanded on the button for screen reader a11y.
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
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
    // Slide the knob. CSS rule .pt-switch.on .pt-knob positions the
    // knob on the right. .on === business mode, no class === personal.
    var sw = document.querySelector(".pt-switch");
    if (sw) sw.classList.toggle("on", mode === "business");
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
