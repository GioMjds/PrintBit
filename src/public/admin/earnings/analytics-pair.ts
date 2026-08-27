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
