export {};

interface ActiveSessionResponse {
  token: string;
  uploadUrl: string;
  publicUploadUrl?: string;
  shortCode?: string;
  shortUploadUrl?: string;
  publicShortUploadUrl?: string;
}

const portalMessage = document.getElementById('portalMessage') as HTMLElement;
const uploadUrlEl = document.getElementById('uploadUrl') as HTMLElement;
const openUploadBtn = document.getElementById(
  'openUploadBtn',
) as HTMLAnchorElement;
const manualFallback = document.getElementById('manualFallback') as HTMLElement;
const shortUploadUrlEl = document.getElementById('shortUploadUrl') as HTMLElement;
const shortCodeEl = document.getElementById('shortCode') as HTMLElement;
const copyLinkBtn = document.getElementById('copyLinkBtn') as HTMLButtonElement;
const retryBtn = document.getElementById('retryBtn') as HTMLButtonElement;
const handoffHint = document.getElementById('handoffHint') as HTMLElement;

const POLL_INTERVAL_MS = 4000;
let pollHandle: number | null = null;
let currentUploadUrl = '';
let currentShortUploadUrl = '';

function setHidden(el: HTMLElement, hidden: boolean): void {
  el.classList.toggle('hidden', hidden);
}

function renderNoSessionState(): void {
  portalMessage.textContent =
    'No active upload session yet. Go to the kiosk, tap Print, then retry here.';
  uploadUrlEl.textContent = '';
  currentUploadUrl = '';
  currentShortUploadUrl = '';
  shortUploadUrlEl.textContent = '';
  shortCodeEl.textContent = '—';
  handoffHint.textContent = '';
  setHidden(uploadUrlEl, true);
  setHidden(manualFallback, true);
  setHidden(openUploadBtn, true);
  setHidden(copyLinkBtn, true);
  setHidden(handoffHint, true);
}

function renderSessionState(session: ActiveSessionResponse): void {
  const uploadUrl = session.uploadUrl;
  const shortUploadUrl = session.shortUploadUrl;
  currentUploadUrl = uploadUrl;
  currentShortUploadUrl = shortUploadUrl ?? '';
  portalMessage.textContent =
    'Session found. Open upload in your full browser for reliable file selection. If captive mode blocks browser handoff, use the short fallback URL.';
  handoffHint.textContent = '';
  uploadUrlEl.textContent = uploadUrl;
  if (shortUploadUrl) {
    shortUploadUrlEl.textContent = shortUploadUrl;
    shortCodeEl.textContent = session.shortCode?.trim().toUpperCase() ?? '—';
  } else {
    shortUploadUrlEl.textContent = '';
    shortCodeEl.textContent = '—';
  }
  openUploadBtn.href = uploadUrl;
  setHidden(uploadUrlEl, false);
  setHidden(manualFallback, !shortUploadUrl);
  setHidden(openUploadBtn, false);
  setHidden(copyLinkBtn, false);
  setHidden(handoffHint, true);
}

function isLikelyCaptiveWebview(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('captiveportal') || ua.includes('captivenetworksupport')) {
    return true;
  }
  if (ua.includes(' cna')) return true;

  let hasStorageAccess = false;
  try {
    hasStorageAccess = typeof window.localStorage !== 'undefined';
  } catch {
    hasStorageAccess = false;
  }
  return !window.indexedDB || !hasStorageAccess;
}

function buildAndroidIntent(
  url: string,
  packageName?: string,
): string | null {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    const scheme = parsed.protocol === 'https:' ? 'https' : 'http';
    const packagePart = packageName ? `;package=${packageName}` : '';
    return `intent://${parsed.host}${path}#Intent;scheme=${scheme};action=android.intent.action.VIEW${packagePart};S.browser_fallback_url=${encodeURIComponent(url)};end`;
  } catch {
    return null;
  }
}

function buildIosChromeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const chromeScheme =
      parsed.protocol === 'https:' ? 'googlechromes:' : 'googlechrome:';
    return `${chromeScheme}//${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function showHandoffHint(message: string): void {
  handoffHint.textContent = message;
  setHidden(handoffHint, false);
}

async function openUploadInExternalBrowser(event: MouseEvent): Promise<void> {
  event.preventDefault();
  if (!currentUploadUrl) return;

  const ua = navigator.userAgent.toLowerCase();
  const isAndroid = ua.includes('android');
  const isIos = /iphone|ipad|ipod/.test(ua);
  const captive = isLikelyCaptiveWebview();

  if (isAndroid && captive) {
    const genericIntent = buildAndroidIntent(currentUploadUrl);
    const chromeIntent = buildAndroidIntent(
      currentUploadUrl,
      'com.android.chrome',
    );
    if (genericIntent) {
      window.location.href = genericIntent;
      window.setTimeout(() => {
        if (chromeIntent) {
          window.location.href = chromeIntent;
          window.setTimeout(() => {
            window.location.href = currentUploadUrl;
          }, 700);
          return;
        }
        window.location.href = currentUploadUrl;
      }, 700);
      showHandoffHint(
        'Trying to open your browser app. If it stays in captive screen, use the captive menu option "Open in browser", then use the copied link.',
      );
      return;
    }
  }

  if (isIos && captive) {
    void copyUploadUrl();
    const iosChromeUrl = buildIosChromeUrl(currentUploadUrl);
    if (iosChromeUrl) {
      window.location.href = iosChromeUrl;
      window.setTimeout(() => {
        window.location.href = currentUploadUrl;
      }, 700);
    } else {
      window.location.href = currentUploadUrl;
    }
    showHandoffHint(
      'iOS may keep links inside captive assistant. Use Share/More -> Open in Safari, then paste the copied link if needed.',
    );
    return;
  }

  const openedWindow = window.open(currentUploadUrl, '_blank', 'noopener,noreferrer');
  if (!openedWindow) {
    window.location.href = currentUploadUrl;
  }
}

async function copyUploadUrl(): Promise<void> {
  const urlToCopy = currentShortUploadUrl || currentUploadUrl;
  if (!urlToCopy) return;
  try {
    await navigator.clipboard.writeText(urlToCopy);
    copyLinkBtn.textContent = 'Copied!';
    window.setTimeout(() => {
      copyLinkBtn.textContent = 'Copy Link';
    }, 1400);
  } catch {
    const textArea = document.createElement('textarea');
    textArea.value = urlToCopy;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      copyLinkBtn.textContent = 'Copied!';
      window.setTimeout(() => {
        copyLinkBtn.textContent = 'Copy Link';
      }, 1400);
    } finally {
      document.body.removeChild(textArea);
    }
  }
}

async function refreshPortalSession(): Promise<void> {
  try {
    const response = await fetch('/api/session/active', { cache: 'no-store' });
    if (response.status === 404) {
      renderNoSessionState();
      return;
    }
    if (!response.ok) {
      portalMessage.textContent = 'Unable to load session. Tap Retry.';
      return;
    }
    const payload = (await response.json()) as ActiveSessionResponse;
    if (!payload.uploadUrl) {
      renderNoSessionState();
      return;
    }
    renderSessionState(payload);
  } catch {
    portalMessage.textContent = 'Network error. Tap Retry.';
  }
}

function startPortalPolling(): void {
  if (pollHandle !== null) return;
  pollHandle = window.setInterval(() => {
    void refreshPortalSession();
  }, POLL_INTERVAL_MS);
}

retryBtn.addEventListener('click', () => {
  void refreshPortalSession();
});
copyLinkBtn.addEventListener('click', () => {
  void copyUploadUrl();
});
openUploadBtn.addEventListener('click', (event) => {
  void openUploadInExternalBrowser(event);
});

void refreshPortalSession();
startPortalPolling();
