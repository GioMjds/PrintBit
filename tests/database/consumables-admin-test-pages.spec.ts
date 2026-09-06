import { DatabaseSync } from 'node:sqlite';

let sqlite: DatabaseSync;

jest.mock('../../src/core/database/sqlite-storage', () => ({
  getSqliteDb: () => sqlite,
}));

jest.mock('../../src/core/database/db', () => ({
  db: { data: null, read: jest.fn(), write: jest.fn() },
}));

import { ConsumablesSqliteStore } from '../../src/core/database/models/consumables.model';

describe('admin test-page usage totals', () => {
  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE consumable_usage_events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        transaction_id TEXT,
        mode TEXT,
        copies INTEGER,
        duplex INTEGER,
        selected_pages INTEGER,
        billable_color_pages INTEGER NOT NULL,
        billable_bw_pages INTEGER NOT NULL,
        estimated_sheets_used INTEGER,
        estimated_ink_units_json TEXT,
        source TEXT NOT NULL,
        billing_page_detection TEXT,
        analysis_confidence TEXT
      );
      CREATE TABLE consumable_ink_snapshots (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL
      )
    `);
    sqlite
      .prepare(
        `INSERT INTO consumable_usage_events
          (id, timestamp, billable_color_pages, billable_bw_pages, source)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('old-test', '2025-01-01T00:00:00.000Z', 0, 1, 'admin-test-page');
    sqlite
      .prepare(
        `INSERT INTO consumable_usage_events
          (id, timestamp, billable_color_pages, billable_bw_pages, source)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('new-test', '2026-09-06T01:00:00.000Z', 0, 1, 'admin-test-page');
    sqlite
      .prepare(
        `INSERT INTO consumable_usage_events
          (id, timestamp, billable_color_pages, billable_bw_pages, source)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('customer', '2025-01-02T00:00:00.000Z', 3, 4, 'worker-return-pipe');
  });

  afterEach(() => {
    sqlite.close();
  });

  test('counts only dedicated admin test pages and honors the time cutoff', () => {
    const store = new ConsumablesSqliteStore();
    const sumUsagePagesBySource = (store as any).sumUsagePagesBySource?.bind(store);

    expect(sumUsagePagesBySource?.('admin-test-page')).toEqual({
      colorPages: 0,
      bwPages: 2,
    });
    expect(
      sumUsagePagesBySource?.(
        'admin-test-page',
        '2026-09-06T00:00:00.000Z',
      ),
    ).toEqual({
      colorPages: 0,
      bwPages: 1,
    });
  });

  test('retains admin test-page counts beyond the telemetry retention window', () => {
    const store = new ConsumablesSqliteStore();

    store.appendUsageEvent({
      id: 'current-test',
      timestamp: new Date().toISOString(),
      transactionId: 'tx-current-test',
      mode: 'print',
      copies: 1,
      duplex: false,
      selectedPages: 1,
      billableColorPages: 0,
      billableBwPages: 1,
      estimatedSheetsUsed: 1,
      estimatedInkUnits: { k: 0.015 },
      source: 'admin-test-page',
      billingPageDetection: 'fallback-assumptions',
      analysisConfidence: 'unknown',
    });

    const remainingIds = sqlite
      .prepare('SELECT id FROM consumable_usage_events ORDER BY id')
      .all()
      .map((row) => String((row as Record<string, unknown>).id));
    expect(remainingIds).toEqual(['current-test', 'new-test', 'old-test']);
  });
});
