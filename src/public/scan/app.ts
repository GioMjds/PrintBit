import { initializePageIdleTimeout } from '@/services/idle-timeout';
import { initKioskLocalization } from '../shared/kiosk-i18n';

export {};

void initKioskLocalization();

// ── Idle Timeout with Warning Modal (Scan Page) ───────────────────────────────────────────────

void initializePageIdleTimeout({
  showWarningModal: true,
  onTimeout: () => {
    console.log('[PAGE IDLE] Scan page timeout reached, redirecting to home');
    if (scanReleaseToken) {
      void releaseScanFile(scanReleaseToken, 'scan_idle_timeout');
      scanReleaseToken = null;
    }
    // Cancel server-side session if exists
    const sessionId = sessionStorage.getItem('printbit.sessionId');
    const sessionToken = sessionStorage.getItem('printbit.sessionToken');
    if (sessionId && sessionToken) {
      void fetch(
        `/api/wireless/sessions/${encodeURIComponent(sessionId)}/cancel?token=${encodeURIComponent(sessionToken)}`,
        { method: 'DELETE' },
      ).catch(() => {});
    }
    // Clear state before redirect
    sessionStorage.removeItem('printbit.config');
    sessionStorage.removeItem('printbit.sessionId');
    sessionStorage.removeItem('printbit.sessionToken');
    window.location.replace('/');
  },
});

type ScanSource = 'feeder' | 'glass';
type ScanColor = 'color' | 'grayscale';
type ScanDpi = '150' | '300' | '600';

interface ScanResponse {
  pages: string[];
  filename?: string;
  releaseToken?: string;
}

interface PricingResponse {
  printPerPage: number;
  copyPerPage: number;
  scanDocument: number;
  colorSurcharge: number;
}

interface StoredScanConfig {
  mode?: string;
  scanFilename?: string;
  scanReleaseToken?: string | null;
}

type ScanFailureCause =
  | 'paper_jam'
  | 'empty_feeder'
  | 'multi_feed'
  | 'busy'
  | 'connection'
  | 'unknown';

const previewHint = document.getElementById('previewHint') as HTMLElement;
const stateIdle = document.getElementById('stateIdle') as HTMLElement;
const stateScanning = document.getElementById('stateScanning') as HTMLElement;
const stateResult = document.getElementById('stateResult') as HTMLElement;
const stateError = document.getElementById('stateError') as HTMLElement;
const scanProgress = document.getElementById('scanProgress') as HTMLElement;
const errorText = document.getElementById('errorText') as HTMLElement;

const scannedImage = document.getElementById(
  'scannedImage',
) as HTMLImageElement;
const pageCountBadge = document.getElementById('pageCountBadge') as HTMLElement;
const pageCountText = document.getElementById('pageCountText') as HTMLElement;

const previewControls = document.getElementById(
  'previewControls',
) as HTMLElement;
const pagePrev = document.getElementById('pagePrev') as HTMLButtonElement;
const pageNext = document.getElementById('pageNext') as HTMLButtonElement;
const pagerLabel = document.getElementById('pagerLabel') as HTMLElement;

const scanBtn = document.getElementById('scanBtn') as HTMLButtonElement;
const scanBtnLabel = document.getElementById('scanBtnLabel') as HTMLElement;
const rescanBtn = document.getElementById('rescanBtn') as HTMLButtonElement;
const proceedBtn = document.getElementById('proceedBtn') as HTMLButtonElement;
const proceedBtnLabel = document.getElementById(
  'proceedBtnLabel',
) as HTMLElement;
const softCopyFeeText = document.getElementById(
  'softCopyFeeText',
) as HTMLElement;
const scanTroubleshootingPanel = document.getElementById(
  'scanTroubleshootingPanel',
) as HTMLElement | null;
const scanTroubleshootSummary = document.getElementById(
  'scanTroubleshootSummary',
) as HTMLElement | null;
const scanTroubleshootCauses = document.getElementById(
  'scanTroubleshootCauses',
) as HTMLUListElement | null;
const scanTroubleshootSteps = document.getElementById(
  'scanTroubleshootSteps',
) as HTMLOListElement | null;

const previewTroubleshooting = document.getElementById(
  'previewTroubleshooting',
) as HTMLElement | null;
const previewTroubleshootSummary = document.getElementById(
  'previewTroubleshootSummary',
) as HTMLElement | null;
const previewTroubleshootCauses = document.getElementById(
  'previewTroubleshootCauses',
) as HTMLUListElement | null;
const previewTroubleshootSteps = document.getElementById(
  'previewTroubleshootSteps',
) as HTMLOListElement | null;

