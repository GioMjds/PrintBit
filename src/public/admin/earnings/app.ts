import flatpickr from 'flatpickr';
import type { Instance as FlatpickrInstance } from 'flatpickr/dist/types/instance';
import {
  EarningsAnalyticsResponse,
  EarningsAnalyticsView,
  SummaryResponse,
  apiFetch,
  setMessage,
  initAuth,
  peso,
} from '../shared';

const earningsToday = document.getElementById('earningsToday') as HTMLElement;
const earningsWeek = document.getElementById('earningsWeek') as HTMLElement;
const earningsAll = document.getElementById('earningsAll') as HTMLElement;
const eBarToday = document.getElementById('eBarToday') as HTMLElement | null;
const eBarWeek = document.getElementById('eBarWeek') as HTMLElement | null;
const openAlertBadge = document.getElementById(
  'openAlertBadge',
) as HTMLElement | null;
const openAlertBadgeMob = document.getElementById(
  'openAlertBadgeMob',
) as HTMLElement | null;

const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement;
const periodLabel = document.getElementById('periodLabel') as HTMLElement;
const trendGrid = document.getElementById('trendGrid') as HTMLElement;
const methodPrint = document.getElementById('methodPrint') as HTMLElement;
const methodCopy = document.getElementById('methodCopy') as HTMLElement;
const methodScan = document.getElementById('methodScan') as HTMLElement;
const topMethod = document.getElementById('topMethod') as HTMLElement;
const viewSwitch = document.getElementById('viewSwitch') as HTMLElement;
const prevAnchorBtn = document.getElementById(
  'prevAnchorBtn',
) as HTMLButtonElement;
const nextAnchorBtn = document.getElementById(
  'nextAnchorBtn',
) as HTMLButtonElement;
const anchorDateInput = document.getElementById(
  'anchorDateInput',
) as HTMLInputElement;
const calendarToggleBtn = document.getElementById(
  'calendarToggleBtn',
) as HTMLButtonElement;

const viewButtons = Array.from(
  viewSwitch.querySelectorAll<HTMLButtonElement>('.view-switch__btn'),
);
let summaryRefreshTimer: number | null = null;
let analyticsRefreshTimer: number | null = null;
let currentView: EarningsAnalyticsView = 'daily';
let anchorDate = new Date();
let summaryInFlight: Promise<void> | null = null;
let analyticsInFlight: Promise<void> | null = null;
let analyticsInFlightKey: string | null = null;
let analyticsRequestSeq = 0;

// ── Flatpickr instance ──────────────────────────────────────────────────────
let picker: FlatpickrInstance;

function initCalendar(): void {
  picker = flatpickr(anchorDateInput, {
    defaultDate: anchorDate,
    maxDate: 'today',
    dateFormat: 'Y-m-d',
    disableMobile: true,
    onChange(selectedDates) {
      if (!selectedDates[0]) return;
      anchorDate = selectedDates[0];
      void loadAnalyticsData().catch((e: unknown) =>
        setMessage(
          e instanceof Error ? e.message : 'Failed to load analytics.',
        ),
      );
    },
  });
}

calendarToggleBtn?.addEventListener('click', () => {
  picker?.open();
});

// ── Helpers ─────────────────────────────────────────────────────────────────
function isAnalyticsView(value: unknown): value is EarningsAnalyticsView {
  return (
    value === 'daily' ||
    value === 'weekly' ||
    value === 'monthly' ||
    value === 'yearly'
  );
}

function setActiveViewButton(view: EarningsAnalyticsView): void {
  viewButtons.forEach((btn) => {
    btn.classList.toggle('view-switch__btn--active', btn.dataset.view === view);
  });
}

function resolveInitialView(): EarningsAnalyticsView {
  const activeBtn = viewButtons.find((btn) =>
    btn.classList.contains('view-switch__btn--active'),
  );
  if (isAnalyticsView(activeBtn?.dataset.view)) {
    return activeBtn.dataset.view;
  }
  return 'daily';
}

function applyEarnings(summary: SummaryResponse): void {
  earningsToday.textContent = peso(summary.earnings.today);
  earningsWeek.textContent = peso(summary.earnings.week);
  earningsAll.textContent = peso(summary.earnings.allTime);
  const openCount =
    summary.anomalyStats.openCount > 0
      ? String(summary.anomalyStats.openCount)
      : '';
  if (openAlertBadge) openAlertBadge.textContent = openCount;
  if (openAlertBadgeMob) openAlertBadgeMob.textContent = openCount;

  const maxE = summary.earnings.allTime || 1;
  if (eBarToday)
    eBarToday.style.width = `${Math.min(100, Math.round((summary.earnings.today / maxE) * 100))}%`;
  if (eBarWeek)
    eBarWeek.style.width = `${Math.min(100, Math.round((summary.earnings.week / maxE) * 100))}%`;
}

function shiftAnchorDate(view: EarningsAnalyticsView, step: number): void {
  const next = new Date(anchorDate);
  if (view === 'daily') next.setDate(next.getDate() + step);
  if (view === 'weekly') next.setDate(next.getDate() + step * 7);
  if (view === 'monthly') next.setMonth(next.getMonth() + step);
  if (view === 'yearly') next.setFullYear(next.getFullYear() + step);
  anchorDate = next;
  // Keep Flatpickr in sync
  picker?.setDate(anchorDate, false);
}

