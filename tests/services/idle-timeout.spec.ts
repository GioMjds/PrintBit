import {
  initializePageIdleTimeout,
  startPageIdleTimer,
  resetPageIdleTimer,
  showPageIdleWarning,
  hidePageIdleWarning,
  setupPageIdleWarningButton,
  getPageIdleState,
} from '@/services/idle-timeout';

describe('kiosk idle-timeout service', () => {
  let modalEl: HTMLElement;
  let countdownEl: HTMLElement;
  let buttonEl: HTMLButtonElement;
  let originalFetch: typeof globalThis.fetch;
  let originalWindow: typeof globalThis.window;
  let originalDocument: typeof globalThis.document;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-28T12:00:00.000Z'));

    // Setup DOM mock
    modalEl = {
      id: 'idleWarningModal',
      style: { display: 'none' } as CSSStyleDeclaration,
      classList: {
        remove: jest.fn(),
        add: jest.fn(),
      } as unknown as DOMTokenList,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      querySelector: jest.fn(),
    } as unknown as HTMLElement;

    countdownEl = {
      id: 'idleCountdown',
      textContent: '20',
    } as unknown as HTMLElement;

    buttonEl = {
      id: 'keepActiveBtn',
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    } as unknown as HTMLButtonElement;

    const elementsById: Record<string, HTMLElement> = {
      idleWarningModal: modalEl,
      idleCountdown: countdownEl,
      keepActiveBtn: buttonEl,
    };

    originalFetch = globalThis.fetch;
    originalDocument = globalThis.document;
    originalWindow = globalThis.window;

    const docListeners: Record<string, ((e: Event) => void)[]> = {};

    globalThis.document = {
      getElementById: jest.fn((id: string) => elementsById[id] || null),
      addEventListener: jest.fn((event: string, cb: (e: Event) => void) => {
        docListeners[event] = docListeners[event] || [];
        docListeners[event].push(cb);
      }),
      removeEventListener: jest.fn(),
    } as unknown as Document;

    globalThis.window = {
      setInterval: ((cb: () => void, ms: number) =>
        setInterval(cb, ms)) as unknown as typeof window.setInterval,
      clearInterval: ((id: number) =>
        clearInterval(id)) as unknown as typeof window.clearInterval,
      setTimeout: ((cb: () => void, ms: number) =>
        setTimeout(cb, ms)) as unknown as typeof window.setTimeout,
      clearTimeout: ((id: number) =>
        clearTimeout(id)) as unknown as typeof window.clearTimeout,
    } as unknown as Window & typeof globalThis;
  });

  afterEach(() => {
    jest.useRealTimers();
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    const state = getPageIdleState();
    if (state.timerHandle !== null) {
      clearInterval(state.timerHandle);
      state.timerHandle = null;
    }
    state.enabled = false;
  });

  it('initializes idle timeout from /api/settings/idle-timeout and starts countdown accurately with wall clock', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ idleTimeoutSeconds: 60 }),
    });

    const onTimeout = jest.fn();
    const onWarningShown = jest.fn();

    await initializePageIdleTimeout({
      showWarningModal: true,
      onTimeout,
      onWarningShown,
    });

    const state = getPageIdleState();
    expect(state.enabled).toBe(true);
    expect(state.timeoutSeconds).toBe(60);

    // Warning threshold for 60s timeout is 60 - 20 = 40 seconds
    // Fast forward 39 seconds
    jest.advanceTimersByTime(39_000);
    expect(onWarningShown).not.toHaveBeenCalled();
    expect(modalEl.style.display).toBe('none');

    // Fast forward to 40 seconds
    jest.advanceTimersByTime(1_000);
    expect(onWarningShown).toHaveBeenCalledTimes(1);
    expect(modalEl.style.display).toBe('flex');
    expect(countdownEl.textContent).toBe('20');

    // Fast forward to 50 seconds (10s remaining)
    jest.advanceTimersByTime(10_000);
    expect(countdownEl.textContent).toBe('10');
    expect(onTimeout).not.toHaveBeenCalled();

    // Fast forward to 60 seconds (timeout reached)
    jest.advanceTimersByTime(10_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('falls back to default 120s if /api/settings/idle-timeout fails', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const onTimeout = jest.fn();
    await initializePageIdleTimeout({
      showWarningModal: true,
      onTimeout,
    });

    const state = getPageIdleState();
    expect(state.enabled).toBe(true);
    expect(state.timeoutSeconds).toBe(120);

    // 120s timeout -> warning at 100s
    jest.advanceTimersByTime(99_000);
    expect(modalEl.style.display).toBe('none');

    jest.advanceTimersByTime(1_000);
    expect(modalEl.style.display).toBe('flex');
    expect(countdownEl.textContent).toBe('20');

    jest.advanceTimersByTime(20_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('handles timer throttling correctly without drifting', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ idleTimeoutSeconds: 60 }),
    });

    const onWarningShown = jest.fn();
    await initializePageIdleTimeout({
      showWarningModal: true,
      onWarningShown,
    });

    // Simulate clock jump or background tab throttling where wall clock advanced 45 seconds
    jest.advanceTimersByTime(45_000);
    expect(onWarningShown).toHaveBeenCalledTimes(1);
    expect(modalEl.style.display).toBe('flex');
    expect(countdownEl.textContent).toBe('15');
  });

  it('resets timer on activity when warning modal is not active', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ idleTimeoutSeconds: 60 }),
    });

    await initializePageIdleTimeout({
      showWarningModal: true,
    });

    // 30 seconds elapse
    jest.advanceTimersByTime(30_000);
    expect(getPageIdleState().elapsedSeconds).toBeCloseTo(30, 0);

    // User activity resets timer
    resetPageIdleTimer();
    expect(getPageIdleState().elapsedSeconds).toBe(0);

    // Advance 30 more seconds — total real time 60s, but only 30s since reset so warning not shown yet
    jest.advanceTimersByTime(30_000);
    expect(modalEl.style.display).toBe('none');
  });
});