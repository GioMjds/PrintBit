import type { EarningsAnalyticsResponse } from '../shared';
import {
  canNavigateToNextEarningsPeriod,
  createEarningsViewModel,
} from './earnings-view-model';

function analytics(periodTotal: number): EarningsAnalyticsResponse {
  return {
    view: 'daily',
    anchorDate: '2026-08-27T12:00:00.000Z',
    period: { start: '2026-08-27', end: '2026-08-27', label: 'Today' },
    totals: {
      today: periodTotal,
      week: periodTotal,
      month: periodTotal,
      year: periodTotal,
      allTime: periodTotal,
      period: periodTotal,
    },
    buckets: [],
    methods: { print: 0, copy: 0, scan: 0, total: 0, topMode: null },
  };
}

describe('earnings view model', () => {
  it('marks a zero-transaction period empty and keeps every service at zero', () => {
    const model = createEarningsViewModel(analytics(0), analytics(0));

    expect(model).toMatchObject({
      total: 0,
      empty: true,
      topService: null,
      services: [
        { label: 'Print', amount: 0 },
        { label: 'Copy', amount: 0 },
        { label: 'Scan', amount: 0 },
      ],
    });
  });

  it('disables next navigation from the current period', () => {
    const today = new Date('2026-08-27T12:00:00.000Z');

    expect(canNavigateToNextEarningsPeriod('daily', today, today)).toBe(false);
    expect(
      canNavigateToNextEarningsPeriod(
        'daily',
        new Date('2026-08-26T12:00:00.000Z'),
        today,
      ),
    ).toBe(true);
  });
});