function renderTrend(analytics: EarningsAnalyticsResponse): void {
  currentView = analytics.view;
  setActiveViewButton(analytics.view);
  periodLabel.textContent = `${analytics.view.toUpperCase()} · ${analytics.period.label}`;
  trendGrid.replaceChildren();
  for (const bucket of analytics.buckets) {
    const cell = document.createElement('div');
    cell.className = 'trend-cell';
    const labelDiv = document.createElement('div');
    labelDiv.className = 'trend-cell__label';
    labelDiv.textContent = bucket.label;
    const amountDiv = document.createElement('div');
    amountDiv.className = 'trend-cell__amount';
    amountDiv.textContent = peso(bucket.amount);
    cell.append(labelDiv, amountDiv);
    trendGrid.appendChild(cell);
  }

  methodPrint.textContent = peso(analytics.methods.print);
  methodCopy.textContent = peso(analytics.methods.copy);
  methodScan.textContent = peso(analytics.methods.scan);
  topMethod.textContent = analytics.methods.topMode
    ? analytics.methods.topMode.toUpperCase()
    : 'N/A';
}

function getAnalyticsRequestKey(): string {
  return `${currentView}:${anchorDate.toISOString()}`;
}

// ── API ──────────────────────────────────────────────────────────────────────
async function loadSummaryData(): Promise<void> {
  if (summaryInFlight) return summaryInFlight;
  summaryInFlight = (async () => {
    const summaryRes = await apiFetch('/api/admin/summary');
    if (!summaryRes.ok) {
      if (summaryRes.status === 401) throw new Error('Invalid admin PIN.');
      throw new Error('Failed to load earnings data.');
    }
    const summary = (await summaryRes.json()) as SummaryResponse;
    applyEarnings(summary);
  })().finally(() => {
    summaryInFlight = null;
  });
  return summaryInFlight;
}

async function loadAnalyticsData(): Promise<void> {
  const requestKey = getAnalyticsRequestKey();
  if (analyticsInFlight && analyticsInFlightKey === requestKey) {
    return analyticsInFlight;
  }
  const requestSeq = ++analyticsRequestSeq;

  let requestPromise: Promise<void>;
  requestPromise = (async () => {
  const analyticsRes = await apiFetch(
    `/api/admin/earnings/analytics?view=${encodeURIComponent(currentView)}&anchor=${encodeURIComponent(anchorDate.toISOString())}`,
  );
    if (!analyticsRes.ok) {
      if (analyticsRes.status === 401) throw new Error('Invalid admin PIN.');
      throw new Error('Failed to load earnings analytics.');
    }
    const analytics = (await analyticsRes.json()) as EarningsAnalyticsResponse;
    // Drop stale responses when users change view/date quickly.
    if (requestSeq !== analyticsRequestSeq) return;
    renderTrend(analytics);
  })().finally(() => {
    if (analyticsInFlight === requestPromise) {
      analyticsInFlight = null;
      analyticsInFlightKey = null;
    }
  });

  analyticsInFlight = requestPromise;
  analyticsInFlightKey = requestKey;
  return requestPromise;
}

async function loadData(): Promise<void> {
  await Promise.all([loadSummaryData(), loadAnalyticsData()]);
}

// ── Events ───────────────────────────────────────────────────────────────────
refreshBtn.addEventListener('click', () => {
  setMessage('Refreshing...');
  void loadData()
    .then(() => setMessage('Earnings refreshed.'))
    .catch((e: unknown) =>
      setMessage(e instanceof Error ? e.message : 'Refresh failed.'),
    );
});

viewButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!isAnalyticsView(btn.dataset.view)) return;
    currentView = btn.dataset.view;
    setActiveViewButton(currentView);
    void loadAnalyticsData().catch((e: unknown) =>
      setMessage(e instanceof Error ? e.message : 'Failed to load analytics.'),
    );
  });
});

prevAnchorBtn.addEventListener('click', () => {
  shiftAnchorDate(currentView, -1);
  void loadAnalyticsData().catch((e: unknown) =>
    setMessage(e instanceof Error ? e.message : 'Failed to load analytics.'),
  );
});

nextAnchorBtn.addEventListener('click', () => {
  shiftAnchorDate(currentView, 1);
  void loadAnalyticsData().catch((e: unknown) =>
    setMessage(e instanceof Error ? e.message : 'Failed to load analytics.'),
  );
});

initAuth(async () => {
  currentView = resolveInitialView();
  setActiveViewButton(currentView);
  initCalendar();
  picker?.setDate(anchorDate, false);
  await loadData();
  if (summaryRefreshTimer !== null) window.clearInterval(summaryRefreshTimer);
  if (analyticsRefreshTimer !== null)
    window.clearInterval(analyticsRefreshTimer);
  summaryRefreshTimer = window.setInterval(() => void loadSummaryData(), 10_000);
  analyticsRefreshTimer = window.setInterval(
    () => void loadAnalyticsData(),
    60_000,
  );
});

window.addEventListener('pagehide', () => {
  if (summaryRefreshTimer !== null) window.clearInterval(summaryRefreshTimer);
  if (analyticsRefreshTimer !== null) window.clearInterval(analyticsRefreshTimer);
});
