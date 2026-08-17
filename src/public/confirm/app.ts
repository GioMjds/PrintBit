import QRCode from 'qrcode';
import {
  initializePageIdleTimeout,
  setupPageIdleWarningButton,
} from '@/services/idle-timeout';
import { initKioskLocalization } from '../shared/kiosk-i18n';

export {};

void initKioskLocalization();

// Initialize page idle timeout on load with warning modal
void setupPageIdleWarningButton();
void initializePageIdleTimeout({
  showWarningModal: true,
  onTimeout: async () => {
    console.log(
      '[PAGE IDLE] Confirm page timeout reached, redirecting to home',
    );
    await releaseTransientFilesForCurrentMode('confirm_idle_timeout');
    // Release the coin slot lock before leaving
    if (coinSlotIsLocked) {
      socket?.emit('unlockCoinSlot', { reason: 'timeout' });
    }
    const sessionId = sessionStorage.getItem('printbit.sessionId');
    const sessionToken = sessionStorage.getItem('printbit.sessionToken');
    if (sessionId && sessionToken) {
      try {
        await fetch(
          `/api/wireless/sessions/${encodeURIComponent(sessionId)}/cancel?token=${encodeURIComponent(sessionToken)}`,
          { method: 'DELETE' },
        );
      } catch {
        // Best-effort cleanup
      }
    }
    // Clear state before redirect
    sessionStorage.removeItem('printbit.config');
    sessionStorage.removeItem('printbit.copyPreviewPath');
    sessionStorage.removeItem('printbit.copyPreviewReleaseToken');
    sessionStorage.removeItem('printbit.sessionId');
    sessionStorage.removeItem('printbit.sessionToken');
    window.location.replace('/');
  },
});

type SocketLike = {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  emit: (event: string, ...args: unknown[]) => void;
};

let socket: SocketLike | null = null;

type PageRangeSelection =
  | { type: 'all' }
  | { type: 'custom'; range: string }
  | { type: 'single'; page: number };
type RotationDeg = 0 | 90 | 180 | 270;

type ConfirmConfig = {
  mode: 'print' | 'copy' | 'scan';
  sessionId: string | null;
  documentId?: string | null;
  scanFilename?: string;
  scanReleaseToken?: string | null;
  copyPreviewPath?: string | null;
  copyPreviewReleaseToken?: string | null;
  detectedColorMode?: 'colored' | 'grayscale' | null;
  colorMode: 'colored' | 'grayscale';
  copies: number;
  orientation: 'portrait' | 'landscape';
  rotationDeg?: number;
  paperSize: 'A4' | 'Letter' | 'Legal';
  pageRange?: PageRangeSelection;
  totalPages?: number;
  quote?: PrintQuote;
};

type PricingResponse = {
  scanDocument: number;
};

type ReceiptLinkPayload = {
  receipt?: {
    viewUrl?: string | null;
    url?: string | null;
    expiresAt?: string | null;
  };
  receiptViewUrl?: string | null;
  receiptExpiresAt?: string | null;
};

type PrintQuote = {
  requiredAmount: number;
  copies: number;
  duplex: boolean;
  pageRange: string | null;
  totalPages: number;
  selectedPages: number;
  selectedColorPages: number;
  selectedBwPages: number;
  billableColorPages: number;
  billableBwPages: number;
  requestedColorMode: 'colored' | 'grayscale';
  effectiveColorMode: 'colored' | 'grayscale';
  pricing: {
    printPerPage: number;
    colorSurcharge: number;
  };
  analysisConfidence: 'high' | 'medium' | 'low';
  billingPageDetection:
    | 'high-confidence-page-detection'
    | 'fallback-assumptions';
  analysisFallbackReasonFlags: string[];
};

type PrintErrorSeverity = 'warning' | 'recoverable' | 'fatal';

type PrintError = {
  code: string;
  severity: PrintErrorSeverity;
  userMessage: string;
  hint?: string;
  timestamp?: string;
  canRetry?: boolean;
  canDismiss?: boolean;
  /**
   * Correlation key of the spooler job this error refers to. Carried in
   * the printErrorRaised socket payload so the Pause/Resume buttons have a
   * fallback key when paymentSpoolerCorrelationKey is null.
   */
  spoolerCorrelationKey?: string | null;
};

type PrintLifecycleStatePayload = {
  mode: 'print' | 'copy' | 'scan';
  state: 'queued' | 'processing' | 'printed' | 'failed';
  printerName?: string | null;
  transactionId?: string | null;
  spoolerCorrelationKey?: string | null;
  spoolerJobId?: number | null;
  jobStatus?: string | null;
  pagesPrinted?: number;
  totalPages?: number;
  reason?: string | null;
  printError?: PrintError | null;
};

function normalizeRotationDeg(value: unknown): RotationDeg {
  if (value === 90 || value === 180 || value === 270) {
    return value;
  }
  return 0;
}

const modeValue = document.getElementById('modeValue');
const fileValue = document.getElementById('fileValue');
const colorValue = document.getElementById('colorValue');
const colorRow = document.getElementById('colorRow');
const copiesValue = document.getElementById('copiesValue');
const copiesRow = document.getElementById('copiesRow');
const pagesValue = document.getElementById('pagesValue');
const pagesRow = document.getElementById('pagesRow');

const orientationRow = document.getElementById('orientationRow');
const orientationValue = document.getElementById('orientationValue');
const rotationValue = document.getElementById('rotationValue');
const rotationRow = document.getElementById('rotationRow');
const paperSizeValue = document.getElementById('paperSizeValue');
const paperRow = document.getElementById('paperRow');
const priceValue = document.getElementById('priceValue');
const balanceValue = document.getElementById('balanceValue');
const changeValue = document.getElementById('changeValue');
const changeRow = document.getElementById('changeRow');
const statusMessage = document.getElementById('statusMessage');
const statusBadge = document.getElementById('statusBadge');
const coinInsertNote = document.getElementById('coinInsertNote');
const footerNote = document.getElementById('footerNote');
const confirmBtn = document.getElementById('confirmBtn') as HTMLButtonElement;

// Action column refs (spec: JS bridge)
const actionPriceValue = document.getElementById('actionPriceValue');
const actionCol = document.querySelector<HTMLElement>('.action-col');

// Printer Error Elements (Issue 124)
const printerErrorBlock = document.getElementById('printerErrorBlock');
const errorTitle = document.getElementById('errorTitle');
const errorMessage = document.getElementById('errorMessage');
const errorHint = document.getElementById('errorHint');
const errorCloseBtn = document.getElementById('errorCloseBtn') as HTMLButtonElement;
const errorActions = document.getElementById('errorActions');
const errorPauseBtn = document.getElementById('errorPauseBtn') as HTMLButtonElement;
const errorResumeBtn = document.getElementById('errorResumeBtn') as HTMLButtonElement;
const errorSeverityBadge = document.getElementById('errorSeverityBadge');
const errorSeverityText = document.getElementById('errorSeverityText');
const errorProgressEl = document.getElementById('errorProgress') as HTMLParagraphElement | null;
const errorCancelRemainingBtn = document.getElementById('errorCancelRemainingBtn') as HTMLButtonElement | null;

// Confirmation Modal Elements
const confirmModal = document.getElementById('confirmModal');
const modalCancelBtn = document.getElementById(
  'modalCancelBtn',
) as HTMLButtonElement;
const modalConfirmBtn = document.getElementById(
  'modalConfirmBtn',
) as HTMLButtonElement;
const modalFile = document.getElementById('modalFile');
const modalMode = document.getElementById('modalMode');
const modalColor = document.getElementById('modalColor');
const modalColorRow = document.getElementById('modalColorRow');
const modalCopies = document.getElementById('modalCopies');
const modalCopiesRow = document.getElementById('modalCopiesRow');
const modalPages = document.getElementById('modalPages');
const modalPagesRow = document.getElementById('modalPagesRow');
const modalOrientation = document.getElementById('modalOrientation');
const modalOrientationRow = document.getElementById('modalOrientationRow');
const modalRotation = document.getElementById('modalRotation');
const modalRotationRow = document.getElementById('modalRotationRow');
const modalPaper = document.getElementById('modalPaper');
const modalPaperRow = document.getElementById('modalPaperRow');
const modalPrice = document.getElementById('modalPrice');
const modalChangeRow = document.getElementById('modalChangeRow');
const modalChange = document.getElementById('modalChange');

