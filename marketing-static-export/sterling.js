// Vanilla replacements for the three bits that need JS once the
// Next hydration scripts are stripped: mobile nav toggle, FAQ
// accordion, audience tabs on the homepage. Plus the live pricing
// fetcher that keeps displayed prices synced with the admin catalog.
(function () {
  "use strict";

  var API_PRICING_URL = "https://apisterlingledger.co.uk/api/public/pricing";
  var API_BOOKING_SLOTS = "https://apisterlingledger.co.uk/api/public/booking/slots";
  var API_BOOKING_CREATE = "https://apisterlingledger.co.uk/api/public/booking/create";
  var CONTACT_FORM_URL = "https://script.google.com/macros/s/AKfycbyCpxrGTxr5C19pPUjkoJsO19LuHzKRjZwa_ZE2u4v0E8Zho4N8q23BDCjWbP4OkNrr/exec";

  // Captured from step 1 so the step-2 picker can POST the booking
  // without asking the user to re-type their details.
  var contactFields = { name: "", phone: "", email: "", message: "" };

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
        contactFields = {
          name: fields.name,
          phone: fields.phone,
          email: fields.email,
          message: fields.message,
        };
        advanceStep(form, 2);
        initBookingPicker();
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
  // above) advances 1, 2 on successful POST. "I have booked" or
  // "Skip" button advances 2, 3. No reload between steps; animated
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

  // --- Booking picker (contact page step 2) ------------------------
  // Vanilla equivalent of src/components/booking/booking-picker.tsx.
  // Called when step 1 submits; walks the user through
  //   pick day -> pick 15-min slot -> confirm -> POST /api/public/
  //   booking/create -> advance to step 3 with Meet link.
  // Honeypot field is in the markup; empty on success means human.
  //
  // State is per-page (one picker instance). Multiple contact pages
  // on one page is not a thing we ship, so no instance guard needed.

  var DAYS_TO_SHOW = 10;
  var PAGE_STEP = 5;
  var MAX_WORKING_DAYS = 40;
  var SLOT_MINUTES = 15;
  var picker = {
    initialised: false,
    startOffset: 0,
    selectedDate: null,
    slots: null,
    slotsLoading: false,
    pickedSlot: null,
    busy: false,
  };

  function pickerEls() {
    var root = document.querySelector("[data-booking-picker]");
    if (!root) return null;
    return {
      root: root,
      daysRow: root.querySelector("[data-booking-days]"),
      prev: root.querySelector("[data-booking-prev]"),
      next: root.querySelector("[data-booking-next]"),
      slotsBox: root.querySelector("[data-booking-slots]"),
      confirmBox: root.querySelector("[data-booking-confirm]"),
      errorEl: root.querySelector("[data-booking-error]"),
      honeypot: root.querySelector('input[name="_website_url"]'),
    };
  }

  function toLondonYmd(d) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  }

  function isWorkingDay(ymd) {
    var p = ymd.split("-");
    var dow = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
    return dow >= 1 && dow <= 5;
  }

  function getWorkingDaysWindow(startOffset, windowSize) {
    var out = [];
    var start = new Date();
    var collected = 0;
    for (var cal = 0; collected < startOffset + windowSize && cal < 200; cal++) {
      var d = new Date(start);
      d.setDate(d.getDate() + cal);
      var ymd = toLondonYmd(d);
      if (!isWorkingDay(ymd)) continue;
      if (collected >= startOffset) out.push(ymd);
      collected += 1;
    }
    return out;
  }

  function parseDayParts(ymd) {
    var p = ymd.split("-");
    var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return {
      dayName: dt.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
      dateNum: String(+p[2]),
      month: dt.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }),
      isToday: toLondonYmd(new Date()) === ymd,
    };
  }

  function longHumanDate(iso) {
    return new Date(iso).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/London",
    });
  }

  function humanTime(iso) {
    var time = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
    return longHumanDate(iso) + " at " + time;
  }

  function renderDays() {
    var els = pickerEls();
    if (!els) return;
    var days = getWorkingDaysWindow(picker.startOffset, DAYS_TO_SHOW);
    if (picker.selectedDate && days.indexOf(picker.selectedDate) === -1) {
      picker.selectedDate = days[0] || null;
    }
    if (!picker.selectedDate) picker.selectedDate = days[0] || null;
    els.daysRow.innerHTML = "";
    days.forEach(function (ymd) {
      var p = parseDayParts(ymd);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "booking-day-card" + (ymd === picker.selectedDate ? " active" : "");
      btn.setAttribute("data-ymd", ymd);
      btn.setAttribute("aria-pressed", ymd === picker.selectedDate ? "true" : "false");
      btn.innerHTML =
        '<span class="booking-day-name">' + p.dayName + "</span>" +
        '<span class="booking-day-num">' + p.dateNum + "</span>" +
        '<span class="booking-day-month">' + p.month + "</span>" +
        (p.isToday && ymd !== picker.selectedDate ? '<span class="booking-day-today-dot" aria-hidden="true"></span>' : "");
      btn.addEventListener("click", function () {
        picker.selectedDate = ymd;
        picker.pickedSlot = null;
        renderDays();
        renderConfirm();
        loadSlots();
      });
      els.daysRow.appendChild(btn);
    });
    els.prev.disabled = picker.startOffset <= 0;
    els.next.disabled = picker.startOffset + DAYS_TO_SHOW >= MAX_WORKING_DAYS;
  }

  function pageBy(delta) {
    var next = Math.max(0, Math.min(picker.startOffset + delta, Math.max(0, MAX_WORKING_DAYS - DAYS_TO_SHOW)));
    if (next === picker.startOffset) return;
    picker.startOffset = next;
    renderDays();
    loadSlots();
  }

  function loadSlots() {
    if (!picker.selectedDate) return;
    var els = pickerEls();
    if (!els) return;
    picker.slots = null;
    picker.slotsLoading = true;
    picker.pickedSlot = null;
    renderSlots();
    renderConfirm();
    var url = API_BOOKING_SLOTS + "?date=" + encodeURIComponent(picker.selectedDate);
    fetch(url, { credentials: "omit" })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        picker.slotsLoading = false;
        if (!res.ok) {
          showError(res.data && res.data.error ? res.data.error : "Could not load times.");
          picker.slots = [];
        } else {
          clearError();
          picker.slots = Array.isArray(res.data.slots) ? res.data.slots : [];
        }
        renderSlots();
      })
      .catch(function () {
        picker.slotsLoading = false;
        picker.slots = [];
        showError("Could not load times. Check your connection and try again.");
        renderSlots();
      });
  }

  function splitMorningAfternoon(slots) {
    var m = [], a = [];
    for (var i = 0; i < slots.length; i++) {
      var hour = parseInt(String(slots[i].label).slice(0, 2), 10);
      if (hour < 12) m.push(slots[i]); else a.push(slots[i]);
    }
    return { morning: m, afternoon: a };
  }

  function renderSlots() {
    var els = pickerEls();
    if (!els) return;
    var box = els.slotsBox;
    box.setAttribute("aria-busy", picker.slotsLoading ? "true" : "false");
    if (picker.slotsLoading) {
      box.innerHTML = skeletonHtml();
      return;
    }
    if (!picker.slots || picker.slots.length === 0) {
      box.innerHTML = emptyDayHtml();
      return;
    }
    var g = splitMorningAfternoon(picker.slots);
    var html = "";
    if (g.morning.length) html += groupHtml("Morning", g.morning);
    if (g.afternoon.length) html += groupHtml("Afternoon", g.afternoon);
    box.innerHTML = html;
    box.querySelectorAll(".booking-slot-pill").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var i = +btn.getAttribute("data-slot-i");
        var g2 = splitMorningAfternoon(picker.slots);
        var group = btn.getAttribute("data-slot-group") === "morning" ? g2.morning : g2.afternoon;
        picker.pickedSlot = group[i];
        renderSlots();
        renderConfirm();
      });
    });
  }

  function groupHtml(label, slots) {
    var items = slots.map(function (s, i) {
      var active = picker.pickedSlot && picker.pickedSlot.startIso === s.startIso;
      return '<button type="button" class="booking-slot-pill' + (active ? " active" : "") +
        '" data-slot-group="' + label.toLowerCase() + '" data-slot-i="' + i + '" aria-pressed="' + (active ? "true" : "false") + '">' +
        escHtml(s.label) + "</button>";
    }).join("");
    return '<div class="booking-slot-group">' +
      '<div class="booking-slot-group-label">' + label + "</div>" +
      '<div class="booking-slot-grid">' + items + "</div>" +
      "</div>";
  }

  function skeletonHtml() {
    var pills = "";
    for (var i = 0; i < 20; i++) pills += '<div class="booking-slot-skeleton"></div>';
    return '<div class="booking-slot-group">' +
      '<div class="booking-slot-group-label">Loading</div>' +
      '<div class="booking-slot-grid">' + pills + "</div>" +
      "</div>";
  }

  function emptyDayHtml() {
    return '<div class="booking-empty-day">' +
      '<p class="booking-empty-title">No times available on this day.</p>' +
      '<p class="booking-empty-body">Try another day from the row above.</p>' +
      "</div>";
  }

  function renderConfirm() {
    var els = pickerEls();
    if (!els) return;
    if (!picker.pickedSlot) {
      els.confirmBox.hidden = true;
      els.confirmBox.innerHTML = "";
      return;
    }
    var slot = picker.pickedSlot;
    var p = parseDayParts(toLondonYmd(new Date(slot.startIso)));
    els.confirmBox.hidden = false;
    els.confirmBox.innerHTML =
      '<div class="booking-section-label">Confirm your call</div>' +
      '<div class="booking-confirm-row">' +
        '<div class="booking-confirm-chip" aria-hidden="true">' +
          '<span class="booking-day-name">' + p.dayName + "</span>" +
          '<span class="booking-day-num">' + p.dateNum + "</span>" +
          '<span class="booking-day-month">' + p.month + "</span>" +
        "</div>" +
        '<div class="booking-confirm-copy">' +
          '<div class="booking-confirm-date">' + escHtml(longHumanDate(slot.startIso)) + "</div>" +
          '<div class="booking-confirm-time"><strong>' + escHtml(slot.label) + "</strong> &middot; " + SLOT_MINUTES + " minutes</div>" +
          '<div class="booking-confirm-note">Video call link to <strong>' + escHtml(contactFields.email || "your email") + "</strong>.</div>" +
        "</div>" +
      "</div>" +
      '<button type="button" data-booking-confirm-btn class="btn-sl btn-sl-primary booking-confirm-btn">Confirm booking</button>';
    els.confirmBox.querySelector("[data-booking-confirm-btn]").addEventListener("click", submitBooking);
  }

  function submitBooking() {
    if (picker.busy || !picker.pickedSlot) return;
    var els = pickerEls();
    if (!els) return;
    picker.busy = true;
    clearError();
    var btn = els.confirmBox.querySelector("[data-booking-confirm-btn]");
    if (btn) { btn.disabled = true; btn.textContent = "Booking..."; }
    var payload = {
      startIso: picker.pickedSlot.startIso,
      attendeeName: contactFields.name,
      attendeeEmail: contactFields.email,
      attendeePhone: contactFields.phone,
      message: contactFields.message,
      _website_url: els.honeypot ? els.honeypot.value : "",
    };
    fetch(API_BOOKING_CREATE, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); })
      .then(function (res) {
        picker.busy = false;
        if (!res.ok) {
          showError(res.data && res.data.error ? res.data.error : "Could not book that time.");
          if (btn) { btn.disabled = false; btn.textContent = "Confirm booking"; }
          // Race: slot taken while picking. Refresh slots.
          if (res.status === 500) loadSlots();
          return;
        }
        advanceToDoneWithMeet(res.data.meetLink, res.data.htmlLink, picker.pickedSlot.startIso);
      })
      .catch(function (err) {
        picker.busy = false;
        if (btn) { btn.disabled = false; btn.textContent = "Confirm booking"; }
        showError("Could not reach the booking service. Try again.");
      });
  }

  function advanceToDoneWithMeet(meetLink, htmlLink, startIso) {
    var meetEl = document.querySelector("[data-booking-done-meet]");
    var bodyEl = document.querySelector("[data-booking-done-body]");
    if (bodyEl) {
      bodyEl.textContent =
        "Your call is confirmed for " + humanTime(startIso) + ". We've also sent a confirmation email to " +
        contactFields.email + ".";
    }
    if (meetEl) {
      if (meetLink) {
        meetEl.hidden = false;
        meetEl.innerHTML =
          '<a class="btn-sl btn-sl-primary" href="' + escAttr(meetLink) + '" target="_blank" rel="noopener">Join the video call</a>' +
          (htmlLink ? ' <a class="btn-sl btn-sl-outline" href="' + escAttr(htmlLink) + '" target="_blank" rel="noopener">Open the calendar event</a>' : "");
      } else if (htmlLink) {
        // No Meet link yet (service-account path), so the calendar
        // event is the only action. Promote to primary so visitors
        // see one clear button instead of a vague secondary.
        meetEl.hidden = false;
        meetEl.innerHTML =
          '<a class="btn-sl btn-sl-primary" href="' + escAttr(htmlLink) + '" target="_blank" rel="noopener">Open the calendar event</a>';
      }
    }
    var trigger = document.querySelector("[data-booking-picker]");
    if (trigger) advanceStep(trigger, 3);
  }

  function showError(text) {
    var els = pickerEls();
    if (!els || !els.errorEl) return;
    els.errorEl.textContent = text;
    els.errorEl.hidden = false;
  }
  function clearError() {
    var els = pickerEls();
    if (!els || !els.errorEl) return;
    els.errorEl.textContent = "";
    els.errorEl.hidden = true;
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function escAttr(s) { return escHtml(s); }

  function initBookingPicker() {
    var els = pickerEls();
    if (!els) return;
    if (!picker.initialised) {
      els.prev.addEventListener("click", function () { pageBy(-PAGE_STEP); });
      els.next.addEventListener("click", function () { pageBy(PAGE_STEP); });
      picker.initialised = true;
    }
    picker.startOffset = 0;
    picker.pickedSlot = null;
    picker.selectedDate = null;
    renderDays();
    loadSlots();
  }
})();
