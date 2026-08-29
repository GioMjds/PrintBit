import type { Request, Response } from 'express';
import {
  createKioskAccessMiddleware,
  KIOSK_COOKIE_NAME,
  KioskAccessService,
} from './kiosk-access';

function buildRequest(
  cookieCredential?: string,
): Request {
  return {
    socket: { remoteAddress: '203.0.113.25' },
    cookies: cookieCredential
      ? { [KIOSK_COOKIE_NAME]: cookieCredential }
      : {},
    path: '/api/wireless/sessions',
    originalUrl: '/api/wireless/sessions',
    get: () => undefined,
  } as unknown as Request;
}

function buildResponse(): Response {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return response as unknown as Response;
}

describe('kiosk HTTP access boundary', () => {
  test('rejects an unauthenticated non-kiosk network request', () => {
    const middleware = createKioskAccessMiddleware(new KioskAccessService());
    const response = buildResponse();
    const next = jest.fn();

    middleware(buildRequest(), response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Kiosk access required.' }),
    );
  });

  test('allows the physical kiosk cookie through from the same network', () => {
    const kiosk = new KioskAccessService();
    const middleware = createKioskAccessMiddleware(kiosk);
    const response = buildResponse();
    const next = jest.fn();

    middleware(buildRequest(kiosk.getCookieCredential()), response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
  });
});
