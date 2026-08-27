import type { EarningsAnalyticsView } from '../shared';

export function getEarningsAnalyticsRequestKey(
  view: EarningsAnalyticsView,
  anchor: Date,
): string {
  return `${view}:${anchor.toISOString()}`;
}

export function isCurrentEarningsAnalyticsRequest(
  requestKey: string,
  view: EarningsAnalyticsView,
  anchor: Date,
): boolean {
  return requestKey === getEarningsAnalyticsRequestKey(view, anchor);
}
