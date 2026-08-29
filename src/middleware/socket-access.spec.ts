import {
  authenticateControlSocket,
  authenticateSessionSocket,
  canControlCoinSlot,
  installSocketAccessMiddleware,
  canJoinSessionRoom,
  type SocketAccessDeps,
} from './socket-access';

const deps: SocketAccessDeps = {
  isKioskCredential: (value) => value === 'trusted-kiosk-cookie',
  isAdminSession: (value) => value === 'trusted-admin-session',
  claimSessionOwner: (sessionId, token, clientId) =>
    sessionId === 'session-a' &&
    token === 'upload-token-a' &&
    clientId === 'phone-a',
};

describe('Socket.IO access boundary', () => {
  test('rejects a connection that has no trusted kiosk, admin, or session credential', () => {
    expect(authenticateControlSocket({ auth: {}, headers: {} }, deps)).toBeNull();
    expect(
      authenticateControlSocket(
        {
          auth: {},
          headers: { cookie: 'printbit_kiosk=trusted-kiosk-cookie' },
        },
        deps,
      ),
    ).toEqual({ kind: 'kiosk' });
    expect(
      authenticateSessionSocket(
        {
          auth: {
            sessionId: 'session-a',
            token: 'wrong-token',
            clientId: 'phone-a',
          },
          headers: {},
        },
        deps,
      ),
    ).toBeNull();
  });

  test('binds a session socket to its claimed session and denies every other room', () => {
    const principal = authenticateSessionSocket(
      {
        auth: {
          sessionId: 'session-a',
          token: 'upload-token-a',
          clientId: 'phone-a',
        },
        headers: {},
      },
      deps,
    );

    expect(principal).toEqual({ kind: 'session', sessionId: 'session-a' });
    expect(canJoinSessionRoom(principal, 'session-a')).toBe(true);
    expect(canJoinSessionRoom(principal, 'session-b')).toBe(false);
  });

  test('allows only kiosk or admin sockets to control the coin slot', () => {
    expect(canControlCoinSlot({ kind: 'kiosk' })).toBe(true);
    expect(canControlCoinSlot({ kind: 'admin' })).toBe(true);
    expect(
      canControlCoinSlot({ kind: 'session', sessionId: 'session-a' }),
    ).toBe(false);
  });

  test('installs separate control and session handshake middleware', () => {
    type Middleware = (
      socket: {
        handshake: { auth: unknown; headers: { cookie?: string } };
        data: Record<string, unknown>;
      },
      next: (error?: Error) => void,
    ) => void;
    const controlNamespace: { use: (middleware: Middleware) => void } = {
      use: jest.fn(),
    };
    const sessionNamespace: { use: (middleware: Middleware) => void } = {
      use: jest.fn(),
    };

    installSocketAccessMiddleware(controlNamespace, sessionNamespace, deps);

    const controlMiddleware = jest.mocked(controlNamespace.use).mock.calls[0]?.[0];
    const sessionMiddleware = jest.mocked(sessionNamespace.use).mock.calls[0]?.[0];
    if (!controlMiddleware || !sessionMiddleware) throw new Error('Middleware missing');

    const controlSocket = {
      handshake: {
        auth: {},
        headers: { cookie: 'adminToken=trusted-admin-session' },
      },
      data: {} as Record<string, unknown>,
    };
    controlMiddleware(controlSocket, (error) => {
      expect(error).toBeUndefined();
    });
    expect(controlSocket.data.principal).toEqual({ kind: 'admin' });

    const sessionSocket = {
      handshake: {
        auth: {
          sessionId: 'session-a',
          token: 'upload-token-a',
          clientId: 'phone-a',
        },
        headers: {},
      },
      data: {} as Record<string, unknown>,
    };
    sessionMiddleware(sessionSocket, (error) => {
      expect(error).toBeUndefined();
    });
    expect(sessionSocket.data.principal).toEqual({
      kind: 'session',
      sessionId: 'session-a',
    });
  });
});
