import {
  getEarningsAnalyticsRequestKey,
  isCurrentEarningsAnalyticsRequest,
} from './analytics-request';

describe('earnings analytics request selection', () => {
  it('renders the coalesced daily request after returning from weekly', () => {
    const anchor = new Date('2026-08-27T12:00:00.000Z');
    const dailyRequest = getEarningsAnalyticsRequestKey('daily', anchor);
    const weeklyRequest = getEarningsAnalyticsRequestKey('weekly', anchor);

    expect(
      isCurrentEarningsAnalyticsRequest(dailyRequest, 'daily', anchor),
    ).toBe(true);
    expect(
      isCurrentEarningsAnalyticsRequest(weeklyRequest, 'daily', anchor),
    ).toBe(false);
  });
});
