import {
  initializePageIdleTimeout,
  setupPageIdleWarningButton,
} from '@/services/idle-timeout';
import { initKioskLocalization } from '../shared/kiosk-i18n';
import {
  extractPrintError,
  getPrintErrorHintKey,
  getPrintErrorMessageKey,
  getPrintErrorTitleKey,
  type PrintErrorPayload,
  type PublicPrintError,
} from '../shared/print-error-ui';

export {};

void initKioskLocalization();

type SocketLike = {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
};

// ── Idle Timeout with Warning Modal (Copy Page) ───────────────────────────────────────────────

// Initialize page idle timeout on load with warning modal
void setupPageIdleWarningButton();
void initializePageIdleTimeout({
  showWarningModal: true,
  onTimeout: () => {
    console.log('[PAGE IDLE] Copy page timeout reached, redirecting to home');
    if (previewReleaseToken) {
      void releaseCopyPreviewFile(previewReleaseToken, 'copy_idle_timeout');
      previewReleaseToken = null;
    }
    // Clear state before redirect
    sessionStorage.removeItem('printbit.config');
    sessionStorage.removeItem('printbit.sessionId');
    sessionStorage.removeItem('printbit.copyPreviewPath');
    sessionStorage.removeItem('printbit.copyPreviewReleaseToken');
    window.location.replace('/');
  },
});

type PdfjsLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: string | ArrayBuffer | { data: ArrayBuffer }) => {
    promise: Promise<PDFDocumentProxy>;
  };
};

interface PDFDocumentProxy {
  numPages: number;
  getPage: (n: number) => Promise<PDFPageProxy>;
  destroy: () => void;
}

interface PDFPageProxy {
  getViewport: (opts: { scale: number }) => PDFViewport;
  render: (ctx: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PDFViewport;
  }) => { promise: Promise<void> };
}

interface PDFViewport {
  width: number;
  height: number;
}

type CopyFailureCause =
  | 'no_document'
  | 'placement'
  | 'dirty_glass'
  | 'busy'
  | 'connection'
  | 'unknown';

const continueBtn = document.getElementById(
  'continueBtn',
) as HTMLButtonElement | null;
const checkDocBtn = document.getElementById(
  'checkDocBtn',
) as HTMLButtonElement | null;
const scanOverlay = document.getElementById(
  'scanOverlay',
) as HTMLElement | null;
const errorBanner = document.getElementById(
  'errorBanner',
) as HTMLElement | null;
const errorText = document.getElementById('errorText') as HTMLElement | null;
const retryBtn = document.getElementById(
  'retryBtn',
) as HTMLButtonElement | null;
const previewSection = document.getElementById(
  'previewSection',
) as HTMLElement | null;
const coverageMeter = document.getElementById(
  'coverageMeter',
) as HTMLElement | null;
const coverageValue = document.getElementById(
  'coverageValue',
) as HTMLElement | null;
const coverageBar = document.getElementById(
  'coverageBar',
) as HTMLElement | null;
const tierBadge = document.getElementById('tierBadge') as HTMLElement | null;
const printerErrorOverlay = document.getElementById(
  'printerErrorOverlay',
) as HTMLElement | null;
const printerErrorCard = document.getElementById(
  'printerErrorCard',
) as HTMLElement | null;
const printerErrorTitle = document.getElementById(
  'printerErrorTitle',
) as HTMLElement | null;
const printerErrorMessage = document.getElementById(
  'printerErrorMessage',
) as HTMLElement | null;
const printerErrorHint = document.getElementById(
  'printerErrorHint',
) as HTMLElement | null;
const printerErrorDismissBtn = document.getElementById(
  'printerErrorDismissBtn',
) as HTMLButtonElement | null;