// Printing In Progress Elements
const printingOverlay = document.getElementById('printingOverlay');
const printingSubtitle = document.getElementById('printingSubtitle');
const printingHint = document.getElementById('printingHint');
const printingProgressText = document.getElementById('printingProgressText');
const printingProgressCurrent = document.getElementById(
  'printingProgressCurrent',
);
const printingProgressTotal = document.getElementById(
  'printingProgressTotal',
);
const printingProgressBar = document.getElementById('printingProgressBar');
const printingProgressFill = document.getElementById(
  'printingProgressFill',
) as HTMLDivElement | null;

// Thank You Elements
const thankYouOverlay = document.getElementById('thankYouOverlay');
const thankYouDoneBtn = document.getElementById(
  'thankYouDoneBtn',
) as HTMLButtonElement;
const printAnotherBtn = document.getElementById(
  'printAnotherBtn',
) as HTMLButtonElement | null;
const transactionReference = document.getElementById(
  'transactionReference',
) as HTMLElement | null;
const receiptCtaContainer = document.getElementById(
  'receiptCtaContainer',
) as HTMLElement | null;
const receiptQrCanvas = document.getElementById(
  'receiptQrCanvas',
) as HTMLCanvasElement | null;
const receiptQrLink = document.getElementById(
  'receiptQrLink',
) as HTMLElement | null;

let currentPrinterError: PrintError | null = null;
let lastKnownPagesPrinted = 0;
let lastKnownTotalPages = 0;

function hasActiveJob(): boolean {
  return (
    isProcessingPayment ||
    activeSpoolerCorrelationKey !== null ||
    paymentSpoolerCorrelationKey !== null
  );
}

const DEFAULT_COIN_INSERT_GUIDANCE_MESSAGE =
  'Tip: Insert one coin at a time. Rapid insertion may not be detected by the kiosk.';
const COIN_INSERT_GUIDANCE_MESSAGE =
  coinInsertNote?.textContent?.trim() ||
  footerNote?.textContent?.trim() ||
  DEFAULT_COIN_INSERT_GUIDANCE_MESSAGE;

function renderPrinterError(err: PrintError): void {
  currentPrinterError = err;
  if (!printerErrorBlock) return;

  if (errorTitle) errorTitle.textContent = 'Printer Error';
  if (errorMessage) errorMessage.textContent = err.userMessage;
  if (errorHint) {
    errorHint.textContent = err.hint || '';
    if (err.hint) errorHint.removeAttribute('hidden');
    else errorHint.setAttribute('hidden', '');
  }

  // Severity-based styling or behavior
  printerErrorBlock.dataset.severity = err.severity;

  // Severity badge label
  if (errorSeverityText) {
    const severityLabels: Record<PrintErrorSeverity, string> = {
      warning: 'Warning',
      recoverable: 'Recoverable',
      fatal: 'Fatal Error',
    };
    errorSeverityText.textContent = severityLabels[err.severity] ?? err.severity;
  }

  if (err.severity === 'warning') {
    if (errorCloseBtn) errorCloseBtn.removeAttribute('hidden');
  } else {
    if (errorCloseBtn) errorCloseBtn.setAttribute('hidden', '');
  }

  // Pause/Resume controls are valid for all paper/jam related codes,
  // including mid-job exhaustion where the OS may have purged the job.
  const PAUSE_RESUME_ERROR_CODES = new Set([
    'PAPER_INSUFFICIENT_PRE_DISPATCH',
    'PAPER_INSUFFICIENT_MID_JOB',
    'PAPER_TRAY_EMPTY',
    'PAPER_JAM_PRINT',
  ]);
  const showActions = PAUSE_RESUME_ERROR_CODES.has(err.code);

  if (lastKnownPagesPrinted > 0) {
    if (errorProgressEl) {
      errorProgressEl.textContent = `Printed: ${lastKnownPagesPrinted} of ${lastKnownTotalPages || 1} pages`;
      errorProgressEl.removeAttribute('hidden');
    }
    if (errorCancelRemainingBtn) {
      errorCancelRemainingBtn.removeAttribute('hidden');
    }
  } else {
    if (errorProgressEl) {
      errorProgressEl.setAttribute('hidden', '');
    }
    if (errorCancelRemainingBtn) {
      errorCancelRemainingBtn.setAttribute('hidden', '');
    }
  }

  if (errorActions) {
    if (showActions || lastKnownPagesPrinted > 0) {
      errorActions.removeAttribute('hidden');
      // Reset button state every time the modal becomes visible
      resetErrorActionButtons();
    } else {
      errorActions.setAttribute('hidden', '');
    }
  }

  if (hasActiveJob()) {
    printerErrorBlock.removeAttribute('hidden');
  }
  applyConfirmGate();
}

function clearPrinterError(): void {
  currentPrinterError = null;
  if (printerErrorBlock) printerErrorBlock.setAttribute('hidden', '');
  if (errorProgressEl) errorProgressEl.setAttribute('hidden', '');
  if (errorCancelRemainingBtn) errorCancelRemainingBtn.setAttribute('hidden', '');
  applyConfirmGate();
}

const PAUSE_BTN_DEFAULT_LABEL = 'Pause Job';
const RESUME_BTN_DEFAULT_LABEL = 'Resume Print';
const PAUSE_BTN_LOADING_LABEL = 'Pausing…';
const RESUME_BTN_LOADING_LABEL = 'Resuming…';

/**
 * Minimum duration the loading label stays visible after a click. The new
 * persistent PowerShell runspace returns pause/resume in ~60 ms (down from
 * ~820 ms), which is fast enough that the user can't tell the click
 * registered. Hold the "Pausing…" / "Resuming…" label for at least this
 * long so the UI gives visible feedback for every click.
 */
const ERROR_ACTION_MIN_LOADING_MS = 350;

/**
 * Restores the printer-error action buttons to their default labels, removes
 * the loading/disabled state, and clears any inline error from a previous
 * failed action.
 */
function resetErrorActionButtons(): void {
  const PAUSE_RESUME_ERROR_CODES = new Set([
    'PAPER_INSUFFICIENT_PRE_DISPATCH',
    'PAPER_INSUFFICIENT_MID_JOB',
    'PAPER_TRAY_EMPTY',
    'PAPER_JAM_PRINT',
  ]);
  const showPauseResume = currentPrinterError && PAUSE_RESUME_ERROR_CODES.has(currentPrinterError.code);

  if (errorPauseBtn) {
    if (showPauseResume) {
      errorPauseBtn.removeAttribute('hidden');
      errorPauseBtn.disabled = false;
      const span = errorPauseBtn.querySelector('span');
      if (span) span.textContent = PAUSE_BTN_DEFAULT_LABEL;
    } else {
      errorPauseBtn.setAttribute('hidden', '');
    }
  }
  if (errorResumeBtn) {
    if (showPauseResume) {
      errorResumeBtn.removeAttribute('hidden');
      errorResumeBtn.disabled = false;
      const span = errorResumeBtn.querySelector('span');
      if (span) span.textContent = RESUME_BTN_DEFAULT_LABEL;
    } else {
      errorResumeBtn.setAttribute('hidden', '');
    }
  }
  if (errorCancelRemainingBtn) {
    if (lastKnownPagesPrinted > 0) {
      errorCancelRemainingBtn.removeAttribute('hidden');
      errorCancelRemainingBtn.disabled = false;
      const span = errorCancelRemainingBtn.querySelector('span');
      if (span) span.textContent = 'Cancel Remaining';
    } else {
      errorCancelRemainingBtn.setAttribute('hidden', '');
    }
  }
  clearErrorActionInlineError();
}

/**
 * Shows an inline error message under the Pause/Resume action buttons.
 * Replaces any previous inline error.
 */
function showErrorActionInlineError(message: string): void {
  if (!errorActions) return;
  let el = errorActions.querySelector<HTMLElement>(
    '.printer-error-modal__inline-error',
  );
  if (!el) {
    el = document.createElement('p');
    el.className = 'printer-error-modal__inline-error';
    el.setAttribute('role', 'alert');
    errorActions.appendChild(el);
  }
  el.textContent = message;
  el.removeAttribute('hidden');
}

function clearErrorActionInlineError(): void {
  if (!errorActions) return;
  const el = errorActions.querySelector<HTMLElement>(
    '.printer-error-modal__inline-error',
  );
  if (el) {
    el.textContent = '';
    el.setAttribute('hidden', '');
  }
}

/**
 * Resolves the spooler correlation key to send to /api/printer/{action}.
 * Prefers the live key from the active payment; falls back to whichever key
 * the currently-displayed printer error carries.
 */
function resolveErrorActionCorrelationKey(): string | null {
  if (paymentSpoolerCorrelationKey) return paymentSpoolerCorrelationKey;
  if (currentPrinterError?.spoolerCorrelationKey) {
    return currentPrinterError.spoolerCorrelationKey;
  }
  return null;
}

