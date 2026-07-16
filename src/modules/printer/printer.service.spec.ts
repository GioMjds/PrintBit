import { PrinterService } from './printer.service';
import { db } from '@/core/database/db';
import {
  getRecoverySession,
  checkpointRecoverySession,
  recordSpoolerLifecycleTransition,
} from '@/services/recovery';
import {
  cancelPrintJobViaEdge,
  pausePrintJobViaEdge,
  resumePrintJobViaEdge,
} from '@/services/windows-printer-edge';
import { deleteTransientScanFile } from '@/services/transient-scan-file';
import { financialLedgerService } from '@/services/financial-ledger';
import { persistAndEmitPrintLifecycleState } from '@/services/print-lifecycle-state';
import { SessionStore } from '@/services/session';
import type { Server as SocketIOServer } from 'socket.io';
import fs from 'node:fs/promises';

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

jest.mock('@/services/printer-status', () => ({
  getPrinterTelemetry: jest.fn().mockReturnValue({ name: 'TestPrinter' }),
}));

jest.mock('@/services/windows-printer-edge', () => ({
  cancelPrintJobViaEdge: jest.fn(),
  pausePrintJobViaEdge: jest.fn(),
  resumePrintJobViaEdge: jest.fn(),
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

jest.mock('node:fs/promises', () => ({
  unlink: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn(),
  rename: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
}));
jest.mock('@/config/http.config', () => {
  const actual = jest.requireActual('@/config/http.config');
  return {
    ...actual,
    WORKER_QUEUE_DIR: 'mock-queue-dir',
    WORKER_FAILED_DIR: 'mock-failed-dir',
  };
});

describe('PrinterService.cancelRemaining', () => {
  let printerService: PrinterService;
  let mockIo: jest.Mocked<SocketIOServer>;
  let mockSessionStore: jest.Mocked<SessionStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    (getRecoverySession as jest.Mock).mockReset();
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

  it('clamps pagesPrinted when it exceeds totalPages', async () => {
    db.data!.spoolerLifecycle[0].pagesPrinted = 15; // exceeds totalPages = 10
    db.data!.spoolerLifecycle[0].totalPages = 10;

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

    // 15 printed out of 10 pages => clamped to 10 printed => printedCost = 50 => refund = 0
    expect(db.data!.balance).toBe(0);
    expect(persistAndEmitPrintLifecycleState).toHaveBeenCalledWith(
      mockIo,
      expect.objectContaining({
        pagesPrinted: 10,
        totalPages: 10,
      }),
      expect.any(Object)
    );
  });

  it('protects against division by zero when totalPages is 0', async () => {
    db.data!.spoolerLifecycle[0].pagesPrinted = 0;
    db.data!.spoolerLifecycle[0].totalPages = 0; // will clamp totalPages to 1

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

    // totalPages clamped to 1. pagesPrinted clamped to 1 (which is min(1, max(0, 0)) = 0).
    // printedCost = Math.ceil(0 * (50/1)) = 0 => refund = 50
    expect(db.data!.balance).toBe(50);
    expect(persistAndEmitPrintLifecycleState).toHaveBeenCalledWith(
      mockIo,
      expect.objectContaining({
        pagesPrinted: 0,
        totalPages: 1,
      }),
      expect.any(Object)
    );
  });

  it('calls deleteTransientScanFile in copy mode if previewFilename is present', async () => {
    const mockRecovery = {
      id: 'tx-123',
      mode: 'copy' as const,
      requiredAmount: 50,
      chargedAmount: 50,
      sessionId: 'session-123',
      documentId: 'doc-123',
      context: { filename: 'test.pdf', previewFilename: 'preview-img-123.jpg' },
    };
    (getRecoverySession as jest.Mock).mockReturnValue(mockRecovery);
    (cancelPrintJobViaEdge as jest.Mock).mockResolvedValue({ success: true });

    await printerService.cancelRemaining('key-123');

    expect(deleteTransientScanFile).toHaveBeenCalledWith('preview-img-123.jpg');
  });

  it('throws error if spoolerCorrelationKey is invalid', async () => {
    await expect(printerService.cancelRemaining('invalid key!'))
      .rejects.toThrow('Invalid spoolerCorrelationKey');
  });

  it('throws error and does not issue refund if cancelPrintJobViaEdge fails with a non-missing error', async () => {
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
    (cancelPrintJobViaEdge as jest.Mock).mockResolvedValue({ success: false, error: 'Access Denied' });

    const balanceBefore = db.data!.balance;
    await expect(printerService.cancelRemaining('key-123'))
      .rejects.toThrow('Failed to cancel print job: Access Denied');

    // Assert refund was NOT issued
    expect(db.data!.balance).toBe(balanceBefore);
  });

  it('does not throw and issues refund if cancelPrintJobViaEdge fails with a job not found / missing error', async () => {
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
    // return "Job not found in queue"
    (cancelPrintJobViaEdge as jest.Mock).mockResolvedValue({ success: false, error: 'Job not found in queue' });

    await printerService.cancelRemaining('key-123');

    // 3 printed out of 10 pages => printedCost = 15 => refund = 35
    expect(db.data!.balance).toBe(35);
  });

  it('does not call deleteTransientScanFile when mode is print', async () => {
    const mockRecovery = {
      id: 'tx-123',
      mode: 'print' as const,
      requiredAmount: 50,
      chargedAmount: 50,
      sessionId: 'session-123',
      documentId: 'doc-123',
      context: { filename: 'test.pdf', previewFilename: 'preview-img-123.jpg' },
    };
    (getRecoverySession as jest.Mock).mockReturnValue(mockRecovery);
    (cancelPrintJobViaEdge as jest.Mock).mockResolvedValue({ success: true });

    await printerService.cancelRemaining('key-123');

    expect(deleteTransientScanFile).not.toHaveBeenCalled();
  });

  it('unlinks filename directly if sessionId is missing', async () => {
    const mockRecovery = {
      id: 'tx-123',
      mode: 'print' as const,
      requiredAmount: 50,
      chargedAmount: 50,
      sessionId: undefined,
      documentId: 'doc-123',
      context: { filename: 'test.pdf' },
    };
    (getRecoverySession as jest.Mock).mockReturnValue(mockRecovery);
    (cancelPrintJobViaEdge as jest.Mock).mockResolvedValue({ success: true });

    await printerService.cancelRemaining('key-123');

    expect(mockSessionStore.removeDocument).not.toHaveBeenCalled();
    expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('test.pdf'));
  });

  it('unlinks filename directly if documentId is missing', async () => {
    const mockRecovery = {
      id: 'tx-123',
      mode: 'print' as const,
      requiredAmount: 50,
      chargedAmount: 50,
      sessionId: 'session-123',
      documentId: undefined,
      context: { filename: 'test.pdf' },
    };
    (getRecoverySession as jest.Mock).mockReturnValue(mockRecovery);
    (cancelPrintJobViaEdge as jest.Mock).mockResolvedValue({ success: true });

    await printerService.cancelRemaining('key-123');

    expect(mockSessionStore.removeDocument).not.toHaveBeenCalled();
    expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('test.pdf'));
  });

  it('logs a warning and does not abort when deleteTransientScanFile throws an error', async () => {
    const mockRecovery = {
      id: 'tx-123',
      mode: 'copy' as const,
      requiredAmount: 50,
      chargedAmount: 50,
      sessionId: 'session-123',
      documentId: 'doc-123',
      context: { filename: 'test.pdf', previewFilename: 'preview-img-123.jpg' },
    };
    (getRecoverySession as jest.Mock).mockReturnValue(mockRecovery);
    (cancelPrintJobViaEdge as jest.Mock).mockResolvedValue({ success: true });
    (deleteTransientScanFile as jest.Mock).mockRejectedValue(new Error('Delete failed'));

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await printerService.cancelRemaining('key-123');

    expect(deleteTransientScanFile).toHaveBeenCalledWith('preview-img-123.jpg');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to delete transient scan file'),
      'Delete failed'
    );

    consoleWarnSpy.mockRestore();
  });

  it('throws error when the recovery session phase is reconciled', async () => {
    const mockRecovery = {
      id: 'tx-123',
      mode: 'print' as const,
      requiredAmount: 50,
      chargedAmount: 50,
      sessionId: 'session-123',
      documentId: 'doc-123',
      context: { filename: 'test.pdf' },
      phase: 'reconciled',
    };
    (getRecoverySession as jest.Mock).mockReturnValue(mockRecovery);

    await expect(printerService.cancelRemaining('key-123'))
      .rejects.toThrow('Cannot cancel: transaction tx-123 is already reconciled.');
  });
});