async function updateCoverageAnalysis(filename: string): Promise<void> {
  if (!coverageMeter) return;

  try {
    const res = await fetch(
      `/api/scan/color-analysis/${encodeURIComponent(filename)}`,
    );
    if (!res.ok) throw new Error('Analysis failed');

    const analysis = (await res.json()) as {
      hasColor: boolean;
      isGrayscale: boolean;
      coverage?: number;
      classification?: string;
    };

    if (typeof analysis.coverage === 'number') {
      const percent = Math.round(analysis.coverage * 100);
      coverageMeter.style.display = 'block';
      if (coverageValue) coverageValue.textContent = `${percent}%`;
      if (coverageBar) coverageBar.style.width = `${percent}%`;

      if (tierBadge) {
        if (analysis.classification === 'bw' || !analysis.hasColor) {
          tierBadge.textContent = 'B&W Rate';
          tierBadge.style.color = '#94a3b8';
        } else if (analysis.classification === 'full_color') {
          tierBadge.textContent = 'Full Color Rate';
          tierBadge.style.color = '#f472b6';
        } else {
          const decile = Math.min(10, Math.floor(analysis.coverage * 10) + 1);
          tierBadge.textContent = `Economy Tier ${decile}`;
          tierBadge.style.color = '#818cf8';
        }
      }
    }
  } catch (error) {
    console.warn('[COPY] Could not get color analysis:', error);
    if (coverageMeter) coverageMeter.style.display = 'none';
  }
}
const previewPaper = document.getElementById(
  'previewPaper',
) as HTMLElement | null;
const previewCanvas = document.getElementById(
  'previewCanvas',
) as HTMLCanvasElement | null;
const previewImageStage = document.getElementById(
  'previewImageStage',
) as HTMLElement | null;
const previewImage = document.getElementById(
  'previewImage',
) as HTMLImageElement | null;
const previewPlaceholder = document.getElementById(
  'previewPlaceholder',
) as HTMLElement | null;
const previewStatusText = document.getElementById(
  'previewStatusText',
) as HTMLElement | null;
const copyTroubleshootingPanel = document.getElementById(
  'copyTroubleshootingPanel',
) as HTMLElement | null;
const copyTroubleshootSummary = document.getElementById(
  'copyTroubleshootSummary',
) as HTMLElement | null;
const copyTroubleshootCauses = document.getElementById(
  'copyTroubleshootCauses',
) as HTMLUListElement | null;
const copyTroubleshootSteps = document.getElementById(
  'copyTroubleshootSteps',
) as HTMLOListElement | null;
const backBtn = document.querySelector<HTMLAnchorElement>('a.back-btn');

let previewPath: string | null = null;
let previewReleaseToken: string | null = null;
let previewObjectUrl: string | null = null;
const RELEASE_TIMEOUT_MS = 1_500;

const COPY_FAILURE_GUIDES: Record<
  CopyFailureCause,
  { causes: string[]; steps: string[] }
> = {
  no_document: {
    causes: [
      'No page is currently on the scanner glass.',
      'Page is face-up instead of face-down on the glass.',
      'Only part of the page is inside the scan area.',
    ],
    steps: [
      'Place one page face-down on the scanner glass.',
      'Align the page with the corner marks so the whole page is inside the frame.',
      'Close the scanner cover gently, then tap Check Document again.',
    ],
  },
  placement: {
    causes: [
      'Page is tilted so edges are outside the scan area.',
      'Paper shifted while the scanner started reading.',
      'Document is smaller/larger than expected and not centered.',
    ],
    steps: [
      'Reposition the page flat and straight on the glass.',
      'Keep page corners inside the scanner frame markings.',
      'Hold the cover steady while starting Check Document.',
    ],
  },
  dirty_glass: {
    causes: [
      'Dust, smudges, or streaks are on the scanner glass.',
      'Dirt on the white backing causes false detection issues.',
      'Previous paper debris left marks in the scan area.',
    ],
    steps: [
      'Open the lid and clean the scanner glass with a soft, dry microfiber cloth.',
      'If needed, lightly dampen cloth with glass cleaner (do not spray directly on scanner).',
      'Dry completely, place the document again, and retry.',
    ],
  },
  busy: {
    causes: [
      'Scanner is still finishing a previous scan request.',
      'Another process is using the scanner right now.',
      'Scanner service is temporarily busy.',
    ],
    steps: [
      'Wait a few seconds, then tap Retry once.',
      'Avoid tapping Check Document repeatedly in quick succession.',
      'If it remains busy, go back and try the copy flow again.',
    ],
  },
  connection: {
    causes: [
      'Scanner connection is unstable or unavailable.',
      'Scanner is powered off or not ready.',
      'Scanner driver/service is unavailable on the kiosk.',
    ],
    steps: [
      'Confirm scanner power is on and the scanner is ready.',
      'Check scanner cable connections are firmly seated.',
      'Retry; if still failing, ask staff to check scanner connection and service.',
    ],
  },
  unknown: {
    causes: [
      'Scanner could not complete document detection.',
      'Page placement or scanner readiness may have interrupted detection.',
      'Temporary scanner runtime issue occurred.',
    ],
    steps: [
      'Remove and place the page face-down again, flat on the glass.',
      'Check the glass is clean and close the lid before retrying.',
      'If it still fails, restart scan flow or ask staff for assistance.',
    ],
  },
};

const SOCKET_DISCONNECTED_ERROR: PublicPrintError = {
  code: 'SOCKET_DISCONNECTED',
  severity: 'RECOVERABLE',
  userMessage: 'print.error.socket_disconnected',
};

