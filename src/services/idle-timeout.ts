/**
 * Shared idle timeout module for all kiosk pages
 * Provides configurable idle detection with optional warning modal
 */

export interface PageIdleState {
  enabled: boolean;
  timeoutSeconds: number;
  elapsedSeconds: number;
  warningShownAt: number | null;
  timerHandle: number | null;
  startedAtMs: number | null;
}

export interface IdleTimeoutConfig {
  showWarningModal?: boolean; // If true, shows modal in last 20 seconds
  modalId?: string;
  countdownId?: string;
  buttonId?: string;
  onTimeout?: () => Promise<void> | void;
  onWarningShown?: () => void;
  onWarningHidden?: () => void;
}

const DEFAULT_TIMEOUT_SECONDS = 120;

const pageIdleState: PageIdleState = {
  enabled: false,
  timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  elapsedSeconds: 0,
  warningShownAt: null,
  timerHandle: null,
  startedAtMs: null,
};

let idleConfig: IdleTimeoutConfig = {
  showWarningModal: false,
  modalId: 'idleWarningModal',
  countdownId: 'idleCountdown',
  buttonId: 'keepActiveBtn',
};

// Cached DOM elements for performance
let cachedModalElement: HTMLElement | null = null;
let cachedCountdownElement: HTMLElement | null = null;
let cachedButtonElement: HTMLButtonElement | null = null;
let areListenersAttached = false;

export async function initializePageIdleTimeout(
  config: IdleTimeoutConfig = {},
): Promise<void> {
  idleConfig = { ...idleConfig, ...config };
  pageIdleState.timeoutSeconds = DEFAULT_TIMEOUT_SECONDS;

  try {
    const res = await fetch('/api/settings/idle-timeout');
    if (res.ok) {
      const data = (await res.json()) as { idleTimeoutSeconds?: number };
      if (data.idleTimeoutSeconds && data.idleTimeoutSeconds > 0) {
        pageIdleState.timeoutSeconds = data.idleTimeoutSeconds;
      }
    }
  } catch (err) {
    console.error('Failed to fetch idle timeout settings, using default:', err);
  } finally {
    // Always enable and start the idle timer even if settings fetch fails
    pageIdleState.enabled = true;
    cachePageIdleDOMElements();
    startPageIdleTimer();
    setupPageIdleWarningButton();
  }
}

function cachePageIdleDOMElements(): void {
  if (idleConfig.modalId) {
    cachedModalElement = document.getElementById(idleConfig.modalId);
  }
  if (idleConfig.countdownId) {
    cachedCountdownElement = document.getElementById(idleConfig.countdownId);
  }
  if (idleConfig.buttonId) {
    cachedButtonElement = document.getElementById(
      idleConfig.buttonId,
    ) as HTMLButtonElement | null;
  }
}

export function startPageIdleTimer(): void {
  if (pageIdleState.timerHandle !== null) {
    clearInterval(pageIdleState.timerHandle);
    pageIdleState.timerHandle = null;
  }

  const now = Date.now();
  pageIdleState.startedAtMs = now;
  pageIdleState.elapsedSeconds = 0;
  pageIdleState.warningShownAt = null;

  if (idleConfig.showWarningModal && cachedModalElement) {
    cachedModalElement.style.display = 'none';
    cachedModalElement.classList.remove('is-leaving');
  }

  let lastCountdownValue = -1; // Track lastCountdownValue to avoid unnecessary DOM updates
  const ACTIVITY_EVENTS = [
    'mousedown',
    'keydown',
    'touchstart',
    'pointerdown',
  ];

  // Attach activity listeners before timer starts
  if (!areListenersAttached) {
    ACTIVITY_EVENTS.forEach((event) => {
      document.addEventListener(event, handleUserActivity, true);
    });
    areListenersAttached = true;
  }

  pageIdleState.timerHandle = window.setInterval(() => {
    if (!pageIdleState.enabled || pageIdleState.startedAtMs === null) return;

    const currentNow = Date.now();
    const elapsed = Math.max(
      0,
      (currentNow - pageIdleState.startedAtMs) / 1000,
    );
    pageIdleState.elapsedSeconds = elapsed;

    // Warning shows in last 20 seconds (or half of timeout if timeout <= 20s)
    const warningThreshold = Math.max(
      0,
      pageIdleState.timeoutSeconds <= 20
        ? pageIdleState.timeoutSeconds / 2
        : pageIdleState.timeoutSeconds - 20,
    );

    // Show warning at threshold (if configured)
    if (
      idleConfig.showWarningModal &&
      pageIdleState.warningShownAt === null &&
      pageIdleState.elapsedSeconds >= warningThreshold
    ) {
      pageIdleState.warningShownAt = pageIdleState.elapsedSeconds;
      showPageIdleWarning();
      if (idleConfig.onWarningShown) {
        idleConfig.onWarningShown();
      }
    }

    // Update countdown display only when value changes (every ~second)
    if (!cachedCountdownElement && idleConfig.countdownId) {
      cachedCountdownElement = document.getElementById(idleConfig.countdownId);
    }
    if (cachedCountdownElement) {
      const timeRemaining = Math.max(
        0,
        Math.ceil(pageIdleState.timeoutSeconds - pageIdleState.elapsedSeconds),
      );
      if (timeRemaining !== lastCountdownValue) {
        lastCountdownValue = timeRemaining;
        cachedCountdownElement.textContent = String(timeRemaining);
      }
    }

    // Handle final timeout
    if (pageIdleState.elapsedSeconds >= pageIdleState.timeoutSeconds) {
      if (pageIdleState.timerHandle !== null) {
        clearInterval(pageIdleState.timerHandle);
        pageIdleState.timerHandle = null;
      }
      void handlePageIdleTimeout();
    }
  }, 100);
}