const errorSubtext = stateError?.querySelector('.preview-state__sub') as HTMLElement | null;

const backBtn = document.querySelector<HTMLAnchorElement>('a.back-btn');

const PREVIEW_STATES: Record<
  'idle' | 'scanning' | 'result' | 'error',
  HTMLElement
> = {
  idle: stateIdle,
  scanning: stateScanning,
  result: stateResult,
  error: stateError,
};

let scannedPages: string[] = [];
let currentPage = 0;
let scanFilename: string | null = null;
let scanReleaseToken: string | null = null;
let scanDocumentPrice = 5;

const SCAN_SOURCE: ScanSource = 'feeder';
const SCAN_COLOR: ScanColor = 'color';
const SCAN_DPI: ScanDpi = '600';

const RELEASE_TIMEOUT_MS = 1_500;

const SCAN_FAILURE_GUIDES: Record<
  ScanFailureCause,
  { causes: string[]; steps: string[] }
> = {
  paper_jam: {
    causes: [
      'Paper is stuck in the feeder path.',
      'A torn or folded sheet blocked the rollers.',
      'The feeder cover was not fully closed after loading.',
    ],
    steps: [
      'Open the feeder cover and remove jammed paper slowly in the feed direction.',
      'Check for torn scraps near rollers, then close all covers firmly.',
      'Reload straight sheets (not folded/stapled) and align paper guides before rescanning.',
    ],
  },
  empty_feeder: {
    causes: [
      'No page is inserted in the feeder slot.',
      'Page was inserted too shallow or skewed so pickup failed.',
      'Paper guides are too loose to grip the sheet.',
    ],
    steps: [
      'Insert at least one clean, flat sheet fully into the feeder tray.',
      'Align both paper guides to the paper width so the sheet stays centered.',
      'Try again with one sheet first to confirm feeding works before loading more.',
    ],
  },
  multi_feed: {
    causes: [
      'Two or more sheets were pulled at the same time.',
      'Paper stack is curled, damp, or static-clinged together.',
      'Pages entered the feeder at an angle.',
    ],
    steps: [
      'Remove the stack, fan and straighten pages, then reload a smaller stack.',
      'Use dry, flat paper and remove folded or wrinkled sheets.',
      'Keep paper guides snug and rescan to verify smooth single-sheet feeding.',
    ],
  },
  busy: {
    causes: [
      'Scanner is still finishing a previous job.',
      'Another request is currently using the scanner.',
      'The scanner service is recovering from a recent interruption.',
    ],
    steps: [
      'Wait a few seconds for the scanner to become idle.',
      'Press Rescan once and avoid repeated rapid taps.',
      'If it stays busy, return Home and retry one scan job at a time.',
    ],
  },
  connection: {
    causes: [
      'Scanner USB/cable connection is loose or temporarily unavailable.',
      'Scanner is powered off or still booting.',
      'Scanner driver/service is unavailable on the kiosk.',
    ],
    steps: [
      'Check that the scanner is powered on and fully ready.',
      'Reseat the scanner cable and ensure it is securely connected.',
      'Retry the scan; if the issue persists, ask staff to check scanner connection and service.',
    ],
  },
  unknown: {
    causes: [
      'The feeder could not complete the scan request.',
      'Document loading or alignment may have interrupted scanning.',
      'Scanner may have hit a temporary runtime issue.',
    ],
    steps: [
      'Remove and reinsert the page straight into the feeder with guides aligned.',
      'Check for jammed, folded, or damaged sheets and retry with a clean page.',
      'If it still fails, power-cycle the scanner and retry or ask staff for assistance.',
    ],
  },
};

function sanitizeUserFacingError(rawMessage: string): string {
  const fallback = 'Scan failed. Please check the feeder and try again.';
  const initial = rawMessage.trim();
  if (!initial) return fallback;

  let safeMessage = initial
    .replace(/epson\s*l5290\s*series/gi, 'scanner')
    .replace(/naps2(?:\.console\.exe)?/gi, 'scanner service')
    .replace(/\btwain\b/gi, 'scanner driver')
    .replace(/\bwia\b/gi, 'scanner driver')
    .replace(/[A-Z]:\\[^ ]+/g, 'scanner service path')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!safeMessage) return fallback;
  return safeMessage;
}

