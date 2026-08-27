# Admin earnings UI redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the admin earnings page as a mobile-first, today-first command deck that quickly shows machine earnings, the comparison to yesterday or the preceding period, and the Print/Copy/Scan mix.

**Architecture:** Keep the existing static HTML/CSS/TypeScript page and existing `/api/admin/summary` plus anchored `/api/admin/earnings/analytics` endpoints. Add small, pure earnings modules for calendar-safe period offsets, comparison view models, and loading the current/prior analytics pair; the DOM entry module remains responsible only for API integration and rendering. No server, route, database, or shared API-type changes are required.

**Tech Stack:** Static HTML, CSS custom properties, TypeScript (strict), Jest/ts-jest, esbuild, flatpickr, existing admin shared helpers.

## Global Constraints

- Preserve the existing admin shell, authentication, refresh control, dark palette, and `/admin/earnings/` route.
- Default to the daily view; show the selected period total and a comparison against its immediately preceding equivalent period.
- The 320px initial viewport must show the selected total, comparison, Today/Week/Month/Year control, and Print/Copy/Scan mix before the trend.
- Reuse `GET /api/admin/summary` and `GET /api/admin/earnings/analytics?view=<view>&anchor=<date>`; do not add an endpoint, schema, or persistence change.
- Retain the last successful data during refresh. Empty periods display `₱0.00` and “No earnings in this period.”
- Use native buttons, `aria-pressed` on the period selector, explicit date-navigation labels, visible focus, and the existing live status message.
- Use `pnpm@10` only. After TypeScript changes, run `pnpm exec tsc --noEmit --ignoreDeprecations 6.0` and `pnpm run build`.
- Do not stage or modify the pre-existing user changes under `src/locales/`, `src/public/admin/system/`, `src/public/app.ts`, `src/public/index.html`, or `src/public/vendor/`.

---

## File structure

| File                                                    | Responsibility                                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/public/admin/earnings/earnings-view-model.ts`      | Pure calendar navigation, prior-period comparison, and selected-period presentation model.          |
| `src/public/admin/earnings/earnings-view-model.spec.ts` | Jest coverage for period arithmetic, comparison text inputs, zero-data state, and service ordering. |
| `src/public/admin/earnings/analytics-pair.ts`           | Purely orchestrates the two analytics requests needed for the selected and preceding periods.       |
| `src/public/admin/earnings/analytics-pair.spec.ts`      | Jest coverage for parallel current/prior lookup and error propagation.                              |
| `src/public/admin/earnings/index.html`                  | Semantic command-deck structure and accessible controls.                                            |
| `src/public/admin/earnings/earnings-page.spec.ts`       | Static markup contract checks that run in the repository's Node-only Jest environment.              |
| `src/public/admin/earnings/styles.css`                  | Responsive command-deck layout, focus states, loading state, service mix, and trend treatment.      |
| `src/public/admin/earnings/app.ts`                      | Fetches live data, keeps refresh/race guards, and renders the new DOM contract.                     |

### Task 1: Add a pure selected-period earnings model

**Files:**

- Create: `src/public/admin/earnings/earnings-view-model.ts`
- Create: `src/public/admin/earnings/earnings-view-model.spec.ts`

**Interfaces:**

- Consumes: `EarningsAnalyticsResponse` and `EarningsAnalyticsView` from `src/public/admin/shared.ts`.
- Produces: `shiftEarningsAnchor`, `canNavigateToNextEarningsPeriod`, `getComparisonReferenceLabel`, and `createEarningsViewModel` for the API orchestration and DOM entry module.

- [ ] **Step 1: Write the failing model tests**

Create `src/public/admin/earnings/earnings-view-model.spec.ts` with these exact cases. Use fixed local dates so daylight-saving and clock time cannot change the result.

```ts
import type { EarningsAnalyticsResponse } from '../shared';
import {
  canNavigateToNextEarningsPeriod,
  createEarningsViewModel,
  getComparisonReferenceLabel,
  shiftEarningsAnchor,
} from './earnings-view-model';

function analytics(
  input: Partial<EarningsAnalyticsResponse> = {},
): EarningsAnalyticsResponse {
  return {
    view: 'daily',
    anchorDate: '2026-08-27',
    period: {
      start: '2026-08-27T00:00:00.000Z',
      end: '2026-08-28T00:00:00.000Z',
      label: 'Aug 27, 2026',
    },
    totals: {
      today: 1240,
      week: 4200,
      month: 12400,
      year: 80200,
      allTime: 201000,
      period: 1240,
    },
    buckets: [],
    methods: { print: 810, copy: 350, scan: 80, total: 1240, topMode: 'print' },
    ...input,
  };
}

