import type { Request, Response } from 'express';

const writeFileSync = jest.fn();
const generateTestPagePdf = jest.fn(() => Buffer.from('%PDF-1.4\n%%EOF'));
const getPrinterTelemetry = jest.fn(() => ({
  connected: true,
  name: 'EPSON L5290 Series',
  status: 'ready',
  driverName: 'EPSON L5290',
  portName: 'USB001',
}));
const handoffToWorker = jest.fn().mockResolvedValue({
  targetPath: 'queue/test.pdf',
  fileName: 'test.pdf',
});
const checkpointRecoverySession = jest.fn().mockResolvedValue({});
const getRecoveryStatusSnapshot = jest.fn(() => ({
  lifecycle: {
    bootCount: 1,
    unexpectedRestartCount: 0,
    lastStartupAt: null,
    lastShutdownAt: null,
  },
  sessionStats: {
    inFlight: 0,
    startupPending: 0,
    autoRefunded: 0,
    pendingAdminReview: 0,
    voided: 0,
  },
}));
const runtimeDb: { data: unknown } = { data: null };
const sumUsagePagesBySource = jest.fn();
const getSqliteDb = jest.fn(() => ({
  prepare: jest.fn(() => ({
    get: jest.fn(() => ({ colorSum: 0, bwSum: 0 })),
  })),
}));

jest.mock('node:fs', () => ({
  __esModule: true,
  default: { writeFileSync },
}));

jest.mock('../../src/services/test-page', () => ({ generateTestPagePdf }));

jest.mock('../../src/services/printer-state-projection', () => ({
  getPrinterTelemetry,
  listInstalledPrinters: jest.fn(),
  refreshPrinterTelemetry: jest.fn(),
  runInkTelemetryDiagnostics: jest.fn(),
}));

jest.mock('../../src/services/worker-handoff', () => ({ handoffToWorker }));

jest.mock('../../src/services/recovery', () => ({
  checkpointRecoverySession,
  getRecoveryStatusSnapshot,
  getSpoolerLifecycleRecord: jest.fn(),
}));

jest.mock('../../src/config', () => ({ WORKER_QUEUE_DIR: 'queue' }));

jest.mock('../../src/services/db', () => ({ db: runtimeDb }));

jest.mock('../../src/middleware/admin-auth', () => ({
  requireAdminLocalAccess: jest.fn(),
  requireAdminPin: jest.fn(),
}));

jest.mock('../../src/core/database/sqlite-storage', () => ({
  ADMIN_TEST_PAGE_USAGE_SOURCE: 'admin-test-page',
  consumablesStore: { sumUsagePagesBySource },
  getSqliteDb,
  writeRuntimeState: jest.fn(),
}));

jest.mock('../../src/modules/receipt', () => ({
  ReceiptService: class {},
}));

jest.mock('../../src/middleware/rate-limit', () => ({
  createRateLimit: jest.fn(() => jest.fn()),
}));

jest.mock('../../src/services/scanner', () => ({
  getScannerStatus: jest.fn(() => ({ connected: false })),
}));

jest.mock('../../src/services/watchdog-health', () => ({
  getExternalWatchdogState: jest.fn(() => ({ installed: false })),
}));

jest.mock('../../src/services/time-source', () => ({
  getTrustedTimeStatus: jest.fn(() => ({ trusted: true })),
  verifyTrustedClockSync: jest.fn(),
}));

jest.mock('../../src/utils/hash', () => ({
  hashPassword: jest.fn(),
  verifyPassword: jest.fn(),
}));

import { AdminController } from '../../src/modules/admin/admin.controller';
import { db } from '../../src/services/db';

function getRouteHandler(controller: AdminController, path: string) {
  const layer = (controller.router as any).stack.find(
    (candidate: any) => candidate.route?.path === path,
  );
  return layer.route.stack.at(-1).handle as (
    req: Request,
    res: Response,
  ) => Promise<void>;
}

function createResponse(): Response & { body?: unknown; statusCode: number } {
  const response: {
    body?: unknown;
    statusCode: number;
    status(code: number): unknown;
    json(body: unknown): unknown;
  } = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return response as unknown as Response & { body?: unknown; statusCode: number };
}