function classifyScanFailure(rawMessage: string): ScanFailureCause {
  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes('paper jam') ||
    normalized.includes('jam') ||
    normalized.includes('stuck')
  ) {
    return 'paper_jam';
  }

  if (
    normalized.includes('multi-feed') ||
    normalized.includes('multifeed') ||
    normalized.includes('double feed') ||
    normalized.includes('misfeed') ||
    normalized.includes('skew')
  ) {
    return 'multi_feed';
  }

  if (
    normalized.includes('no document') ||
    normalized.includes('no pages') ||
    normalized.includes('empty feeder') ||
    normalized.includes('insert document') ||
    normalized.includes('load paper')
  ) {
    return 'empty_feeder';
  }

  if (
    normalized.includes('busy') ||
    normalized.includes('in use') ||
    normalized.includes('another scan') ||
    normalized.includes('already scanning')
  ) {
    return 'busy';
  }

  if (
    normalized.includes('no scanner') ||
    normalized.includes('not connected') ||
    normalized.includes('unavailable') ||
    normalized.includes('connection') ||
    normalized.includes('usb') ||
    normalized.includes('driver') ||
    normalized.includes('cannot communicate') ||
    normalized.includes('offline')
  ) {
    return 'connection';
  }

  return 'unknown';
}

function replaceListItems(
  listEl: HTMLUListElement | HTMLOListElement | null,
  items: string[],
): void {
  if (!listEl) return;
  listEl.replaceChildren();
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    listEl.appendChild(li);
  }
}

function hideScanTroubleshooting(): void {
  if (scanTroubleshootingPanel) scanTroubleshootingPanel.style.display = 'none';
  if (previewTroubleshooting) {
    previewTroubleshooting.classList.add('hidden');
    if (previewTroubleshootSummary) previewTroubleshootSummary.textContent = '';
    replaceListItems(previewTroubleshootCauses, []);
    replaceListItems(previewTroubleshootSteps, []);
  }
}

function showScanTroubleshooting(rawMessage: string): string {
  const safeMessage = sanitizeUserFacingError(rawMessage);
  const cause = classifyScanFailure(rawMessage);
  const guide = SCAN_FAILURE_GUIDES[cause];

  if (scanTroubleshootSummary) {
    scanTroubleshootSummary.textContent = safeMessage;
  }
  replaceListItems(scanTroubleshootCauses, guide.causes);
  replaceListItems(scanTroubleshootSteps, guide.steps);
  if (scanTroubleshootingPanel) scanTroubleshootingPanel.style.display = '';

  // Preview-area troubleshooting
  if (previewTroubleshootSummary) {
    previewTroubleshootSummary.textContent = safeMessage;
  }
  replaceListItems(previewTroubleshootCauses, guide.causes);
  replaceListItems(previewTroubleshootSteps, guide.steps);
  if (previewTroubleshooting) previewTroubleshooting.classList.remove('hidden');

  if (errorSubtext) {
    errorSubtext.textContent = guide.steps && guide.steps.length > 0 ? guide.steps[0] : safeMessage;
  }

  return safeMessage;
}

function setBackNavigationLocked(locked: boolean): void {
  if (!backBtn) return;
  if (locked) {
    backBtn.classList.add('back-btn--disabled');
    backBtn.setAttribute('aria-disabled', 'true');
    backBtn.setAttribute('tabindex', '-1');
    return;
  }

  backBtn.classList.remove('back-btn--disabled');
  backBtn.removeAttribute('aria-disabled');
  backBtn.removeAttribute('tabindex');
}

backBtn?.addEventListener('click', (event) => {
  if (backBtn.getAttribute('aria-disabled') === 'true') {
    event.preventDefault();
    event.stopPropagation();
  }
});