describe('earnings view model', () => {
  it('moves daily and weekly anchors without mutating the original date', () => {
    const source = new Date(2026, 7, 27);
    expect(shiftEarningsAnchor('daily', source, -1)).toEqual(
      new Date(2026, 7, 26),
    );
    expect(shiftEarningsAnchor('weekly', source, -1)).toEqual(
      new Date(2026, 7, 20),
    );
    expect(source).toEqual(new Date(2026, 7, 27));
  });

  it('clamps calendar shifts to the destination month for month and year comparisons', () => {
    expect(shiftEarningsAnchor('monthly', new Date(2026, 2, 31), -1)).toEqual(
      new Date(2026, 1, 28),
    );
    expect(shiftEarningsAnchor('yearly', new Date(2024, 1, 29), -1)).toEqual(
      new Date(2023, 1, 28),
    );
  });

  it('prevents navigation beyond the current selected period', () => {
    const now = new Date(2026, 7, 27);
    expect(
      canNavigateToNextEarningsPeriod('daily', new Date(2026, 7, 27), now),
    ).toBe(false);
    expect(
      canNavigateToNextEarningsPeriod('weekly', new Date(2026, 7, 20), now),
    ).toBe(true);
    expect(
      canNavigateToNextEarningsPeriod('monthly', new Date(2026, 7, 1), now),
    ).toBe(false);
  });

  it('builds the selected-period comparison and keeps all service rows for zero earnings', () => {
    const current = analytics({
      totals: { ...analytics().totals, period: 1240 },
    });
    const prior = analytics({
      totals: { ...analytics().totals, period: 1060 },
    });
    expect(createEarningsViewModel(current, prior)).toMatchObject({
      total: 1240,
      delta: 180,
      direction: 'up',
      referenceLabel: 'yesterday',
      empty: false,
      services: [
        { label: 'Print', amount: 810 },
        { label: 'Copy', amount: 350 },
        { label: 'Scan', amount: 80 },
      ],
      topService: 'Print',
    });

    const empty = createEarningsViewModel(
      analytics({
        totals: { ...analytics().totals, period: 0 },
        methods: { print: 0, copy: 0, scan: 0, total: 0, topMode: null },
      }),
      analytics({ totals: { ...analytics().totals, period: 0 } }),
    );
    expect(empty).toMatchObject({
      delta: 0,
      direction: 'flat',
      empty: true,
      topService: null,
    });
    expect(empty.services).toHaveLength(3);
    expect(getComparisonReferenceLabel('monthly')).toBe('last month');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm test -- src/public/admin/earnings/earnings-view-model.spec.ts --runInBand
```

Expected: FAIL because `earnings-view-model.ts` does not exist.

- [ ] **Step 3: Implement the pure model**

Create `src/public/admin/earnings/earnings-view-model.ts`. Keep the module free of DOM and network calls so Node-environment Jest can exercise all business rules.

```ts
import type {
  EarningsAnalyticsResponse,
  EarningsAnalyticsView,
} from '../shared';

export type EarningsComparisonDirection = 'up' | 'down' | 'flat';

export type EarningsViewModel = {
  total: number;
  delta: number;
  direction: EarningsComparisonDirection;
  referenceLabel: string;
  periodLabel: string;
  empty: boolean;
  services: Array<{ label: 'Print' | 'Copy' | 'Scan'; amount: number }>;
  topService: 'Print' | 'Copy' | 'Scan' | null;
};

function dateInTargetMonth(source: Date, year: number, month: number): Date {
  const target = new Date(source);
  target.setDate(1);
  target.setFullYear(year, month);
  const lastDay = new Date(year, month + 1, 0).getDate();
  target.setDate(Math.min(source.getDate(), lastDay));
  return target;
}

export function shiftEarningsAnchor(
  view: EarningsAnalyticsView,
  anchor: Date,
  step: number,
): Date {
  if (view === 'daily' || view === 'weekly') {
    const shifted = new Date(anchor);
    shifted.setDate(shifted.getDate() + (view === 'daily' ? step : step * 7));
    return shifted;
  }
  if (view === 'monthly') {
    const month = anchor.getMonth() + step;
    return dateInTargetMonth(
      anchor,
      anchor.getFullYear() + Math.floor(month / 12),
      ((month % 12) + 12) % 12,
    );
  }
  return dateInTargetMonth(
    anchor,
    anchor.getFullYear() + step,
    anchor.getMonth(),
  );
}

export function canNavigateToNextEarningsPeriod(
  view: EarningsAnalyticsView,
  anchor: Date,
  now = new Date(),
): boolean {
  const next = shiftEarningsAnchor(view, anchor, 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return next <= today;
}

export function getComparisonReferenceLabel(
  view: EarningsAnalyticsView,
): string {
  return {
    daily: 'yesterday',
    weekly: 'last week',
    monthly: 'last month',
    yearly: 'last year',
  }[view];
}

export function createEarningsViewModel(
  current: EarningsAnalyticsResponse,
  previous: EarningsAnalyticsResponse,
): EarningsViewModel {
  const total = current.totals.period;
  const delta = Math.round((total - previous.totals.period) * 100) / 100;
  const services: EarningsViewModel['services'] = [
    { label: 'Print', amount: current.methods.print },
    { label: 'Copy', amount: current.methods.copy },
    { label: 'Scan', amount: current.methods.scan },
  ];
  return {
    total,
    delta,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
    referenceLabel: getComparisonReferenceLabel(current.view),
    periodLabel: current.period.label,
    empty: total === 0,
    services,
    topService: current.methods.topMode
      ? ({ print: 'Print', copy: 'Copy', scan: 'Scan' } as const)[
          current.methods.topMode
        ]
      : null,
  };
}
```

- [ ] **Step 4: Run the focused test and type-check**

Run:

```bash
pnpm test -- src/public/admin/earnings/earnings-view-model.spec.ts --runInBand
pnpm exec tsc --noEmit --ignoreDeprecations 6.0
```

Expected: both commands pass.

- [ ] **Step 5: Commit the tested model**

```bash
git add src/public/admin/earnings/earnings-view-model.ts src/public/admin/earnings/earnings-view-model.spec.ts
git commit -m "feat: add earnings period comparison model"
```

### Task 2: Add a race-safe current/prior analytics loader

**Files:**

- Create: `src/public/admin/earnings/analytics-pair.ts`
- Create: `src/public/admin/earnings/analytics-pair.spec.ts`

**Interfaces:**

- Consumes: `EarningsAnalyticsView`, `EarningsAnalyticsResponse`, and `shiftEarningsAnchor` from Task 1.
- Produces: `loadEarningsAnalyticsPair(loadOne, view, anchor)`, used by `app.ts` in Task 4.

- [ ] **Step 1: Write the failing loader tests**

```ts
import type { EarningsAnalyticsResponse } from '../shared';
import { loadEarningsAnalyticsPair } from './analytics-pair';

const response = (anchorDate: string): EarningsAnalyticsResponse => ({
  view: 'daily',
  anchorDate,
  period: {
    start: `${anchorDate}T00:00:00.000Z`,
    end: `${anchorDate}T23:59:59.999Z`,
    label: anchorDate,
  },
  totals: { today: 0, week: 0, month: 0, year: 0, allTime: 0, period: 0 },
  buckets: [],
  methods: { print: 0, copy: 0, scan: 0, total: 0, topMode: null },
});

describe('loadEarningsAnalyticsPair', () => {
  it('loads the selected daily period and its previous day together', async () => {
    const loadOne = jest.fn((_: string, anchor: Date) =>
      Promise.resolve(response(anchor.toISOString().slice(0, 10))),
    );
    await expect(
      loadEarningsAnalyticsPair(loadOne, 'daily', new Date(2026, 7, 27)),
    ).resolves.toMatchObject({
      current: { anchorDate: '2026-08-27' },
      previous: { anchorDate: '2026-08-26' },
    });
    expect(loadOne).toHaveBeenCalledTimes(2);
  });

  it('does not swallow an analytics failure', async () => {
    const loadOne = jest.fn(() =>
      Promise.reject(new Error('Failed to load earnings analytics.')),
    );
    await expect(
      loadEarningsAnalyticsPair(loadOne, 'weekly', new Date(2026, 7, 27)),
    ).rejects.toThrow('Failed to load earnings analytics.');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm test -- src/public/admin/earnings/analytics-pair.spec.ts --runInBand
```

Expected: FAIL because `analytics-pair.ts` does not exist.

- [ ] **Step 3: Implement the loader**

```ts
import type {
  EarningsAnalyticsResponse,
  EarningsAnalyticsView,
} from '../shared';
import { shiftEarningsAnchor } from './earnings-view-model';

export type EarningsAnalyticsPair = {
  current: EarningsAnalyticsResponse;
  previous: EarningsAnalyticsResponse;
};

export type LoadOneEarningsAnalytics = (
  view: EarningsAnalyticsView,
  anchor: Date,
) => Promise<EarningsAnalyticsResponse>;

export async function loadEarningsAnalyticsPair(
  loadOne: LoadOneEarningsAnalytics,
  view: EarningsAnalyticsView,
  anchor: Date,
): Promise<EarningsAnalyticsPair> {
  const previousAnchor = shiftEarningsAnchor(view, anchor, -1);
  const [current, previous] = await Promise.all([
    loadOne(view, anchor),
    loadOne(view, previousAnchor),
  ]);
  return { current, previous };
}
```

- [ ] **Step 4: Run tests and type-check**

```bash
pnpm test -- src/public/admin/earnings/analytics-pair.spec.ts src/public/admin/earnings/earnings-view-model.spec.ts --runInBand
pnpm exec tsc --noEmit --ignoreDeprecations 6.0
```

Expected: both commands pass.

- [ ] **Step 5: Commit the loader**

```bash
git add src/public/admin/earnings/analytics-pair.ts src/public/admin/earnings/analytics-pair.spec.ts
git commit -m "feat: load paired earnings analytics"
```

### Task 3: Replace the earnings page with an accessible mobile-first command deck

**Files:**

- Modify: `src/public/admin/earnings/index.html:291-443`
- Modify: `src/public/admin/earnings/styles.css:1-439`
- Create: `src/public/admin/earnings/earnings-page.spec.ts`

**Interfaces:**

- Consumes: the DOM IDs and `data-view` values named below from `app.ts` in Task 4.
- Produces: `selectedPeriodAmount`, `comparisonText`, `periodLabel`, `trendGrid`, three `.service-mix__item` rows, and all required keyboard-accessible controls.

- [ ] **Step 1: Write the failing static markup contract test**

The Jest environment is Node, so assert the important HTML/CSS contract from source rather than adding a DOM dependency solely for this page.

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(
  resolve(process.cwd(), 'src/public/admin/earnings/index.html'),
  'utf8',
);
const css = readFileSync(
  resolve(process.cwd(), 'src/public/admin/earnings/styles.css'),
  'utf8',
);

describe('admin earnings command deck markup', () => {
  it('exposes the selected-period summary, comparison, four pressed-state tabs, and all service rows', () => {
    expect(html).toContain('id="selectedPeriodAmount"');
    expect(html).toContain('id="comparisonText"');
    expect(html).toContain('id="periodLabel"');
    expect(
      html.match(/data-view="(daily|weekly|monthly|yearly)"/g),
    ).toHaveLength(4);
    expect(html.match(/aria-pressed="(true|false)"/g)).toHaveLength(4);
    expect(html).toContain('id="servicePrint"');
    expect(html).toContain('id="serviceCopy"');
    expect(html).toContain('id="serviceScan"');
  });

  it('keeps a mobile layout and visible keyboard focus treatment in the page stylesheet', () => {
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('.view-switch__btn:focus-visible');
    expect(css).toContain('.earnings-trend__viewport');
  });
});
```

- [ ] **Step 2: Run the contract test to verify it fails**

```bash
pnpm test -- src/public/admin/earnings/earnings-page.spec.ts --runInBand
```

Expected: FAIL because the selected-period and service-mix IDs do not yet exist.

- [ ] **Step 3: Replace the page content and styles**

Replace the old hero, three summary cards, analytics panel, and four method cards with the following structure inside `<section class="page">`. Leave the surrounding admin shell, sidebar, topbar, alert badge IDs, and script reference unchanged.

```html
<section class="earnings-deck" aria-labelledby="earningsDeckTitle">
  <div class="earnings-deck__summary">
    <div class="earnings-deck__heading">
      <p class="earnings-deck__kicker">Machine earnings</p>
      <h3 id="earningsDeckTitle" class="earnings-deck__title">Earnings</h3>
    </div>
    <p id="periodLabel" class="earnings-deck__period">Today</p>
    <p id="selectedPeriodAmount" class="earnings-deck__amount">₱ 0.00</p>
    <p id="comparisonText" class="earnings-deck__comparison" aria-live="polite">
      Matching yesterday
    </p>
    <p id="emptyPeriodMessage" class="earnings-deck__empty" hidden>
      No earnings in this period.
    </p>
  </div>
  <div class="view-switch" id="viewSwitch" aria-label="Earnings period">
    <button
      class="view-switch__btn view-switch__btn--active"
      type="button"
      data-view="daily"
      aria-pressed="true"
    >
      Today
    </button>
    <button
      class="view-switch__btn"
      type="button"
      data-view="weekly"
      aria-pressed="false"
    >
      Week
    </button>
    <button
      class="view-switch__btn"
      type="button"
      data-view="monthly"
      aria-pressed="false"
    >
      Month
    </button>
    <button
      class="view-switch__btn"
      type="button"
      data-view="yearly"
      aria-pressed="false"
    >
      Year
    </button>
  </div>
  <section class="service-mix" aria-labelledby="serviceMixTitle">
    <div class="service-mix__header">
      <h4 id="serviceMixTitle">By service</h4>
      <p id="topMethod">Top service: —</p>
    </div>
    <div class="service-mix__item">
      <span>Print</span><strong id="servicePrint">₱ 0.00</strong>
    </div>
    <div class="service-mix__item">
      <span>Copy</span><strong id="serviceCopy">₱ 0.00</strong>
    </div>
    <div class="service-mix__item">
      <span>Scan</span><strong id="serviceScan">₱ 0.00</strong>
    </div>
  </section>
</section>

<section class="earnings-trend" aria-labelledby="trendTitle">
  <div class="earnings-trend__header">
    <div>
      <p class="earnings-deck__kicker">Period detail</p>
      <h3 id="trendTitle">Earnings trend</h3>
    </div>
    <div class="anchor-controls">
      <button
        id="prevAnchorBtn"
        class="anchor-btn"
        type="button"
        aria-label="View previous earnings period"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path
            fill-rule="evenodd"
            d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"
          />
        </svg>
      </button>
      <input
        id="anchorDateInput"
        class="anchor-input"
        type="text"
        readonly
        aria-label="Select earnings period anchor date"
      />
      <button
        id="calendarToggleBtn"
        class="anchor-btn anchor-btn--calendar"
        type="button"
        aria-label="Choose a historical earnings date"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fill-rule="evenodd"
            d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 011-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z"
            clip-rule="evenodd"
          />
        </svg>
      </button>
      <button
        id="nextAnchorBtn"
        class="anchor-btn"
        type="button"
        aria-label="View next earnings period"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path
            fill-rule="evenodd"
            d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"
          />
        </svg>
      </button>
    </div>
  </div>
  <div class="earnings-trend__viewport">
    <div
      id="trendGrid"
      class="trend-grid"
      aria-label="Earnings trend buckets"
    ></div>
  </div>
</section>
```

In `styles.css`, remove the old `.earnings-row`, `.earning-card*`, `.earnings-panel`, `.methods-row`, and `.method-card*` rules. Define the new page as follows:

```css
.earnings-deck {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(15rem, 0.85fr);
  gap: 1rem;
  padding: 1rem;
  border: 1px solid rgba(125, 211, 252, 0.2);
  border-radius: 1rem;
  background: linear-gradient(
    165deg,
    rgba(17, 20, 47, 0.9),
    rgba(11, 10, 26, 0.95)
  );
}
.earnings-deck__summary {
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
}
.earnings-deck__kicker {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.earnings-deck__title,
.earnings-trend h3 {
  margin: 0.25rem 0 0;
  color: var(--white);
  font-size: 1rem;
}
.earnings-deck__period {
  margin: 1rem 0 0;
  color: var(--ink-muted);
  font-size: 0.8125rem;
}
.earnings-deck__amount {
  margin: 0.25rem 0 0;
  color: var(--green);
  font-size: clamp(2.25rem, 6vw, 4rem);
  font-weight: 800;
  letter-spacing: -0.055em;
  line-height: 1;
}
.earnings-deck__comparison {
  display: inline-flex;
  margin: 0.75rem 0 0;
  padding: 0.375rem 0.5rem;
  border-radius: 999px;
  background: rgba(110, 231, 183, 0.12);
  color: var(--green);
  font-size: 0.8125rem;
  font-weight: 700;
}
.earnings-deck__comparison[data-direction='down'] {
  background: rgba(251, 146, 60, 0.12);
  color: var(--peach);
}
.earnings-deck__comparison[data-direction='flat'] {
  background: rgba(255, 255, 255, 0.08);
  color: var(--ink-muted);
}
.earnings-deck__empty {
  margin: 0.5rem 0 0;
  color: var(--ink-muted);
  font-size: 0.8125rem;
}
.view-switch {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-column: 1 / -1;
  grid-row: 2;
  gap: 0.25rem;
  padding: 0.25rem;
  border: 1px solid rgba(125, 211, 252, 0.24);
  border-radius: 0.75rem;
  background: rgba(255, 255, 255, 0.04);
}
.view-switch__btn {
  min-height: 2.75rem;
  border: 0;
  border-radius: 0.5rem;
  background: transparent;
  color: var(--ink-muted);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 700;
  cursor: pointer;
}
.view-switch__btn--active {
  background: rgba(105, 111, 199, 0.32);
  color: var(--white);
}
.view-switch__btn:focus-visible,
.anchor-btn:focus-visible {
  outline: 2px solid var(--lavender);
  outline-offset: 2px;
}
.service-mix {
  display: grid;
  grid-column: 2;
  grid-row: 1;
  gap: 0.5rem;
  align-content: start;
  padding: 0.875rem;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  background: rgba(255, 255, 255, 0.025);
}
.service-mix__header,
.service-mix__item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}
.service-mix__header h4,
.service-mix__header p {
  margin: 0;
  font-size: 0.75rem;
}
.service-mix__header p,
.service-mix__item span {
  color: var(--ink-muted);
}
.service-mix__item strong {
  color: var(--white);
  font-size: 0.9375rem;
}
.earnings-trend {
  margin-top: 1rem;
  padding: 1rem;
  border: 1px solid rgba(125, 211, 252, 0.2);
  border-radius: 1rem;
  background: linear-gradient(
    165deg,
    rgba(17, 20, 47, 0.9),
    rgba(11, 10, 26, 0.95)
  );
}
.earnings-trend__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.earnings-trend__viewport {
  margin-top: 1rem;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
}
.earnings-deck[aria-busy='true'] .earnings-deck__amount {
  opacity: 0.72;
  transition: opacity 150ms;
}
.anchor-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.trend-grid {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(4.5rem, 1fr);
  gap: 0.5rem;
  min-width: max-content;
}
.trend-cell {
  display: grid;
  gap: 0.5rem;
  min-height: 7.5rem;
  padding: 0.625rem;
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  background: rgba(255, 255, 255, 0.02);
}
.trend-cell__bar {
  align-self: end;
  min-height: 0.25rem;
  height: var(--trend-height);
  border-radius: 0.25rem 0.25rem 0 0;
  background: var(--indigo);
}
.trend-cell__label,
.trend-cell__amount {
  font-size: 0.75rem;
}
.trend-cell__label {
  color: var(--ink-muted);
}
.trend-cell__amount {
  color: var(--white);
  font-weight: 700;
}
@media (max-width: 640px) {
  .earnings-deck {
    grid-template-columns: 1fr;
    padding: 0.875rem;
    gap: 0.875rem;
  }
  .earnings-deck__summary {
    grid-column: 1;
    grid-row: 1;
  }
  .view-switch {
    grid-column: 1;
    grid-row: 2;
  }
  .service-mix {
    grid-column: 1;
    grid-row: 3;
  }
  .earnings-deck__amount {
    font-size: 2.5rem;
  }
  .earnings-trend {
    padding: 0.875rem;
  }
  .earnings-trend__header {
    align-items: flex-start;
    flex-direction: column;
  }
  .anchor-controls {
    width: 100%;
    justify-content: space-between;
  }
}
```

Keep the existing flatpickr theme rules after these component rules. Use the existing CSS variables rather than introducing new hex colors beyond the alpha surfaces shown above.

- [ ] **Step 4: Run the markup contract and build**

```bash
pnpm test -- src/public/admin/earnings/earnings-page.spec.ts --runInBand
pnpm run build
```

Expected: the contract test passes and esbuild produces `src/public/admin/earnings/app.js` without compilation errors. Do not stage ignored generated bundles.

- [ ] **Step 5: Commit the command-deck structure**

```bash
git add src/public/admin/earnings/index.html src/public/admin/earnings/styles.css src/public/admin/earnings/earnings-page.spec.ts
git commit -m "feat: add mobile-first earnings command deck"
```

### Task 4: Connect the command deck to live earnings data

**Files:**

- Modify: `src/public/admin/earnings/index.html:291-443`
- Modify: `src/public/admin/earnings/app.ts:1-255`

**Interfaces:**

- Consumes: the helper exports from Tasks 1–2 and DOM IDs from Task 3.
- Produces: live selected-period total, prior-period comparison, service mix, trend bars, historical navigation state, and non-destructive loading/error behavior.

- [ ] **Step 1: Write the failing integration contract additions**

Extend `earnings-page.spec.ts` before changing `app.ts` so the page contract requires the data-target attributes the renderer will use:

```ts
expect(html).toContain('data-direction="flat"');
expect(html).toContain('aria-busy="true"');
expect(html).toContain('role="list"');
```

Run:

```bash
pnpm test -- src/public/admin/earnings/earnings-page.spec.ts --runInBand
```

Expected: FAIL until the static markup includes the declared loading and trend semantics.

- [ ] **Step 2: Implement the DOM bindings and paired fetch**

In `index.html`, make the three exact static contract substitutions before changing `app.ts`:

```html
<section
  class="earnings-deck"
  aria-labelledby="earningsDeckTitle"
  aria-busy="true"
>
  <p
    id="comparisonText"
    class="earnings-deck__comparison"
    data-direction="flat"
    aria-live="polite"
  >
    Matching yesterday
  </p>
  <div
    id="trendGrid"
    class="trend-grid"
    role="list"
    aria-label="Earnings trend buckets"
  ></div>
</section>
```

In `app.ts`, delete the old `earningsToday`, `earningsWeek`, `earningsAll`, `eBarToday`, `eBarWeek`, `methodPrint`, and `methodScan` bindings. Bind the command-deck IDs instead:

```ts
import { loadEarningsAnalyticsPair } from './analytics-pair';
import {
  canNavigateToNextEarningsPeriod,
  createEarningsViewModel,
  shiftEarningsAnchor,
} from './earnings-view-model';

const earningsDeck = document.querySelector<HTMLElement>('.earnings-deck')!;
const selectedPeriodAmount = document.getElementById('selectedPeriodAmount')!;
const comparisonText = document.getElementById('comparisonText')!;
const emptyPeriodMessage = document.getElementById('emptyPeriodMessage')!;
const servicePrint = document.getElementById('servicePrint')!;
const serviceCopy = document.getElementById('serviceCopy')!;
const serviceScan = document.getElementById('serviceScan')!;
```

Replace `shiftAnchorDate` with `shiftEarningsAnchor`. Replace `renderTrend(analytics)` with a renderer receiving the two analytics responses:

```ts
function renderAnalytics(
  current: EarningsAnalyticsResponse,
  previous: EarningsAnalyticsResponse,
): void {
  const model = createEarningsViewModel(current, previous);
  currentView = current.view;
  setActiveViewButton(current.view);
  periodLabel.textContent = model.periodLabel;
  selectedPeriodAmount.textContent = peso(model.total);
  comparisonText.dataset.direction = model.direction;
  comparisonText.textContent =
    model.direction === 'flat'
      ? `Matches ${model.referenceLabel}`
      : `${model.direction === 'up' ? '↑' : '↓'} ${peso(Math.abs(model.delta))} ${model.direction === 'up' ? 'more' : 'less'} than ${model.referenceLabel}`;
  emptyPeriodMessage.hidden = !model.empty;
  servicePrint.textContent = peso(model.services[0].amount);
  serviceCopy.textContent = peso(model.services[1].amount);
  serviceScan.textContent = peso(model.services[2].amount);
  topMethod.textContent = `Top service: ${model.topService ?? '—'}`;
  nextAnchorBtn.disabled = !canNavigateToNextEarningsPeriod(
    currentView,
    anchorDate,
  );
  renderTrendBuckets(current.buckets);
}
```

Add one shared error presenter, then call it from every manual refresh, tab, date, and initial-load catch handler. The existing refresh button is the retry path; this text makes that path explicit without adding another competing control.

```ts
function showEarningsError(error: unknown): void {
  const detail =
    error instanceof Error ? error.message : 'Failed to load earnings.';
  setMessage(`${detail} Use Refresh to retry.`);
}
```

Add this exact trend renderer. It does not put API values in `innerHTML` and makes the 24 hourly buckets scroll inside the trend viewport rather than across the page.

```ts
function renderTrendBuckets(
  buckets: EarningsAnalyticsResponse['buckets'],
): void {
  const maxAmount = Math.max(...buckets.map(({ amount }) => amount), 1);
  trendGrid.replaceChildren();
  for (const bucket of buckets) {
    const cell = document.createElement('div');
    cell.className = 'trend-cell';
    cell.setAttribute('role', 'listitem');

    const amount = document.createElement('div');
    amount.className = 'trend-cell__amount';
    amount.textContent = peso(bucket.amount);

    const bar = document.createElement('div');
    bar.className = 'trend-cell__bar';
    bar.style.setProperty(
      '--trend-height',
      `${Math.max(8, Math.round((bucket.amount / maxAmount) * 100))}%`,
    );

    const label = document.createElement('div');
    label.className = 'trend-cell__label';
    label.textContent = bucket.label;
    cell.append(amount, bar, label);
    trendGrid.append(cell);
  }
}
```

Add this exact single-request wrapper and replace the old one-request analytics loader with the paired, sequence-guarded loader. Retain prior values until `renderAnalytics` receives two successful responses.

```ts
async function loadOneAnalytics(
  view: EarningsAnalyticsView,
  anchor: Date,
): Promise<EarningsAnalyticsResponse> {
  const analyticsRes = await apiFetch(
    `/api/admin/earnings/analytics?view=${encodeURIComponent(view)}&anchor=${encodeURIComponent(anchor.toISOString())}`,
  );
  if (!analyticsRes.ok) {
    if (analyticsRes.status === 401) throw new Error('Invalid admin PIN.');
    throw new Error('Failed to load earnings analytics.');
  }
  return analyticsRes.json() as Promise<EarningsAnalyticsResponse>;
}

async function loadAnalyticsData(): Promise<void> {
  const requestKey = getAnalyticsRequestKey();
  if (analyticsInFlight && analyticsInFlightKey === requestKey)
    return analyticsInFlight;
  const requestSeq = ++analyticsRequestSeq;
  earningsDeck.setAttribute('aria-busy', 'true');
  const requestPromise = loadEarningsAnalyticsPair(
    loadOneAnalytics,
    currentView,
    anchorDate,
  )
    .then((pair) => {
      if (requestSeq === analyticsRequestSeq)
        renderAnalytics(pair.current, pair.previous);
    })
    .finally(() => {
      if (analyticsInFlight === requestPromise) {
        analyticsInFlight = null;
        analyticsInFlightKey = null;
        earningsDeck.setAttribute('aria-busy', 'false');
      }
    });
  analyticsInFlight = requestPromise;
  analyticsInFlightKey = requestKey;
  return requestPromise;
}
```

Update `setActiveViewButton` to synchronize both class and ARIA state:

```ts
btn.classList.toggle('view-switch__btn--active', btn.dataset.view === view);
btn.setAttribute('aria-pressed', String(btn.dataset.view === view));
```

When `loadSummaryData` receives fresh summary data, continue updating alert badges. Add this current-day-only amount refresh; it does not clear the comparison or service mix. Keep the existing 10-second summary and 60-second analytics timers.

```ts
if (
  currentView === 'daily' &&
  !canNavigateToNextEarningsPeriod('daily', anchorDate)
) {
  selectedPeriodAmount.textContent = peso(summary.earnings.today);
}
```

- [ ] **Step 3: Make controls safe for current and historical periods**

Replace the current tab and anchor listeners with the following handlers. Keep `analyticsRequestSeq`, `analyticsInFlight`, and `analyticsInFlightKey`; `getAnalyticsRequestKey` continues to return `\`${currentView}:${anchorDate.toISOString()}\`` so an older pair cannot overwrite a newer selection.

```ts
viewButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!isAnalyticsView(btn.dataset.view)) return;
    currentView = btn.dataset.view;
    anchorDate = new Date();
    picker?.setDate(anchorDate, false);
    setActiveViewButton(currentView);
    void loadAnalyticsData().catch(showEarningsError);
  });
});

prevAnchorBtn.addEventListener('click', () => {
  anchorDate = shiftEarningsAnchor(currentView, anchorDate, -1);
  picker?.setDate(anchorDate, false);
  void loadAnalyticsData().catch(showEarningsError);
});

nextAnchorBtn.addEventListener('click', () => {
  if (!canNavigateToNextEarningsPeriod(currentView, anchorDate)) return;
  anchorDate = shiftEarningsAnchor(currentView, anchorDate, 1);
  picker?.setDate(anchorDate, false);
  void loadAnalyticsData().catch(showEarningsError);
});
```

Retain flatpickr's existing `maxDate: 'today'` and `onChange` behavior, changing only the load call to the paired `loadAnalyticsData`. The renderer recalculates the disabled next-button state after every successful response.

Use the same retry copy for manual and initial loads:

```ts
refreshBtn.addEventListener('click', () => {
  setMessage('Refreshing...');
  void loadData()
    .then(() => setMessage('Earnings refreshed.'))
    .catch(showEarningsError);
});

initAuth(async () => {
  currentView = resolveInitialView();
  setActiveViewButton(currentView);
  initCalendar();
  picker?.setDate(anchorDate, false);
  await loadData().catch(showEarningsError);
  if (summaryRefreshTimer !== null) window.clearInterval(summaryRefreshTimer);
  if (analyticsRefreshTimer !== null)
    window.clearInterval(analyticsRefreshTimer);
  summaryRefreshTimer = window.setInterval(
    () => void loadSummaryData().catch(showEarningsError),
    10_000,
  );
  analyticsRefreshTimer = window.setInterval(
    () => void loadAnalyticsData().catch(showEarningsError),
    60_000,
  );
});
```

- [ ] **Step 4: Run focused verification**

```bash
pnpm test -- src/public/admin/earnings/earnings-view-model.spec.ts src/public/admin/earnings/analytics-pair.spec.ts src/public/admin/earnings/earnings-page.spec.ts --runInBand
pnpm exec tsc --noEmit --ignoreDeprecations 6.0
pnpm run lint
pnpm run build
```

Expected: all commands pass. The generated `app.js` may change locally but remains ignored and must not be staged.

- [ ] **Step 5: Verify the actual UI in a browser**

Run the local server using the repository's normal development command, authenticate with a test admin account, and verify all of the following with browser devtools:

1. At 320px, the first viewport shows the selected total, comparison, four tabs, and all three service rows before the trend.
2. At 768px, 1024px, and 1440px, the summary and service mix remain readable without overlap or horizontal page scrolling.
3. Today shows the daily total and “more/less than yesterday”; Week/Month/Year use “last week/month/year”.
4. The previous button changes the displayed range; the next button returns toward the current range and becomes disabled at the current period.
5. Keyboard Tab, Enter, and Space operate refresh, all four period buttons, date controls, and preserve a visible focus indicator.
6. Force one analytics request to fail in devtools: the existing values remain visible and the live status message exposes the error plus “Use Refresh to retry.”
7. Use an anchor with no transactions: the total is `₱0.00`, the empty-period message appears, and Print/Copy/Scan remain at `₱0.00`.

- [ ] **Step 6: Commit the live integration**

```bash
git add src/public/admin/earnings/app.ts src/public/admin/earnings/earnings-page.spec.ts
git commit -m "feat: connect earnings deck to period analytics"
```

### Task 5: Final change review and handoff

**Files:**

- Review: `src/public/admin/earnings/earnings-view-model.ts`
- Review: `src/public/admin/earnings/analytics-pair.ts`
- Review: `src/public/admin/earnings/index.html`
- Review: `src/public/admin/earnings/styles.css`
- Review: `src/public/admin/earnings/app.ts`
- Review: `src/public/admin/earnings/*.spec.ts`

**Interfaces:**

- Consumes: the completed source and verification results from Tasks 1–4.
- Produces: a reviewed, focused feature branch with no generated bundle or pre-existing unrelated change staged.

- [ ] **Step 1: Review scope and staged content**

```bash
git status --short
git diff --check HEAD
git diff HEAD -- src/public/admin/earnings
```

Expected: only earnings UI source/tests and their intentional commits are part of this feature; the known pre-existing changes remain untouched.

- [ ] **Step 2: Run final test suite for this feature**

```bash
pnpm test -- src/public/admin/earnings/earnings-view-model.spec.ts src/public/admin/earnings/analytics-pair.spec.ts src/public/admin/earnings/earnings-page.spec.ts --runInBand
pnpm exec tsc --noEmit --ignoreDeprecations 6.0
pnpm run lint
pnpm run build
```

Expected: all commands pass.

- [ ] **Step 3: Review the final diff for secrets and generated output**

```bash
git diff HEAD -- src/public/admin/earnings | rg -i "password|secret|api[_-]?key|token"
git status --ignored --short src/public/admin/earnings/app.js
```

Expected: no secret-bearing additions and `app.js` is ignored rather than staged.

- [ ] **Step 4: Commit only if Task 4 left a review-only correction**

If no correction was required, do not make an empty commit. If a correction was made, stage only the affected earnings source/test files and use:

```bash
git commit -m "fix: polish earnings command deck"
```
