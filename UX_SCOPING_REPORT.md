# UX & Modernization Scoping Report
Date: 13 October 2026
Scope: static code review across the three portals + marketing site.
Not: live browser click-through (would be ~4 to 6 hours, not in this session's budget).

---

## 1. Design system, the shared primitives

**Current state:** reasonably clean. Everything routes through:
- `SLButton` (40 call sites), three variants (primary, outline, ghost)
- `PortalPageHeader` / `AdminPageHeader` (31 pages, every one)
- `card-sl` utility class
- `StatusPill`, `DeadlinePill`, `UrgentPill` (consistent pill vocabulary)
- `Brand`, `Avatar`, `BlobField`

**Design-system work (highest leverage, every surface benefits):**

| # | Issue | Difficulty | Impact |
|---|-------|------------|--------|
| D1 | Button variants are inconsistent ,  `btn-sl-primary` CSS + `SLButton` component coexist, same visual output but different APIs. Pick one. | S | High, removes a whole class of future drift |
| D2 | No explicit focus-visible ring on primary interactive elements. Fine for sighted mouse users; fails keyboard-only + screen-reader a11y. | S | Medium, a11y compliance |
| D3 | Typography scale: 7+ font-size × class combinations used across pages. Consolidate to 5 heading sizes + 3 body sizes with named classes (`.h1-sl`, `.h2-sl`, `.body-sm`, etc.). | M | High, visual consistency |
| D4 | Spacing: `space-y-{2,3,4,5,6,8,10,12}` used ad-hoc. Define a vertical rhythm (e.g. always 24px between major blocks, 12px between related, 8px tight). | S | Medium |
| D5 | Color tokens: `--navy-deep`, `--sky`, `--ink`, `--slate`, `--paper`, `--cloud`, `--line`, `--mint` ,  fine, but no semantic layer (`--color-primary`, `--color-success`, `--color-danger`). Add a semantic layer so modernization-themed re-colouring is a 10-line CSS change. | M | High, enables future theming |
| D6 | Icons are hand-rolled SVGs scattered in-file. No icon library, no `<Icon name="x">` component. Harder to replace globally. | M | Medium, polish |

---

## 2. Marketing static site (sterlingledger.co.uk)

**Current state:** 16 pages, flat export, live pricing, SEO meta.

| # | Issue | Difficulty | Impact |
|---|-------|------------|--------|
| M1 | Homepage hero is text-heavy, no illustration/screenshot of the actual product. Modern SV pattern: hero screenshot + 3-second video loop or static demo image. | M (asset creation + layout) | High |
| M2 | No Open Graph / Twitter Card meta tags. Links shared to Slack/LinkedIn render blank previews. | S | Medium |
| M3 | No structured data (JSON-LD for Organization, Service, FAQPage). SEO rich snippets won't show. | S | Medium |
| M4 | 3 of 16 pages are still `PlaceholderPage` content: `/about`, `/calculators`, `/guides`. Users click, see "Coming soon." | M | Medium, thin content vs real pages |
| M5 | No cookie banner. UK GDPR allows strictly-necessary without banner; if any analytics are added later, banner required. | S | Low (not needed yet) |
| M6 | Mobile tap targets: audited in Batch 4 to 44px minimum enforced on chat/attachment removes. Marketing site itself appears OK but hasn't been live-verified at mobile widths. | S | Medium |
| M7 | Page load: the Tailwind-compiled styles.css is 126 KB. Fine but modernization pass could tree-shake with a dedicated build. | M | Low (perf is acceptable now) |

---

## 3. Client portal

**Current state:** 11 pages, well-tracked case flow (`StepTracker` component).

| # | Issue | Difficulty | Impact |
|---|-------|------------|--------|
| C1 | **Case detail page (`/client/cases/[id]/page.tsx`, 681 lines)** is a wall of information. Progress bar + step tracker + status pill + urgent pill + deadline pill + addon panels + chat + document uploads all stacked. Needs progressive disclosure: tabs or accordions by state. | L | **High** ,  this is the main screen a client uses, dense. |
| C2 | No in-page notifications toast system, successes are shown as banners that persist, errors as inline red text. Modernize to a toast pattern (slide-in, auto-dismiss). | M | Medium |
| C3 | Payment and engagement flow has multiple "pay now" banners stacked at times (balance_pay_banner + addon_pay_banner). Collapse into one CTA pane that handles multiple pending payments. | M | Medium, reduces confusion |
| C4 | Mobile: `/client/cases/[id]` has a two-column grid at `lg:`. On tablet (≥768px, <1024px) it collapses to single column + the chat panel ends up below the main content. Chat is the primary interaction surface, needs sticky or floating button access on mobile+tablet. | M | **High** ,  mobile UX critical for future mobile apps |
| C5 | Empty states (no cases, no payments, no messages) use the same generic `EmptyState` component. Each context deserves copy specific to the next-action (e.g. "Start your first return" button right there). | S | Medium |
| C6 | Period-docs upload page is checklist-heavy. The checklist renders every required item linearly. Would benefit from progress indicator ("3 of 10 complete") stickied at top + grouping by section. | M | Medium |

---

## 4. Accountant portal

**Current state:** 5 pages, queue + my-cases pattern.

| # | Issue | Difficulty | Impact |
|---|-------|------------|--------|
| A1 | Case detail page carries the admin + client case data all at once (onboarding answers, period docs, VAT if applicable, addons, chat, status actions). Needs the same tabs-by-state treatment as C1. | L | **High** |
| A2 | Wallet page: shows wallet balance + withdrawal form in a single stack. Could be a two-pane overview ,  "Available / Pending / Withdrawn" cards up top, withdraw form in a dedicated right rail. | M | Medium |
| A3 | Queue page: cases are a flat list sorted by created_at. Modernize to filtering by segment (Personal / LC / VAT) + sort options (deadline soonest, highest fee, oldest). | M | Medium, productivity for busy accountants |
| A4 | No bulk actions. If an accountant has 10 open cases, every status update is per-row. Low priority at low scale. | L | Low |
| A5 | Pending accountant page (`/accountant/pending`) just shows "awaiting approval", no detail on what the admin reviews, no CTA. Could pre-populate accountant profile fields they can edit while waiting. | M | Medium |
| A6 | Mobile responsiveness of case detail: similar to C4, chat panel ends up below content on narrow screens. | M | High |

---

## 5. Admin portal

**Current state:** 15 pages, most densely-populated of the three.

| # | Issue | Difficulty | Impact |
|---|-------|------------|--------|
| X1 | **Admin dashboard (`/admin/page.tsx`, 540 lines)** mixes metrics header + cases list + stale-draft section. Modernize to a true dashboard: metric cards up top (count-up on load), activity feed, split-view "cases by status" sections. | L | **High** |
| X2 | **Admin case detail page (`/admin/cases/[id]/page.tsx`, 1014 lines)** is the biggest page in the app. Shows everything about a case: client, accountant, status, engagement, onboarding, period docs, VAT, addons, chat, reassign form, reveal controls. Tab-by-section organization is essential. | XL | **High** |
| X3 | Withdrawals + reveals audit pages: good, recently refined. Could use CSV export. | S | Low |
| X4 | Service catalog editor: inline edit per row with a Save button. Fine, but no bulk edit. Low priority. | M | Low |
| X5 | Accountants / Clients list pages: pagination + search exist. UX modernization: card view instead of list view, with quick-action buttons (suspend, delete) exposed on hover. | M | Medium |
| X6 | No "activity log" view for an individual admin or user, admin_actions table drives per-feature audit pages (reveals, now), but no unified "what did admin X do today" view. | M | Low (not yet) |

---

## 6. Cross-portal consistency

| # | Issue | Difficulty | Impact |
|---|-------|------------|--------|
| G1 | Session timeout UX: no soft warning before Supabase token expires. User mid-form loses state on refresh. | M | Medium |
| G2 | Error boundaries exist (added in Batch 4) but all show the same generic "something went wrong." Could carry per-portal-specific help text. | S | Low |
| G3 | No search / command palette. 31 pages is reaching the size where a Cmd-K palette helps admins navigate quickly. | L | Medium |
| G4 | Keyboard shortcuts: nothing wired up. "/" for search, "n" for new case, "g c" for cases, etc. | M | Low initially, high for power users |
| G5 | Dark mode: not implemented. Modern SV default, users increasingly expect it. | L | Low (nice-to-have) |

---

## 7. Native-mobile preparedness

User flagged this becomes native iOS/Android eventually. Current state assessed against that:

| # | Issue | Difficulty | Impact |
|---|-------|------------|--------|
| N1 | Fixed-width classes present at 5 call sites, all `max-w-*` so they degrade safely, but Tailwind's `w-[220px]` on chat attachment names could truncate oddly on narrow phones. Audit on 320px viewport. | S | High |
| N2 | Camera capture modal (added in a prior batch): verified it opens, but real camera capture via web vs native is different. If going to native, this becomes a device API call instead. | - | - (plan-only) |
| N3 | Session + auth: Supabase cookies work on web; mobile apps need the OAuth2 code+PKCE flow with secure token storage. Not implemented yet. | L | High for native launch |
| N4 | File upload UX: the drag-drop zone is desktop-oriented. Mobile needs big "Choose from gallery / Take photo" buttons front and centre. | M | High for mobile |
| N5 | Tap target audit: did 44px minimum in Batch 4 for chat chip removes. Entire portal needs a sweep against this. | M | High |

---

## 8. Prioritization (my recommendation)

If this were my project and I had a design week:

**Must-fix before public launch:**
- D1, D2 (button consolidation + focus rings), a11y + consistency, 1 day
- M2, M3 (OG tags + JSON-LD). SEO, half a day
- M4 (real content for /about + /guides + /calculators placeholders), content, 2 days
- C1 + X2 (progressive disclosure on the two monster case-detail pages), biggest UX wins, 2 to 3 days

**Should-fix for Silicon Valley polish:**
- D3, D4, D5 (typography scale + spacing rhythm + semantic colour tokens), unlocks fast re-skinning, 2 days
- C2 (toast notifications), half a day
- C4 + A6 (mobile case-detail chat access), critical for mobile UX, 1 day
- X1 (admin dashboard modernization), 2 days

**Nice-to-have:**
- G3 (Cmd-K palette), 1 day
- D6 (icon system), 1 day
- X5 (card-view for accountants/clients list), 1 day
- Dark mode, 2 days

**Total "SV-polish" scope**: ~2 focused weeks of work with design input from you between iterations. Not something I can one-shot in a single conversation session, it's an iterative design project.

---

## 9. Bug sweep (static code audit)

Methodology: grep-driven over `src/**` for known failure patterns. Not a substitute for live-browser click-through (which would be the real "every button, every state" audit).

### Checked ✓

- Internal links to deleted marketing routes (Stage 5 cleanup) ,  **zero** hits
- Dead `href="#"` anchors in app code ,  **zero**
- Hardcoded old `api.sterlingledger.co.uk` references ,  **zero** (full domain cutover is clean)
- `onClick={() => {}}` placeholder handlers ,  **zero**
- Suspicious `disabled={true}` or bare `disabled>` prop uses ,  **zero**
- Server actions without an auth gate ,  **false positives only** (two files flagged by grep; both are RLS-protected or correctly `getUser()`-check: `src/app/messages.ts`, `src/app/notification-actions.ts`)
- Toggle components: all 6 (document-uploader, period-card, service-catalog-row, sign-form, onboarding-form, new-case-form) wire their `checked` attribute to React state via `useState` and call a proper `onChange` handler. UI reflects real state. ✓
- `TODO/FIXME` markers ,  **zero** in `src/`

### NOT checked (needs live browser)

- Every button in every portal state (admin suspending a client, accountant with 0 cases vs many, client mid-onboarding, etc.)
- Form validation edge cases (what happens when you submit an incomplete form, invalid data, etc.)
- Console errors on every page
- Network errors (what happens when Stripe is slow, Supabase is 503)
- Visual regressions across viewport widths

Open-ended live-browser audit is ~4-6 hours and should be a separate session with the Chrome extension connected.

### Pricing bug (from earlier this session)

Fixed. Commit `36051fa`. Real Stripe test-mode session `cs_test_a1jQ77TCSddLm7NHpEoWE6SS6BnMiuAFoXujy8l4uWTFVBGTAZmDWKpegn` created at `amount_total: 9000p (£90)` ,  the sale price, not £99.

---

End of report.