async function releaseScanFile(releaseToken: string, reason: string): Promise<void> {
  const safeReleaseToken = releaseToken.trim();
  if (!safeReleaseToken) return;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), RELEASE_TIMEOUT_MS);
  try {
    const response = await fetch('/api/scanner/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        releaseToken: safeReleaseToken,
        reason,
      }),
    });
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const payload = (await response.json()) as { error?: string };
        if (payload.error && payload.error.trim()) {
          detail = payload.error.trim();
        }
      } catch {
        // Non-JSON response; keep status detail.
      }
      throw new Error(detail);
    }
  } catch {
    // Best-effort cleanup.
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function showPreview(
  name: 'idle' | 'scanning' | 'result' | 'error',
  hint?: string,
): void {
  for (const [key, el] of Object.entries(PREVIEW_STATES)) {
    el.classList.toggle('hidden', key !== name);
  }
  if (hint !== undefined) previewHint.textContent = hint;
}

function goToPage(n: number): void {
  n = Math.max(0, Math.min(scannedPages.length - 1, n));
  currentPage = n;
  scannedImage.src = scannedPages[n];
  scannedImage.removeAttribute('data-gray');

  const total = scannedPages.length;
  pagerLabel.textContent = `${n + 1} / ${total}`;
  pagePrev.disabled = n <= 0;
  pageNext.disabled = n >= total - 1;
  pageCountText.textContent = `${total} page${total !== 1 ? 's' : ''}`;
}

function updatePager(): void {
  const multi = scannedPages.length > 1;
  previewControls.style.display = multi ? 'flex' : 'none';
  pageCountBadge.style.display = multi ? 'inline-flex' : 'none';
  if (scannedPages.length > 0) goToPage(currentPage);
}

function formatPeso(value: number): string {
  return `₱${value}`;
}

function updateSoftCopyPricingUi(): void {
  proceedBtnLabel.textContent = `Proceed to Pay (${formatPeso(scanDocumentPrice)})`;
  softCopyFeeText.textContent = `A soft copy fee of ${formatPeso(scanDocumentPrice)} applies. Pay on the next screen to get your download QR code.`;
}

async function loadPricing(): Promise<void> {
  try {
    const response = await fetch('/api/pricing');
    if (!response.ok) throw new Error('Failed to load pricing information.');

    const payload = (await response.json()) as Partial<PricingResponse>;
    if (
      typeof payload.scanDocument === 'number' &&
      Number.isFinite(payload.scanDocument)
    ) {
      scanDocumentPrice = payload.scanDocument;
    }
  } catch {
    scanDocumentPrice = 5;
  } finally {
    updateSoftCopyPricingUi();
  }
}

async function restoreScanPreviewFromSession(): Promise<boolean> {
  const rawConfig = sessionStorage.getItem('printbit.config');
  if (!rawConfig) return false;

  let storedConfig: StoredScanConfig;
  try {
    storedConfig = JSON.parse(rawConfig) as StoredScanConfig;
  } catch {
    return false;
  }

  if (storedConfig.mode !== 'scan') return false;
  const restoredFilename =
    typeof storedConfig.scanFilename === 'string'
      ? storedConfig.scanFilename.trim()
      : '';
  if (!restoredFilename) return false;

  const previewUrl = `/api/scan/preview/${encodeURIComponent(restoredFilename)}`;

  try {
    const response = await fetch(previewUrl, { cache: 'no-store' });
    if (!response.ok) {
      if (response.status === 404) {
        sessionStorage.removeItem('printbit.config');
      }
      return false;
    }
  } catch {
    return false;
  }

  scannedPages = [previewUrl];
  scanFilename = restoredFilename;
  scanReleaseToken =
    typeof storedConfig.scanReleaseToken === 'string' &&
    storedConfig.scanReleaseToken.trim().length > 0
      ? storedConfig.scanReleaseToken.trim()
      : null;
  currentPage = 0;

  showPreview('result', 'Restored your scanned document preview.');
  hideScanTroubleshooting();
  updatePager();
  updateSoftCopyPricingUi();
  rescanBtn.style.display = 'flex';
  proceedBtn.style.display = 'flex';
  proceedBtn.disabled = false;
  proceedBtn.setAttribute('aria-disabled', 'false');
  scanBtn.disabled = false;
  scanBtn.setAttribute('aria-disabled', 'false');

  return true;
}

async function startScan(): Promise<void> {
  const previousPages = scannedPages.slice();
  const previousPage = currentPage;
  const previousFilename = scanFilename;
  const previousReleaseToken = scanReleaseToken;
  const hasPreviousPreview = previousPages.length > 0 && Boolean(previousFilename);

  setBackNavigationLocked(true);
  hideScanTroubleshooting();
  showPreview('scanning', 'Scanning your document…');
  scanBtn.disabled = true;
  scanBtn.setAttribute('aria-disabled', 'true');
  rescanBtn.style.display = 'none';
  proceedBtn.style.display = 'none';
  scanProgress.textContent = 'Feeding document…';

  const progressMessages = [
    'Feeding document…',
    'Scanning page…',
    'Processing image',
    'Finalising…',
  ];
  let progIdx = 0;
  const progTimer = window.setInterval(() => {
    progIdx = Math.min(progIdx + 1, progressMessages.length - 1);
    scanProgress.textContent = progressMessages[progIdx];
  }, 1200);

  try {
    const res = await fetch('/api/scanner/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: SCAN_SOURCE,
        color: SCAN_COLOR,
        dpi: SCAN_DPI,
      }),
    });

    clearInterval(progTimer);

    const data = (await res.json()) as ScanResponse & { error?: string };
    if (!res.ok) {
      throw new Error(data.error ?? 'Scan failed');
    }

    if (
      !data.pages ||
      data.pages.length === 0 ||
      !data.filename ||
      !data.releaseToken
    ) {
      throw new Error('No pages returned from scanner');
    }

    scannedPages = data.pages;
    scanFilename = data.filename;
    scanReleaseToken = data.releaseToken;
    currentPage = 0;

    if (
      previousReleaseToken &&
      previousReleaseToken !== data.releaseToken
    ) {
      void releaseScanFile(previousReleaseToken, 'scan_replaced_by_new_scan');
    }

    showPreview('result', `Page 1 of ${data.pages.length}`);
    updatePager();
    updateSoftCopyPricingUi();

    rescanBtn.style.display = 'flex';
    proceedBtn.style.display = 'flex';
    proceedBtn.disabled = false;
    proceedBtn.setAttribute('aria-disabled', 'false');
    scanBtnLabel.textContent = 'Scan Document';
  } catch (err) {
    clearInterval(progTimer);
    const rawMessage = err instanceof Error ? err.message : 'Scan failed';
    const safeMessage = showScanTroubleshooting(rawMessage);

    if (hasPreviousPreview) {
      scannedPages = previousPages;
      scanFilename = previousFilename;
      scanReleaseToken = previousReleaseToken;
      currentPage = Math.max(
        0,
        Math.min(previousPage, previousPages.length - 1),
      );

      showPreview(
        'result',
        `Previous scan kept. New scan failed: ${safeMessage}`,
      );
      updatePager();
      updateSoftCopyPricingUi();
      rescanBtn.style.display = 'flex';
      proceedBtn.style.display = 'flex';
      proceedBtn.disabled = false;
      proceedBtn.setAttribute('aria-disabled', 'false');
      scanBtn.disabled = false;
      scanBtn.setAttribute('aria-disabled', 'false');
      return;
    }

    errorText.textContent = safeMessage;
    showPreview('error', safeMessage);
    scanBtn.disabled = false;
    scanBtn.setAttribute('aria-disabled', 'false');
    rescanBtn.style.display = 'none';
  } finally {
    setBackNavigationLocked(false);
  }
}

