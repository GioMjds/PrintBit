import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { initAuth } from '../../src/public/admin/shared';

const ADMIN_PAGE_HTML = [
  'alerts',
  'dashboard',
  'earnings',
  'feedback',
  'logs',
  'report',
  'settings',
  'system',
  'transactions',
];

class FakeClassList {
  private readonly values = new Set<string>();

  add(value: string): void {
    this.values.add(value);
  }

  remove(value: string): void {
    this.values.delete(value);
  }

  contains(value: string): boolean {
    return this.values.has(value);
  }

  toggle(value: string, force?: boolean): boolean {
    const enabled = force ?? !this.values.has(value);
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }
}

class FakeElement {
  readonly classList = new FakeClassList();
  private readonly listeners = new Map<string, (event: { preventDefault(): void }) => void>();
  parentElement: FakeElement | null = null;
  queryResult: FakeElement | null = null;
  className = '';
  textContent = '';
  id = '';
  value = '';

  prepend(child: FakeElement): void {
    child.parentElement = this;
  }

  addEventListener(
    type: string,
    listener: (event: { preventDefault(): void }) => void,
  ): void {
    this.listeners.set(type, listener);
  }

  querySelector(): FakeElement | null {
    return this.queryResult;
  }

  dispatch(type: string): void {
    this.listeners.get(type)?.({ preventDefault: () => undefined });
  }

  remove(): void {}
}

class FakeSessionStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe('admin session paint continuity', () => {
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const originalNavigator = globalThis.navigator;
  const originalSessionStorage = globalThis.sessionStorage;
  const originalWindow = globalThis.window;

  afterEach(() => {
    Object.assign(globalThis, {
      document: originalDocument,
      fetch: originalFetch,
      navigator: originalNavigator,
      sessionStorage: originalSessionStorage,
      window: originalWindow,
    });
    jest.restoreAllMocks();
  });

  it('records a non-secret paint hint after the server verifies the cookie session', async () => {
    const documentElement = new FakeElement();
    const body = new FakeElement();
    const authView = new FakeElement();
    const dashboard = new FakeElement();
    dashboard.classList.add('hidden');
    const storage = new FakeSessionStorage();

    const elements = new Map<string, FakeElement>([
      ['adminAuthView', authView],
      ['adminDashboard', dashboard],
    ]);
    const fakeDocument = {
      body,
      documentElement,
      createElement: () => new FakeElement(),
      getElementById: (id: string) => elements.get(id) ?? null,
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const fakeWindow = {
      addEventListener: jest.fn(),
      location: { protocol: 'http:' },
      matchMedia: () => ({ matches: true }),
    };

    Object.assign(globalThis, {
      document: fakeDocument,
      fetch: jest.fn().mockResolvedValue({ ok: true }),
      navigator: { onLine: true },
      sessionStorage: storage,
      window: fakeWindow,
    });

    const onSuccess = jest.fn();
    initAuth(onSuccess);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(storage.getItem('printbit.adminSessionActive')).toBe('1');
    expect(storage.getItem('adminSessionToken')).toBeNull();
    expect(documentElement.classList.contains('admin-session-active')).toBe(true);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('records the paint hint after a successful PIN login', async () => {
    const documentElement = new FakeElement();
    const body = new FakeElement();
    const authView = new FakeElement();
    const dashboard = new FakeElement();
    const authForm = new FakeElement();
    const pinInput = new FakeElement();
    const storage = new FakeSessionStorage();
    dashboard.classList.add('hidden');
    pinInput.value = '1234';
    authForm.queryResult = pinInput;

    const elements = new Map<string, FakeElement>([
      ['adminAuthView', authView],
      ['adminDashboard', dashboard],
      ['adminAuthForm', authForm],
      ['adminPinInput', pinInput],
    ]);
    const fakeDocument = {
      body,
      documentElement,
      createElement: () => new FakeElement(),
      getElementById: (id: string) => elements.get(id) ?? null,
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const fakeWindow = {
      addEventListener: jest.fn(),
      location: { protocol: 'http:' },
      matchMedia: () => ({ matches: true }),
    };
    const fetchMock = jest.fn((path: string) => {
      if (path === '/api/admin/auth') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    Object.assign(globalThis, {
      document: fakeDocument,
      fetch: fetchMock,
      navigator: { onLine: true },
      sessionStorage: storage,
      window: fakeWindow,
    });

    const onSuccess = jest.fn();
    initAuth(onSuccess);
    await new Promise<void>((resolve) => setImmediate(resolve));
    authForm.dispatch('submit');
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(storage.getItem('printbit.adminSessionActive')).toBe('1');
    expect(storage.getItem('adminSessionToken')).toBeNull();
    expect(documentElement.classList.contains('admin-session-active')).toBe(true);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('clears the paint hint when the admin logs out', async () => {
    const documentElement = new FakeElement();
    const body = new FakeElement();
    const authView = new FakeElement();
    const dashboard = new FakeElement();
    const logoutBtn = new FakeElement();
    const storage = new FakeSessionStorage();
    storage.setItem('printbit.adminSessionActive', '1');

    const elements = new Map<string, FakeElement>([
      ['adminAuthView', authView],
      ['adminDashboard', dashboard],
      ['logoutBtn', logoutBtn],
    ]);
    Object.assign(globalThis, {
      document: {
        body,
        documentElement,
        createElement: () => new FakeElement(),
        getElementById: (id: string) => elements.get(id) ?? null,
        querySelector: () => null,
        querySelectorAll: () => [],
      },
      fetch: jest.fn().mockResolvedValue({ ok: true }),
      navigator: { onLine: true },
      sessionStorage: storage,
      window: {
        addEventListener: jest.fn(),
        location: { protocol: 'http:' },
        matchMedia: () => ({ matches: true }),
      },
    });

    initAuth(jest.fn());
    await new Promise<void>((resolve) => setImmediate(resolve));
    logoutBtn.dispatch('click');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(storage.getItem('printbit.adminSessionActive')).toBeNull();
    expect(documentElement.classList.contains('admin-session-active')).toBe(false);
  });

  it('clears a stale paint hint when session verification cannot complete', async () => {
    const documentElement = new FakeElement();
    const body = new FakeElement();
    const authView = new FakeElement();
    const dashboard = new FakeElement();
    const storage = new FakeSessionStorage();
    storage.setItem('printbit.adminSessionActive', '1');
    documentElement.classList.add('admin-session-active');

    const elements = new Map<string, FakeElement>([
      ['adminAuthView', authView],
      ['adminDashboard', dashboard],
    ]);
    Object.assign(globalThis, {
      document: {
        body,
        documentElement,
        createElement: () => new FakeElement(),
        getElementById: (id: string) => elements.get(id) ?? null,
        querySelector: () => null,
        querySelectorAll: () => [],
      },
      fetch: jest.fn().mockRejectedValue(new Error('network unavailable')),
      navigator: { onLine: true },
      sessionStorage: storage,
      window: {
        addEventListener: jest.fn(),
        location: { protocol: 'http:' },
        matchMedia: () => ({ matches: true }),
      },
    });

    initAuth(jest.fn());
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(storage.getItem('printbit.adminSessionActive')).toBeNull();
    expect(documentElement.classList.contains('admin-session-active')).toBe(false);
  });

  it('ignores a stale startup rejection after a newer PIN login succeeds', async () => {
    const documentElement = new FakeElement();
    const body = new FakeElement();
    const authView = new FakeElement();
    const dashboard = new FakeElement();
    const authForm = new FakeElement();
    const pinInput = new FakeElement();
    const storage = new FakeSessionStorage();
    const verification = deferred<{ ok: boolean }>();
    pinInput.value = '1234';
    authForm.queryResult = pinInput;

    const elements = new Map<string, FakeElement>([
      ['adminAuthView', authView],
      ['adminDashboard', dashboard],
      ['adminAuthForm', authForm],
      ['adminPinInput', pinInput],
    ]);
    Object.assign(globalThis, {
      document: {
        body,
        documentElement,
        createElement: () => new FakeElement(),
        getElementById: (id: string) => elements.get(id) ?? null,
        querySelector: () => null,
        querySelectorAll: () => [],
      },
      fetch: jest.fn((requestPath: string) =>
        requestPath === '/api/admin/verify'
          ? verification.promise
          : Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ ok: true }),
            }),
      ),
      navigator: { onLine: true },
      sessionStorage: storage,
      window: {
        addEventListener: jest.fn(),
        location: { protocol: 'http:' },
        matchMedia: () => ({ matches: true }),
      },
    });

    const onSuccess = jest.fn();
    initAuth(onSuccess);
    authForm.dispatch('submit');
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    verification.resolve({ ok: false });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(storage.getItem('printbit.adminSessionActive')).toBe('1');
    expect(documentElement.classList.contains('admin-session-active')).toBe(true);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale startup approval after logout begins', async () => {
    const documentElement = new FakeElement();
    const body = new FakeElement();
    const authView = new FakeElement();
    const dashboard = new FakeElement();
    const logoutBtn = new FakeElement();
    const storage = new FakeSessionStorage();
    const verification = deferred<{ ok: boolean }>();
    storage.setItem('printbit.adminSessionActive', '1');
    documentElement.classList.add('admin-session-active');

    const elements = new Map<string, FakeElement>([
      ['adminAuthView', authView],
      ['adminDashboard', dashboard],
      ['logoutBtn', logoutBtn],
    ]);
    Object.assign(globalThis, {
      document: {
        body,
        documentElement,
        createElement: () => new FakeElement(),
        getElementById: (id: string) => elements.get(id) ?? null,
        querySelector: () => null,
        querySelectorAll: () => [],
      },
      fetch: jest.fn((requestPath: string) =>
        requestPath === '/api/admin/verify'
          ? verification.promise
          : Promise.resolve({ ok: true }),
      ),
      navigator: { onLine: true },
      sessionStorage: storage,
      window: {
        addEventListener: jest.fn(),
        location: { protocol: 'http:' },
        matchMedia: () => ({ matches: true }),
      },
    });

    const onSuccess = jest.fn();
    initAuth(onSuccess);
    logoutBtn.dispatch('click');
    await new Promise<void>((resolve) => setImmediate(resolve));
    verification.resolve({ ok: true });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(storage.getItem('printbit.adminSessionActive')).toBeNull();
    expect(documentElement.classList.contains('admin-session-active')).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('hides a BFCache-restored dashboard after another page logs out', async () => {
    const documentElement = new FakeElement();
    const body = new FakeElement();
    const authView = new FakeElement();
    const dashboard = new FakeElement();
    const storage = new FakeSessionStorage();
    const addWindowListener = jest.fn();
    storage.setItem('printbit.adminSessionActive', '1');
    documentElement.classList.add('admin-session-active');

    const elements = new Map<string, FakeElement>([
      ['adminAuthView', authView],
      ['adminDashboard', dashboard],
    ]);
    Object.assign(globalThis, {
      document: {
        body,
        documentElement,
        createElement: () => new FakeElement(),
        getElementById: (id: string) => elements.get(id) ?? null,
        querySelector: () => null,
        querySelectorAll: () => [],
      },
      fetch: jest.fn().mockResolvedValue({ ok: true }),
      navigator: { onLine: true },
      sessionStorage: storage,
      window: {
        addEventListener: addWindowListener,
        location: { protocol: 'http:' },
        matchMedia: () => ({ matches: true }),
      },
    });

    const onSuccess = jest.fn();
    initAuth(onSuccess);
    await new Promise<void>((resolve) => setImmediate(resolve));
    storage.removeItem('printbit.adminSessionActive');

    const pageshowHandler = addWindowListener.mock.calls.find(
      ([type]) => type === 'pageshow',
    )?.[1] as ((event: { persisted: boolean }) => void) | undefined;
    expect(pageshowHandler).toBeDefined();
    pageshowHandler?.({ persisted: true });

    expect(documentElement.classList.contains('admin-session-active')).toBe(false);
    expect(authView.classList.contains('hidden')).toBe(false);
    expect(dashboard.classList.contains('hidden')).toBe(true);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('reloads a valid BFCache-restored page so its live updates restart', async () => {
    const documentElement = new FakeElement();
    const body = new FakeElement();
    const authView = new FakeElement();
    const dashboard = new FakeElement();
    const storage = new FakeSessionStorage();
    const addWindowListener = jest.fn();
    const reload = jest.fn();
    storage.setItem('printbit.adminSessionActive', '1');

    const elements = new Map<string, FakeElement>([
      ['adminAuthView', authView],
      ['adminDashboard', dashboard],
    ]);
    Object.assign(globalThis, {
      document: {
        body,
        documentElement,
        createElement: () => new FakeElement(),
        getElementById: (id: string) => elements.get(id) ?? null,
        querySelector: () => null,
        querySelectorAll: () => [],
      },
      fetch: jest.fn().mockResolvedValue({ ok: true }),
      navigator: { onLine: true },
      sessionStorage: storage,
      window: {
        addEventListener: addWindowListener,
        location: { protocol: 'http:', reload },
        matchMedia: () => ({ matches: true }),
      },
    });

    initAuth(jest.fn());
    await new Promise<void>((resolve) => setImmediate(resolve));
    const pageshowHandler = addWindowListener.mock.calls.find(
      ([type]) => type === 'pageshow',
    )?.[1] as ((event: { persisted: boolean }) => void) | undefined;
    pageshowHandler?.({ persisted: true });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('aborts pending authenticated initialization when logout begins', async () => {
    const documentElement = new FakeElement();
    const body = new FakeElement();
    const authView = new FakeElement();
    const dashboard = new FakeElement();
    const authForm = new FakeElement();
    const pinInput = new FakeElement();
    const logoutBtn = new FakeElement();
    const storage = new FakeSessionStorage();
    const initialization = deferred<void>();
    let initializationSignal: AbortSignal | undefined;
    pinInput.value = '1234';
    authForm.queryResult = pinInput;

    const elements = new Map<string, FakeElement>([
      ['adminAuthView', authView],
      ['adminDashboard', dashboard],
      ['adminAuthForm', authForm],
      ['adminPinInput', pinInput],
      ['logoutBtn', logoutBtn],
    ]);
    Object.assign(globalThis, {
      document: {
        body,
        documentElement,
        createElement: () => new FakeElement(),
        getElementById: (id: string) => elements.get(id) ?? null,
        querySelector: () => null,
        querySelectorAll: () => [],
      },
      fetch: jest.fn((requestPath: string) =>
        requestPath === '/api/admin/verify'
          ? Promise.resolve({ ok: false })
          : Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ ok: true }),
            }),
      ),
      navigator: { onLine: true },
      sessionStorage: storage,
      window: {
        addEventListener: jest.fn(),
        location: { protocol: 'http:' },
        matchMedia: () => ({ matches: true }),
      },
    });

    const onSuccess = ((signal: AbortSignal) => {
      initializationSignal = signal;
      return initialization.promise;
    }) as unknown as () => Promise<void>;
    initAuth(onSuccess);
    await new Promise<void>((resolve) => setImmediate(resolve));
    authForm.dispatch('submit');
    await new Promise<void>((resolve) => setImmediate(resolve));
    logoutBtn.dispatch('click');

    expect(initializationSignal).toBeDefined();
    expect(initializationSignal?.aborted).toBe(true);
    initialization.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(storage.getItem('printbit.adminSessionActive')).toBeNull();
    expect(documentElement.classList.contains('admin-session-active')).toBe(false);
  });

  it.each(ADMIN_PAGE_HTML)(
    'uses the non-secret paint hint before rendering the %s page body',
    (page) => {
      const html = fs.readFileSync(
        path.resolve('src', 'public', 'admin', page, 'index.html'),
        'utf8',
      );
      const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
      expect(inlineScript).toBeDefined();
      const scriptStart = html.indexOf('<script>');
      const headEnd = html.indexOf('</head>');
      const bodyStart = html.indexOf('<body');
      expect(scriptStart).toBeGreaterThan(-1);
      expect(scriptStart).toBeLessThan(headEnd);
      expect(headEnd).toBeLessThan(bodyStart);

      const storage = new FakeSessionStorage();
      const documentElement = new FakeElement();
      storage.setItem('printbit.adminSessionActive', '1');
      vm.runInNewContext(inlineScript!, {
        document: { documentElement },
        sessionStorage: storage,
      });

      expect(documentElement.classList.contains('admin-session-active')).toBe(
        true,
      );
    },
  );

  it('evicts the previous admin asset cache so updated auth code loads immediately', async () => {
    const handlers = new Map<string, (event: { waitUntil(promise: Promise<unknown>): void }) => void>();
    const addAll = jest.fn().mockResolvedValue(undefined);
    const openCache = jest.fn().mockResolvedValue({ addAll });
    const deleteCache = jest.fn().mockResolvedValue(true);
    const claimClients = jest.fn().mockResolvedValue(undefined);
    const skipWaiting = jest.fn().mockResolvedValue(undefined);
    const serviceWorker = fs.readFileSync(
      path.resolve('src', 'public', 'admin', 'sw.js'),
      'utf8',
    );

    vm.runInNewContext(serviceWorker, {
      URL,
      Response,
      caches: {
        delete: deleteCache,
        keys: () => Promise.resolve(['pb-admin-v1', 'unrelated-cache']),
        open: openCache,
      },
      fetch: jest.fn(),
      self: {
        addEventListener: (type: string, handler: typeof handlers extends Map<string, infer T> ? T : never) => {
          handlers.set(type, handler);
        },
        clients: { claim: claimClients },
        skipWaiting,
      },
    });

    let installation: Promise<unknown> | undefined;
    handlers.get('install')?.({
      waitUntil: (promise) => {
        installation = promise;
      },
    });
    await installation;

    let activation: Promise<unknown> | undefined;
    handlers.get('activate')?.({
      waitUntil: (promise) => {
        activation = promise;
      },
    });
    await activation;

    expect(openCache).toHaveBeenCalledWith('pb-admin-v2');
    expect(addAll).toHaveBeenCalledTimes(1);
    expect(skipWaiting).toHaveBeenCalledTimes(1);
    expect(deleteCache).toHaveBeenCalledWith('pb-admin-v1');
    expect(deleteCache).not.toHaveBeenCalledWith('unrelated-cache');
    expect(claimClients).toHaveBeenCalledTimes(1);
  });
});
