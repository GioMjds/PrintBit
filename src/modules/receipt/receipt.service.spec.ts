import type { ReceiptRecordEntry } from '@/services/db';
import { receiptStore } from '@/core/database/sqlite-storage';
import { ReceiptService } from './receipt.service';

jest.mock('@/core/database/sqlite-storage', () => ({
  receiptStore: {
    getReceiptByTransactionId: jest.fn(),
    getReceiptById: jest.fn(),
    upsertReceiptRecord: jest.fn(),
  },
}));

jest.mock('@/services/admin', () => ({
  adminService: {
    appendAdminLog: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/services/recovery', () => ({
  getSpoolerLifecycleRecord: jest.fn(() => null),
}));

describe('ReceiptService transaction details', () => {
  let storedReceipt: ReceiptRecordEntry | null;
  let service: ReceiptService;

  beforeEach(() => {
    jest.clearAllMocks();
    storedReceipt = null;
    service = new ReceiptService();

    (receiptStore.getReceiptByTransactionId as jest.Mock).mockImplementation(
      () => storedReceipt,
    );
    (receiptStore.upsertReceiptRecord as jest.Mock).mockImplementation(
      (entry: ReceiptRecordEntry) => {
        storedReceipt = entry;
      },
    );
  });

  it('keeps the accepted coins, document name, and selected print configuration in the receipt payload', () => {
    const now = new Date('2026-09-08T08:00:00.000Z');

    service.upsertReceiptSnapshot(
      {
        transactionId: 'PB-DETAILS-001',
        mode: 'print',
        chargedAmount: 14,
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
        change: {
          requested: 6,
          dispensed: 4,
          state: 'failed',
        },
      } as any,
      now,
    );

    const result = service.resolveByTransactionId('PB-DETAILS-001', now);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('Expected receipt payload.');
    expect(result.payload).toMatchObject({
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
      change: {
        requested: 6,
        dispensed: 4,
        remaining: 2,
      },
    });
  });

  it('stores only a safe display name for an uploaded document', () => {
    const now = new Date('2026-09-08T08:00:00.000Z');

    service.upsertReceiptSnapshot(
      {
        transactionId: 'PB-DETAILS-002',
        mode: 'print',
        chargedAmount: 5,
        coinsInserted: 5,
        documentName: '../private\u0000/final\r\nreport.docx',
      } as any,
      now,
    );

    const result = service.resolveByTransactionId('PB-DETAILS-002', now);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('Expected receipt payload.');
    expect((result.payload as any).documentName).toBe('finalreport.docx');
  });
});