let activePrinterError: PublicPrintError | null = null;
let connectionLost = false;
let lockedActionState: {
  checkDocDisabled: boolean;
  retryDisabled: boolean;
  continueDisabled: boolean;
} | null = null;

function setAriaDisabled(
  el: HTMLButtonElement | null,
  disabled: boolean,
): void {
  if (!el) return;
  el.disabled = disabled;
  el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
}

function lockCopyActions(): void {
  if (lockedActionState) return;
  lockedActionState = {
    checkDocDisabled: checkDocBtn?.disabled ?? false,
    retryDisabled: retryBtn?.disabled ?? false,
    continueDisabled: continueBtn?.disabled ?? false,
  };
  setAriaDisabled(checkDocBtn, true);
  setAriaDisabled(retryBtn, true);
  setAriaDisabled(continueBtn, true);
}

function unlockCopyActions(): void {
  if (!lockedActionState) return;
  setAriaDisabled(checkDocBtn, lockedActionState.checkDocDisabled);
  setAriaDisabled(retryBtn, lockedActionState.retryDisabled);
  setAriaDisabled(continueBtn, lockedActionState.continueDisabled);
  lockedActionState = null;
}

function resolvePrinterOverlayError(): PublicPrintError | null {
  if (connectionLost) return SOCKET_DISCONNECTED_ERROR;
  return activePrinterError;
}

function renderPrinterErrorOverlay(): void {
  if (!printerErrorOverlay || !printerErrorCard) return;
  const error = resolvePrinterOverlayError();
  if (!error) {
    printerErrorOverlay.hidden = true;
    printerErrorCard.removeAttribute('data-severity');
    unlockCopyActions();
    return;
  }

  const titleKey = getPrintErrorTitleKey(error.severity);
  const messageKey = getPrintErrorMessageKey(error);
  const hintKey = getPrintErrorHintKey(error);

  if (printerErrorTitle) printerErrorTitle.textContent = titleKey;
  if (printerErrorMessage) printerErrorMessage.textContent = messageKey;
  if (printerErrorHint) {
    if (hintKey) {
      printerErrorHint.textContent = hintKey;
      printerErrorHint.removeAttribute('hidden');
    } else {
      printerErrorHint.textContent = '';
      printerErrorHint.setAttribute('hidden', '');
    }
  }

  printerErrorOverlay.hidden = false;
  printerErrorCard.setAttribute('data-severity', error.severity);
  lockCopyActions();

  if (printerErrorDismissBtn) {
    if (error.severity === 'WARNING' && !connectionLost) {
      printerErrorDismissBtn.removeAttribute('hidden');
    } else {
      printerErrorDismissBtn.setAttribute('hidden', '');
    }
  }
}

function handlePrintErrorPayload(payload: unknown): void {
  const error = extractPrintError(payload as PrintErrorPayload);
  if (!error) return;
  activePrinterError = error;
  renderPrinterErrorOverlay();
}

