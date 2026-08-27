import type {
  EarningsAnalyticsResponse,
  EarningsAnalyticsView,
} from '../shared';
import { loadEarningsAnalyticsPair } from './analytics-pair';

const current: EarningsAnalyticsResponse = {
  view: 'daily',
  anchorDate: '2026-08-27T12:00:00.000Z',
  period: { start: '2026-08-27', end: '2026-08-27', label: 'Today' },
  totals: { today: 50, week: 50, month: 50, year: 50, allTime: 50, period: 50 },
  buckets: [],
  methods: { print: 50, copy: 0, scan: 0, total: 50, topMode: 'print' },
};

describe('loadEarningsAnalyticsPair', () => {
  it('rejects instead of returning partial data when the comparison load fails', async () => {
    const loadOne = async (_view: EarningsAnalyticsView, anchor: Date) => {
      if (anchor.toISOString() === current.anchorDate) return current;
      throw new Error('comparison unavailable');
    };

    await expect(
      loadEarningsAnalyticsPair(
        loadOne,
        'daily',
        new Date(current.anchorDate),
      ),
    ).rejects.toThrow('comparison unavailable');
  });
});
