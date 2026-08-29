import { DotLottie } from '@lottiefiles/dotlottie-web';

export type ConfigPreparationState = 'preparing' | 'ready' | 'error';

export interface ConfigPreparationLoadingController {
  start(message?: string): void;
  setMessage(message: string, detail?: string): void;
  finish(): void;
  fail(message?: string): void;
  destroy(): void;
}

interface ControllerOptions {
  setContinueEnabled: (enabled: boolean) => void;
}

const DEFAULT_TITLE = 'Preparing document';
const DEFAULT_DETAIL = 'Building your print preview…';
const DOTLOTTIE_WASM_URL = '/vendor/dotlottie/dotlottie-player.wasm';
const DOTLOTTIE_ASSET_URL = '/config/assets/document-preparing.lottie';

export function createConfigPreparationLoadingController(
  options: ControllerOptions,
): ConfigPreparationLoadingController {
  const layout = document.getElementById('configLayout');
  const preparing = document.getElementById('configPreparing');
  const canvas = document.getElementById(
    'configPreparingAnimation',
  ) as HTMLCanvasElement | null;
  const status = document.getElementById('configPreparingStatus');
  const detail = document.getElementById('configPreparingDetail');
  const paperLoading = document.getElementById('paperLoading');
  const reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;

  let state: ConfigPreparationState = 'ready';
  let animation: DotLottie | null = null;

  const showFallback = (): void => {
    preparing?.setAttribute('data-lottie-unavailable', '');
  };

  const ensureAnimation = (): void => {
    if (reducedMotion || !canvas) {
      showFallback();
      return;
    }
    if (animation) return;

    try {
      DotLottie.setWasmUrl(DOTLOTTIE_WASM_URL);
      animation = new DotLottie({
        canvas,
        src: DOTLOTTIE_ASSET_URL,
        autoplay: true,
        loop: true,
      });
      animation.addEventListener('loadError', showFallback);
      animation.addEventListener('renderError', showFallback);
    } catch (error) {
      console.warn(
        '[CONFIG PREPARING] DotLottie unavailable, using CSS fallback',
        error,
      );
      showFallback();
    }
  };

  const setState = (nextState: ConfigPreparationState): void => {
    state = nextState;
    layout?.setAttribute('data-preparation-state', nextState);
    layout?.setAttribute(
      'aria-busy',
      nextState === 'preparing' ? 'true' : 'false',
    );
  };

  return {
    start(message = DEFAULT_TITLE): void {
      setState('preparing');
      if (status) status.textContent = message;
      if (detail) detail.textContent = DEFAULT_DETAIL;
      paperLoading?.classList.remove('hidden');
      options.setContinueEnabled(false);
      ensureAnimation();
    },

    setMessage(message: string, nextDetail = DEFAULT_DETAIL): void {
      if (status) status.textContent = message;
      if (detail) detail.textContent = nextDetail;
    },

    finish(): void {
      if (state !== 'error') setState('ready');
      paperLoading?.classList.add('hidden');
      animation?.pause();
    },

    fail(message = 'Preview unavailable'): void {
      setState('error');
      if (status) status.textContent = message;
      paperLoading?.classList.add('hidden');
      animation?.pause();
    },

    destroy(): void {
      animation?.destroy();
      animation = null;
    },
  };
}
