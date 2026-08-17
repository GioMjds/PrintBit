const DEFAULT_RETRY_AFTER_MS = 1500;

interface StartupReadinessPayload {
  ready?: boolean;
  phase?: string;
  message?: string | null;
  retryAfterMs?: number;
}

const statusText = document.getElementById('statusText');
const metaText = document.getElementById('metaText');

if (
  !(statusText instanceof HTMLElement) ||
  !(metaText instanceof HTMLElement)
) {
  throw new Error('Loading page status elements are missing.');
}

const setBooting = (): void => {
  statusText.textContent =
    'Preparing kiosk services. This page will continue automatically.';
  statusText.classList.remove('error');
};

const setFailed = (message?: string | null): void => {
  statusText.textContent =
    message || 'Startup failed. Waiting for automatic recovery.';
  statusText.classList.add('error');
};

const poll = async (): Promise<void> => {
  let retryAfterMs = DEFAULT_RETRY_AFTER_MS;

  try {
    const response = await fetch('/api/startup/ready', { cache: 'no-store' });
    const payload = (await response.json()) as StartupReadinessPayload;

    if (typeof payload.retryAfterMs === 'number' && payload.retryAfterMs > 0) {
      retryAfterMs = payload.retryAfterMs;
    }

    if (payload.ready === true) {
      window.location.replace('/');
      return;
    }

    if (payload.phase === 'failed') {
      setFailed(payload.message);
      // Show more detailed error information for debugging
      const detailMessage = payload.message
        ? `Startup failed: ${payload.message}`
        : 'Startup failed. Check server logs for details.';
      metaText.textContent = `${detailMessage} Automatic recovery is running. Retrying…`;
    } else {
      setBooting();
      metaText.textContent = 'Waiting for readiness signal.';
    }
  } catch {
    setBooting();
    metaText.textContent = 'Network unavailable. Retrying…';
    retryAfterMs = Math.max(retryAfterMs, 3000);
  }

  window.setTimeout(() => {
    void poll();
  }, retryAfterMs);
};

void poll();
