import type { Server } from 'socket.io';
import { execFile } from 'node:child_process';
import {
  FinancialService,
  handleMidJobCancellation,
  type MidJobCancellationInput,
} from './financial.service';
import { settleTerminal } from '@/services/settlement';
import { cancelPrintJobViaEdge } from '@/services/windows-printer-edge';
import { financialLedgerService } from '@/services/financial-ledger';
import type { SessionStore } from '@/services/session';

jest.mock('node:child_process', () => ({
  execFile: jest.fn((_cmd, _args, opts, callback) => {
    const cb = typeof opts === 'function' ? opts : callback;
    if (typeof cb === 'function') {
      cb(null, { stdout: '', stderr: '' });
    }
  }),
}));

jest.mock('@/services/windows-printer-edge', () => ({
  cancelPrintJobViaEdge: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('@/services/settlement', () => ({
  settleTerminal: jest.fn(),
  settlementService: {
    settleTerminal: jest.fn(),
  },
}));

jest.mock('@/services/financial-ledger', () => ({
  financialLedgerService: {
    append: jest.fn().mockResolvedValue({ id: 'ledger-entry-id' }),
  },
}));

jest.mock('@/services/db', () => ({
  db: {
    data: {
      balance: 10,
      earnings: 100,
      financialLedger: [],
      coinStats: { one: 0, five: 0, ten: 0, twenty: 0 },
      settings: { pricingEngine: {} },
    },
    write: jest.fn().mockResolvedValue(undefined),
  },
  withBalanceLock: (cb: () => Promise<unknown>) => cb(),
  acquireIdempotencyKey: jest.fn(),
  storeIdempotencyKey: jest.fn(),
  releaseIdempotencyKey: jest.fn(),
}));

jest.mock('@/core/database/sqlite-storage', () => ({
  getSqliteDb: jest.fn().mockReturnValue({
    exec: jest.fn(),
    prepare: jest.fn().mockReturnValue({
      get: jest.fn(),
      run: jest.fn(),
    }),
  }),
  consumablesStore: {},
  readRuntimeState: jest.fn(),
  writeRuntimeState: jest.fn(),
}));

jest.mock('@/services/admin', () => ({
  adminService: {
    appendAdminLog: jest.fn().mockResolvedValue(undefined),
    getPricingSettings: jest.fn().mockReturnValue({}),
  },
}));

jest.mock('@/services/printer-status', () => ({
  getPrinterTelemetry: jest.fn().mockReturnValue({ name: 'EPSON_L5290' }),
  refreshPrinterTelemetry: jest.fn().mockResolvedValue({ name: 'EPSON_L5290' }),
  evaluateInkPreflight: jest.fn().mockReturnValue({ ok: true }),
  isCoinSlotLocked: jest.fn().mockReturnValue(false),
  getCoinSlotLockOwnerId: jest.fn().mockReturnValue(null),
  getPrinterFaultLock: jest.fn().mockReturnValue(null),
  clearPrinterFaultLock: jest.fn(),
}));

jest.mock('@/services/time-source', () => ({
  assertTrustedTimeForFinancialOperation: jest.fn(),
  getTrustedTimeStatus: jest.fn().mockReturnValue({
    synced: true,
    offsetMs: 0,
    driftExceeded: false,
    enforceForFinancial: false,
  }),
  getTrustedTimestamp: jest.fn().mockReturnValue({
    timestamp: '2026-08-30T00:00:00.000Z',
    meta: { source: 'system', synced: true },
  }),
  isTrustedTimeError: jest.fn().mockReturnValue(false),
}));

describe('FinancialService.handleMidJobCancellation', () => {
  const mockIo = { emit: jest.fn() } as unknown as Server;
  const mockSessionStore = {} as SessionStore;
  let service: FinancialService;

  beforeEach(() => {
    jest.clearAllMocks();

    (settleTerminal as jest.Mock).mockImplementation(async (input) => {
      const charge = Math.min(input.escrowBalance, Math.max(0, input.actualChargedAmount));
      const changeAmount = input.escrowBalance - charge;
      return {
        ok: true,
        chargedAmount: charge,
        previousBalance: input.escrowBalance,
        remainingBalance: 0,
        earnings: 100 + charge,
        change: {
          requested: changeAmount,
          dispensed: changeAmount,
          state: changeAmount > 0 ? 'dispensed' : 'none',
        },
      };
    });

    service = new FinancialService({
      io: mockIo,
      sessionStore: mockSessionStore,
      resolvePublicBaseUrl: () => new URL('http://localhost:3000'),
    });
  });

  it('Test 1: 3-page job @ ₱3/page (total ₱9), ₱10 inserted, 2 pages printed -> charges ₱6, refund ₱3, original change ₱1, total dispensed ₱4', async () => {
    const input: MidJobCancellationInput = {
      transactionId: 'tx-test-1',
      totalInserted: 10,
      unitPricePerPage: 3,
      totalPages: 3,
      pagesPrinted: 2,
      spoolerJobId: 101,
      printerName: 'EPSON_L5290',
      io: mockIo,
    };

    const result = await handleMidJobCancellation(input);

    expect(result.chargedAmount).toBe(6);
    expect(result.refundAmount).toBe(3);
    expect(result.originalChange).toBe(1);
    expect(result.totalDispensed).toBe(4);

    expect(result.itemizedBreakdown).toEqual({
      totalInserted: 10,
      pagesPrinted: 2,
      printedCharge: 6,
      unprintedPages: 1,
      unprintedRefund: 3,
      originalChange: 1,
      totalDispensed: 4,
    });

    expect(cancelPrintJobViaEdge).toHaveBeenCalledWith('EPSON_L5290', 101);
    expect(execFile).toHaveBeenCalledWith(
      'taskkill',
      ['/F', '/IM', 'e_yarnyre.exe'],
      { timeout: 2000 },
      expect.any(Function),
    );

    expect(settleTerminal).toHaveBeenCalledWith({
      escrowBalance: 10,
      actualChargedAmount: 6,
      io: mockIo,
      jobContext: {
        mode: 'print',
        transactionId: 'tx-test-1',
        pagesPrinted: 2,
        totalPages: 3,
        terminalReason: 'paper_out_auto_refund',
      },
    });

    expect(financialLedgerService.append).toHaveBeenCalledWith({
      eventType: 'refund_issued',
      amount: 3,
      referenceId: 'tx-test-1',
      meta: expect.objectContaining({
        source: 'print_partial_settlement',
        transactionId: 'tx-test-1',
        totalPages: 3,
        pagesPrinted: 2,
        unprintedPages: 1,
        printedCharge: 6,
        unprintedRefund: 3,
        originalChange: 1,
        totalDispensed: 4,
        spoolerJobId: 101,
        printerName: 'EPSON_L5290',
      }),
    });
  });

  it('Test 2: 3-page job @ ₱3/page, ₱10 inserted, 0 pages printed (paper out before page 1) -> charges ₱0, total dispensed ₱10 (full payout)', async () => {
    const input: MidJobCancellationInput = {
      transactionId: 'tx-test-2',
      totalInserted: 10,
      unitPricePerPage: 3,
      totalPages: 3,
      pagesPrinted: 0,
      spoolerJobId: 102,
      printerName: 'EPSON_L5290',
      io: mockIo,
    };

    const result = await handleMidJobCancellation(input);

    expect(result.chargedAmount).toBe(0);
    expect(result.refundAmount).toBe(9);
    expect(result.originalChange).toBe(1);
    expect(result.totalDispensed).toBe(10);

    expect(result.itemizedBreakdown).toEqual({
      totalInserted: 10,
      pagesPrinted: 0,
      printedCharge: 0,
      unprintedPages: 3,
      unprintedRefund: 9,
      originalChange: 1,
      totalDispensed: 10,
    });

    expect(settleTerminal).toHaveBeenCalledWith({
      escrowBalance: 10,
      actualChargedAmount: 0,
      io: mockIo,
      jobContext: {
        mode: 'print',
        transactionId: 'tx-test-2',
        pagesPrinted: 0,
        totalPages: 3,
        terminalReason: 'paper_out_auto_refund',
      },
    });

    expect(financialLedgerService.append).toHaveBeenCalledWith({
      eventType: 'refund_issued',
      amount: 9,
      referenceId: 'tx-test-2',
      meta: expect.objectContaining({
        source: 'print_partial_settlement',
        transactionId: 'tx-test-2',
        printedCharge: 0,
        unprintedRefund: 9,
        originalChange: 1,
        totalDispensed: 10,
      }),
    });
  });

  it('Test 3: 3-page job @ ₱3/page, ₱9 exact inserted, 2 pages printed -> charges ₱6, refund ₱3, original change ₱0, total dispensed ₱3', async () => {
    const input: MidJobCancellationInput = {
      transactionId: 'tx-test-3',
      totalInserted: 9,
      unitPricePerPage: 3,
      totalPages: 3,
      pagesPrinted: 2,
      spoolerJobId: 103,
      printerName: 'EPSON_L5290',
      io: mockIo,
    };

    const result = await service.handleMidJobCancellation(input);

    expect(result.chargedAmount).toBe(6);
    expect(result.refundAmount).toBe(3);
    expect(result.originalChange).toBe(0);
    expect(result.totalDispensed).toBe(3);

    expect(result.itemizedBreakdown).toEqual({
      totalInserted: 9,
      pagesPrinted: 2,
      printedCharge: 6,
      unprintedPages: 1,
      unprintedRefund: 3,
      originalChange: 0,
      totalDispensed: 3,
    });

    expect(settleTerminal).toHaveBeenCalledWith({
      escrowBalance: 9,
      actualChargedAmount: 6,
      io: mockIo,
      jobContext: {
        mode: 'print',
        transactionId: 'tx-test-3',
        pagesPrinted: 2,
        totalPages: 3,
        terminalReason: 'paper_out_auto_refund',
      },
    });

    expect(financialLedgerService.append).toHaveBeenCalledWith({
      eventType: 'refund_issued',
      amount: 3,
      referenceId: 'tx-test-3',
      meta: expect.objectContaining({
        source: 'print_partial_settlement',
        transactionId: 'tx-test-3',
        printedCharge: 6,
        unprintedRefund: 3,
        originalChange: 0,
        totalDispensed: 3,
      }),
    });
  });

  it('Test 4: Handles edge cancellation failure gracefully and still settles accurate partial payment', async () => {
    (cancelPrintJobViaEdge as jest.Mock).mockRejectedValueOnce(
      new Error('Spooler RPC connection failed'),
    );
    (execFile as unknown as jest.Mock).mockImplementationOnce((_cmd, _args, opts, cb) => {
      const callback = typeof opts === 'function' ? opts : cb;
      callback(new Error('Process not found'));
    });

    const input: MidJobCancellationInput = {
      transactionId: 'tx-test-4',
      totalInserted: 10,
      unitPricePerPage: 3,
      totalPages: 3,
      pagesPrinted: 2,
      spoolerJobId: 104,
      printerName: 'EPSON_L5290',
      io: mockIo,
    };

    const result = await handleMidJobCancellation(input);

    expect(result.chargedAmount).toBe(6);
    expect(result.refundAmount).toBe(3);
    expect(result.originalChange).toBe(1);
    expect(result.totalDispensed).toBe(4);

    expect(settleTerminal).toHaveBeenCalledWith({
      escrowBalance: 10,
      actualChargedAmount: 6,
      io: mockIo,
      jobContext: {
        mode: 'print',
        transactionId: 'tx-test-4',
        pagesPrinted: 2,
        totalPages: 3,
        terminalReason: 'paper_out_auto_refund',
      },
    });

    expect(financialLedgerService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'refund_issued',
        amount: 3,
        referenceId: 'tx-test-4',
      }),
    );
  });

  it('clamps negative pagesPrinted and excess pagesPrinted', async () => {
    // Negative pagesPrinted clamped to 0
    const resultNegative = await handleMidJobCancellation({
      transactionId: 'tx-clamp-neg',
      totalInserted: 10,
      unitPricePerPage: 3,
      totalPages: 3,
      pagesPrinted: -1,
      io: mockIo,
    });
    expect(resultNegative.itemizedBreakdown.pagesPrinted).toBe(0);
    expect(resultNegative.chargedAmount).toBe(0);
    expect(resultNegative.refundAmount).toBe(9);
    expect(resultNegative.totalDispensed).toBe(10);

    // Excess pagesPrinted clamped to totalPages (3)
    const resultExcess = await handleMidJobCancellation({
      transactionId: 'tx-clamp-excess',
      totalInserted: 10,
      unitPricePerPage: 3,
      totalPages: 3,
      pagesPrinted: 5,
      io: mockIo,
    });
    expect(resultExcess.itemizedBreakdown.pagesPrinted).toBe(3);
    expect(resultExcess.chargedAmount).toBe(9);
    expect(resultExcess.refundAmount).toBe(0);
    expect(resultExcess.originalChange).toBe(1);
    expect(resultExcess.totalDispensed).toBe(1);
  });

  it('handles optional spooler params and ledger append errors without crashing', async () => {
    (financialLedgerService.append as jest.Mock).mockRejectedValueOnce(
      new Error('Ledger write error'),
    );

    const input: MidJobCancellationInput = {
      transactionId: 'tx-no-spooler',
      totalInserted: 10,
      unitPricePerPage: 3,
      totalPages: 3,
      pagesPrinted: 1,
    };

    const result = await handleMidJobCancellation(input);

    expect(cancelPrintJobViaEdge).not.toHaveBeenCalled();
    expect(result.chargedAmount).toBe(3);
    expect(result.refundAmount).toBe(6);
    expect(result.originalChange).toBe(1);
    expect(result.totalDispensed).toBe(7);
  });
});
