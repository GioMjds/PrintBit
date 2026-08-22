import fs from 'node:fs';
import path from 'node:path';
import {
  initKioskNavigation,
  navigateWithKioskMotion,
  resolveSameOriginNavigation,
} from '@/public/shared/kiosk-navigation';

const PUBLIC_DIR = path.resolve('src/public');
const KIOSK_TRANSITION_STYLESHEET =
  '<link rel="stylesheet" href="/shared/kiosk-transition.css" />';
const CUSTOMER_PAGE_HTML = [
  'index.html',
  'config/index.html',
  'confirm/index.html',
  'copy/index.html',
  'feedback/index.html',
  'loading/index.html',
  'print/index.html',
  'receipt/index.html',
  'report/index.html',
  'scan/index.html',
  'upload/index.html',
];

function readPublicFile(relativePath: string): string {
  return fs.readFileSync(path.join(PUBLIC_DIR, relativePath), 'utf8');
}

interface KioskWindowStub {
  location: {
    href: string;
    assign: jest.Mock<void, [string | URL]>;
    replace: jest.Mock<void, [string | URL]>;
  };
  matchMedia: jest.Mock<{ matches: boolean }, [string]>;
  setTimeout: jest.Mock<number, [TimerHandler, number?]>;
  addEventListener: jest.Mock<void, [string, EventListener]>;
}

interface KioskDocumentStub {
  documentElement: { dataset: DOMStringMap };
  addEventListener: jest.Mock<void, [string, EventListener]>;
}

describe('optimized kiosk navigation motion', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalElement = globalThis.Element;
  let kioskWindow: KioskWindowStub;
  let kioskDocument: KioskDocumentStub;
  let rootDataset: DOMStringMap;

  beforeEach(() => {
    rootDataset = {} as DOMStringMap;
    kioskWindow = {
      location: {
        href: 'http://127.0.0.1:3000/config?mode=print',
        assign: jest.fn(),
        replace: jest.fn(),
      },
      matchMedia: jest.fn((query: string) => {
        void query;
        return { matches: false };
      }),
      setTimeout: jest.fn((handler: TimerHandler, timeout?: number) => {
        void handler;
        void timeout;
        return 1;
      }),
      addEventListener: jest.fn(),
    };
    kioskDocument = {
      documentElement: { dataset: rootDataset },
      addEventListener: jest.fn(),
    };

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: kioskWindow,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: kioskDocument,
    });
  });

  afterAll(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    });
    Object.defineProperty(globalThis, 'Element', {
      configurable: true,
      value: originalElement,
    });
  });

  it.each(CUSTOMER_PAGE_HTML)(
    'keeps non-navigation motion static while opting %s into page transitions',
    (relativePath) => {
      const html = readPublicFile(relativePath);

      expect(html).toMatch(/<html\b[^>]*\bdata-kiosk-static="true"/);
      expect(html).toContain(KIOSK_TRANSITION_STYLESHEET);
      expect(html).not.toContain('/shared/motion.js');
    },
  );

  it('ships the shared browser-native navigation transition stylesheet', () => {
    expect(
      fs.existsSync(path.join(PUBLIC_DIR, 'shared/kiosk-transition.css')),
    ).toBe(true);
  });

  it('disables composited motion in the shared customer stylesheet', () => {
    const globals = readPublicFile('globals.css');

    expect(globals).toContain("html[data-kiosk-static='true'] *");
    expect(globals).toContain('animation: none !important');
    expect(globals).toContain('backdrop-filter: none !important');
    expect(globals).toContain('transition: none !important');
  });

  it('resolves only same-origin page navigation', () => {
    const currentUrl = kioskWindow.location.href;

    expect(resolveSameOriginNavigation('/confirm', currentUrl)).toBe(
      'http://127.0.0.1:3000/confirm',
    );
    expect(resolveSameOriginNavigation('#paper-size', currentUrl)).toBeNull();
    expect(
      resolveSameOriginNavigation('https://example.com/help', currentUrl),
    ).toBeNull();
    expect(
      resolveSameOriginNavigation('mailto:help@example.com', currentUrl),
    ).toBeNull();
  });

  it('plays the live-page departure before assigning same-origin navigation', () => {
    expect(navigateWithKioskMotion('/confirm')).toBe(true);

    expect(rootDataset.kioskNavigationPending).toBe('true');
    expect(rootDataset.kioskPageState).toBe('leaving');
    expect(kioskWindow.location.assign).not.toHaveBeenCalled();
    expect(kioskWindow.setTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      170,
    );

    const completeNavigation = kioskWindow.setTimeout.mock.calls[0]?.[0];
    expect(typeof completeNavigation).toBe('function');
    (completeNavigation as () => void)();

    expect(kioskWindow.location.assign).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/confirm',
    );
  });

  it('replaces same-origin navigation after the same departure', () => {
    expect(navigateWithKioskMotion('/', 'replace')).toBe(true);

    const completeNavigation = kioskWindow.setTimeout.mock.calls[0]?.[0];
    (completeNavigation as () => void)();

    expect(kioskWindow.location.replace).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/',
    );
  });

  it('navigates immediately when reduced motion is requested', () => {
    kioskWindow.matchMedia.mockReturnValue({ matches: true });

    expect(navigateWithKioskMotion('/confirm')).toBe(true);

    expect(kioskWindow.location.assign).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/confirm',
    );
    expect(kioskWindow.setTimeout).not.toHaveBeenCalled();
  });

  it('routes same-origin anchor clicks through the live-page departure', () => {
    class FakeElement {
      constructor(
        private readonly anchor: {
          href: string;
          target: string;
          hasAttribute: (name: string) => boolean;
        },
      ) {}

      closest(): typeof this.anchor {
        return this.anchor;
      }
    }
    Object.defineProperty(globalThis, 'Element', {
      configurable: true,
      value: FakeElement,
    });

    initKioskNavigation();
    const clickListener = kioskDocument.addEventListener.mock.calls.find(
      ([type]) => type === 'click',
    )?.[1] as ((event: MouseEvent) => void) | undefined;
    expect(clickListener).toBeDefined();

    const preventDefault = jest.fn();
    clickListener?.({
      defaultPrevented: false,
      button: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      target: new FakeElement({
        href: 'http://127.0.0.1:3000/copy',
        target: '',
        hasAttribute: () => false,
      }),
      preventDefault,
    } as unknown as MouseEvent);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(rootDataset.kioskPageState).toBe('leaving');
    expect(kioskWindow.location.assign).not.toHaveBeenCalled();
  });

  it('ignores invalid or external navigation', () => {
    expect(navigateWithKioskMotion('https://example.com/help')).toBe(false);
    expect(kioskWindow.location.assign).not.toHaveBeenCalled();
    expect(kioskWindow.location.replace).not.toHaveBeenCalled();
    expect(kioskWindow.setTimeout).not.toHaveBeenCalled();
  });
});
