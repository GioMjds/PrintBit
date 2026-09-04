import http from 'node:http';
import express, { type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import type { PageController } from '@/modules/page/page.controller';
import { StudentSessionController } from '@/modules/student-session/student-session.controller';
import type {
  RosterReplacementResult,
  StudentIdentificationResult,
  StudentKioskState,
} from '@/modules/student-session/student-session.types';

interface StudentSessionRouteService {
  identify(studentId: string): StudentIdentificationResult;
  getKioskState(): StudentKioskState;
  endActiveSession(reason: 'user_ended'): StudentKioskState;
  replaceRosterCsv(csv: string): RosterReplacementResult;
}

function makeService(): jest.Mocked<StudentSessionRouteService> {
  return {
    identify: jest.fn(),
    getKioskState: jest.fn(),
    endActiveSession: jest.fn(),
    replaceRosterCsv: jest.fn(),
  };
}

function findRouteMiddleware(
  controller: StudentSessionController,
  path: string,
): (req: Request, res: Response, next: () => void) => void {
  const layer = controller.router.stack.find(
    (candidate: {
      route?: { path?: string; stack: Array<{ handle: unknown }> };
    }) => candidate.route?.path === path,
  );
  if (!layer?.route) throw new Error(`Route not found: ${path}`);
  return layer.route.stack[0].handle as (
    req: Request,
    res: Response,
    next: () => void,
  ) => void;
}

function makePageController(
  studentIdVerificationEnabled: boolean,
): PageController {
  let PageControllerConstructor:
    | (typeof import('@/modules/page/page.controller'))['PageController']
    | undefined;

  jest.isolateModules(() => {
    jest.doMock('@/config', () => ({
      ...jest.requireActual('@/config'),
      STUDENT_ID_VERIFICATION_ENABLED: studentIdVerificationEnabled,
    }));
    PageControllerConstructor = require('@/modules/page/page.controller').PageController;
  });
  jest.dontMock('@/config');
  if (!PageControllerConstructor) {
    throw new Error('PageController module did not load.');
  }
  return new PageControllerConstructor({
    sessionStore: {} as never,
    publicPageRoutes: [],
    resolvePublicBaseUrl: () => new URL('http://127.0.0.1'),
  });
}

function makePageResponse(): Response {
  const response = {
    type: jest.fn().mockReturnThis(),
    send: jest.fn(),
    sendFile: jest.fn(),
    sendStatus: jest.fn(),
  };
  return response as unknown as Response;
}

describe('StudentSessionController', () => {
  let app: express.Express;
  let server: http.Server;
  let baseUrl: string;
  let service: jest.Mocked<StudentSessionRouteService>;
  let controller: StudentSessionController;

  beforeEach(async () => {
    service = makeService();
    controller = new StudentSessionController(service);
    app = express();
    app.set('trust proxy', true);
    app.use(cookieParser());
    app.use(express.json());
    app.use(controller.router);
    server = await new Promise<http.Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not expose a TCP address.');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  test('identifies a roster member with an opaque portal-status cookie only', async () => {
    service.identify.mockReturnValue({ ok: true, sessionId: 'session-secret' });

    const response = await fetch(`${baseUrl}/api/portal/identify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentId: '123-4567' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'active' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^printbit_portal_status=[^;]+;/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('session-secret');
    expect(cookie).not.toContain('123-4567');
  });

  test('returns the same generic response for invalid identification', async () => {
    service.identify.mockReturnValue({ ok: false, code: 'IDENTIFICATION_FAILED' });

    const response = await fetch(`${baseUrl}/api/portal/identify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentId: 'not-an-id' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Student ID could not be verified.' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  test('reports an active-kiosk conflict without exposing the active session', async () => {
    service.identify.mockReturnValue({ ok: false, code: 'KIOSK_IN_USE' });

    const response = await fetch(`${baseUrl}/api/portal/identify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentId: '123-4567' }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'The kiosk is currently in use.' });
  });

  test('rate limits the eleventh portal identification attempt from one IP', async () => {
    service.identify.mockReturnValue({ ok: true, sessionId: 'session-secret' });
    const request = () =>
      fetch(`${baseUrl}/api/portal/identify`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.242',
        },
        body: JSON.stringify({ studentId: '123-4567' }),
      });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await request()).status).toBe(200);
    }

    const blocked = await request();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('cache-control')).toBe('no-store');
  });

  test('keeps portal status phone-safe while the kiosk can read and end its own session', async () => {
    service.getKioskState.mockReturnValue({
      status: 'active',
      sessionId: 'kiosk-session-token',
    });
    service.endActiveSession.mockReturnValue({
      status: 'ended',
      sessionId: 'kiosk-session-token',
    });

    const portalResponse = await fetch(`${baseUrl}/api/portal/student-session`);
    expect(await portalResponse.json()).toEqual({ status: 'active' });

    const kioskStatus = await fetch(`${baseUrl}/api/kiosk/student-session`);
    expect(await kioskStatus.json()).toEqual({
      status: 'active',
      sessionId: 'kiosk-session-token',
    });

    const kioskEnd = await fetch(`${baseUrl}/api/kiosk/student-session/end`, {
      method: 'POST',
    });
    expect(await kioskEnd.json()).toEqual({
      status: 'ended',
      sessionId: 'kiosk-session-token',
    });
    expect(service.endActiveSession).toHaveBeenCalledWith('user_ended');
  });

  test('keeps kiosk status and end routes behind the existing kiosk access middleware', () => {
    const req = {
      socket: { remoteAddress: '203.0.113.25' },
      cookies: {},
      path: '/api/kiosk/student-session',
      originalUrl: '/api/kiosk/student-session',
      get: () => undefined,
      accepts: () => false,
    } as unknown as Request;
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;

    findRouteMiddleware(controller, '/api/kiosk/student-session')(
      req,
      response,
      jest.fn(),
    );

    expect((response.status as unknown as jest.Mock)).toHaveBeenCalledWith(403);
    expect((response.json as unknown as jest.Mock)).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Kiosk access required.' }),
    );
  });

  test('requires both local-network access and an admin PIN before roster import', async () => {
    const nonLocalResponse = await fetch(
      `${baseUrl}/api/admin/student-roster/import`,
      {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.25' },
      },
    );
    expect(nonLocalResponse.status).toBe(403);

    const missingPinResponse = await fetch(
      `${baseUrl}/api/admin/student-roster/import`,
      { method: 'POST' },
    );
    expect(missingPinResponse.status).toBe(401);
    expect(service.replaceRosterCsv).not.toHaveBeenCalled();
  });

  test('serves the Task 5 student portal from its enabled directory and allowlists only its assets', () => {
    const controller = makePageController(true) as unknown as {
      handlePortal(req: Request, res: Response): void;
      serveStudentPortalAsset(req: Request, res: Response): void;
    };
    const pageResponse = makePageResponse();

    controller.handlePortal({} as Request, pageResponse);
    expect(pageResponse.sendFile).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]student-portal[\\/]index\.html$/),
    );

    const allowedAssetResponse = makePageResponse();
    controller.serveStudentPortalAsset(
      { params: { asset: 'app.js' } } as unknown as Request,
      allowedAssetResponse,
    );
    expect(allowedAssetResponse.sendFile).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]student-portal[\\/]app\.js$/),
      expect.any(Function),
    );

    const blockedAssetResponse = makePageResponse();
    controller.serveStudentPortalAsset(
      { params: { asset: 'secrets.txt' } } as unknown as Request,
      blockedAssetResponse,
    );
    expect(blockedAssetResponse.sendStatus).toHaveBeenCalledWith(404);
  });

  test('retains the upload waiting portal and blocks student assets when verification is disabled', () => {
    const controller = makePageController(false) as unknown as {
      handlePortal(req: Request, res: Response): void;
      serveStudentPortalAsset(req: Request, res: Response): void;
    };
    const pageResponse = makePageResponse();

    controller.handlePortal({} as Request, pageResponse);
    expect(pageResponse.type).toHaveBeenCalledWith('html');
    expect(pageResponse.send).toHaveBeenCalledWith(
      expect.stringContaining('No active print upload session was found yet.'),
    );

    const assetResponse = makePageResponse();
    controller.serveStudentPortalAsset(
      { params: { asset: 'app.js' } } as unknown as Request,
      assetResponse,
    );
    expect(assetResponse.sendStatus).toHaveBeenCalledWith(404);
  });
});
