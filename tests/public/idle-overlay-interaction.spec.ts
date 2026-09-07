import { initIdleScreen } from '../../src/public/shared/idle-screen';
import {
  getPageIdleState,
  initializePageIdleTimeout,
  showPageIdleWarning,
} from '../../src/services/idle-timeout';

class FakeClassList {
  private readonly values = new Set<string>();

  add(...names: string[]): void {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names: string[]): void {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name: string): boolean {
    return this.values.has(name);
  }
}

class FakeElement extends EventTarget {
  readonly classList = new FakeClassList();
  readonly style = { display: '' };
  readonly attributes = new Map<string, string>();
  readonly offsetWidth = 0;

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class FakeDocument extends EventTarget {
  readonly readyState = 'complete';
  readonly documentElement = new FakeElement();

  constructor(private readonly elements: Record<string, FakeElement>) {
    super();
  }

  getElementById(id: string): FakeElement | null {
    return this.elements[id] ?? null;
  }
}

type WindowShim = {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};

type IntervalCallback = () => void;

type GlobalBrowserShims = {
  document?: unknown;
  window?: unknown;
};

const browserGlobals = globalThis as unknown as GlobalBrowserShims;
const originalDocument = browserGlobals.document;
const originalWindow = browserGlobals.window;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalDocument === undefined) {
    delete browserGlobals.document;
  } else {
    browserGlobals.document = originalDocument;
  }

  if (originalWindow === undefined) {
    delete browserGlobals.window;
  } else {
    browserGlobals.window = originalWindow;
  }

  globalThis.fetch = originalFetch;
});

function installBrowserShims(document: FakeDocument): {
  runLatestInterval: () => void;
} {
  let latestIntervalCallback: IntervalCallback | undefined;
  const windowShim: WindowShim = {
    setTimeout: jest.fn(() => 1) as unknown as typeof setTimeout,
    clearTimeout: jest.fn(),
    setInterval: jest.fn((callback: IntervalCallback) => {
      latestIntervalCallback = callback;
      return 1;
    }) as unknown as typeof setInterval,
    clearInterval: jest.fn(),
  };

  browserGlobals.document = document;
  browserGlobals.window = windowShim;
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ idleTimeoutSeconds: 120 }),
  }) as unknown as typeof fetch;

  return {
    runLatestInterval: () => latestIntervalCallback?.(),
  };
}

test('idle attractor consumes pointer and click activation events', async () => {
  const overlay = new FakeElement();
  const document = new FakeDocument({ idleOverlay: overlay });
  installBrowserShims(document);

  initIdleScreen({ overlayId: 'idleOverlay', activateImmediately: true });
  await Promise.resolve();

  const pointerDown = new Event('pointerdown', { cancelable: true });
  const click = new Event('click', { cancelable: true });

  document.dispatchEvent(pointerDown);
  document.dispatchEvent(click);

  expect(pointerDown.defaultPrevented).toBe(true);
  expect(click.defaultPrevented).toBe(true);
});

test('idle timeout warning consumes activation events before dismissing', async () => {
  const modal = new FakeElement();
  const countdown = new FakeElement();
  const document = new FakeDocument({
    idleWarningModal: modal,
    idleCountdown: countdown,
  });
  installBrowserShims(document);

  await initializePageIdleTimeout({ showWarningModal: true });
  getPageIdleState().warningShownAt = 0;
  showPageIdleWarning();

  const pointerDown = new Event('pointerdown', { cancelable: true });
  const click = new Event('click', { cancelable: true });

  document.dispatchEvent(pointerDown);
  document.dispatchEvent(click);

  expect(pointerDown.defaultPrevented).toBe(true);
  expect(click.defaultPrevented).toBe(true);
});

test('idle timeout defers cleanup while a confirmation job is active', async () => {
  const modal = new FakeElement();
  const countdown = new FakeElement();
  const document = new FakeDocument({
    idleWarningModal: modal,
    idleCountdown: countdown,
  });
  const { runLatestInterval } = installBrowserShims(document);
  const onTimeout = jest.fn();
  const now = jest.spyOn(Date, 'now');
  now.mockReturnValueOnce(0).mockReturnValue(121_000);

  await initializePageIdleTimeout({
    showWarningModal: true,
    deferWhile: () => true,
    onTimeout,
  });
  runLatestInterval();
  await Promise.resolve();

  expect(getPageIdleState().warningShownAt).toBeNull();
  expect(modal.style.display).not.toBe('flex');
  expect(onTimeout).not.toHaveBeenCalled();
  now.mockRestore();
});