describe('PrinterService.pauseJob', () => {
  let printerService: PrinterService;

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
          currentState: 'processing',
          updatedAt: new Date().toISOString(),
          printerName: 'TestPrinter',
          spoolerJobId: 456,
          mode: 'print',
        } as any,
      ],
      recovery: { sessions: [] },
      pendingRefunds: []
    } as any;

    printerService = new PrinterService();
  });

  it('successfully pauses a print job and records the paused transition', async () => {
    (pausePrintJobViaEdge as jest.Mock).mockResolvedValue({ success: true });

    await printerService.pauseJob('key-123');

    expect(pausePrintJobViaEdge).toHaveBeenCalledWith('TestPrinter', 456);
    expect(recordSpoolerLifecycleTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: 'tx-123',
        state: 'paused',
        spoolerCorrelationKey: 'key-123',
      })
    );
  });

  it('handles the EPSON driver race condition (job not found) as a no-op success', async () => {
    (pausePrintJobViaEdge as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Job not found in queue',
    });

    await expect(printerService.pauseJob('key-123')).resolves.not.toThrow();

    expect(pausePrintJobViaEdge).toHaveBeenCalledWith('TestPrinter', 456);
    expect(recordSpoolerLifecycleTransition).not.toHaveBeenCalled();
  });

  it('throws an error if pausePrintJobViaEdge fails with other errors', async () => {
    (pausePrintJobViaEdge as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Access Denied',
    });

    await expect(printerService.pauseJob('key-123')).rejects.toThrow('Access Denied');
    expect(recordSpoolerLifecycleTransition).not.toHaveBeenCalled();
  });

  it('throws error if spoolerCorrelationKey is invalid', async () => {
    await expect(printerService.pauseJob('invalid key!'))
      .rejects.toThrow('Invalid spoolerCorrelationKey');
  });
});