function handleUserActivity(): void {
  if (!pageIdleState.enabled) return;

  // When warning modal is actively displayed, modal buttons and backdrop handle dismissal
  if (pageIdleState.warningShownAt !== null) {
    return;
  }

  resetPageIdleTimer();
}

export function resetPageIdleTimer(): void {
  if (!pageIdleState.enabled) return;

  // Restart the timer (listeners remain attached from startPageIdleTimer)
  startPageIdleTimer();
}

export function showPageIdleWarning(): void {
  if (!cachedModalElement && idleConfig.modalId) {
    cachedModalElement = document.getElementById(idleConfig.modalId);
  }
  if (cachedModalElement) {
    // Remove any lingering exit class and make visible
    cachedModalElement.classList.remove('is-leaving');
    cachedModalElement.style.display = 'flex';

    // Tap anywhere on the overlay backdrop to dismiss
    cachedModalElement.removeEventListener('click', handleOverlayClick);
    cachedModalElement.addEventListener('click', handleOverlayClick);
  }
}

/** Animate the overlay out, then hide it once the animation completes */
export function hidePageIdleWarning(): void {
  if (!cachedModalElement) {
    if (idleConfig.onWarningHidden) idleConfig.onWarningHidden();
    return;
  }

  // Remove overlay tap listener
  cachedModalElement.removeEventListener('click', handleOverlayClick);

  // Trigger CSS exit animation
  cachedModalElement.classList.add('is-leaving');

  // After the animation completes (280ms), hide and clean up
  const el = cachedModalElement;
  window.setTimeout(() => {
    el.style.display = 'none';
    el.classList.remove('is-leaving');
  }, 300);

  if (idleConfig.onWarningHidden) {
    idleConfig.onWarningHidden();
  }
}

/**
 * Dismiss the warning when the user taps/clicks anywhere on the dark overlay
 * (but NOT when the click is inside the modal card itself).
 */
function handleOverlayClick(event: Event): void {
  const modalCard = cachedModalElement?.querySelector('.idle-warning-modal');
  if (modalCard && modalCard.contains(event.target as Node)) {
    // Click was inside the card — don't dismiss
    return;
  }
  console.log('[PAGE IDLE] User tapped overlay to dismiss timeout warning');
  hidePageIdleWarning();
  resetPageIdleTimer();
}

export function setupPageIdleWarningButton(): void {
  if (!cachedButtonElement && idleConfig.buttonId) {
    cachedButtonElement = document.getElementById(
      idleConfig.buttonId,
    ) as HTMLButtonElement | null;
  }
  if (!cachedButtonElement) return;

  // Prevent duplicate listeners by removing any existing listener first
  cachedButtonElement.removeEventListener('click', handleKeepActiveClick);
  cachedButtonElement.addEventListener('click', handleKeepActiveClick);
}

function handleKeepActiveClick(event?: Event): void {
  event?.stopPropagation();
  console.log('[PAGE IDLE] User dismissed timeout warning via button');
  hidePageIdleWarning();
  resetPageIdleTimer();
}

async function handlePageIdleTimeout(): Promise<void> {
  console.log('[PAGE IDLE] Timeout reached');
  hidePageIdleWarning();
  if (idleConfig.onTimeout) {
    await idleConfig.onTimeout();
  }
}

export function getPageIdleState(): PageIdleState {
  return pageIdleState;
}