async function handleErrorAction(action: 'pause' | 'resume'): Promise<void> {
  if (!errorPauseBtn || !errorResumeBtn) return;

  const targetKey = resolveErrorActionCorrelationKey();
  if (!targetKey) {
    console.warn(
      `[PRINTER-ACTION] Cannot ${action}: no spooler correlation key available.`,
    );
    showErrorActionInlineError(
      'No active print job to control. Please try again or contact staff.',
    );
    return;
  }

  // Enter loading state for both buttons so a rapid second click is ignored.
  const clickedBtn = action === 'pause' ? errorPauseBtn : errorResumeBtn;
  const otherBtn = action === 'pause' ? errorResumeBtn : errorPauseBtn;
  const loadingLabel =
    action === 'pause' ? PAUSE_BTN_LOADING_LABEL : RESUME_BTN_LOADING_LABEL;
  const defaultLabel =
    action === 'pause' ? PAUSE_BTN_DEFAULT_LABEL : RESUME_BTN_DEFAULT_LABEL;

  errorPauseBtn.disabled = true;
  errorResumeBtn.disabled = true;
  const clickedSpan = clickedBtn.querySelector('span');
  if (clickedSpan) clickedSpan.textContent = loadingLabel;
  clearErrorActionInlineError();

  const loadingStartedAt = Date.now();

  try {
    const response = await fetchWithTimeout(`/api/printer/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spoolerCorrelationKey: targetKey }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const message =
        (errBody && typeof errBody.error === 'string' && errBody.error) ||
        `Server returned HTTP ${response.status}.`;
      throw new Error(message);
    }

    // Hold the loading label for at least ERROR_ACTION_MIN_LOADING_MS so
    // fast (~60 ms) persistent-PS round-trips still produce visible
    // feedback. If the call already took longer than the floor, no wait.
    const elapsed = Date.now() - loadingStartedAt;
    if (elapsed < ERROR_ACTION_MIN_LOADING_MS) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, ERROR_ACTION_MIN_LOADING_MS - elapsed),
      );
    }

    if (action === 'pause') {
      // Reflect paused state in the modal: keep Resume prominent, hide Pause.
      if (errorTitle) errorTitle.textContent = 'Job Paused';
      if (errorMessage) {
        errorMessage.textContent =
          'The print job is paused. Reload paper, then press Resume to continue.';
      }
      clickedBtn.setAttribute('hidden', '');
      const clickedLoadingSpan = clickedBtn.querySelector('span');
      if (clickedLoadingSpan) clickedLoadingSpan.textContent = defaultLabel;
      otherBtn.disabled = false;
      const otherSpan = otherBtn.querySelector('span');
      if (otherSpan) otherSpan.textContent = RESUME_BTN_DEFAULT_LABEL;
      return;
    }

    // action === 'resume' — restore normal flow.
    clearPrinterError();
  } catch (err) {
    console.error(`[PRINTER-ACTION] Failed to ${action} job:`, err);
    const message =
      err instanceof Error
        ? err.message
        : `Could not ${action} the print job.`;
    // Re-enable both buttons with their default labels.
    const clickedSpanAgain = clickedBtn.querySelector('span');
    if (clickedSpanAgain) clickedSpanAgain.textContent = defaultLabel;
    const otherSpanAgain = otherBtn.querySelector('span');
    if (otherSpanAgain) otherSpanAgain.textContent = defaultLabel;
    clickedBtn.removeAttribute('hidden');
    otherBtn.removeAttribute('hidden');
    errorPauseBtn.disabled = false;
    errorResumeBtn.disabled = false;
    showErrorActionInlineError(
      `Could not ${action} the print job. ${message} Please try again.`,
    );
  }
}

function syncCoinInsertGuidanceMessage(): void {
  if (coinInsertNote) coinInsertNote.textContent = COIN_INSERT_GUIDANCE_MESSAGE;
  if (footerNote) footerNote.textContent = COIN_INSERT_GUIDANCE_MESSAGE;
}

syncCoinInsertGuidanceMessage();

const rawConfig = sessionStorage.getItem('printbit.config');
const uploadedFile = sessionStorage.getItem('printbit.uploadedFile');
const uploadedDocumentId = sessionStorage.getItem(
  'printbit.uploadedDocumentId',
);
const DEFAULT_PRICING: PricingResponse = {
  scanDocument: 5,
};
const PENDING_PAYMENT_IDEMPOTENCY_STORAGE_KEY =
  'printbit.confirmPaymentIdempotencyKey';
const PENDING_PAYMENT_SPOOLER_STORAGE_KEY =
  'printbit.confirmPaymentSpoolerCorrelationKey';
const PENDING_PAYMENT_FINGERPRINT_STORAGE_KEY =
  'printbit.confirmPaymentFingerprint';
let totalPrice = 0;
let pricingLoaded = false;
let pricingError: string | null = null;
let currentBalance = 0;
let currentPrintQuote: PrintQuote | null = null;
let coinSlotIsLocked: boolean = false;
let printerReady = false;

if (!rawConfig) {
  const storedSessionId = sessionStorage.getItem('printbit.sessionId');
  const fallback = storedSessionId
    ? `/config?sessionId=${encodeURIComponent(storedSessionId)}`
    : '/config';
  window.location.href = fallback;
  throw new Error('Missing print configuration');
}

const config = JSON.parse(rawConfig ?? '{}') as ConfirmConfig;
config.rotationDeg = normalizeRotationDeg(config.rotationDeg);
if (typeof config.documentId !== 'string') {
  config.documentId = uploadedDocumentId;
}
if (
  config.detectedColorMode !== 'colored' &&
  config.detectedColorMode !== 'grayscale'
) {
  config.detectedColorMode = null;
}
currentPrintQuote =
  config.mode === 'scan' ? null : ((config.quote as PrintQuote | undefined) ?? null);

const currentPaymentFingerprint = JSON.stringify({
  mode: config.mode,
  sessionId: config.sessionId ?? null,
  documentId: config.documentId ?? null,
  copies: config.copies,
  colorMode: config.colorMode,
  orientation: config.orientation,
  rotationDeg: config.rotationDeg,
  paperSize: config.paperSize,
  pageRange: pageRangeFingerprint(config.pageRange),
  quotedAmount: currentPrintQuote?.requiredAmount ?? null,
});

const backLink = document.getElementById(
  'backLink',
) as HTMLAnchorElement | null;
if (backLink) {
  if (config.mode === 'copy') {
    backLink.href = '/copy';
  } else if (config.mode === 'scan') {
    backLink.href = '/scan';
  } else if (config.sessionId) {
    backLink.href = `/config?sessionId=${encodeURIComponent(config.sessionId)}`;
  }
}

function pageRangeLabel(sel?: PageRangeSelection): string {
  if (!sel || sel.type === 'all') return 'All Pages';
  if (sel.type === 'single') return `Page ${sel.page}`;
  return sel.range ? `Pages ${sel.range}` : 'Pages (custom)';
}

function pageRangeFingerprint(sel?: PageRangeSelection): string {
  if (!sel || sel.type === 'all') return 'all';
  if (sel.type === 'single') return `single:${sel.page}`;
  return `custom:${sel.range ?? ''}`;
}

const RELEASE_REQUEST_TIMEOUT_MS = 1_500;

async function releaseTransientScanFile(
  releaseToken: string,
  reason: string,
): Promise<void> {
  const safeReleaseToken = releaseToken.trim();
  if (!safeReleaseToken) return;

  try {
    const response = await fetchWithTimeout(
      '/api/scanner/release',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          releaseToken: safeReleaseToken,
          reason,
        }),
      },
      RELEASE_REQUEST_TIMEOUT_MS,
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    if (isAbortError(error)) return;
  }
}

async function releaseTransientFilesForCurrentMode(
  reason: string,
): Promise<void> {
  if (config.mode === 'scan' && config.scanReleaseToken) {
    await releaseTransientScanFile(config.scanReleaseToken, reason);
    return;
  }
  if (config.mode === 'copy' && config.copyPreviewReleaseToken) {
    await releaseTransientScanFile(config.copyPreviewReleaseToken, reason);
  }
}

function getDisplayColorMode(): 'colored' | 'grayscale' {
  if ((config.mode === 'print' || config.mode === 'copy') && currentPrintQuote) {
    return currentPrintQuote.effectiveColorMode;
  }
  return config.colorMode;
}

function formatColorMode(mode: 'colored' | 'grayscale'): string {
  return mode === 'colored' ? 'Colored' : 'Black & White';
}

function formatPaperSizeForPricing(
  paperSize: 'A4' | 'Letter' | 'Legal',
): string {
  switch (paperSize) {
    case 'A4':
      return 'A4 Bond Paper';
    case 'Letter':
      return 'Short Bond Paper';
    case 'Legal':
      return 'Long Bond Paper';
    default:
      return paperSize;
  }
}

function getColorModeSummaryLabel(): string {
  if (
    config.mode === 'print' &&
    config.detectedColorMode &&
    config.detectedColorMode !== config.colorMode
  ) {
    return `Detected: ${formatColorMode(config.detectedColorMode)} | Selected: ${formatColorMode(config.colorMode)}`;
  }

  return formatColorMode(getDisplayColorMode());
}

const confirmBtnSpan = confirmBtn?.querySelector('span');
if (confirmBtnSpan) {
  confirmBtnSpan.textContent =
    config.mode === 'print'
      ? 'Confirm & Print'
      : config.mode === 'copy'
        ? 'Confirm & Copy'
        : 'Confirm & Download';
}

const modalConfirmBtnSpan = document.querySelector('#modalConfirmBtn span');
if (modalConfirmBtnSpan) {
  modalConfirmBtnSpan.textContent =
    config.mode === 'print'
      ? 'Yes, Print'
      : config.mode === 'copy'
        ? 'Yes, Copy'
        : 'Yes, Download';
}

if (config.mode === 'scan') {
  // Hide all scan-irrelevant rows on the main view
  colorRow?.setAttribute('hidden', '');
  copiesRow?.setAttribute('hidden', '');
  pagesRow?.setAttribute('hidden', '');
  orientationRow?.setAttribute('hidden', '');
  rotationRow?.setAttribute('hidden', '');
  paperRow?.setAttribute('hidden', '');

  // Hide all scan-irrelevant rows in the modal
  modalColorRow?.setAttribute('hidden', '');
  modalCopiesRow?.setAttribute('hidden', '');
  modalPagesRow?.setAttribute('hidden', '');
  modalOrientationRow?.setAttribute('hidden', '');
  modalRotationRow?.setAttribute('hidden', '');
  modalPaperRow?.setAttribute('hidden', '');
} else {
  // Populate main screen values for print/copy
  if (colorValue) colorValue.textContent = getColorModeSummaryLabel();
  if (copiesValue) copiesValue.textContent = String(config.copies);
  if (pagesValue) pagesValue.textContent = pageRangeLabel(config.pageRange);
  if (orientationValue) {
    orientationValue.textContent =
      config.orientation === 'landscape' ? 'Landscape' : 'Portrait';
  }
  if (rotationValue) rotationValue.textContent = `${config.rotationDeg}°`;
  if (paperSizeValue)
    paperSizeValue.textContent = formatPaperSizeForPricing(config.paperSize);
}

if (modeValue) modeValue.textContent = config.mode.toUpperCase();
if (fileValue)
  fileValue.textContent =
    config.mode === 'print'
      ? (uploadedFile ?? 'No uploaded file')
      : config.mode === 'copy'
        ? 'Physical document copy'
        : (config.scanFilename ?? 'Scanned document');
if (priceValue) priceValue.textContent = 'Loading...';

function applyLockState(locked: boolean): void {
  coinSlotIsLocked = locked;
  const changeAmount = Math.max(0, currentBalance - totalPrice);

  const paymentColEl = document.querySelector<HTMLElement>('.payment-col');
  const coinIcon = document.getElementById('coinIcon');
  const padlockIcon = document.getElementById('padlockIcon');
  const changeReadyBadge = document.getElementById('changeReadyBadge');
  const changeReadyAmount = document.getElementById('changeReadyAmount');
  const ctaText = document.querySelector<HTMLElement>('.payment-col__cta');

  if (locked) {
    paymentColEl?.classList.add('payment-col--locked');
    if (padlockIcon) padlockIcon.removeAttribute('hidden'); // was: padlockIcon.style.display = ''
    if (coinIcon) coinIcon.setAttribute('hidden', '');     // was: coinIcon.style.display = 'none'
    if (ctaText) ctaText.textContent = 'Coin slot locked — ready to confirm';
    if (changeReadyAmount) {
      changeReadyAmount.textContent =
        changeAmount > 0
          ? `₱${changeAmount} change will be dispensed`
          : 'Exact amount — no change';
    }
    changeReadyBadge?.removeAttribute('hidden');
  } else {
    paymentColEl?.classList.remove('payment-col--locked');
    if (coinIcon) coinIcon.removeAttribute('hidden');      // was: coinIcon.style.display = ''
    if (padlockIcon) padlockIcon.setAttribute('hidden', ''); // was: padlockIcon.style.display = 'none'
    if (ctaText)
      ctaText.textContent = 'Insert coins into the kiosk slot to pay';
    changeReadyBadge?.setAttribute('hidden', '');
  }
}

function syncCoinSlotLockState(): void {
  const shouldLock =
    pricingLoaded && totalPrice > 0 && currentBalance >= totalPrice;
  if (shouldLock === coinSlotIsLocked) return;

  applyLockState(shouldLock);
  socket?.emit(
    shouldLock ? 'lockCoinSlot' : 'unlockCoinSlot',
    shouldLock ? { threshold: totalPrice } : { reason: 'balance_dropped' },
  );
}

function updateChangeDisplay(balance: number): void {
  const change = balance - totalPrice;
  const hasChange = pricingLoaded && change > 0;
  if (changeRow) {
    if (hasChange) {
      changeRow.removeAttribute('hidden');
    } else {
      changeRow.setAttribute('hidden', '');
    }
  }
  if (changeValue) {
    changeValue.textContent = hasChange ? `₱ ${change}` : '—';
  }
}

function applyConfirmGate(statusOverride?: string): void {
  if (!confirmBtn || !statusMessage) return;
  if (isProcessingPayment) {
    confirmBtn.disabled = true;
    confirmBtn.setAttribute('aria-disabled', 'true');
    if (statusBadge) statusBadge.dataset.state = 'waiting';
    return;
  }

  if (
    currentPrinterError &&
    (currentPrinterError.severity === 'fatal' ||
      currentPrinterError.severity === 'recoverable')
  ) {
    confirmBtn.disabled = true;
    confirmBtn.setAttribute('aria-disabled', 'true');
    statusMessage.textContent =
      statusOverride ?? currentPrinterError.userMessage;
    if (statusBadge) statusBadge.dataset.state = 'error';
    return;
  }

  if (!pricingLoaded) {
    confirmBtn.disabled = true;
    confirmBtn.setAttribute('aria-disabled', 'true');
    statusMessage.textContent =
      statusOverride ?? pricingError ?? 'Loading pricing...';
    if (statusBadge) statusBadge.dataset.state = 'waiting';
    return;
  }

  if (!printerReady) {
    confirmBtn.disabled = true;
    confirmBtn.setAttribute('aria-disabled', 'true');
    statusMessage.textContent =
      statusOverride ??
      `Printer not ready (${latestPrinterStatusLabel}). Please wait before inserting coins.`;
    if (statusBadge) {
      statusBadge.dataset.state =
        latestPrinterStatusLabel.startsWith('Checking') ? 'waiting' : 'error';
    }
    return;
  }

  if (currentBalance >= totalPrice) {
    confirmBtn.disabled = false;
    confirmBtn.setAttribute('aria-disabled', 'false');
    confirmBtn.classList.add('is-ready');          // NEW
    actionCol?.classList.add('is-ready');          // NEW (turns price green)
    statusMessage.textContent =
      statusOverride ?? 'Sufficient balance detected. You can confirm now.';
    if (statusBadge) statusBadge.dataset.state = 'ready';
  } else {
    confirmBtn.classList.remove('is-ready');       // NEW
    actionCol?.classList.remove('is-ready');       // NEW
    const needed = totalPrice - currentBalance;
    confirmBtn.disabled = true;
    confirmBtn.setAttribute('aria-disabled', 'true');
    statusMessage.textContent =
      statusOverride ?? `Insert more coins: ₱ ${needed} remaining.`;
    if (statusBadge) statusBadge.dataset.state = 'waiting';
  }
}

function updateBalanceUI(balance: number): void {
  currentBalance = balance;
  if (balanceValue) balanceValue.textContent = `₱ ${balance}`;
  updateChangeDisplay(balance);
  syncCoinSlotLockState();
  applyConfirmGate();
}

function setPrintingPhase(
  phase: 'printing' | 'dispensing' | 'failed' | 'done' | 'manual-review',
): void {
  const modeLabel = config.mode === 'copy' ? 'Copying' : 'Printing';
  const modePast = config.mode === 'copy' ? 'Copy' : 'Print';

  if (phase === 'printing') {
    if (printingSubtitle) {
      printingSubtitle.textContent = `Please wait while your document is being ${modeLabel.toLowerCase()}...`;
    }
    if (printingHint) {
      printingHint.textContent = 'Do not turn off the machine.';
    }
    return;
  }

  if (phase === 'dispensing') {
    if (printingSubtitle) {
      printingSubtitle.textContent = `${modeLabel} done. Dispensing your coin change...`;
    }
    if (printingHint) {
      printingHint.textContent = 'Please wait until the dispenser completes.';
    }
    return;
  }

  if (phase === 'failed') {
    if (printingSubtitle) {
      printingSubtitle.textContent = `${modePast} finalization failed and needs review.`;
    }
    if (printingHint) {
      printingHint.textContent =
        'Please contact staff for manual change settlement.';
    }
    return;
  }

  if (phase === 'manual-review') {
    if (printingSubtitle) {
      printingSubtitle.textContent = `${modePast} status requires manual review before release.`;
    }
    if (printingHint) {
      printingHint.textContent =
        'Please contact staff. Keep this screen open while recovery is verified.';
    }
    return;
  }

  if (printingSubtitle) {
    printingSubtitle.textContent = `${modePast} and change handling completed.`;
  }
  if (printingHint) {
    printingHint.textContent = 'Thank you for using PrintBit.';
  }
}

/**
 * Updates the printing overlay's progress indicator from a
 * `printLifecycleState` payload. Called whenever a 'processing' transition
 * arrives with `pagesPrinted` set. The block stays hidden on the very first
 * call (the call must reveal text + bar), then updates are progressively
 * cheap text/bar mutations.
 */
function renderPrintProgress(input: {
  pagesPrinted?: number | null;
  totalPages?: number | null;
}): void {
  const pagesPrinted =
    typeof input.pagesPrinted === 'number' && Number.isFinite(input.pagesPrinted)
      ? Math.max(0, Math.floor(input.pagesPrinted))
      : null;
  if (pagesPrinted === null || pagesPrinted <= 0) return;

  const totalPages =
    typeof input.totalPages === 'number' && Number.isFinite(input.totalPages) &&
    input.totalPages > 0
      ? Math.floor(input.totalPages)
      : null;

  if (printingProgressCurrent) {
    printingProgressCurrent.textContent = String(pagesPrinted);
  }
  if (printingProgressTotal) {
    printingProgressTotal.textContent = totalPages !== null
      ? String(totalPages)
      : '—';
  }

  let pct: number | null = null;
  if (totalPages !== null) {
    pct = Math.max(0, Math.min(100, (pagesPrinted / totalPages) * 100));
  }
  if (printingProgressFill && pct !== null) {
    printingProgressFill.style.setProperty('--progress', `${pct}%`);
  }

  if (printingProgressText) printingProgressText.removeAttribute('hidden');
  if (printingProgressBar) printingProgressBar.removeAttribute('hidden');
}

/**
 * Hides and resets the progress indicator. Called on terminal states
 * (printed / failed / paused) so the next session starts clean.
 */
function hidePrintProgress(): void {
  if (printingProgressText) printingProgressText.setAttribute('hidden', '');
  if (printingProgressBar) printingProgressBar.setAttribute('hidden', '');
  if (printingProgressFill) {
    printingProgressFill.style.setProperty('--progress', '0%');
  }
  if (printingProgressCurrent) printingProgressCurrent.textContent = '0';
  if (printingProgressTotal) printingProgressTotal.textContent = '0';
}

async function showScanQrOverlay(
  downloadUrl: string,
  expiresAt?: string,
): Promise<void> {
  const scanQrOverlay = document.getElementById('scanQrOverlay');
  const scanQrCanvas = document.getElementById(
    'scanQrCanvas',
  ) as HTMLCanvasElement | null;
  const scanQrLinkText = document.getElementById('scanQrLinkText');
  const scanQrExpiry = document.getElementById('scanQrExpiry');

  if (!scanQrOverlay || !scanQrCanvas) return;

  await QRCode.toCanvas(scanQrCanvas, downloadUrl, {
    width: 220,
    margin: 1,
    color: { dark: '#1a1a2e', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  });

  if (scanQrLinkText) scanQrLinkText.textContent = downloadUrl;
  if (scanQrExpiry && expiresAt) {
    const expiry = new Date(expiresAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    scanQrExpiry.textContent = `Link expires at ${expiry}`;
  }

  showOverlay(scanQrOverlay);
  scanQrOverlay.querySelector<HTMLElement>('button')?.focus();
}

async function fetchInitialBalance(): Promise<void> {
  const response = await fetch('/api/balance');
  const data = (await response.json()) as { balance: number };
  updateBalanceUI(data.balance ?? 0);
}

async function loadPricing(): Promise<void> {
  if (config.mode === 'print' || config.mode === 'copy') {
    try {
      if (config.mode === 'print' && !config.sessionId) {
        throw new Error('Print session is required.');
      }
      if (config.mode === 'copy' && !config.copyPreviewPath) {
        throw new Error('Copy preview is required.');
      }

      const endpoint =
        config.mode === 'print' ? '/api/print/quote' : '/api/copy/quote';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          copies: config.copies,
          colorMode: config.colorMode,
          orientation: config.orientation,
          rotationDeg: config.rotationDeg,
          paperSize: config.paperSize,
          pageRange: config.pageRange,
          ...(config.mode === 'print'
            ? {
                sessionId: config.sessionId,
                documentId: config.documentId ?? uploadedDocumentId ?? undefined,
              }
            : {
                copyPreviewPath: config.copyPreviewPath,
              }),
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        quote?: PrintQuote;
      };
      if (!response.ok || !payload.quote) {
        throw new Error(
          payload.error ??
            `Failed to load ${config.mode === 'print' ? 'print' : 'copy'} quote.`,
        );
      }

      currentPrintQuote = payload.quote;
      totalPrice = payload.quote.requiredAmount;
      pricingLoaded = true;
      pricingError = null;
      if (priceValue) priceValue.textContent = `₱ ${totalPrice}`;
      if (actionPriceValue) actionPriceValue.textContent = `₱ ${totalPrice}`;
      if (colorValue) colorValue.textContent = getColorModeSummaryLabel();
      if (pagesValue) {
        pagesValue.textContent =
          `${pageRangeLabel(config.pageRange)} · ` +
          `Selected ${payload.quote.selectedPages} of ${payload.quote.totalPages} · ` +
          `B/W ${payload.quote.billableBwPages} · ` +
          `Color ${payload.quote.billableColorPages}`;
      }
      updateChangeDisplay(currentBalance);
      syncCoinSlotLockState();
      applyConfirmGate();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `Failed to load ${config.mode === 'print' ? 'print' : 'copy'} quote.`;
      currentPrintQuote = null;
      totalPrice = 0;
      pricingLoaded = false;
      pricingError = message;
      if (priceValue) priceValue.textContent = 'Unavailable';
      if (actionPriceValue) actionPriceValue.textContent = '₱ 0';
      updateChangeDisplay(currentBalance);
      syncCoinSlotLockState();
      applyConfirmGate();
    }
    return;
  }

  const response = await fetch('/api/pricing');
  if (!response.ok) throw new Error('Pricing request failed.');

  const payload = (await response.json()) as Partial<PricingResponse>;
  const safePricing = {
    scanDocument: payload.scanDocument ?? DEFAULT_PRICING.scanDocument,
  };

  totalPrice = safePricing.scanDocument;
  pricingLoaded = true;
  pricingError = null;
  if (priceValue) priceValue.textContent = `₱ ${totalPrice}`;
  if (actionPriceValue) actionPriceValue.textContent = `₱ ${totalPrice}`;
  updateChangeDisplay(currentBalance);
  syncCoinSlotLockState();
  applyConfirmGate();
}

// Modal declarations removed (moved to top of file)

let isProcessingPayment = false;
let activeSpoolerCorrelationKey: string | null = null;
const persistedSpoolerCorrelationKeyRaw = sessionStorage.getItem(
  PENDING_PAYMENT_SPOOLER_STORAGE_KEY,
);
const persistedPaymentFingerprintRaw = sessionStorage.getItem(
  PENDING_PAYMENT_FINGERPRINT_STORAGE_KEY,
);
const persistedFingerprintMatchesCurrent =
  (config.mode === 'print' || config.mode === 'copy') &&
  persistedPaymentFingerprintRaw === currentPaymentFingerprint;
const persistedSpoolerCorrelationKey =
  persistedFingerprintMatchesCurrent &&
  persistedSpoolerCorrelationKeyRaw?.trim().length
    ? persistedSpoolerCorrelationKeyRaw.trim()
    : null;
const persistedPaymentIdempotencyKeyRaw = sessionStorage.getItem(
  PENDING_PAYMENT_IDEMPOTENCY_STORAGE_KEY,
);
const persistedPaymentIdempotencyKey =
  persistedFingerprintMatchesCurrent &&
  persistedPaymentIdempotencyKeyRaw?.trim().length
    ? persistedPaymentIdempotencyKeyRaw.trim()
    : null;
let lastSpoolerCorrelationKey: string | null = persistedSpoolerCorrelationKey;
let paymentSpoolerCorrelationKey: string | null =
  persistedSpoolerCorrelationKey;
let paymentIdempotencyKey: string | null = persistedPaymentIdempotencyKey;
if (!persistedFingerprintMatchesCurrent) {
  sessionStorage.removeItem(PENDING_PAYMENT_SPOOLER_STORAGE_KEY);
  sessionStorage.removeItem(PENDING_PAYMENT_IDEMPOTENCY_STORAGE_KEY);
  sessionStorage.removeItem(PENDING_PAYMENT_FINGERPRINT_STORAGE_KEY);
}
let latestPrinterStatusLabel = 'Checking...';
const spoolerTimedOut = false;

const NETWORK_REQUEST_TIMEOUT_MS = 90_000;

let currentTransactionId: string | null = null;
let currentReceiptUrl: string | null = null;
let currentReceiptExpiresAt: string | null = null;
let pendingReceiptData: ReceiptLinkPayload | null = null;

function setTransactionReference(id: string | null): void {
  currentTransactionId = id?.trim().length ? id.trim() : null;
  if (!transactionReference) return;
  if (currentTransactionId) {
    transactionReference.textContent = `Reference ID: ${currentTransactionId}`;
    transactionReference.removeAttribute('hidden');
  } else {
    transactionReference.textContent = 'Reference ID: —';
    transactionReference.setAttribute('hidden', '');
  }
}

function extractReceiptUrl(
  payload: ReceiptLinkPayload,
): { url: string; expiresAt: string | null } | null {
  const url =
    payload.receipt?.viewUrl || payload.receiptViewUrl || payload.receipt?.url;
  if (!url) return null;
  return {
    url,
    expiresAt: payload.receipt?.expiresAt || payload.receiptExpiresAt || null,
  };
}

/** For copy mode: poll the copy job endpoint to get receipt data after async settlement. */
async function pollCopyJobReceipt(jobId: string): Promise<void> {
  const maxAttempts = 15;
  const intervalMs = 2000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(`/api/copy/jobs/${encodeURIComponent(jobId)}`);
      if (!res.ok) break;
      const job = await res.json() as { receipt?: { viewUrl?: string; expiresAt?: string }; transactionId?: string; id?: string };
      if (job.receipt?.viewUrl) {
        captureReceiptCta({ receipt: { viewUrl: job.receipt.viewUrl, expiresAt: job.receipt.expiresAt ?? null } });
        const txId = job.transactionId ?? job.id ?? null;
        if (txId) setTransactionReference(txId);
        return;
      }
    } catch {
      // Ignore fetch errors, retry
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, intervalMs));
  }
}

function renderReceiptCta(): void {
  if (!receiptCtaContainer || !receiptQrCanvas || !currentReceiptUrl) return;
  receiptCtaContainer.removeAttribute('hidden');
  if (receiptQrLink) receiptQrLink.setAttribute('href', currentReceiptUrl);

  QRCode.toCanvas(receiptQrCanvas, currentReceiptUrl, {
    width: 180,
    margin: 1,
    color: { dark: '#1a1a2e', light: '#ffffff' },
  }).catch(console.error);
}

function captureReceiptCta(payload: ReceiptLinkPayload): void {
  const receipt = extractReceiptUrl(payload);
  if (!receipt) return;
  currentReceiptUrl = receipt.url;
  currentReceiptExpiresAt = receipt.expiresAt;
  pendingReceiptData = payload;
  renderReceiptCta();
}

function finalizePrintSuccess(transactionId: string | null): void {
  setTransactionReference(transactionId ?? currentTransactionId);
  hideOverlay(printingOverlay);
  hidePrintProgress();
  showOverlay(thankYouOverlay);
  clearPendingPaymentSessionState();
  activeSpoolerCorrelationKey = null;
  if (statusMessage)
    statusMessage.textContent = 'Printing complete. Thank you!';
  renderReceiptCta();
  lastSpoolerCorrelationKey = null;
  isProcessingPayment = false;

  if (printAnotherBtn) {
    printAnotherBtn.removeAttribute('hidden');
    const btnSpan = printAnotherBtn.querySelector('span');
    if (btnSpan) {
      if (config.mode === 'copy') {
        btnSpan.textContent = 'Copy Another Document';
      } else if (config.mode === 'scan') {
        btnSpan.textContent = 'Scan Another Document';
      } else {
        btnSpan.textContent = 'Print Another File';
      }
    }
  }

  applyConfirmGate();
  void checkRemainingFilesAndPrompt();
}

function enterWorkerPendingState(transactionId: string | null): void {
  setTransactionReference(transactionId);
  activeSpoolerCorrelationKey = paymentSpoolerCorrelationKey;
  if (statusMessage) {
    statusMessage.textContent =
      config.mode === 'copy'
        ? 'Payment confirmed. Waiting for the worker to start copying.'
        : 'Payment confirmed. Waiting for the worker to start printing.';
  }
  // Show the printing overlay in a worker-pending state
  showOverlay(printingOverlay);
  setPrintingPhase('printing');
}

function matchesPendingWorkerEvent(payload: {
  transactionId?: string | null;
  spoolerCorrelationKey?: string | null;
}): boolean {
  const payloadTransactionId =
    typeof payload.transactionId === 'string' ? payload.transactionId : null;
  const payloadSpoolerKey =
    typeof payload.spoolerCorrelationKey === 'string'
      ? payload.spoolerCorrelationKey
      : null;

  if (currentTransactionId && payloadTransactionId === currentTransactionId) {
    return true;
  }

  return Boolean(
    paymentSpoolerCorrelationKey &&
      payloadSpoolerKey &&
      payloadSpoolerKey === paymentSpoolerCorrelationKey,
  );
}

function syncPendingPaymentSessionState(): void {
  if (config.mode !== 'print' && config.mode !== 'copy') return;
  if (paymentIdempotencyKey)
    sessionStorage.setItem(
      PENDING_PAYMENT_IDEMPOTENCY_STORAGE_KEY,
      paymentIdempotencyKey,
    );
  if (paymentSpoolerCorrelationKey) {
    sessionStorage.setItem(
      PENDING_PAYMENT_SPOOLER_STORAGE_KEY,
      paymentSpoolerCorrelationKey,
    );
    sessionStorage.setItem(
      PENDING_PAYMENT_FINGERPRINT_STORAGE_KEY,
      currentPaymentFingerprint,
    );
  }
}

function clearPendingPaymentSessionState(): void {
  paymentIdempotencyKey = null;
  paymentSpoolerCorrelationKey = null;
  sessionStorage.removeItem(PENDING_PAYMENT_IDEMPOTENCY_STORAGE_KEY);
  sessionStorage.removeItem(PENDING_PAYMENT_SPOOLER_STORAGE_KEY);
  sessionStorage.removeItem(PENDING_PAYMENT_FINGERPRINT_STORAGE_KEY);
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = NETWORK_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutHandle = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutHandle);
  }
}

function showModal(): void {
  if (!confirmModal) return;
  if (modalFile)
    modalFile.textContent =
      config.mode === 'print'
        ? (uploadedFile ?? 'No file')
        : config.mode === 'copy'
          ? 'Physical document copy'
          : (config.scanFilename ?? 'Scanned document');
  if (modalMode) modalMode.textContent = config.mode.toUpperCase();

  if (config.mode !== 'scan') {
    if (modalColor) modalColor.textContent = getColorModeSummaryLabel();
    if (modalCopies) modalCopies.textContent = String(config.copies);
    if (modalPages) {
      if (currentPrintQuote) {
        modalPages.textContent =
          `${pageRangeLabel(config.pageRange)} (${currentPrintQuote.selectedPages} of ${currentPrintQuote.totalPages} pages)`;
      } else {
        modalPages.textContent = pageRangeLabel(config.pageRange);
      }
    }
    if (modalOrientation) {
      modalOrientation.textContent =
        config.orientation === 'landscape' ? 'Landscape' : 'Portrait';
    }
    if (modalRotation) modalRotation.textContent = `${config.rotationDeg}°`;
    if (modalPaper) modalPaper.textContent = formatPaperSizeForPricing(config.paperSize);
  }

  if (modalPrice) modalPrice.textContent = `₱ ${totalPrice}`;

  // Show coin change in modal when overpaid
  const modalChangeAmount = Math.max(0, currentBalance - totalPrice);
  if (modalChangeRow) {
    if (pricingLoaded && modalChangeAmount > 0) {
      modalChangeRow.removeAttribute('hidden');
    } else {
      modalChangeRow.setAttribute('hidden', '');
    }
  }
  if (modalChange) {
    modalChange.textContent =
      modalChangeAmount > 0 ? `₱ ${modalChangeAmount}` : '—';
  }

  confirmModal.classList.add('is-visible');
  confirmModal.setAttribute('aria-hidden', 'false');
  modalCancelBtn?.focus();
}

function hideModal(): void {
  confirmModal?.classList.remove('is-visible');
  confirmModal?.setAttribute('aria-hidden', 'true');
  confirmBtn?.focus();
}

function showOverlay(el: HTMLElement | null): void {
  if (!el) return;
  el.classList.add('is-visible');
  el.setAttribute('aria-hidden', 'false');
}

function hideOverlay(el: HTMLElement | null): void {
  if (!el) return;
  el.classList.remove('is-visible');
  el.setAttribute('aria-hidden', 'true');
}

function clearConfirmSessionStorage(): void {
  setTransactionReference(null);
  clearPendingPaymentSessionState();
  sessionStorage.removeItem('printbit.config');
  sessionStorage.removeItem('printbit.copyPreviewPath');
  sessionStorage.removeItem('printbit.copyPreviewReleaseToken');
  sessionStorage.removeItem('printbit.uploadedFile');
  sessionStorage.removeItem('printbit.uploadedDocumentId');
  sessionStorage.removeItem('printbit.sessionId');
  sessionStorage.removeItem('printbit.sessionToken');
}

async function checkRemainingFilesAndPrompt(): Promise<void> {
  if (config.mode !== 'print' || !config.sessionId) {
    // No auto-redirect: user taps Done when ready
    return;
  }
  // Simplified for brevity — no auto-redirect
}

confirmBtn?.addEventListener('click', () => showModal());
modalCancelBtn?.addEventListener('click', () => hideModal());

modalConfirmBtn?.addEventListener('click', async () => {
  modalConfirmBtn.disabled = true;
  hideModal();
  confirmBtn.disabled = true;
  isProcessingPayment = true;
  showOverlay(printingOverlay);
  setPrintingPhase('printing');

  try {
    if (config.mode === 'scan') {
      // Scan Soft Copy fee payment
      const response = await fetchWithTimeout('/api/scanner/soft-copy/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: config.scanFilename,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Scan payment failed');
      }

      const payload = (await response.json()) as ReceiptLinkPayload & {
        transactionId?: string | null;
      };
      captureReceiptCta(payload);
      finalizePrintSuccess(payload.transactionId ?? null);
      // For scan mode: the receipt data comes in the same response (no async job)
      // captureReceiptCta above should have set it if available
    } else if (config.mode === 'copy') {
      // Copy (Scan to Print) job creation
      const spoolerCorrelationKey =
        paymentSpoolerCorrelationKey ?? createSpoolerCorrelationKey();
      paymentSpoolerCorrelationKey = spoolerCorrelationKey;
      paymentIdempotencyKey =
        paymentIdempotencyKey ?? createPaymentIdempotencyKey();
      syncPendingPaymentSessionState();

      const response = await fetchWithTimeout('/api/copy/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': paymentIdempotencyKey,
        },
        body: JSON.stringify({
          amount: totalPrice,
          copies: config.copies,
          colorMode: getDisplayColorMode(),
          orientation: config.orientation,
          rotationDeg: config.rotationDeg,
          paperSize: config.paperSize,
          pageRange: config.pageRange,
          previewPath: config.copyPreviewPath,
          spoolerCorrelationKey,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        if (errData.printError) {
          renderPrinterError(errData.printError);
          throw new Error(errData.printError.userMessage);
        }
        throw new Error(errData.error || 'Copy job failed');
      }

      const payload = (await response.json()) as ReceiptLinkPayload & {
        id?: string;
        transactionId?: string | null;
      };
      // For copy jobs, the ID is often in 'id' field of the job object
      const transactionId = payload.transactionId ?? payload.id ?? null;
      captureReceiptCta(payload);
      enterWorkerPendingState(transactionId);
    } else {
      // Print implementation...
      const spoolerCorrelationKey =
        paymentSpoolerCorrelationKey ?? createSpoolerCorrelationKey();
      paymentSpoolerCorrelationKey = spoolerCorrelationKey;
      paymentIdempotencyKey =
        paymentIdempotencyKey ?? createPaymentIdempotencyKey();
      syncPendingPaymentSessionState();

      const response = await fetchWithTimeout('/api/confirm-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': paymentIdempotencyKey,
        },
        body: JSON.stringify({
          amount: totalPrice,
          mode: config.mode,
          sessionId: config.sessionId,
          documentId: config.documentId,
          copies: config.copies,
          colorMode: getDisplayColorMode(),
          orientation: config.orientation,
          rotationDeg: config.rotationDeg,
          paperSize: config.paperSize,
          pageRange: config.pageRange,
          spoolerCorrelationKey,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        if (errData.printError) {
          renderPrinterError(errData.printError);
          throw new Error(errData.printError.userMessage);
        }
        throw new Error(errData.error || 'Payment failed');
      }
      
      const payload = (await response.json()) as ReceiptLinkPayload & {
        transactionId?: string | null;
      };
      captureReceiptCta(payload);
      enterWorkerPendingState(payload.transactionId ?? null);
    }
  } catch (error) {
    hideOverlay(printingOverlay);
    isProcessingPayment = false;
    const message = error instanceof Error ? error.message : 'Error processing payment.';
    applyConfirmGate(message);
  }
});

thankYouDoneBtn?.addEventListener('click', () => {
  clearConfirmSessionStorage();
  window.location.href = '/';
});

printAnotherBtn?.addEventListener('click', () => {
  setTransactionReference(null);
  clearPendingPaymentSessionState();
  sessionStorage.removeItem('printbit.config');
  sessionStorage.removeItem('printbit.copyPreviewPath');
  sessionStorage.removeItem('printbit.copyPreviewReleaseToken');
  
  if (config.mode === 'print') {
    // Keep sessionId, sessionToken, uploadedFile, etc. for remaining files
    window.location.href = '/print';
  } else if (config.mode === 'copy') {
    sessionStorage.removeItem('printbit.uploadedFile');
    sessionStorage.removeItem('printbit.uploadedDocumentId');
    sessionStorage.removeItem('printbit.sessionId');
    sessionStorage.removeItem('printbit.sessionToken');
    window.location.href = '/copy';
  } else if (config.mode === 'scan') {
    sessionStorage.removeItem('printbit.uploadedFile');
    sessionStorage.removeItem('printbit.uploadedDocumentId');
    sessionStorage.removeItem('printbit.sessionId');
    sessionStorage.removeItem('printbit.sessionToken');
    window.location.href = '/scan';
  }
});

const ioFactory = (window as any).io;
if (typeof ioFactory === 'function') {
  const connectedSocket = ioFactory() as SocketLike;
  socket = connectedSocket;
  connectedSocket.on('balance', (amount: unknown) => {
    if (typeof amount === 'number') updateBalanceUI(amount);
  });

  connectedSocket.on('printErrorRaised', (payload: any) => {
    if (!hasActiveJob()) return;
    const err = payload as PrintError;
    if (!err) return;

    // Filter by correlation key if present, except for warnings
    if (err.severity !== 'warning') {
      const payloadKey = (payload as any).spoolerCorrelationKey;
      if (payloadKey) {
        if (
          !paymentSpoolerCorrelationKey ||
          payloadKey !== paymentSpoolerCorrelationKey
        ) {
          return;
        }
      }
    }

    renderPrinterError(err);
  });

  connectedSocket.on('printLifecycleState', (payload: any) => {
    const lifecycle = payload as PrintLifecycleStatePayload;
    if (typeof lifecycle.pagesPrinted === 'number') {
      lastKnownPagesPrinted = lifecycle.pagesPrinted;
    }
    if (typeof lifecycle.totalPages === 'number') {
      lastKnownTotalPages = lifecycle.totalPages;
    }
    const isHardwareError =
      lifecycle.printError?.severity === 'recoverable' ||
      lifecycle.printError?.code === 'PAPER_TRAY_EMPTY' ||
      lifecycle.printError?.code === 'PAPER_JAM_PRINT' ||
      currentPrinterError?.severity === 'recoverable';

    // Live progress updates — only 'processing' transitions carry
    // pagesPrinted. PrintStarted emits the same state without pagesPrinted,
    // which is a no-op here and lets the spinner-only copy stand.
    if (lifecycle.state === 'processing') {
      if (
        typeof lifecycle.pagesPrinted === 'number' &&
        lifecycle.pagesPrinted > 0
      ) {
        renderPrintProgress({
          pagesPrinted: lifecycle.pagesPrinted,
          totalPages: lifecycle.totalPages ?? null,
        });
      }
    }

    if (
      lifecycle.state === 'failed' &&
      matchesPendingWorkerEvent({
        transactionId: lifecycle.transactionId ?? null,
        spoolerCorrelationKey: lifecycle.spoolerCorrelationKey ?? null,
      })
    ) {
      if (isHardwareError) {
        hideOverlay(printingOverlay);
        isProcessingPayment = false;
        // Keep activeSpoolerCorrelationKey and session state intact!
        if (lifecycle.printError) {
          renderPrinterError(lifecycle.printError);
        } else if (currentPrinterError) {
          renderPrinterError(currentPrinterError);
        }
        return;
      }

      hideOverlay(printingOverlay);
      hidePrintProgress();
      isProcessingPayment = false;
      activeSpoolerCorrelationKey = null;
      clearPendingPaymentSessionState();
      applyConfirmGate(
        lifecycle.reason ?? 'The worker could not complete this print job.',
      );
    }
    if (lifecycle.printError) {
      if (hasActiveJob()) renderPrinterError(lifecycle.printError);
    } else if (lifecycle.state === 'printed' || lifecycle.state === 'failed') {
      if (lifecycle.state === 'printed') hidePrintProgress();
      if (!isHardwareError) {
        clearPrinterError();
      }
    }
  });

  connectedSocket.on('connect', () => {
    void loadPrinterStatus();
  });

  connectedSocket.on('printerStatusChanged', (payload: any) => {
    if (payload && typeof payload.connected === 'boolean') {
      const isBlocked =
        !payload.connected || BLOCKED_PRINTER_STATUSES.has(payload.status);
      printerReady = !isBlocked;
      latestPrinterStatusLabel =
        payload.status || (payload.connected ? 'Ready' : 'Not Found');
      applyConfirmGate();
      if (!printerReady) {
        void loadPrinterStatus();
      }
    } else {
      void loadPrinterStatus();
    }
  });

  connectedSocket.on('printerRecovered', (payload: any) => {
    printerReady = true;
    latestPrinterStatusLabel = payload?.status || 'Idle';
    clearPrinterError();
    applyConfirmGate();
  });

  connectedSocket.on('printerStatusRestored', () => {
    printerReady = true;
    latestPrinterStatusLabel = 'Ready';
    clearPrinterError();
    applyConfirmGate();
  });

  // Re-sync on printer malfunction or spooler failure
  connectedSocket.on('printerMalfunction', (payload: any) => {
    printerReady = false;
    latestPrinterStatusLabel = payload?.status || 'Error';
    if (hasActiveJob() && payload?.printError) {
      renderPrinterError(payload.printError);
    }
    applyConfirmGate();
  });
  connectedSocket.on('printerSpoolerFailure', (payload: any) => {
    if (hasActiveJob() && payload?.printError) renderPrinterError(payload.printError);
  });

  connectedSocket.on('workerPrintStarted', (payload: any) => {
    if (!matchesPendingWorkerEvent(payload)) return;
    setPrintingPhase('printing');
    if (statusMessage) {
      statusMessage.textContent =
        config.mode === 'copy'
          ? 'Copy job started by the worker.'
          : 'Print job started by the worker.';
    }
  });

  connectedSocket.on('workerPrintSucceeded', (payload: any) => {
    if (!matchesPendingWorkerEvent(payload)) return;
    finalizePrintSuccess(payload?.transactionId ?? null);
  });

  connectedSocket.on('workerPrintFailed', (payload: any) => {
    if (!matchesPendingWorkerEvent(payload)) return;

    // If the worker reports a HardwareError, show the error modal
    // with pause/resume instead of aborting the transaction.
    const isHardwareError =
      payload?.failureStage === 'HardwareError' ||
      payload?.failureStage === 'IncompleteOutput' ||
      payload?.errorType === 'HardwareError' ||
      payload?.reason === 'HardwareError' ||
      payload?.printError?.code === 'PAPER_TRAY_EMPTY' ||
      payload?.printError?.code === 'PAPER_JAM_PRINT';

    if (isHardwareError) {
      hideOverlay(printingOverlay);
      isProcessingPayment = false;
      const hardwareError: PrintError = payload?.printError ?? {
        code: 'PAPER_TRAY_EMPTY',
        severity: 'recoverable' as PrintErrorSeverity,
        userMessage:
          payload?.message ?? 'Printer Out of Paper. Please load paper and click Resume.',
        hint: 'Ask staff to load paper into the rear tray, then press Resume to retry.',
        canRetry: true,
      };
      // Ensure severity is at least recoverable for hardware errors
      if (hardwareError.severity === 'warning') {
        hardwareError.severity = 'recoverable';
      }
      renderPrinterError(hardwareError);
      return;
    }

    // Non-hardware failure: abort as before
    hideOverlay(printingOverlay);
    hidePrintProgress();
    isProcessingPayment = false;
    activeSpoolerCorrelationKey = null;
    clearPendingPaymentSessionState();
    applyConfirmGate(
      payload?.message ?? 'The worker reported a terminal print failure.',
    );
  });
}

// Error action button handlers
errorCloseBtn?.addEventListener('click', () => {
  clearPrinterError();
});

errorPauseBtn?.addEventListener('click', () => {
  void handleErrorAction('pause');
});

errorResumeBtn?.addEventListener('click', () => {
  void handleErrorAction('resume');
});

errorCancelRemainingBtn?.addEventListener('click', async () => {
  const key = resolveErrorActionCorrelationKey();
  if (!key) {
    showErrorActionInlineError('No active print job to control. Please try again or contact staff.');
    return;
  }

  if (errorCancelRemainingBtn) {
    errorCancelRemainingBtn.disabled = true;
    const span = errorCancelRemainingBtn.querySelector('span');
    if (span) span.textContent = 'Cancelling…';
  }
  clearErrorActionInlineError();

  try {
    const response = await fetchWithTimeout('/api/printer/cancel-remaining', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spoolerCorrelationKey: key }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const message =
        (errBody && typeof errBody.error === 'string' && errBody.error) ||
        `Server returned HTTP ${response.status}.`;
      throw new Error(message);
    }

    clearPrinterError();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not cancel the print job.';
    showErrorActionInlineError(message);
    if (errorCancelRemainingBtn) {
      errorCancelRemainingBtn.disabled = false;
      const span = errorCancelRemainingBtn.querySelector('span');
      if (span) span.textContent = 'Cancel Remaining';
    }
  }
});

const BLOCKED_PRINTER_STATUSES = new Set([
  'Offline',
  'Error',
  'Paper Jam',
  'Paper Out',
  'Door Open',
  'User Intervention Required',
  'Paused',
]);

let printerStatusRetryTimer: number | null = null;

async function loadPrinterStatus(): Promise<void> {
  if (printerStatusRetryTimer !== null) {
    window.clearTimeout(printerStatusRetryTimer);
    printerStatusRetryTimer = null;
  }

  try {
    const res = await fetch('/api/printer/status');
    const data = await res.json();
    printerReady = Boolean(data.ready);
    latestPrinterStatusLabel =
      data.status || (printerReady ? 'Ready' : 'Not Found');
    applyConfirmGate();

    // If printer is not ready or still in checking phase, schedule a retry
    if (
      !printerReady ||
      latestPrinterStatusLabel === 'Checking…' ||
      latestPrinterStatusLabel === 'Checking...'
    ) {
      printerStatusRetryTimer = window.setTimeout(() => {
        void loadPrinterStatus();
      }, 2500);
    }
  } catch {
    printerReady = false;
    applyConfirmGate();
    printerStatusRetryTimer = window.setTimeout(() => {
      void loadPrinterStatus();
    }, 3000);
  }
}

async function boot(): Promise<void> {
  await Promise.all([
    loadPrinterStatus(),
    loadPricing(),
    fetchInitialBalance(),
  ]);
}

void boot();

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function createSpoolerCorrelationKey(): string {
  return crypto.randomUUID();
}

function createPaymentIdempotencyKey(): string {
  return crypto.randomUUID();
}
