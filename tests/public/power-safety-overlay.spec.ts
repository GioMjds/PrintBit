import {
  attachPowerSafetyOverlay,
  type WorkerPowerEventPayload,
} from '../../src/public/shared/power-safety-overlay';

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

class FakeElement {
  id: string = '';
  className: string = '';
  textContent: string = '';
  private _innerHTML: string = '';
  readonly classList = new FakeClassList();
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  offsetWidth = 100;

  get innerHTML(): string {
    return this._innerHTML;
  }

  set innerHTML(val: string) {
    this._innerHTML = val;
    const idMatches = val.matchAll(/id="([^"]+)"/g);
    for (const match of idMatches) {
      const child = new FakeElement();
      child.id = match[1];
      this.appendChild(child);
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  querySelector(selector: string): FakeElement | null {
    const id = selector.startsWith('#') ? selector.slice(1) : selector;
    return this.findChildById(id);
  }

  private findChildById(id: string): FakeElement | null {
    for (const child of this.children) {
      if (child.id === id) return child;
      const found = child.findChildById(id);
      if (found) return found;
    }
    return null;
  }
}

class FakeDocument {
  readonly head = new FakeElement();
  readonly body = new FakeElement();
  private readonly elements = new Map<string, FakeElement>();

  createElement(tagName: string): FakeElement {
    const el = new FakeElement();
    return el;
  }

  getElementById(id: string): FakeElement | null {
    if (this.elements.has(id)) return this.elements.get(id)!;
    // Check head and body trees
    const fromHead = this.head.querySelector(`#${id}`);
    if (fromHead) return fromHead;
    const fromBody = this.body.querySelector(`#${id}`);
    if (fromBody) return fromBody;
    return null;
  }

