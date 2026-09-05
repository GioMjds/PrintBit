import {
  initializeStudentSessionKiosk,
  type StudentSessionKioskState,
} from '../../src/public/shared/student-session';

type SocketHandler = (payload?: unknown) => void;

function createSocketHarness() {
  const handlers = new Map<string, SocketHandler>();
  const socket = {
    on: jest.fn((event: string, handler: SocketHandler) => {
      handlers.set(event, handler);
    }),
  };

  return {
    socket,
    emit(event: string, payload?: unknown) {
      handlers.get(event)?.(payload);
    },
  };
}

function jsonResponse(
  body: unknown,
  options: { ok?: boolean; status?: number } = {},
): Response {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => body,
  } as Response;
}

describe('student session kiosk helper', () => {
  test('starts locked and follows socket-driven unlock and lock events', () => {
    const socketHarness = createSocketHarness();
    const states: StudentSessionKioskState[] = [];
    const fetcher = jest.fn(() => new Promise<Response>(() => {}));

    const session = initializeStudentSessionKiosk({
      socket: socketHarness.socket,
      fetcher,
      onStateChange: (state) => states.push(state),
    });

    expect(session.isActive()).toBe(false);
    expect(states).toEqual(['checking']);

    socketHarness.emit('kiosk.session.started', { status: 'active' });
    expect(session.isActive()).toBe(true);
    expect(states.at(-1)).toBe('active');

    socketHarness.emit('kiosk.session.ended', { status: 'ended' });
    expect(session.isActive()).toBe(false);
    expect(states.at(-1)).toBe('inactive');
  });

  test('fetches initial kiosk state without caching and unlocks only for active state', async () => {
    const fetcher = jest.fn().mockResolvedValue(
      jsonResponse({ status: 'active', sessionId: 'opaque-session' }),
    );
    const states: StudentSessionKioskState[] = [];

    const session = initializeStudentSessionKiosk({
      socket: null,
      fetcher,
      onStateChange: (state) => states.push(state),
    });
    await session.ready;

    expect(fetcher).toHaveBeenCalledWith('/api/kiosk/student-session', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    expect(session.isActive()).toBe(true);
    expect(states).toEqual(['checking', 'active']);
  });

  test('preserves the unlocked legacy kiosk when verification is disabled', async () => {
    const fetcher = jest.fn().mockResolvedValue(
      jsonResponse({ status: 'idle', verificationEnabled: false }),
    );
    const states: StudentSessionKioskState[] = [];

    const session = initializeStudentSessionKiosk({
      socket: null,
      fetcher,
      onStateChange: (state) => states.push(state),
    });
    await session.ready;

    expect(session.isActive()).toBe(true);
    expect(states).toEqual(['checking', 'active']);
  });

  test('keeps an enabled kiosk locked while no student session is active', async () => {
    const fetcher = jest.fn().mockResolvedValue(
      jsonResponse({ status: 'idle', verificationEnabled: true }),
    );

    const session = initializeStudentSessionKiosk({ socket: null, fetcher });
    await session.ready;

    expect(session.isActive()).toBe(false);
  });

  test('keeps guarded navigation inert until the kiosk session is active', () => {
    const socketHarness = createSocketHarness();
    const navigate = jest.fn();
    const session = initializeStudentSessionKiosk({
      socket: socketHarness.socket,
      fetcher: jest.fn(() => new Promise<Response>(() => {})),
    });

    expect(session.navigateWhenActive('/print', navigate)).toBe(false);
    expect(navigate).not.toHaveBeenCalled();

    socketHarness.emit('kiosk.session.started', { status: 'active' });

    expect(session.navigateWhenActive('/print', navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/print');
  });

  test('coalesces repeated end requests into exactly one kiosk API call', async () => {
    const socketHarness = createSocketHarness();
    const endResponse = jsonResponse({ status: 'ended' });
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'active' }))
      .mockResolvedValueOnce(endResponse);
    const session = initializeStudentSessionKiosk({
      socket: socketHarness.socket,
      fetcher,
    });
    await session.ready;

    const first = session.endStudentSession('user_ended');
    const second = session.endStudentSession('user_ended');
    await Promise.all([first, second]);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith(
      '/api/kiosk/student-session/end',
      {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'user_ended' }),
      },
    );
    expect(session.isActive()).toBe(false);
  });
});
