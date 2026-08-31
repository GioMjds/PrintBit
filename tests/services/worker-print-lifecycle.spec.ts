const persistAndEmitPrintLifecycleState = jest.fn();
const getSpoolerLifecycleRecord = jest.fn();

jest.mock('../../src/services', () => ({
  checkpointRecoverySession: jest.fn(),
  getRecoverySession: jest.fn(() => ({
    mode: 'print',
    requiredAmount: 10,
    sessionId: 'session-paper-out',
    documentId: 'document-paper-out',
    context: {},
  })),
  getSpoolerLifecycleRecord,
  persistAndEmitPrintLifecycleState,
}));

jest.mock('../../src/modules/receipt/receipt.service', () => ({
  ReceiptService: class {
    updateTerminalStatus = jest.fn();
  },
}));

jest.mock('../../src/services/job-store', () => ({
  jobStore: { updateJobState: jest.fn() },
}));

jest.mock('../../src/services/pending-refund', () => ({
  PendingRefundServiceError: class extends Error {},
  upsertSpoolerFailureRefund: jest.fn(),
}));

jest.mock('../../src/services/transient-scan-file', () => ({
  deleteTransientScanFile: jest.fn(),
}));

jest.mock('../../src/services/admin', () => ({
  adminService: { appendAdminLog: jest.fn() },
}));

import { handleWorkerReturnPrintEvent } from '../../src/services/worker-print-lifecycle';

describe('worker PrinterError lifecycle', () => {
  beforeEach(() => {
    persistAndEmitPrintLifecycleState.mockClear();
    getSpoolerLifecycleRecord.mockReset();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('emits a correlated maintenance failure for Epson paper-out', async () => {
    await handleWorkerReturnPrintEvent({
      evt: {
        type: 'PrinterError',
        transactionId: 'tx-paper-out',
        spoolerCorrelationKey: 'spool-paper-out',
        printerName: 'EPSON L5290 Series',
        failureStage: 'hardware_error',
        message: 'Printer error (No Paper)',
        timestampUtc: '2026-08-31T00:00:00.000Z',
      },
      io: {} as never,
      sessionStore: {} as never,
    });

    expect(persistAndEmitPrintLifecycleState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        mode: 'print',
        state: 'failed',
        transactionId: 'tx-paper-out',
        spoolerCorrelationKey: 'spool-paper-out',
        printError: expect.objectContaining({
          code: 'WORKER_HARDWARE_ERROR',
          canRetry: false,
          canDismiss: false,
        }),
      }),
      expect.objectContaining({
        requiredAmount: 10,
        sessionId: 'session-paper-out',
        documentId: 'document-paper-out',
      }),
    );
  });

  test('ignores a late success after the correlated hardware failure is recorded', async () => {
    getSpoolerLifecycleRecord.mockReturnValue({
      currentState: 'failed',
      spoolerCorrelationKey: 'spool-paper-out',
    });

    await handleWorkerReturnPrintEvent({
      evt: {
        type: 'PrintSucceeded',
        transactionId: 'tx-paper-out',
        spoolerCorrelationKey: 'spool-paper-out',
        printerName: 'EPSON L5290 Series',
        timestampUtc: '2026-08-31T00:00:01.000Z',
      },
      io: {} as never,
      sessionStore: {} as never,
    });

    expect(persistAndEmitPrintLifecycleState).not.toHaveBeenCalled();
  });

  test('waits for a correlated hardware failure to persist before processing success', async () => {
    let releaseFailurePersistence: (() => void) | undefined;
    let terminalFailureRecorded = false;
    const failurePersistence = new Promise<void>((resolve) => {
      releaseFailurePersistence = () => {
        terminalFailureRecorded = true;
        resolve();
      };
    });
    getSpoolerLifecycleRecord.mockImplementation(() =>
      terminalFailureRecorded
        ? {
            currentState: 'failed',
            spoolerCorrelationKey: 'spool-paper-out',
          }
        : null,
    );
    persistAndEmitPrintLifecycleState.mockImplementationOnce(
      () => failurePersistence,
    );

    const printerError = handleWorkerReturnPrintEvent({
      evt: {
        type: 'PrinterError',
        transactionId: 'tx-paper-out',
        spoolerCorrelationKey: 'spool-paper-out',
        printerName: 'EPSON L5290 Series',
        failureStage: 'hardware_error',
        message: 'Printer error (No Paper)',
        timestampUtc: '2026-08-31T00:00:00.000Z',
      },
      io: {} as never,
      sessionStore: {} as never,
    });
    const success = handleWorkerReturnPrintEvent({
      evt: {
        type: 'PrintSucceeded',
        transactionId: 'tx-paper-out',
        spoolerCorrelationKey: 'spool-paper-out',
        printerName: 'EPSON L5290 Series',
        timestampUtc: '2026-08-31T00:00:01.000Z',
      },
      io: {} as never,
      sessionStore: {} as never,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(persistAndEmitPrintLifecycleState).toHaveBeenCalledTimes(1);

    releaseFailurePersistence?.();
    await Promise.all([printerError, success]);

    expect(persistAndEmitPrintLifecycleState).toHaveBeenCalledTimes(1);
  });

  test('keeps a hardware failure terminal when lifecycle persistence is unavailable', async () => {
    getSpoolerLifecycleRecord.mockReturnValue(null);

    await handleWorkerReturnPrintEvent({
      evt: {
        type: 'PrinterError',
        transactionId: 'tx-persist-failure',
        spoolerCorrelationKey: 'spool-persist-failure',
        printerName: 'EPSON L5290 Series',
        failureStage: 'hardware_error',
        message: 'Printer error (No Paper)',
        timestampUtc: '2026-08-31T00:00:00.000Z',
      },
      io: {} as never,
      sessionStore: {} as never,
    });
    await handleWorkerReturnPrintEvent({
      evt: {
        type: 'PrintSucceeded',
        transactionId: 'tx-persist-failure',
        spoolerCorrelationKey: 'spool-persist-failure',
        printerName: 'EPSON L5290 Series',
        timestampUtc: '2026-08-31T00:00:01.000Z',
      },
      io: {} as never,
      sessionStore: {} as never,
    });

    expect(persistAndEmitPrintLifecycleState).toHaveBeenCalledTimes(1);
  });
});
