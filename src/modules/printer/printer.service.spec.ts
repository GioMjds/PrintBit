import { PrinterService } from './printer.service';
import { db } from '@/core/database/db';
import { getRecoverySession, checkpointRecoverySession } from '@/services/recovery';
import { cancelPrintJobViaEdge } from '@/services/windows-printer-edge';
import { deleteTransientScanFile } from '@/services/transient-scan-file';
import { financialLedgerService } from '@/services/financial-ledger';
import { persistAndEmitPrintLifecycleState } from '@/services/print-lifecycle-state';
import { SessionStore } from '@/services/session';
import type { Server as SocketIOServer } from 'socket.io';

jest.mock('@/core/database/db', () => ({
  db: {
    data: {
      balance: 0,
      earnings: 100,
      spoolerLifecycle: [],
      recovery: { sessions: [] },
      pendingRefunds: []
    },
    write: jest.fn().mockResolvedValue(undefined),
  },
  withBalanceLock: (cb: () => Promise<any>) => cb(),
}));

jest.mock('@/services/recovery', () => ({
  getRecoverySession: jest.fn(),
  checkpointRecoverySession: jest.fn(),
  recordSpoolerLifecycleTransition: jest.fn(),
}));

jest.mock('@/services/windows-printer-edge', () => ({
  cancelPrintJobViaEdge: jest.fn(),
}));

jest.mock('@/services/transient-scan-file', () => ({
  deleteTransientScanFile: jest.fn(),
}));

jest.mock('@/services/financial-ledger', () => ({
  financialLedgerService: {
    append: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('@/services/print-lifecycle-state', () => ({
  persistAndEmitPrintLifecycleState: jest.fn(),
}));

describe('PrinterService.cancelRemaining', () => {
  let printerService: PrinterService;
  let mockIo: jest.Mocked<SocketIOServer>;
  let mockSessionStore: jest.Mocked<SessionStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    db.data = {
      balance: 0,
      earnings: 100,
      spoolerLifecycle: [
        {
          spoolerCorrelationKey: 'key-123',
          transactionId: 'tx-123',
          pagesPrinted: 3,
          totalPages: 10,
          currentState: 'failed',
          updatedAt: new Date().toISOString(),
          printerName: 'TestPrinter',
          spoolerJobId: 456,
        } as any,
      ],
      recovery: { sessions: [] },
      pendingRefunds: []
    } as any;

    mockIo = {
      emit: jest.fn(),
    } as any;

    mockSessionStore = {
      removeDocument: jest.fn().mockResolvedValue({ success: true, deletedFile: true }),
    } as any;

    printerService = new PrinterService(mockIo, mockSessionStore);
  });

  it('calculates the refund and updates balance and ledger correctly', async () => {
    const mockRecovery = {
      id: 'tx-123',
      mode: 'print' as const,
      requiredAmount: 50,
      chargedAmount: 50,
      sessionId: 'session-123',
      documentId: 'doc-123',
      context: { filename: 'test.pdf' },
    };
    (getRecoverySession as jest.Mock).mockReturnValue(mockRecovery);
    (cancelPrintJobViaEdge as jest.Mock).mockResolvedValue({ success: true });

    await printerService.cancelRemaining('key-123');

    // 3 printed out of 10 pages => printedCost = 15 => refund = 35
    expect(db.data!.balance).toBe(35);
    expect(db.data!.earnings).toBe(65);
    expect(financialLedgerService.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'refund_issued',
        amount: 35,
        referenceId: 'tx-123',
      })
    );
    expect(mockIo.emit).toHaveBeenCalledWith('balance', 35);
    expect(cancelPrintJobViaEdge).toHaveBeenCalledWith(expect.any(String), expect.any(Number));
    expect(mockSessionStore.removeDocument).toHaveBeenCalledWith('session-123', 'doc-123');
    expect(persistAndEmitPrintLifecycleState).toHaveBeenCalledWith(
      mockIo,
      expect.objectContaining({
        state: 'printed',
        pagesPrinted: 3,
        totalPages: 10,
      }),
      expect.any(Object)
    );
  });
});