describe('admin test print accounting metadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('validates and writes the test PDF before registering its grayscale completion metadata', async () => {
    const controller = new AdminController(
      { appendAdminLog: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {
        io: {} as never,
        uploadDir: 'tmp',
        getSerialStatus: jest.fn(),
        getHopperStatus: jest.fn(),
        runHopperSelfTest: jest.fn(),
      },
    );

    await getRouteHandler(controller, '/printer/test-print')(
      {} as Request,
      createResponse(),
    );

    expect(checkpointRecoverySession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'print',
        phase: 'preflight_passed',
        requiredAmount: 0,
        context: expect.objectContaining({
          adminTestPrint: true,
          copies: 1,
          selectedPages: 1,
          billableColorPages: 0,
          billableBwPages: 1,
        }),
      }),
    );
    expect(generateTestPagePdf.mock.invocationCallOrder[0]).toBeLessThan(
      writeFileSync.mock.invocationCallOrder[0],
    );
    expect(writeFileSync.mock.invocationCallOrder[0]).toBeLessThan(
      checkpointRecoverySession.mock.invocationCallOrder[0],
    );
    expect(checkpointRecoverySession.mock.invocationCallOrder[0]).toBeLessThan(
      handoffToWorker.mock.invocationCallOrder[0],
    );
  });

  test('does not register grayscale usage metadata when test-page generation fails', async () => {
    generateTestPagePdf.mockImplementationOnce(() => {
      throw new Error('PDF generation failed');
    });
    const controller = new AdminController(
      { appendAdminLog: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {
        io: {} as never,
        uploadDir: 'tmp',
        getSerialStatus: jest.fn(),
        getHopperStatus: jest.fn(),
        runHopperSelfTest: jest.fn(),
      },
    );
    const response = createResponse();

    await getRouteHandler(controller, '/printer/test-print')(
      {} as Request,
      response,
    );

    expect(response.statusCode).toBe(500);
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(checkpointRecoverySession).not.toHaveBeenCalled();
    expect(handoffToWorker).not.toHaveBeenCalled();
  });

  test('includes a completed admin test page in the grayscale tank count', async () => {
    sumUsagePagesBySource.mockImplementation(
      (_source: string, sinceTimestamp?: string) => ({
        colorPages: 0,
        bwPages: sinceTimestamp ? 1 : 1,
      }),
    );
    db.data = {
      balance: 0,
      coinStats: {},
      jobStats: {},
      hopperStats: {},
      owedChanges: [],
      pendingRefunds: [],
      anomalyIncidents: [],
      feedback: [],
      reportIssues: [],
      inkRefillBaseline: { colorPages: 0, bwPages: 0, updatedAt: null },
    } as never;
    const adminService = {
      appendAdminLog: jest.fn(),
      computeEarningsBuckets: jest.fn(() => ({})),
      getStorageUsage: jest.fn(() => ({})),
      listLogsByTypes: jest.fn(() => []),
    };
    const controller = new AdminController(
      adminService as never,
      { getForecast: jest.fn(() => ({})) } as never,
      {
        io: {} as never,
        uploadDir: 'tmp',
        getSerialStatus: jest.fn(() => ({
          connected: false,
          portPath: null,
          lastError: null,
        })),
        getHopperStatus: jest.fn(() => ({
          connected: false,
          pending: false,
          portPath: null,
          lastError: null,
          lastSuccessAt: null,
        })),
        runHopperSelfTest: jest.fn(),
      },
    );
    const response = createResponse();

    getRouteHandler(controller, '/summary')(
      { get: jest.fn(() => 'localhost') } as unknown as Request,
      response,
    );

    expect((response.body as any).pageCounts).toEqual(
      expect.objectContaining({
        todayBwPages: 1,
        totalBwPages: 1,
        refillBwPages: 1,
      }),
    );
    expect((response.body as any).inkEstimation.grayscale.pagesUsed).toBe(1);
  });

  test('includes completed admin test pages when resetting the ink baseline', async () => {
    sumUsagePagesBySource.mockReturnValue({ colorPages: 0, bwPages: 1 });
    const resetInkRefillBaseline = jest.fn().mockResolvedValue(undefined);
    const controller = new AdminController(
      {
        appendAdminLog: jest.fn(),
        resetInkRefillBaseline,
      } as never,
      {} as never,
      {
        io: {} as never,
        uploadDir: 'tmp',
        getSerialStatus: jest.fn(),
        getHopperStatus: jest.fn(),
        runHopperSelfTest: jest.fn(),
      },
    );

    await getRouteHandler(controller, '/printer/reset-ink-counters')(
      {} as Request,
      createResponse(),
    );

    expect(resetInkRefillBaseline).toHaveBeenCalledWith(0, 1);
  });
});

