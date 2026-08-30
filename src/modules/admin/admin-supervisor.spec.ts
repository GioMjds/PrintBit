import type { Request, Response } from 'express';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ConsumablesService } from './consumables.service';
import { db } from '@/services/db';

jest.mock('@/services/db', () => ({
  db: {
    data: {
      balance: 10,
      spoolerLifecycle: [],
      anomalyIncidents: [],
      feedback: [],
      reportIssues: [],
      pendingRefunds: [],
      owedChanges: [],
      coinStats: { one: 0, five: 0, ten: 0, twenty: 0 },
      jobStats: { total: 0, print: 0, copy: 0, scan: 0 },
      hopperStats: {
        dispenseAttempts: 0,
        dispenseSuccess: 0,
        dispenseFailures: 0,
        totalDispensed: 0,
        lastDispensedAt: null,
        lastError: null,
        selfTestPassed: null,
        lastSelfTestAt: null,
      },
      settings: {
        adminPin: '1234',
        pricingEngine: {},
      },
      inkRefillBaseline: null,
    },
    write: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/core/database/sqlite-storage', () => ({
  getSqliteDb: jest.fn().mockReturnValue({
    prepare: jest.fn().mockReturnValue({
      get: jest.fn().mockReturnValue({ colorSum: 0, bwSum: 0 }),
    }),
  }),
  writeRuntimeState: jest.fn(),
}));

jest.mock('@/middleware/admin-auth', () => ({
  requireAdminLocalAccess: (_req: any, _res: any, next: any) => next(),
  requireAdminPin: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('@/services/printer-status', () => ({
  getPrinterTelemetry: jest.fn().mockReturnValue({ name: 'EPSON_L5290' }),
  refreshPrinterTelemetry: jest.fn().mockResolvedValue({ name: 'EPSON_L5290' }),
  listInstalledPrinters: jest.fn().mockResolvedValue([]),
  runInkTelemetryDiagnostics: jest.fn().mockResolvedValue({}),
}));

jest.mock('@/services/scanner', () => ({
  getScannerStatus: jest.fn().mockReturnValue({ connected: true }),
}));

jest.mock('@/services/watchdog-health', () => ({
  getExternalWatchdogState: jest.fn().mockReturnValue({ running: false }),
}));

jest.mock('@/services/time-source', () => ({
  getTrustedTimeStatus: jest.fn().mockReturnValue({ synced: true }),
  verifyTrustedClockSync: jest.fn().mockResolvedValue({ synced: true }),
}));

jest.mock('@/services/recovery', () => ({
  getRecoveryStatusSnapshot: jest.fn().mockReturnValue({}),
  getSpoolerLifecycleRecord: jest.fn(),
}));

describe('AdminController Active Print Job Supervisor', () => {
  let controller: AdminController;
  let adminService: AdminService;
  let consumablesService: ConsumablesService;

  function createMockResponse(): Partial<Response> & {
    _status: number;
    _sent: any;
  } {
    const res: any = {
      _status: 200,
      _sent: null,
      status(code: number) {
        this._status = code;
        return this;
      },
      json(data: any) {
        this._sent = data;
        return this;
      },
    };
    return res;
  }

  beforeEach(() => {
    jest.clearAllMocks();

    db.data = {
      balance: 10,
      spoolerLifecycle: [],
      anomalyIncidents: [],
      feedback: [],
      reportIssues: [],
      pendingRefunds: [],
      owedChanges: [],
      coinStats: { one: 0, five: 0, ten: 0, twenty: 0 },
      jobStats: { total: 0, print: 0, copy: 0, scan: 0 },
      hopperStats: {
        dispenseAttempts: 0,
        dispenseSuccess: 0,
        dispenseFailures: 0,
        totalDispensed: 0,
        lastDispensedAt: null,
        lastError: null,
        selfTestPassed: null,
        lastSelfTestAt: null,
      },
      settings: {
        adminPin: '1234',
        pricingEngine: {} as any,
      },
      inkRefillBaseline: null,
    } as any;

    adminService = new AdminService();
    consumablesService = new ConsumablesService();
    controller = new AdminController(adminService, consumablesService, {
      io: { emit: jest.fn() } as any,
      uploadDir: '/tmp/uploads',
      getSerialStatus: jest.fn().mockReturnValue({
        connected: true,
        portPath: null,
        lastError: null,
      }),
      getHopperStatus: jest.fn().mockReturnValue({
        connected: true,
        pending: false,
        portPath: null,
        lastError: null,
        lastSuccessAt: null,
      }),
      runHopperSelfTest: jest.fn().mockResolvedValue({
        ok: true,
        amount: 0,
        message: 'OK',
        attempts: 1,
      }),
    });
  });

  it('returns hasActiveJob: false when spoolerLifecycle is empty', async () => {
    db.data!.spoolerLifecycle = [];
    const req = {} as Request;
    const res = createMockResponse();

    await (controller as any).handleGetActivePrintJob(req, res);

    expect(res._status).toBe(200);
    expect(res._sent).toEqual({
      ok: true,
      activeJob: {
        hasActiveJob: false,
      },
    });
  });

  it('returns hasActiveJob: false when all lifecycle records are completed or failed', async () => {
    db.data!.spoolerLifecycle = [
      {
        transactionId: 'tx-completed-1',
        mode: 'print',
        currentState: 'printed',
        createdAt: '2026-08-30T10:00:00.000Z',
        updatedAt: '2026-08-30T10:01:00.000Z',
      } as any,
      {
        transactionId: 'tx-failed-1',
        mode: 'print',
        currentState: 'failed',
        createdAt: '2026-08-30T10:02:00.000Z',
        updatedAt: '2026-08-30T10:03:00.000Z',
      } as any,
    ];

    const req = {} as Request;
    const res = createMockResponse();

    await (controller as any).handleGetActivePrintJob(req, res);

    expect(res._status).toBe(200);
    expect(res._sent).toEqual({
      ok: true,
      activeJob: {
        hasActiveJob: false,
      },
    });
  });

  it('returns active job telemetry when a job is in processing state', async () => {
    db.data!.balance = 15;
    db.data!.spoolerLifecycle = [
      {
        transactionId: 'tx-active-1',
        mode: 'print',
        currentState: 'processing',
        spoolerJobId: 101,
        spoolerCorrelationKey: 'corr-active-1',
        pagesPrinted: 1,
        totalPages: 4,
        reason: null,
        meta: { filename: 'Report.pdf' },
        createdAt: '2026-08-30T11:00:00.000Z',
        updatedAt: '2026-08-30T11:00:30.000Z',
      } as any,
    ];

    const req = {} as Request;
    const res = createMockResponse();

    await (controller as any).handleGetActivePrintJob(req, res);

    expect(res._status).toBe(200);
    expect(res._sent).toEqual({
      ok: true,
      activeJob: {
        hasActiveJob: true,
        jobId: 101,
        spoolerCorrelationKey: 'corr-active-1',
        transactionId: 'tx-active-1',
        documentName: 'Report.pdf',
        pagesPrinted: 1,
        totalPages: 4,
        escrowBalance: 15,
        status: 'processing',
        isOutOfPaper: false,
        isPaused: false,
      },
    });
  });

  it('returns active job telemetry when a job is paused due to paper out', async () => {
    db.data!.balance = 20;
    db.data!.spoolerLifecycle = [
      {
        transactionId: 'tx-paused-1',
        mode: 'print',
        currentState: 'paused',
        spoolerJobId: 102,
        spoolerCorrelationKey: 'corr-paused-1',
        pagesPrinted: 2,
        totalPages: 5,
        reason: 'paper_out',
        meta: { filename: 'Thesis.pdf' },
        createdAt: '2026-08-30T11:10:00.000Z',
        updatedAt: '2026-08-30T11:11:00.000Z',
      } as any,
    ];

    const req = {} as Request;
    const res = createMockResponse();

    await (controller as any).handleGetActivePrintJob(req, res);

    expect(res._status).toBe(200);
    expect(res._sent).toEqual({
      ok: true,
      activeJob: {
        hasActiveJob: true,
        jobId: 102,
        spoolerCorrelationKey: 'corr-paused-1',
        transactionId: 'tx-paused-1',
        documentName: 'Thesis.pdf',
        pagesPrinted: 2,
        totalPages: 5,
        escrowBalance: 20,
        status: 'paused',
        isOutOfPaper: true,
        isPaused: true,
      },
    });
  });

  it('returns active job telemetry when a job is queued with fallback document name', async () => {
    db.data!.balance = 6;
    db.data!.spoolerLifecycle = [
      {
        transactionId: 'tx-queued-1',
        mode: 'print',
        currentState: 'queued',
        spoolerJobId: null,
        spoolerCorrelationKey: 'corr-queued-1',
        pagesPrinted: null,
        totalPages: 2,
        reason: null,
        createdAt: '2026-08-30T11:20:00.000Z',
        updatedAt: '2026-08-30T11:20:00.000Z',
      } as any,
    ];

    const req = {} as Request;
    const res = createMockResponse();

    await (controller as any).handleGetActivePrintJob(req, res);

    expect(res._status).toBe(200);
    expect(res._sent).toEqual({
      ok: true,
      activeJob: {
        hasActiveJob: true,
        jobId: null,
        spoolerCorrelationKey: 'corr-queued-1',
        transactionId: 'tx-queued-1',
        documentName: 'Document',
        pagesPrinted: 0,
        totalPages: 2,
        escrowBalance: 6,
        status: 'queued',
        isOutOfPaper: false,
        isPaused: false,
      },
    });
  });

  it('returns 500 when an unexpected error occurs during querying', async () => {
    Object.defineProperty(db, 'data', {
      get: () => {
        throw new Error('Database connection crashed');
      },
      configurable: true,
    });

    const req = {} as Request;
    const res = createMockResponse();

    await (controller as any).handleGetActivePrintJob(req, res);

    expect(res._status).toBe(500);
    expect(res._sent).toEqual({
      ok: false,
      error: 'Failed to query active print job',
    });
  });
});
