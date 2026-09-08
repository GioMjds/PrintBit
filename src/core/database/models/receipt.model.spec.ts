import { DatabaseSync } from 'node:sqlite';
import { getSqliteDb } from '../sqlite-storage';
import { ReceiptSqliteStore, type ReceiptRecordEntry } from './receipt.model';

jest.mock('../sqlite-storage', () => ({
  getSqliteDb: jest.fn(),
  withTransaction: (handler: () => unknown) => handler(),
}));

describe('ReceiptSqliteStore transaction details', () => {
  let sqlite: DatabaseSync;
  let store: ReceiptSqliteStore;

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE receipt_records (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL UNIQUE,
        mode TEXT NOT NULL,
        charged_amount INTEGER NOT NULL,
        color_pages INTEGER,
        bw_pages INTEGER,
        status TEXT NOT NULL,
        change_requested INTEGER NOT NULL DEFAULT 0,
        change_dispensed INTEGER NOT NULL DEFAULT 0,
        change_state TEXT NOT NULL DEFAULT 'none',
        change_attempts INTEGER NOT NULL DEFAULT 0,
        change_owed_id TEXT,
        change_message TEXT,
        details_json TEXT,
        settled_at TEXT,
        terminal_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `);
    (getSqliteDb as jest.Mock).mockReturnValue(sqlite);
    store = new ReceiptSqliteStore();
  });

  afterEach(() => {
    sqlite.close();
  });

  it('round-trips coins, document name, and print configuration', () => {
    const entry: ReceiptRecordEntry = {
      id: 'receipt-1',
      transactionId: 'PB-STORE-001',
      mode: 'print',
      chargedAmount: 14,
      colorPages: 3,
      bwPages: 0,
      status: 'printed',
      change: {
        requested: 6,
        dispensed: 4,
        state: 'failed',
        attempts: 1,
        owedChangeId: 'OWE-1',
        message: 'Manual settlement required.',
      },
      details: {
        coinsInserted: 20,
        documentName: 'class-report.pdf',
        printConfiguration: {
          copies: 2,
          colorMode: 'colored',
          paperSize: 'A4',
          quality: 'high',
          duplex: true,
          orientation: 'landscape',
          pageRange: '2-4',
        },
      },
      settledAt: '2026-09-08T08:00:00.000Z',
      terminalAt: '2026-09-08T08:01:00.000Z',
      createdAt: '2026-09-08T08:00:00.000Z',
      updatedAt: '2026-09-08T08:01:00.000Z',
      expiresAt: '2026-09-09T08:00:00.000Z',
    };

    store.upsertReceiptRecord(entry);

    expect(store.getReceiptByTransactionId(entry.transactionId)).toEqual(entry);
  });
});