describe('PrinterService.resumeJob', () => {
  let printerService: PrinterService;

  beforeEach(() => {
    jest.clearAllMocks();
    (getRecoverySession as jest.Mock).mockReset();
    db.data = {
      balance: 0,
      earnings: 100,
      spoolerLifecycle: [
        {
          spoolerCorrelationKey: 'key-123',
          transactionId: 'tx-123',
          pagesPrinted: 3,
          totalPages: 10,
          currentState: 'paused',
          updatedAt: new Date().toISOString(),
          printerName: 'TestPrinter',
          spoolerJobId: 456,
          mode: 'print',
        } as any,
      ],
      recovery: { sessions: [] },
      pendingRefunds: []
    } as any;

    printerService = new PrinterService();
  });

  it('successfully resumes a paused print job and records processing transition', async () => {
    (resumePrintJobViaEdge as jest.Mock).mockResolvedValue({ success: true });

    await printerService.resumeJob('key-123');

    expect(resumePrintJobViaEdge).toHaveBeenCalledWith('TestPrinter', 456);
    expect(recordSpoolerLifecycleTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: 'tx-123',
        state: 'processing',
        spoolerCorrelationKey: 'key-123',
      })
    );
  });

  it('handles EPSON firmware quirk (already in state) when it was a genuine user pause', async () => {
    (resumePrintJobViaEdge as jest.Mock).mockResolvedValue({
      success: true,
      alreadyInState: true,
    });

    await printerService.resumeJob('key-123');

    expect(resumePrintJobViaEdge).toHaveBeenCalledWith('TestPrinter', 456);
    // Should still record transition to processing
    expect(recordSpoolerLifecycleTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: 'tx-123',
        state: 'processing',
        spoolerCorrelationKey: 'key-123',
      })
    );
  });

  it('skips resubmit/transition if already in state and not a genuine user pause', async () => {
    db.data!.spoolerLifecycle[0].currentState = 'processing';
    (resumePrintJobViaEdge as jest.Mock).mockResolvedValue({
      success: true,
      alreadyInState: true,
    });

    await printerService.resumeJob('key-123');

    expect(resumePrintJobViaEdge).toHaveBeenCalledWith('TestPrinter', 456);
    expect(recordSpoolerLifecycleTransition).not.toHaveBeenCalled();
  });

  it('resubmits job if job is not found in queue and plan is partial (files in queue dir)', async () => {
    db.data!.spoolerLifecycle[0].pagesPrinted = 3;
    db.data!.spoolerLifecycle[0].totalPages = 10;
    (resumePrintJobViaEdge as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Job not found in queue',
    });

    (fs.readdir as jest.Mock).mockImplementation((dir) => {
      if (dir === 'mock-queue-dir') {
        return Promise.resolve(['tx-123_key-123_1623.pdf', 'tx-123_key-123_1623.json']);
      }
      return Promise.resolve([]);
    });

    (fs.readFile as jest.Mock).mockResolvedValue(
      JSON.stringify({ copies: 2, color: true })
    );

    await printerService.resumeJob('key-123');

    expect(fs.unlink).toHaveBeenCalledWith(
      expect.stringContaining('tx-123_key-123_1623.json')
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('tx-123_key-123_'),
      expect.stringContaining('"pageRange":"4-10"'),
      'utf-8'
    );
  });

  it('resubmits job if job is not found in queue and plan is partial (files in failed dir)', async () => {
    db.data!.spoolerLifecycle[0].pagesPrinted = 3;
    db.data!.spoolerLifecycle[0].totalPages = 10;
    (resumePrintJobViaEdge as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Job not found in queue',
    });

    (fs.readdir as jest.Mock).mockImplementation((dir) => {
      if (dir === 'mock-failed-dir') {
        return Promise.resolve(['tx-123_key-123_1623.pdf', 'tx-123_key-123_1623.json']);
      }
      return Promise.resolve([]);
    });

    (fs.readFile as jest.Mock).mockResolvedValue(
      JSON.stringify({ copies: 2, color: true })
    );

    await printerService.resumeJob('key-123');

    expect(fs.rename).toHaveBeenCalledWith(
      expect.stringContaining('mock-failed-dir'),
      expect.stringContaining('mock-queue-dir')
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('tx-123_key-123_1623.json'),
      expect.stringContaining('"pageRange":"4-10"'),
      'utf-8'
    );
  });

  it('does nothing and returns successfully if plan is no_resubmit', async () => {
    db.data!.spoolerLifecycle[0].pagesPrinted = 10;
    db.data!.spoolerLifecycle[0].totalPages = 10;
    (resumePrintJobViaEdge as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Job not found in queue',
    });

    await printerService.resumeJob('key-123');

    expect(fs.readdir).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('throws a structured error if plan is unknown', async () => {
    db.data!.spoolerLifecycle[0].pagesPrinted = null;
    db.data!.spoolerLifecycle[0].totalPages = null;
    (resumePrintJobViaEdge as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Job not found in queue',
    });

    await expect(printerService.resumeJob('key-123')).rejects.toThrow(
      /Cannot resume: spooler job was purged/
    );
  });

  it('throws an error if files are not found in queue or failed directories', async () => {
    db.data!.spoolerLifecycle[0].pagesPrinted = 3;
    db.data!.spoolerLifecycle[0].totalPages = 10;
    (resumePrintJobViaEdge as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Job not found in queue',
    });

    (fs.readdir as jest.Mock).mockResolvedValue([]);

    await expect(printerService.resumeJob('key-123')).rejects.toThrow(
      /Print files not found in worker queue or failed directory/
    );
  });

  it('throws error when the recovery session phase is reconciled', async () => {
    const mockRecovery = {
      id: 'tx-123',
      mode: 'print' as const,
      requiredAmount: 50,
      chargedAmount: 50,
      sessionId: 'session-123',
      documentId: 'doc-123',
      context: { filename: 'test.pdf' },
      phase: 'reconciled',
    };
    (getRecoverySession as jest.Mock).mockReturnValue(mockRecovery);

    await expect(printerService.resumeJob('key-123'))
      .rejects.toThrow('Cannot resume: transaction tx-123 is already reconciled.');
  });

  it('throws error if spoolerCorrelationKey is invalid', async () => {
    await expect(printerService.resumeJob('invalid key!'))
      .rejects.toThrow('Invalid spoolerCorrelationKey');
  });
});

