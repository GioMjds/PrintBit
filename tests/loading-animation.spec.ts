type LoadingAnimationModule = {
  resolveLoadingAnimationAsset: (mode: unknown) => string;
  mountLoadingAnimation: (
    options: {
      root: FakeElement;
      canvas: HTMLCanvasElement;
      mode: unknown;
      active?: boolean;
    },
    dependencies: {
      createPlayer: (config: unknown) => FakePlayer;
      motionQuery: FakeMotionQuery;
      pageDocument: FakeDocument;
    },
  ) => {
    setActive: (active: boolean) => void;
    destroy: () => void;
  };
};

class FakeClassList {
  private readonly values = new Set<string>();

  add(...tokens: string[]): void {
    tokens.forEach((token) => this.values.add(token));
  }

  remove(...tokens: string[]): void {
    tokens.forEach((token) => this.values.delete(token));
  }

  toggle(token: string, force?: boolean): boolean {
    const next = force ?? !this.values.has(token);
    if (next) this.values.add(token);
    else this.values.delete(token);
    return next;
  }

  contains(token: string): boolean {
    return this.values.has(token);
  }
}

class FakeElement {
  readonly classList = new FakeClassList();
}

type PlayerEvent = 'load' | 'loadError' | 'renderError';

class FakePlayer {
  isPlaying = false;
  currentFrame = 0;
  destroyed = false;
  private readonly listeners = new Map<PlayerEvent, Set<() => void>>();

  addEventListener(type: PlayerEvent, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: PlayerEvent, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: PlayerEvent): void {
    this.listeners.get(type)?.forEach((listener) => listener());
  }

  play(): void {
    this.isPlaying = true;
  }

  pause(): void {
    this.isPlaying = false;
  }

  setFrame(frame: number): void {
    this.currentFrame = frame;
  }

  destroy(): void {
    this.destroyed = true;
    this.isPlaying = false;
  }
}

class FakeMotionQuery {
  matches: boolean;
  private readonly listeners = new Set<() => void>();

  constructor(matches = false) {
    this.matches = matches;
  }

  addEventListener(_type: 'change', listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'change', listener: () => void): void {
    this.listeners.delete(listener);
  }

  setMatches(matches: boolean): void {
    this.matches = matches;
    this.listeners.forEach((listener) => listener());
  }
}

class FakeDocument {
  hidden = false;
  private readonly listeners = new Set<() => void>();

  addEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.delete(listener);
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.listeners.forEach((listener) => listener());
  }
}

function loadModule(): LoadingAnimationModule {
  return require('../src/public/shared/loading-animation') as LoadingAnimationModule;
}

describe('loading animation controller', () => {
  it.each([
    ['print', '/assets/lottie/printing.lottie'],
    ['copy', '/assets/lottie/copying.lottie'],
    ['scan', '/assets/lottie/scanning.lottie'],
    ['unexpected', '/assets/lottie/printing.lottie'],
  ])('selects the %s loading animation', (mode, expectedAsset) => {
    const { resolveLoadingAnimationAsset } = loadModule();

    expect(resolveLoadingAnimationAsset(mode)).toBe(expectedAsset);
  });

  it('keeps the CSS fallback until the Lottie renderer loads', () => {
    const { mountLoadingAnimation } = loadModule();
    const root = new FakeElement();
    const player = new FakePlayer();

    mountLoadingAnimation(
      {
        root,
        canvas: {} as HTMLCanvasElement,
        mode: 'scan',
        active: true,
      },
      {
        createPlayer: () => player,
        motionQuery: new FakeMotionQuery(),
        pageDocument: new FakeDocument(),
      },
    );

    expect(root.classList.contains('is-lottie-ready')).toBe(false);

    player.emit('load');

    expect(root.classList.contains('is-lottie-ready')).toBe(true);
    expect(player.isPlaying).toBe(true);

    player.emit('loadError');

    expect(root.classList.contains('is-lottie-ready')).toBe(false);
    expect(root.classList.contains('is-lottie-fallback')).toBe(true);
    expect(player.isPlaying).toBe(false);
  });

  it('keeps the CSS fallback when the renderer cannot be constructed', () => {
    const { mountLoadingAnimation } = loadModule();
    const root = new FakeElement();

    expect(() =>
      mountLoadingAnimation(
        {
          root,
          canvas: {} as HTMLCanvasElement,
          mode: 'print',
          active: true,
        },
        {
          createPlayer: () => {
            throw new Error('WebAssembly unavailable');
          },
          motionQuery: new FakeMotionQuery(),
          pageDocument: new FakeDocument(),
        },
      ),
    ).not.toThrow();
    expect(root.classList.contains('is-lottie-fallback')).toBe(true);
    expect(root.classList.contains('is-lottie-ready')).toBe(false);
  });

  it('shows a still frame for reduced motion and pauses while inactive', () => {
    const { mountLoadingAnimation } = loadModule();
    const root = new FakeElement();
    const player = new FakePlayer();
    const motionQuery = new FakeMotionQuery(true);
    const pageDocument = new FakeDocument();
    const controller = mountLoadingAnimation(
      {
        root,
        canvas: {} as HTMLCanvasElement,
        mode: 'copy',
        active: true,
      },
      {
        createPlayer: () => player,
        motionQuery,
        pageDocument,
      },
    );

    player.emit('load');

    expect(root.classList.contains('is-reduced-motion')).toBe(true);
    expect(player.isPlaying).toBe(false);
    expect(player.currentFrame).toBeGreaterThan(0);

    motionQuery.setMatches(false);
    expect(player.isPlaying).toBe(true);

    controller.setActive(false);
    expect(player.isPlaying).toBe(false);

    controller.setActive(true);
    pageDocument.setHidden(true);
    expect(player.isPlaying).toBe(false);

    controller.destroy();
    expect(player.destroyed).toBe(true);
  });
});
