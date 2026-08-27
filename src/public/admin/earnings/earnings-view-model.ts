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
  services: { label: 'Print' | 'Copy' | 'Scan'; amount: number }[];
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
  const nextDay = new Date(next.getFullYear(), next.getMonth(), next.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return nextDay <= today;
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
  const services = [
    { label: 'Print', amount: current.methods.print },
    { label: 'Copy', amount: current.methods.copy },
    { label: 'Scan', amount: current.methods.scan },
  ] as const satisfies EarningsViewModel['services'];
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
