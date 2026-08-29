/**
 * Idle / attractor screen module for the kiosk homepage.
 *
 * Responsibilities:
 *  - Fetch the configured idle timeout duration from the server.
 *  - Arm a timer that shows the idle overlay after inactivity.
 *  - Show / hide the overlay with CSS transitions.
 *  - Re-arm the timer each time the overlay is dismissed.
 *  - Support an immediate-show mode for the boot → idle flow.
 */

const DEFAULT_IDLE_TIMEOUT_MS = 120_000; // 2 minutes fallback
const FADE_OUT_DURATION_MS = 260; // Fast, responsive 260ms exit transition (matches kiosk-navigation timing)

export interface IdleScreenOptions {
  /** The ID of the idle overlay element in the DOM. */
  overlayId: string;
  /** When true, show the overlay immediately (e.g. after boot). */
  activateImmediately?: boolean;
  /** Called just after the overlay becomes visible. */
  onShow?: () => void;
  /** Called just after the overlay is fully hidden. */
  onHide?: () => void;
}

let overlayEl: HTMLElement | null = null;
let idleTimer: number | null = null;
let idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS;
let isVisible = false;
let isLeaving = false;
let onHideCb: (() => void) | undefined;
let onShowCb: (() => void) | undefined;

const ACTIVITY_EVENTS = ['pointerdown', 'touchstart', 'keydown'] as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the idle screen module.
 * Safe to call once per page load.
 *
 * NOTE: bundle.js has no `defer` attribute, so this script runs
 * synchronously while the HTML is still being parsed. The #idleOverlay
 * element may not yet exist in the DOM at call time. We therefore defer
 * the actual DOM lookup and setup until DOMContentLoaded fires (or
 * immediately if the document is already interactive/complete).
 */
export function initIdleScreen(options: IdleScreenOptions): void {
  const isBoot = Boolean(
    options.activateImmediately ||
      (typeof document !== 'undefined' &&
        document.documentElement.classList.contains('kiosk-boot-idle')),
  );

  const run = async () => {
    overlayEl = document.getElementById(options.overlayId);
    if (!overlayEl) {
      console.warn(`[IdleScreen] Element #${options.overlayId} not found.`);
      return;
    }

    onShowCb = options.onShow;
    onHideCb = options.onHide;

    // Attach activity listeners so tapping dismisses the overlay when visible.
    ACTIVITY_EVENTS.forEach((evt) => {
      document.addEventListener(evt, handleActivity, true);
    });

    if (isBoot) {
      showIdleOverlay();
      document.documentElement.classList.remove('kiosk-boot-idle');
    }

    // Fetch timeout from server in background; fall back gracefully on failure.
    idleTimeoutMs = await fetchIdleTimeoutMs();

    if (!isBoot) {
      armIdleTimer();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void run(), {
      once: true,
    });
  } else {
    void run();
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchIdleTimeoutMs(): Promise<number> {
  try {
    const res = await fetch('/api/settings/idle-timeout');
    if (!res.ok) return DEFAULT_IDLE_TIMEOUT_MS;
    const data = (await res.json()) as {
      idleTimeoutSeconds?: number;
      idleScreenTimeoutSeconds?: number;
    };
    // Use the dedicated idle screen timeout if configured; fall back to
    // the session idle timeout, then the hard-coded default.
    const seconds =
      data.idleScreenTimeoutSeconds ?? data.idleTimeoutSeconds ?? null;
    if (seconds && seconds > 0) {
      return seconds * 1_000;
    }
  } catch (err) {
    console.error('[IdleScreen] Failed to fetch idle timeout settings:', err);
  }
  return DEFAULT_IDLE_TIMEOUT_MS;
}

function armIdleTimer(): void {
  clearIdleTimer();
  idleTimer = window.setTimeout(() => {
    showIdleOverlay();
  }, idleTimeoutMs);
}

function clearIdleTimer(): void {
  if (idleTimer !== null) {
    window.clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function showIdleOverlay(): void {
  if (!overlayEl || isVisible) return;

  clearIdleTimer();
  isVisible = true;
  isLeaving = false;

  // Clear any existing state and force reflow so keyframe animations always play freshly from 0%
  overlayEl.classList.remove('is-leaving', 'is-visible');
  void overlayEl.offsetWidth;

  overlayEl.classList.add('is-visible');
  overlayEl.removeAttribute('aria-hidden');
  overlayEl.setAttribute('aria-modal', 'true');

  if (onShowCb) onShowCb();
}

function hideIdleOverlay(): void {
  if (!overlayEl || !isVisible || isLeaving) return;

  isLeaving = true;

  // Switch to is-leaving state to trigger the fast fade-out exit animation
  overlayEl.classList.remove('is-visible');
  void overlayEl.offsetWidth;
  overlayEl.classList.add('is-leaving');

  // After the CSS animation completes, clean up and re-arm timer.
  window.setTimeout(() => {
    if (!overlayEl) return;
    overlayEl.classList.remove('is-leaving');
    overlayEl.setAttribute('aria-hidden', 'true');
    overlayEl.setAttribute('aria-modal', 'false');

    isVisible = false;
    isLeaving = false;

    if (onHideCb) onHideCb();

    armIdleTimer();
  }, FADE_OUT_DURATION_MS);
}

function handleActivity(event?: Event): void {
  if (isVisible) {
    // Consume the wake-up tap so it doesn't accidentally trigger an underlying action button
    if (event) {
      event.stopPropagation();
    }
    hideIdleOverlay();
  } else {
    // Any activity while idle screen is not shown: reset the arm timer.
    armIdleTimer();
  }
}