  registerElement(id: string, el: FakeElement): void {
    this.elements.set(id, el);
  }
}

describe('PowerSafetyOverlay', () => {
  let fakeDoc: FakeDocument;
  let originalDocument: unknown;
  let originalWindow: unknown;
  let originalFetch: unknown;

  beforeEach(() => {
    fakeDoc = new FakeDocument();
    originalDocument = (globalThis as any).document;
    originalWindow = (globalThis as any).window;
    originalFetch = globalThis.fetch;

    (globalThis as any).document = fakeDoc;
    (globalThis as any).window = {
      io: undefined,
    };
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        type: 'PowerStatusSnapshot',
        operationalState: 'Operational',
        acceptingTransactions: true,
      }),
    });
  });

  afterEach(() => {
    (globalThis as any).document = originalDocument;
    (globalThis as any).window = originalWindow;
    globalThis.fetch = originalFetch as any;
  });

  test('creates overlay and banner in DOM and starts inert', () => {
    const controller = attachPowerSafetyOverlay();

    const overlay = fakeDoc.getElementById('printbitPowerSafetyOverlay');
    const banner = fakeDoc.getElementById('printbitPowerSafetyBanner');

    expect(overlay).not.toBeNull();
    expect(banner).not.toBeNull();
    expect(overlay?.getAttribute('role')).toBe('alertdialog');
    expect(banner?.getAttribute('role')).toBe('status');

    controller.destroy();
  });

  test('displays full-screen blocking overlay when power is emergency and no print is in-flight', () => {
    const controller = attachPowerSafetyOverlay({
      isPrintInFlight: () => false,
    });

    controller.updateState({
      operationalState: 'PowerEmergency',
      acceptingTransactions: false,
    });

    const overlay = fakeDoc.getElementById('printbitPowerSafetyOverlay');
    const banner = fakeDoc.getElementById('printbitPowerSafetyBanner');

    expect(overlay?.classList.contains('is-visible')).toBe(true);
    expect(overlay?.getAttribute('hidden')).toBeNull();
    expect(banner?.classList.contains('is-visible')).toBe(false);

    expect(controller.getOperationalState()).toBe('PowerEmergency');
    expect(controller.isAcceptingTransactions()).toBe(false);

    controller.destroy();
  });

  test('displays non-blocking banner when power is emergency and print IS in-flight', () => {
    // printingActive stays true throughout — notifyPrintCompleted() must
    // internally override the isPrintInFlight predicate (Fix 1).
    const printingActive = true;
    const controller = attachPowerSafetyOverlay({
      isPrintInFlight: () => printingActive,
    });

    controller.updateState({
      operationalState: 'PowerEmergency',
      acceptingTransactions: false,
    });

    const overlay = fakeDoc.getElementById('printbitPowerSafetyOverlay');
    const banner = fakeDoc.getElementById('printbitPowerSafetyBanner');

    // Banner is visible, full blocking overlay is hidden
    expect(banner?.classList.contains('is-visible')).toBe(true);
    expect(banner?.getAttribute('hidden')).toBeNull();
    expect(overlay?.classList.contains('is-visible')).toBe(false);

    // When in-flight print finishes, notifyPrintCompleted() sets the internal
    // printCompleted flag, bypassing isPrintInFlight() and showing the full
    // blocking overlay — WITHOUT requiring the caller to flip printingActive.
    controller.notifyPrintCompleted();

    expect(banner?.classList.contains('is-visible')).toBe(false);
    expect(overlay?.classList.contains('is-visible')).toBe(true);
    expect(overlay?.getAttribute('hidden')).toBeNull();

    controller.destroy();
  });

  test('hides both overlay and banner when power returns to Operational', () => {
    const controller = attachPowerSafetyOverlay({
      isPrintInFlight: () => false,
    });

    // Enter emergency
    controller.updateState({
      operationalState: 'PowerEmergency',
      acceptingTransactions: false,
    });

    const overlay = fakeDoc.getElementById('printbitPowerSafetyOverlay');
    expect(overlay?.classList.contains('is-visible')).toBe(true);

    // Restore to operational
    controller.updateState({
      operationalState: 'Operational',
      acceptingTransactions: true,
    });

    const banner = fakeDoc.getElementById('printbitPowerSafetyBanner');
    expect(overlay?.classList.contains('is-visible')).toBe(false);
    expect(banner?.classList.contains('is-visible')).toBe(false);
    expect(controller.isAcceptingTransactions()).toBe(true);

    controller.destroy();
  });

  test('subscribes to socket workerPowerStatusChanged events', () => {
    const handlers: Record<string, Function> = {};
    const mockSocket = {
      on: jest.fn((event: string, cb: Function) => {
        handlers[event] = cb;
      }),
      off: jest.fn(),
    };

    const controller = attachPowerSafetyOverlay({
      socket: mockSocket,
      isPrintInFlight: () => false,
    });

    expect(mockSocket.on).toHaveBeenCalledWith(
      'workerPowerStatusChanged',
      expect.any(Function),
    );

    // Simulate socket event
    handlers['workerPowerStatusChanged']({
      operationalState: 'Recovering',
      acceptingTransactions: false,
    });

    expect(controller.getOperationalState()).toBe('Recovering');
    expect(controller.isAcceptingTransactions()).toBe(false);

    const overlay = fakeDoc.getElementById('printbitPowerSafetyOverlay');
    expect(overlay?.classList.contains('is-visible')).toBe(true);

    controller.destroy();
    expect(mockSocket.off).toHaveBeenCalledWith(
      'workerPowerStatusChanged',
      expect.any(Function),
    );
  });

  test('updates transaction reference ID on overlay', () => {
    const controller = attachPowerSafetyOverlay({
      isPrintInFlight: () => false,
    });

    controller.setTransactionReference('tx-12345');
    controller.updateState({
      operationalState: 'PowerEmergency',
      acceptingTransactions: false,
    });

    const refEl = fakeDoc.getElementById('printbitPowerSafetyOverlay')?.querySelector('#powerSafetyRef');
    expect(refEl?.textContent).toBe('Reference ID: tx-12345');
    expect(refEl?.getAttribute('hidden')).toBeNull();

    controller.destroy();
  });

  // Fix 2: When a live socket object is passed, the overlay subscribes to it
  // directly and does NOT fall back to window.io (which would create a
  // redundant unmanaged connection).
  test('does not call window.io() when a live socket is provided', () => {
    const mockIoFactory = jest.fn();
    (globalThis as any).window = { io: mockIoFactory };

    const mockSocket = {
      on: jest.fn(),
      off: jest.fn(),
    };

    const controller = attachPowerSafetyOverlay({
      // Pass the live socket directly (simulating post-socket-init attachment)
      socket: mockSocket,
      isPrintInFlight: () => false,
    });

    // The overlay must have subscribed via the provided socket
    expect(mockSocket.on).toHaveBeenCalledWith(
      'workerPowerStatusChanged',
      expect.any(Function),
    );
    // window.io() must NOT have been called — no redundant socket creation
    expect(mockIoFactory).not.toHaveBeenCalled();

    controller.destroy();
  });

  // Fix 3: When the /api/power-safety/status endpoint returns a non-OK
  // response, the overlay must call updatePresentation() (fail-closed) rather
  // than silently swallowing the error (fail-open).
  test('fail-closed: calls updatePresentation when status fetch returns non-OK', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    const controller = attachPowerSafetyOverlay({
      // No socket, no isPrintInFlight — default Unknown state
    });

    // Flush the microtask queue so the fetch promise chain resolves
    await new Promise((resolve) => setTimeout(resolve, 0));

    // With a 503, the overlay should have run updatePresentation() in
    // fail-closed mode. Since operationalState is still 'Unknown' and
    // acceptingTransactions is false, the full blocking overlay must be visible.
    const overlay = fakeDoc.getElementById('printbitPowerSafetyOverlay');
    expect(overlay?.classList.contains('is-visible')).toBe(true);

    controller.destroy();
  });

  // Fix 3 supplementary: verify the happy-path still applies the fetched state.
  test('applies fetched operational state on successful status response', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async (): Promise<WorkerPowerEventPayload> => ({
        operationalState: 'PowerEmergency',
        acceptingTransactions: false,
      }),
    });

    const controller = attachPowerSafetyOverlay({
      isPrintInFlight: () => false,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(controller.getOperationalState()).toBe('PowerEmergency');
    expect(controller.isAcceptingTransactions()).toBe(false);

    const overlay = fakeDoc.getElementById('printbitPowerSafetyOverlay');
    expect(overlay?.classList.contains('is-visible')).toBe(true);

    controller.destroy();
  });
});
