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
  // error, the row-append already happened server-side by then.
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
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Continue"; }
        advanceStep(form, 2);
      })
      .catch(function () {
        setStatus(
          statusEl,
          "Could not send that just now. Try again in a minute, or email us at info@sterlingledger.co.uk.",
          "error",
        );
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Continue"; }
      });
  });

  // --- Contact flow step transitions ------------------------------
  // 3-step flow: 1 details, 2 booking, 3 done. Form submit (handler
  // above) advances 1 to 2 on successful POST. "I have booked" or
  // "Skip" button advances 2 to 3. No reload between steps; animated
  // via the .active class.
  document.addEventListener("click", function (e) {
    var next = e.target.closest && e.target.closest("[data-step-done],[data-step-skip]");
    if (!next) return;
    advanceStep(next, 3);
  });

  function advanceStep(fromEl, targetStep) {
    var flow = fromEl.closest ? fromEl.closest("[data-contact-flow]") : null;
    if (!flow) return;
    flow.querySelectorAll("[data-step]").forEach(function (section) {
      section.hidden = String(section.getAttribute("data-step")) !== String(targetStep);
    });
    var indicator = flow.parentElement ? flow.parentElement.querySelector("[data-step-indicator]") : null;
    if (indicator) {
      indicator.querySelectorAll("[data-step-marker]").forEach(function (li) {
        var n = parseInt(li.getAttribute("data-step-marker"), 10);
        li.classList.toggle("done", n < targetStep);
        li.classList.toggle("active", n === targetStep);
      });
    }
    // Scroll the new step into view smoothly.
    var newStep = flow.querySelector('[data-step="' + targetStep + '"]');
    if (newStep && newStep.scrollIntoView) {
      newStep.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // On page load, mark step 1 as the active indicator step so the
  // visual starts clean.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initStepIndicator);
  } else {
    initStepIndicator();
  }
  function initStepIndicator() {
    var items = document.querySelectorAll("[data-step-marker]");
    if (!items.length) return;
    items.forEach(function (li) {
      var n = parseInt(li.getAttribute("data-step-marker"), 10);
      li.classList.toggle("active", n === 1);
    });
  }

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
  // this is additive, pages without pricing render fine.
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
        // Silent failure, the HTML already has the price at build
        // time as a fallback. User still sees a number.
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fetchPricing);
  } else {
    fetchPricing();
  }
})();
