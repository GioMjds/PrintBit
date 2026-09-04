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
