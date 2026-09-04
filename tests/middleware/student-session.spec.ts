import http from 'node:http';
import express from 'express';
import type { Request, RequestHandler, Response } from 'express';

interface StudentSessionAuthority {
  requireActiveSession(): { sessionId: string };
  attributeTransaction(
    transactionId: string,
    operation: string,
  ): unknown;
}

function loadMiddleware(enabled: boolean): typeof import('@/middleware/student-session') {
  let loaded: typeof import('@/middleware/student-session') | undefined;
  jest.isolateModules(() => {
    jest.doMock('@/config', () => ({
      ...jest.requireActual('@/config'),
      STUDENT_ID_VERIFICATION_ENABLED: enabled,
    }));
    loaded = require('@/middleware/student-session') as typeof import('@/middleware/student-session');
  });
  jest.dontMock('@/config');
  if (!loaded) throw new Error('Student session middleware did not load.');
  return loaded;
}

function makeResponse(): Response & {
  status: jest.Mock;
  json: jest.Mock;
} {
  const response = {
    locals: {},
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
}

function invoke(
  middleware: RequestHandler,
  service: jest.Mocked<StudentSessionAuthority>,
): { response: ReturnType<typeof makeResponse>; next: jest.Mock } {
  const request = {
    body: { studentKioskSessionId: 'request-controlled-session' },
    cookies: { printbit_portal_status: 'request-controlled-cookie' },
  } as unknown as Request;
  const response = makeResponse();
  const next = jest.fn();
  middleware(request, response, next);
  return { response, next };
}

describe('student session transaction middleware', () => {
  test('keeps transaction routes compatible when verification is disabled', () => {
    const service: jest.Mocked<StudentSessionAuthority> = {
      requireActiveSession: jest.fn(() => {
        throw Object.assign(new Error('ACTIVE_SESSION_REQUIRED'), {
          code: 'ACTIVE_SESSION_REQUIRED',
        });
      }),
      attributeTransaction: jest.fn(),
    };
    const { requireStudentSession } = loadMiddleware(false);

    const { response, next } = invoke(requireStudentSession(service), service);

    expect(next).toHaveBeenCalledTimes(1);
    expect(service.requireActiveSession).not.toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
  });

  test('rejects an enabled transaction request without an active session', () => {
    const service: jest.Mocked<StudentSessionAuthority> = {
      requireActiveSession: jest.fn(() => {
        throw Object.assign(new Error('ACTIVE_SESSION_REQUIRED'), {
          code: 'ACTIVE_SESSION_REQUIRED',
        });
      }),
      attributeTransaction: jest.fn(),
    };
    const { requireStudentSession } = loadMiddleware(true);

    const { response, next } = invoke(requireStudentSession(service), service);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({
      code: 'STUDENT_IDENTIFICATION_REQUIRED',
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('uses only the active server-side session for request attribution context', () => {
    const service: jest.Mocked<StudentSessionAuthority> = {
      requireActiveSession: jest.fn(() => ({ sessionId: 'server-session' })),
      attributeTransaction: jest.fn(),
    };
    const { requireStudentSession } = loadMiddleware(true);

    const { response, next } = invoke(requireStudentSession(service), service);

    expect(response.locals.studentKioskSessionId).toBe('server-session');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('rechecks the active session when it ends between requests', () => {
    const service: jest.Mocked<StudentSessionAuthority> = {
      requireActiveSession: jest
        .fn()
        .mockReturnValueOnce({ sessionId: 'server-session' })
        .mockImplementationOnce(() => {
          throw Object.assign(new Error('ACTIVE_SESSION_REQUIRED'), {
            code: 'ACTIVE_SESSION_REQUIRED',
          });
        }),
      attributeTransaction: jest.fn(),
    };
    const { requireStudentSession } = loadMiddleware(true);
    const middleware = requireStudentSession(service);

    const first = invoke(middleware, service);
    const second = invoke(middleware, service);

    expect(first.next).toHaveBeenCalledTimes(1);
    expect(second.response.status).toHaveBeenCalledWith(403);
    expect(second.next).not.toHaveBeenCalled();
    expect(service.requireActiveSession).toHaveBeenCalledTimes(2);
  });

  test('skips transaction attribution in disabled compatibility mode', () => {
    const service: jest.Mocked<StudentSessionAuthority> = {
      requireActiveSession: jest.fn(),
      attributeTransaction: jest.fn(),
    };
    const { attributeStudentTransaction } = loadMiddleware(false);

    attributeStudentTransaction(service, 'transaction-id', 'print');

    expect(service.attributeTransaction).not.toHaveBeenCalled();
  });

  test('delegates transaction attribution to the active server-side service', () => {
    const service: jest.Mocked<StudentSessionAuthority> = {
      requireActiveSession: jest.fn(),
      attributeTransaction: jest.fn(),
    };
    const { attributeStudentTransaction } = loadMiddleware(true);

    attributeStudentTransaction(service, 'transaction-id', 'print');

    expect(service.attributeTransaction).toHaveBeenCalledTimes(1);
    expect(service.attributeTransaction).toHaveBeenCalledWith(
      'transaction-id',
      'print',
    );
  });
});

interface RegisteredRouteTestApp {
  baseUrl: string;
  server: http.Server;
  guardChecks: jest.Mock;
  routeHits: jest.Mock;
  resetKioskOrder(): void;
}

async function createRegisteredRouteTestApp(): Promise<RegisteredRouteTestApp> {
  let registerAppModules:
    | typeof import('@/app.module')['registerAppModules']
    | undefined;
  let kioskAuthenticated = false;
  const guardChecks = jest.fn();
  const routeHits = jest.fn();
  const registerNoRoutes = jest.fn();

  jest.isolateModules(() => {
    jest.doMock('@/config', () => ({
      PUBLIC_PAGE_ROUTES: [],
      PORTAL_ASSETS: new Set<string>(),
      PORTAL_DIR: '.',
      UPLOAD_DIR: '.',
      STUDENT_ID_VERIFICATION_ENABLED: true,
    }));
    jest.doMock('@/services', () => ({ getHotspotConfig: () => ({}) }));
    jest.doMock('@/services/power-safety', () => ({ powerSafetyService: {} }));
    jest.doMock('@/middleware', () => ({
      createKioskAccessMiddleware: () =>
        (_req: Request, _res: Response, next: () => void) => {
          kioskAuthenticated = true;
          next();
        },
      registerStaticAssets: jest.fn(),
    }));
    jest.doMock('@/modules/student-session', () => ({
      StudentSessionService: class {
        requireActiveSession(): never {
          guardChecks();
          if (!kioskAuthenticated) throw new Error('student guard ran before kiosk auth');
          throw Object.assign(new Error('ACTIVE_SESSION_REQUIRED'), {
            code: 'ACTIVE_SESSION_REQUIRED',
          });
        }

        attributeTransaction(): void {}
      },
      registerStudentSessionModule: registerNoRoutes,
    }));
    jest.doMock('@/modules/copy', () => ({
      registerCopyModule: (app: express.Express) => {
        app.post('/api/copy/jobs', (_req, res) => {
          routeHits('copy-create');
          res.sendStatus(204);
        });
        app.get('/api/copy/jobs/:id', (_req, res) => {
          routeHits('copy-status');
          res.sendStatus(204);
        });
        app.post('/api/copy/jobs/:id/cancel', (_req, res) => {
          routeHits('copy-cancel');
          res.sendStatus(204);
        });
      },
    }));
    jest.doMock('@/modules/scanner', () => ({
      registerScannerModule: (app: express.Express) => {
        app.post('/api/scanner/scan', (_req, res) => {
          routeHits('scanner-scan');
          res.sendStatus(204);
        });
        app.post('/api/scanner/soft-copy/charge', (_req, res) => {
          routeHits('scanner-charge');
          res.sendStatus(204);
        });
        app.post('/api/scan/jobs', (_req, res) => {
          routeHits('scan-create');
          res.sendStatus(204);
        });
        app.get('/api/scanner/status', (_req, res) => {
          routeHits('scanner-status');
          res.sendStatus(204);
        });
      },
    }));
    jest.doMock('@/modules/financial', () => ({
      registerFinancialModule: (app: express.Express) => {
        app.post('/api/confirm-payment', (_req, res) => {
          routeHits('confirm-payment');
          res.sendStatus(204);
        });
        app.post('/print', (_req, res) => {
          routeHits('legacy-print');
          res.sendStatus(204);
        });
        app.get('/api/transactions/:id/receipt', (_req, res) => {
          routeHits('receipt');
          res.sendStatus(204);
        });
      },
    }));
    for (const [moduleName, exportName] of [
      ['@/modules/admin', 'registerAdminModule'],
      ['@/modules/printer', 'registerPrinterModule'],
      ['@/modules/wireless-session', 'registerWirelessSessionModule'],
      ['@/modules/feedback', 'registerFeedbackModule'],
      ['@/modules/report', 'registerReportModule'],
      ['@/modules/receipt', 'registerReceiptModule'],
      ['@/modules/hotspot', 'registerHotspotModule'],
      ['@/modules/watchdog', 'registerWatchdogModule'],
      ['@/modules/hopper', 'registerHopperModule'],
      ['@/modules/anomaly', 'registerAnomalyModule'],
      ['@/modules/language', 'registerLanguageModule'],
      ['@/modules/upload-portal', 'registerUploadPortalModule'],
      ['@/modules/page', 'registerPageModule'],
    ]) {
      jest.doMock(moduleName, () => ({ [exportName]: registerNoRoutes }));
    }
    registerAppModules = require('@/app.module').registerAppModules;
  });
  jest.resetModules();
  jest.clearAllMocks();

  if (!registerAppModules) throw new Error('App module did not load.');
  const app = express();
  registerAppModules(app, {
    io: {} as never,
    sessionIo: {} as never,
    sessionStore: {} as never,
    getSerialStatus: () => ({ connected: false, portPath: null, lastError: null }),
    getHopperStatus: () => ({
      connected: false,
      pending: false,
      portPath: null,
      lastError: null,
      lastSuccessAt: null,
    }),
    runHopperSelfTest: async () => ({ ok: true, amount: 0, message: '', attempts: 0 }),
    resolvePublicBaseUrl: () => new URL('http://127.0.0.1'),
    convertToPdfArtifact: async (_source, artifact) => artifact,
  });
  const server = await new Promise<http.Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not expose an address.');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
    guardChecks,
    routeHits,
    resetKioskOrder: () => {
      kioskAuthenticated = false;
    },
  };
}

describe('student transaction route placement', () => {
  test('guards transaction routes only after kiosk authentication', async () => {
    const testApp = await createRegisteredRouteTestApp();
    try {
      for (const path of [
        '/api/copy/jobs',
        '/api/copy/jobs/copy-id/cancel',
        '/api/scanner/scan',
        '/api/scanner/soft-copy/charge',
        '/api/scan/jobs',
        '/api/confirm-payment',
        '/print',
      ]) {
        testApp.resetKioskOrder();
        const result = await fetch(`${testApp.baseUrl}${path}`, { method: 'POST' });
        expect(result.status).toBe(403);
        expect(await result.json()).toEqual({
          code: 'STUDENT_IDENTIFICATION_REQUIRED',
        });
      }
      expect(testApp.guardChecks).toHaveBeenCalledTimes(7);
      expect(testApp.routeHits).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => {
        testApp.server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test('leaves copy status, scanner status, and receipts reachable', async () => {
    const testApp = await createRegisteredRouteTestApp();
    try {
      for (const path of [
        '/api/copy/jobs/copy-id',
        '/api/scanner/status',
        '/api/transactions/transaction-id/receipt',
      ]) {
        testApp.resetKioskOrder();
        const result = await fetch(`${testApp.baseUrl}${path}`);
        expect(result.status).toBe(204);
      }
      expect(testApp.guardChecks).not.toHaveBeenCalled();
      expect(testApp.routeHits.mock.calls.map(([route]) => route)).toEqual([
        'copy-status',
        'scanner-status',
        'receipt',
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        testApp.server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
