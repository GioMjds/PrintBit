# Admin earnings UI redesign

**Status:** Design approved; specification awaiting final review
**Date:** 2026-08-27
**Scope:** `src/public/admin/earnings/`

## Purpose

Give an administrator a fast, low-scroll view of machine earnings on desktop and, primarily, on a mobile screen. The default question the page must answer is: “How much did the machine earn today, and how does that compare with yesterday?” The page must also make today, week, month, and year earnings easy to switch between.

## Decisions

- Use the **Today-first command deck** layout selected during design review.
- Start on **Today**. Show its total, the current date, and the peso delta against yesterday in the primary card.
- A four-option segmented control switches the selected period: Today, Week, Month, and Year. Selecting a new period updates the primary card to that period's total and comparison with the preceding equivalent period.
- Show Print, Copy, and Scan earnings as a compact service mix immediately after the total. Identify the leading service in the same compact area.
- Keep period navigation secondary. A date-range control and preceding/following buttons support historical review; following navigation is disabled for the current period.
- Put the trend after the primary summary. It renders the available buckets for the selected period: hourly for today, then progressively broader daily/weekly/monthly buckets for the other views.
- Preserve the existing admin shell, dark visual system, authentication, refresh control, and data sources. The redesign does not add a new route or public API.

## Layout

### Desktop

1. Retain the existing page header and refresh action.
2. Place the selected-period total, comparison, and period selector in one primary earnings deck.
3. Present the service mix beside or directly beneath that total, depending on available width.
4. Place compact historical controls above the trend visualisation.
5. Render a dense but readable trend below the summary and service mix.

### Mobile

The initial phone viewport must contain, in this order:

1. Page title and refresh action.
2. Selected-period amount and comparison.
3. The Today/Week/Month/Year selector.
4. Print, Copy, and Scan breakdown.

The trend and historical navigation follow below the first summary region. Controls require comfortable touch targets and must not depend on horizontal page scrolling. The trend itself may use a horizontal data treatment only when its labels cannot remain legible at 320px.

## Interaction and data flow

- Continue using `GET /api/admin/summary` for current summary values and `GET /api/admin/earnings/analytics?view=<view>&anchor=<date>` for selected-period totals, service totals, and trend buckets.
- For a comparison, request the selected period and its immediately preceding equivalent period in parallel. The displayed delta is the current total minus the previous total. This reuses the existing anchored analytics endpoint; no backend endpoint or database change is required.
- Current summary data refreshes every 10 seconds. Selected-period analytics (including its comparison) refresh every 60 seconds. Manual refresh reloads both sets immediately.
- Period controls update selection without navigating away. Historical navigation changes the anchor date; its label always identifies the viewed range.
- Do not allow navigation beyond the current period.

## States and accessibility

- Retain the last successful values while a refresh is in flight. Use a subtle busy state instead of clearing amounts to zero.
- Display inline, non-destructive errors with a retry path. An error must not hide successful historical data already on screen.
- Empty periods display `₱0.00` and “No earnings in this period.” Service rows remain present with `₱0.00` values, so their order stays predictable.
- Use native buttons for all actions. The selected period uses `aria-pressed`; date-navigation buttons have explicit labels; the existing live status message announces refresh success and errors.
- Preserve visible keyboard focus and meet contrast requirements with the existing dark palette. Color is supplementary to text, icons, and comparison wording.

## Alternatives considered

### Period-first overview

Treats all four periods uniformly. Rejected because it dilutes the user's stated need to check today and yesterday at a glance.

### Analytics-led ledger

Leads with a large chart and denser analytical detail. Rejected because it pushes the daily amount lower on mobile and increases cognitive load for routine checks.

## Component boundaries

- Keep page orchestration in the earnings entry module.
- Extract focused presentation and rendering helpers if the entry file would otherwise exceed its current responsibility: period selection/date navigation, primary summary/comparison, service mix, and trend rendering.
- Do not duplicate API types; continue using the shared `EarningsAnalyticsResponse` and `EarningsAnalyticsView` definitions.

## Verification

- Type-check and build the browser bundle after TypeScript changes.
- Test period selection, historical anchors, previous-period comparisons, loading/error/empty rendering, and refresh behavior.
- Verify keyboard operation and layouts at 320px, 768px, 1024px, and 1440px.
- Confirm the initial 320px view prioritises the total, comparison, period control, and service mix before the trend.

## Out of scope

- Changes to revenue calculation, transaction storage, settlement, or refund handling.
- New reports, exports, alerts, or backend API/schema changes.
- Altering the shared admin navigation outside changes strictly required for responsive earnings layout consistency.
