jest.mock('@/middleware/file-validation', () => {
  const passThrough = (
    _req: unknown,
    _res: unknown,
    next: (error?: Error) => void,
  ) => next();

  return {
    uploadMiddleware: { single: jest.fn(() => passThrough) },
    handleMulterError: passThrough,
    validateMagicBytes: passThrough,
  };
});

import type { RequestHandler } from 'express';
import { WirelessSessionController } from './wireless-session.controller';
import type { WirelessSessionService } from './wireless-session.service';

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
};
type RouteDefinition = NonNullable<RouteLayer['route']>;

const handler = jest.fn() as unknown as RequestHandler;

function buildController(): {
  controller: WirelessSessionController;
  service: WirelessSessionService;
} {
  const service = {
    createSession: handler,
    getSessionByToken: handler,
    getSessionPreview: handler,
    getSessionColorAnalysis: handler,
    getSessionDocumentAnalysis: handler,
    getSessionById: handler,
    verifyKioskOrOwnedUploadTarget: handler,
    verifyKioskOrOwnedAnalyzeJobTarget: handler,
    uploadToSession: handler,
    removeSessionDocument: handler,
    cancelSession: handler,
    analyzeSessionDocument: handler,
    analyzeJob: handler,
  } as unknown as WirelessSessionService;

  return { controller: new WirelessSessionController(service), service };
}

function getRoute(
  controller: WirelessSessionController,
  path: string,
  method: string,
): RouteDefinition {
  const layer = (controller.router.stack as RouteLayer[]).find(
    (candidate) =>
      candidate.route?.path === path && candidate.route.methods[method],
  );
  if (!layer?.route) throw new Error(`Missing ${method.toUpperCase()} ${path}`);
  return layer.route;
}

describe('wireless session route authorization', () => {
  test('places session ownership authorization before every session-ID read or mutation', () => {
    const { controller, service } = buildController();
    const ownershipGuard = service.verifyKioskOrOwnedUploadTarget;

    expect(
      getRoute(controller, '/api/wireless/sessions/:sessionId/preview', 'get')
        .stack[0]?.handle,
    ).toBe(ownershipGuard);
    expect(
      getRoute(controller, '/api/wireless/sessions/:sessionId/color-analysis', 'get')
        .stack[0]?.handle,
    ).toBe(ownershipGuard);
    expect(
      getRoute(
        controller,
        '/api/wireless/sessions/:sessionId/analysis/:documentId',
        'get',
      ).stack[0]?.handle,
    ).toBe(ownershipGuard);
    expect(
      getRoute(controller, '/api/wireless/sessions/:sessionId', 'get').stack[0]
        ?.handle,
    ).toBe(ownershipGuard);
    expect(
      getRoute(
        controller,
        '/api/wireless/sessions/:sessionId/documents/:documentId',
        'delete',
      ).stack[0]?.handle,
    ).toBe(ownershipGuard);
    expect(
      getRoute(controller, '/api/wireless/sessions/:sessionId/cancel', 'delete')
        .stack[0]?.handle,
    ).toBe(ownershipGuard);
    expect(
      getRoute(controller, '/api/wireless/sessions/:sessionId/analyze', 'post')
        .stack[0]?.handle,
    ).toBe(ownershipGuard);
    expect(
      getRoute(controller, '/api/analyze-job', 'post').stack[0]?.handle,
    ).toBe(service.verifyKioskOrOwnedAnalyzeJobTarget);
  });

  test('places an access middleware in front of kiosk-only session creation', () => {
    const { controller, service } = buildController();
    const route = getRoute(controller, '/api/wireless/sessions', 'get');

    expect(route.stack).toHaveLength(2);
    expect(route.stack[0]?.handle).not.toBe(service.createSession);
    expect(route.stack[1]?.handle).toBe(service.createSession);
  });
});