describe('admin system shutdown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRecoveryStatusSnapshot.mockReturnValue({
      lifecycle: {
        bootCount: 1,
        unexpectedRestartCount: 0,
        lastStartupAt: null,
        lastShutdownAt: null,
      },
      sessionStats: {
        inFlight: 0,
        startupPending: 0,
        autoRefunded: 0,
        pendingAdminReview: 0,
        voided: 0,
      },
    });
  });

  function createController(
    shutdownWindows: jest.Mock,
    getHopperStatus = jest.fn(() => ({
      connected: false,
      pending: false,
      portPath: null,
      lastError: null,
      lastSuccessAt: null,
    })),
  ): AdminController {
    return new AdminController(
      { appendAdminLog: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {
        io: {} as never,
        uploadDir: 'tmp',
        getSerialStatus: jest.fn(),
        getHopperStatus,
        runHopperSelfTest: jest.fn(),
        shutdownWindows,
      },
    );
  }

  test('requests a normal Windows shutdown when no work is in flight', async () => {
    const shutdownWindows = jest.fn().mockResolvedValue(undefined);
    const controller = createController(shutdownWindows);
    const response = createResponse();

    await getRouteHandler(controller, '/system/shutdown')(
      {} as Request,
      response,
    );

    expect(response.statusCode).toBe(202);
    expect(response.body).toEqual({
      ok: true,
      message: 'Windows shutdown scheduled.',
    });
    expect(shutdownWindows).toHaveBeenCalledTimes(1);
  });

  test('refuses shutdown while a recovery session is still in flight', async () => {
    getRecoveryStatusSnapshot.mockReturnValueOnce({
      lifecycle: {
        bootCount: 1,
        unexpectedRestartCount: 0,
        lastStartupAt: null,
        lastShutdownAt: null,
      },
      sessionStats: {
        inFlight: 1,
        startupPending: 0,
        autoRefunded: 0,
        pendingAdminReview: 0,
        voided: 0,
      },
    });
    const shutdownWindows = jest.fn().mockResolvedValue(undefined);
    const controller = createController(shutdownWindows);
    const response = createResponse();

    await getRouteHandler(controller, '/system/shutdown')(
      {} as Request,
      response,
    );

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      ok: false,
      error: 'Cannot shut down while a customer operation is in progress.',
    });
    expect(shutdownWindows).not.toHaveBeenCalled();
  });

  test('refuses shutdown while the hopper is busy', async () => {
    const shutdownWindows = jest.fn().mockResolvedValue(undefined);
    const controller = createController(
      shutdownWindows,
      jest.fn(() => ({
        connected: false,
        pending: true,
        portPath: null,
        lastError: null,
        lastSuccessAt: null,
      })),
    );
    const response = createResponse();

    await getRouteHandler(controller, '/system/shutdown')(
      {} as Request,
      response,
    );

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      ok: false,
      error: 'Cannot shut down while a customer operation is in progress.',
    });
    expect(shutdownWindows).not.toHaveBeenCalled();
  });

  test('reports when Windows rejects the shutdown request', async () => {
    const shutdownWindows = jest
      .fn()
      .mockRejectedValue(new Error('shutdown privilege unavailable'));
    const controller = createController(shutdownWindows);
    const response = createResponse();

    await getRouteHandler(controller, '/system/shutdown')(
      {} as Request,
      response,
    );

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      ok: false,
      error: 'Windows shutdown could not be scheduled.',
    });
  });
});