function resetToIdle(): void {
  if (scanReleaseToken) {
    void releaseScanFile(scanReleaseToken, 'scan_reset_to_idle');
    scanReleaseToken = null;
  }
  scannedPages = [];
  scanFilename = null;
  currentPage = 0;

  showPreview('idle', 'Insert document into the feeder and press Scan');
  hideScanTroubleshooting();
  previewControls.style.display = 'none';
  pageCountBadge.style.display = 'none';
  rescanBtn.style.display = 'none';
  proceedBtn.style.display = 'none';
  proceedBtn.disabled = true;

  scanBtn.disabled = false;
  scanBtn.setAttribute('aria-disabled', 'false');
  scanBtnLabel.textContent = 'Scan Document';
}

pagePrev.addEventListener('click', () => goToPage(currentPage - 1));
pageNext.addEventListener('click', () => goToPage(currentPage + 1));

scanBtn.addEventListener('click', () => {
  if (!scanBtn.disabled) void startScan();
});

rescanBtn.addEventListener('click', () => {
  if (!scanBtn.disabled) void startScan();
});

proceedBtn.addEventListener('click', () => {
  if (!scannedPages.length || !scanFilename) return;

  sessionStorage.setItem(
    'printbit.config',
    JSON.stringify({
      mode: 'scan',
      scanFilename,
      scanReleaseToken,
      sessionId: null,
      colorMode: 'colored',
      copies: 1,
      orientation: 'portrait',
      paperSize: 'A4',
      rotationDeg: 0,
    }),
  );
  sessionStorage.setItem('printbit.mode', 'scan');
  window.location.href = '/confirm';
});

async function initializeScanPage(): Promise<void> {
  await loadPricing();
  const restored = await restoreScanPreviewFromSession();
  if (restored) return;

  hideScanTroubleshooting();
  showPreview('idle', 'Insert document into the feeder and press Scan');
  scanBtn.disabled = false;
  scanBtn.setAttribute('aria-disabled', 'false');
}

void initializeScanPage();
