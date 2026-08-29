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
  readonly classList = new FakeClassList();
  readonly attributes = new Map<string, string>();
  inert = false;
  textContent = '';

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
}

class FakeDocument {
  constructor(
    private readonly elements: Record<string, FakeElement>,
    private readonly selectors: Record<string, FakeElement> = {},
  ) {}

  getElementById(id: string): FakeElement | null {
    return this.elements[id] ?? null;
  }

  querySelector(selector: string): FakeElement | null {
    return this.selectors[selector] ?? null;
  }
}

type BrowserGlobals = {
  document?: unknown;
  window?: unknown;
};

type PreparationLoadingModule = {
  createConfigPreparationLoadingController?: (options: {
    setContinueEnabled: (enabled: boolean) => void;
  }) => {
    start(message?: string): void;
    setMessage(message: string, detail?: string): void;
    finish(): void;
    fail(message?: string): void;
    destroy(): void;
  };
};

const browserGlobals = globalThis as unknown as BrowserGlobals;
const originalDocument = browserGlobals.document;
const originalWindow = browserGlobals.window;

afterEach(() => {
  jest.resetModules();

  if (originalDocument === undefined) delete browserGlobals.document;
  else browserGlobals.document = originalDocument;

  if (originalWindow === undefined) delete browserGlobals.window;
  else browserGlobals.window = originalWindow;
});

function loadControllerModule(): PreparationLoadingModule {
  try {
    return require('../../src/public/config/loading-state') as PreparationLoadingModule;
  } catch {
    return {};
  }
}

test('preparation locks the page and a failure remains terminal after cleanup', () => {
  const layout = new FakeElement();
  const preparing = new FakeElement();
  const status = new FakeElement();
  const detail = new FakeElement();
  const paperLoading = new FakeElement();
  paperLoading.classList.add('hidden');

  browserGlobals.document = new FakeDocument({
    configLayout: layout,
    configPreparing: preparing,
    configPreparingStatus: status,
    configPreparingDetail: detail,
    paperLoading,
  });
  browserGlobals.window = {
    matchMedia: () => ({ matches: true }),
  };

  const setContinueEnabled = jest.fn();
  const controller = loadControllerModule().createConfigPreparationLoadingController;

  expect(controller).toBeDefined();

  const preparation = controller!({ setContinueEnabled });
  preparation.start();
  preparation.setMessage('Preparing copy preview', 'Loading the scanned pages…');
  preparation.fail('Preview unavailable');
  preparation.finish();

  expect(layout.getAttribute('data-preparation-state')).toBe('error');
  expect(layout.getAttribute('aria-busy')).toBe('false');
  expect(status.textContent).toBe('Preview unavailable');
  expect(detail.textContent).toBe('Loading the scanned pages…');
  expect(paperLoading.classList.contains('hidden')).toBe(true);
  expect(setContinueEnabled).toHaveBeenCalledWith(false);
});

test('preparation makes settings and preview controls inert until cleanup', () => {
  const layout = new FakeElement();
  const settings = new FakeElement();
  const previewControls = new FakeElement();
  const zoomControls = new FakeElement();
  const paperLoading = new FakeElement();

  browserGlobals.document = new FakeDocument(
    {
      configLayout: layout,
      configSettings: settings,
      previewControls,
      paperLoading,
    },
    { '.zoom-controls': zoomControls },
  );
  browserGlobals.window = {
    matchMedia: () => ({ matches: true }),
  };

  const controller = loadControllerModule().createConfigPreparationLoadingController;
  const preparation = controller!({ setContinueEnabled: jest.fn() });

  preparation.start();

  expect(settings.inert).toBe(true);
  expect(previewControls.inert).toBe(true);
  expect(zoomControls.inert).toBe(true);

  preparation.fail();
  preparation.finish();

  expect(settings.inert).toBe(false);
  expect(previewControls.inert).toBe(false);
  expect(zoomControls.inert).toBe(false);
});