function sanitizeUserFacingError(rawMessage: string): string {
  const fallback = 'Could not complete scanner check. Please try again.';
  const initial = rawMessage.trim();
  if (!initial) return fallback;

  const safeMessage = initial
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

function classifyCopyFailure(rawMessage: string): CopyFailureCause {
  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes('no document') ||
    normalized.includes('no pages') ||
    normalized.includes('not detected')
  ) {
    return 'no_document';
  }

  if (
    normalized.includes('align') ||
    normalized.includes('alignment') ||
    normalized.includes('skew') ||
    normalized.includes('crop') ||
    normalized.includes('position')
  ) {
    return 'placement';
  }

  if (
    normalized.includes('dirty') ||
    normalized.includes('smudge') ||
    normalized.includes('streak') ||
    normalized.includes('dust') ||
    normalized.includes('glass')
  ) {
    return 'dirty_glass';
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

function hideCopyTroubleshooting(): void {
  if (copyTroubleshootingPanel) copyTroubleshootingPanel.style.display = 'none';
}

function showCopyTroubleshooting(rawMessage: string): string {
  const safeMessage = sanitizeUserFacingError(rawMessage);
  const cause = classifyCopyFailure(rawMessage);
  const guide = COPY_FAILURE_GUIDES[cause];

  if (copyTroubleshootSummary) {
    copyTroubleshootSummary.textContent = safeMessage;
  }
  replaceListItems(copyTroubleshootCauses, guide.causes);
  replaceListItems(copyTroubleshootSteps, guide.steps);
  if (copyTroubleshootingPanel) copyTroubleshootingPanel.style.display = '';
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

async function releaseCopyPreviewFile(
  releaseToken: string,
  reason: string,
): Promise<void> {
  const safeReleaseToken = releaseToken.trim();
  if (!safeReleaseToken) return;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    RELEASE_TIMEOUT_MS,
  );
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

function clearPreviewImageUrl(): void {
  if (!previewObjectUrl) return;
  URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = null;
}

function showOverlay(show: boolean): void {
  if (!scanOverlay) return;
  if (show) {
    scanOverlay.classList.add('is-visible');
    scanOverlay.setAttribute('aria-hidden', 'false');
  } else {
    scanOverlay.classList.remove('is-visible');
    scanOverlay.setAttribute('aria-hidden', 'true');
  }
}

function resetPreviewSurfaces(): void {
  if (previewCanvas) {
    previewCanvas.style.display = 'none';
    const ctx = previewCanvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  }
  if (previewImageStage) previewImageStage.style.display = 'none';
  if (previewImage) {
    previewImage.style.display = 'none';
    previewImage.removeAttribute('src');
  }
  clearPreviewImageUrl();
}

function showError(msg: string): void {
  const safeMessage = showCopyTroubleshooting(msg);
  if (errorBanner) errorBanner.style.display = '';
  if (errorText) errorText.textContent = safeMessage;
  if (checkDocBtn) checkDocBtn.style.display = '';
  if (previewSection) previewSection.style.display = 'none';
  if (previewPlaceholder) previewPlaceholder.style.display = '';
  if (continueBtn) {
    continueBtn.style.display = 'none';
    continueBtn.disabled = true;
  }
  resetPreviewSurfaces();
  if (previewStatusText) {
    previewStatusText.textContent = 'Waiting for scan';
    previewStatusText.removeAttribute('data-status');
  }
}

function hideError(): void {
  if (errorBanner) errorBanner.style.display = 'none';
  hideCopyTroubleshooting();
}

async function renderPdfPreview(buf: ArrayBuffer): Promise<void> {
  if (!previewCanvas) throw new Error('Preview canvas not found');

  const dynImport = new Function('u', 'return import(u)') as (
    u: string,
  ) => Promise<Record<string, unknown>>;
  const mod = await dynImport('/libs/pdfjs/pdf.min.mjs');
  const pdfjs = (mod.default ?? mod) as PdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = `${window.location.origin}/libs/pdfjs/pdf.worker.min.mjs`;

  const pdfDoc = await pdfjs.getDocument({ data: buf }).promise;
  try {
    const firstPage = await pdfDoc.getPage(1);
    const baseViewport = firstPage.getViewport({ scale: 1 });

    const paperWidth = Math.max((previewPaper?.clientWidth ?? 840) - 24, 240);
    const paperHeight = Math.max(
      (previewPaper?.clientHeight ?? 1188) - 24,
      320,
    );
    const dpr = window.devicePixelRatio || 1;
    const scale =
      Math.min(
        paperWidth / baseViewport.width,
        paperHeight / baseViewport.height,
      ) * dpr;
    const viewport = firstPage.getViewport({ scale });

    previewCanvas.width = Math.floor(viewport.width);
    previewCanvas.height = Math.floor(viewport.height);

    const ctx = previewCanvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');

    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    await firstPage.render({ canvasContext: ctx, viewport }).promise;

    if (previewImageStage) previewImageStage.style.display = 'none';
    previewCanvas.style.display = 'block';
  } finally {
    pdfDoc.destroy();
  }
}

async function renderImagePreview(blob: Blob): Promise<void> {
  if (!previewImage || !previewImageStage) {
    throw new Error('Preview image element not found');
  }

  clearPreviewImageUrl();
  previewObjectUrl = URL.createObjectURL(blob);

  await new Promise<void>((resolve, reject) => {
    previewImage.onload = () => resolve();
    previewImage.onerror = () => reject(new Error('Image preview failed'));
    previewImage.src = previewObjectUrl!;
  });

  if (previewCanvas) previewCanvas.style.display = 'none';
  previewImageStage.style.display = 'grid';
  previewImage.style.display = 'block';
}

async function loadPreviewContent(filename: string): Promise<void> {
  const response = await fetch(
    `/api/scan/preview/${encodeURIComponent(filename)}`,
  );
  if (!response.ok) {
    throw new Error(`Preview request failed (${response.status})`);
  }

  const contentType = (
    response.headers.get('Content-Type') ?? ''
  ).toLowerCase();

  if (contentType.includes('application/pdf')) {
    const buf = await response.arrayBuffer();
    await renderPdfPreview(buf);
    return;
  }

  if (contentType.startsWith('image/')) {
    const blob = await response.blob();
    await renderImagePreview(blob);
    return;
  }

  throw new Error(`Unsupported preview format: ${contentType || 'unknown'}`);
}

async function showPreview(filename: string): Promise<void> {
  hideError();
  if (previewPlaceholder) previewPlaceholder.style.display = 'none';
  if (previewSection) previewSection.style.display = '';
  if (previewStatusText) {
    previewStatusText.textContent = 'Loading preview…';
    previewStatusText.setAttribute('data-status', 'loading');
  }
  resetPreviewSurfaces();

  try {
    await loadPreviewContent(filename);
  } catch (error) {
    console.error('[COPY PREVIEW] Failed to render preview.', error);
    showError('Could not render scanned preview. Please retry.');
    return;
  }

  if (continueBtn) {
    continueBtn.style.display = '';
    continueBtn.disabled = false;
  }
  if (checkDocBtn) checkDocBtn.style.display = 'none';
  if (previewStatusText) {
    previewStatusText.textContent = 'Ready to copy';
    previewStatusText.setAttribute('data-status', 'ready');
  }
  void updateCoverageAnalysis(filename);
}

async function checkForDocument(): Promise<void> {
  hideError();
  setBackNavigationLocked(true);
  showOverlay(true);
  if (checkDocBtn) checkDocBtn.disabled = true;

  try {
    const res = await fetch('/api/scan/preview', { method: 'POST' });
    const data = (await res.json()) as {
      detected: boolean;
      previewPath?: string;
      releaseToken?: string;
      error?: string;
    };

    showOverlay(false);

    if (data.detected && data.previewPath && data.releaseToken) {
      if (previewReleaseToken && previewReleaseToken !== data.releaseToken) {
        void releaseCopyPreviewFile(
          previewReleaseToken,
          'copy_preview_replaced',
        );
      }
      previewPath = data.previewPath;
      previewReleaseToken = data.releaseToken;

      sessionStorage.setItem('printbit.copyPreviewPath', previewPath);
      sessionStorage.setItem(
        'printbit.copyPreviewReleaseToken',
        previewReleaseToken,
      );

      await showPreview(data.previewPath);
    } else {
      showError(
        data.error ??
          'No document detected. Place your document face-down on the scanner glass and try again.',
      );
    }
  } catch {
    showOverlay(false);
    showError('Could not reach the scanner. Please try again.');
  } finally {
    setBackNavigationLocked(false);
    if (checkDocBtn) checkDocBtn.disabled = false;
  }
}

checkDocBtn?.addEventListener('click', () => void checkForDocument());
retryBtn?.addEventListener('click', () => void checkForDocument());

continueBtn?.addEventListener('click', () => {
  sessionStorage.setItem('printbit.mode', 'copy');
  sessionStorage.removeItem('printbit.sessionId');
  sessionStorage.removeItem('printbit.uploadedFile');
  if (previewPath) {
    sessionStorage.setItem('printbit.copyPreviewPath', previewPath);
  }
  if (previewReleaseToken) {
    sessionStorage.setItem(
      'printbit.copyPreviewReleaseToken',
      previewReleaseToken,
    );
  } else {
    sessionStorage.removeItem('printbit.copyPreviewReleaseToken');
  }
  window.location.href = '/config?mode=copy';
});

window.addEventListener('beforeunload', clearPreviewImageUrl);

printerErrorDismissBtn?.addEventListener('click', () => {
  activePrinterError = null;
  renderPrinterErrorOverlay();
});

function setupSocketEvents(): void {
  const ioFactory = (window as any).io;
  if (typeof ioFactory !== 'function') return;
  const connectedSocket = ioFactory() as SocketLike;

  connectedSocket.on('connect', () => {
    connectionLost = false;
    renderPrinterErrorOverlay();
  });

  connectedSocket.on('disconnect', () => {
    connectionLost = true;
    renderPrinterErrorOverlay();
  });

  connectedSocket.on('printErrorRaised', handlePrintErrorPayload);
  connectedSocket.on('printerMalfunction', handlePrintErrorPayload);
  connectedSocket.on('printerSpoolerFailure', handlePrintErrorPayload);
  connectedSocket.on('printerSpoolerTimeout', handlePrintErrorPayload);
}

async function initializeCopyPage(): Promise<void> {
  previewPath = sessionStorage.getItem('printbit.copyPreviewPath');
  previewReleaseToken = sessionStorage.getItem(
    'printbit.copyPreviewReleaseToken',
  );

  if (previewPath) {
    console.log('[COPY] Restoring preview from session:', previewPath);
    await showPreview(previewPath);
  }
}

void initializeCopyPage();
setupSocketEvents();
