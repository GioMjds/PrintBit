export type StudentSessionKioskState = 'checking' | 'active' | 'inactive';
export type StudentSessionEndReason = 'user_ended' | 'idle_timeout';

export interface StudentSessionSocket {
  on(event: string, handler: (payload?: unknown) => void): void;
  off?(event: string, handler: (payload?: unknown) => void): void;
}

export interface StudentSessionKioskOptions {
  socket?: StudentSessionSocket | null;
  fetcher?: typeof fetch;
  onStateChange?: (state: StudentSessionKioskState) => void;
}

export interface StudentSessionKioskController {
  ready: Promise<void>;
  isActive(): boolean;
  navigateWhenActive(path: string, navigate: (path: string) => void): boolean;
  endStudentSession(reason: StudentSessionEndReason): Promise<void>;
  destroy(): void;
}

function hasStatus(payload: unknown, expected: string): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'status' in payload &&
    (payload as { status?: unknown }).status === expected
  );
}

function resolveSocket(
  provided: StudentSessionSocket | null | undefined,
): StudentSessionSocket | null {
  if (provided !== undefined) return provided;
  if (typeof window === 'undefined') return null;

  const ioFactory = (
    window as unknown as { io?: () => StudentSessionSocket }
  ).io;
  return typeof ioFactory === 'function' ? ioFactory() : null;
}

export function initializeStudentSessionKiosk(
  options: StudentSessionKioskOptions = {},
): StudentSessionKioskController {
  const fetcher = options.fetcher ?? fetch;
  const socket = resolveSocket(options.socket);
  let state: StudentSessionKioskState = 'checking';
  let stateRevision = 0;
  let endRequest: Promise<void> | null = null;
  let destroyed = false;

  const setState = (nextState: StudentSessionKioskState): void => {
    if (destroyed || state === nextState) return;
    state = nextState;
    options.onStateChange?.(state);
  };

  options.onStateChange?.(state);

  const handleStarted = (payload?: unknown): void => {
    if (!hasStatus(payload, 'active')) return;
    stateRevision += 1;
    endRequest = null;
    setState('active');
  };
  const handleEnded = (payload?: unknown): void => {
    if (!hasStatus(payload, 'ended') && !hasStatus(payload, 'idle')) return;
    stateRevision += 1;
    setState('inactive');
  };

  socket?.on('kiosk.session.started', handleStarted);
  socket?.on('kiosk.session.ended', handleEnded);

  const fetchRevision = stateRevision;
  const ready = fetcher('/api/kiosk/student-session', {
    cache: 'no-store',
    credentials: 'same-origin',
  })
    .then(async (response) => {
      if (!response.ok) throw new Error('Student session state unavailable');
      const payload: unknown = await response.json();
      if (stateRevision !== fetchRevision) return;
      if (hasStatus(payload, 'active')) {
        endRequest = null;
        setState('active');
      } else {
        setState('inactive');
      }
    })
    .catch(() => {
      if (stateRevision === fetchRevision) setState('inactive');
    });

  return {
    ready,
    isActive: () => state === 'active',
    navigateWhenActive(path, navigate) {
      if (state !== 'active') return false;
      navigate(path);
      return true;
    },
    endStudentSession(reason) {
      if (endRequest) return endRequest;

      endRequest = fetcher('/api/kiosk/student-session/end', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
        .then(() => {
          stateRevision += 1;
          setState('inactive');
        })
        .catch(() => {
          stateRevision += 1;
          setState('inactive');
        });
      return endRequest;
    },
    destroy() {
      destroyed = true;
      socket?.off?.('kiosk.session.started', handleStarted);
      socket?.off?.('kiosk.session.ended', handleEnded);
    },
  };
}
