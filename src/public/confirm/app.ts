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

type ConfirmConfig = {
  mode: 'print' | 'copy' | 'scan';
  sessionId: string | null;
  documentId?: string | null;
  scanFilename?: string;
  copyPreviewPath?: string | null;
  colorMode: 'colored' | 'grayscale';
  duplex?: boolean;
  copies: number;
  orientation: 'portrait' | 'landscape';
  paperSize: 'A4' | 'Letter' | 'Legal';
  pageRange?: PageRangeSelection;
  totalPages?: number;
  quote?: PrintQuote;
};

type PricingResponse = {
  printPerPage: number;
  copyPerPage: number;
  colorSurcharge: number;
  scanDocument: number;
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
};

const modeValue = document.getElementById('modeValue');
const fileValue = document.getElementById('fileValue');
const colorValue = document.getElementById('colorValue');
const copiesValue = document.getElementById('copiesValue');
const pagesValue = document.getElementById('pagesValue');
const pagesRow = document.getElementById('pagesRow');
const orientationValue = document.getElementById('orientationValue');
const paperSizeValue = document.getElementById('paperSizeValue');
const priceValue = document.getElementById('priceValue');
const balanceValue = document.getElementById('balanceValue');
const changeValue = document.getElementById('changeValue');
const changeRow = document.getElementById('changeRow');
const modalChange = document.getElementById('modalChange');
const modalChangeRow = document.getElementById('modalChangeRow');
const statusMessage = document.getElementById('statusMessage');
const coinEventMessage = document.getElementById('coinToast');
const confirmBtn = document.getElementById('confirmBtn') as HTMLButtonElement;
const resetBalanceBtn = document.getElementById(
  'resetBalanceBtn',
) as HTMLButtonElement;

const rawConfig = sessionStorage.getItem('printbit.config');
const uploadedFile = sessionStorage.getItem('printbit.uploadedFile');
const uploadedDocumentId = sessionStorage.getItem(
  'printbit.uploadedDocumentId',
);
const DEFAULT_PRICING: PricingResponse = {
  printPerPage: 5,
  copyPerPage: 3,
  colorSurcharge: 2,
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
// [PRINTER GUARD] Starts false — fail-safe: UI stays locked until the first
// /api/printer/status check confirms the printer is online.
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
config.duplex = config.duplex === true;
if (typeof config.documentId !== 'string') {
  config.documentId = uploadedDocumentId;
}
currentPrintQuote = config.mode === 'print' ? (config.quote ?? null) : null;
const currentPaymentFingerprint = JSON.stringify({
  mode: config.mode,
  sessionId: config.sessionId ?? null,
  documentId: config.documentId ?? null,
  copies: config.copies,
  colorMode: config.colorMode,
  duplex: config.duplex === true,
  orientation: config.orientation,
  paperSize: config.paperSize,
  pageRange: pageRangeFingerprint(config.pageRange),
  quotedAmount: currentPrintQuote?.requiredAmount ?? null,
});

// Update back link to return to the correct config page with the session
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

function getDisplayColorMode(): 'colored' | 'grayscale' {
  if (config.mode === 'print' && currentPrintQuote) {
    return currentPrintQuote.effectiveColorMode;
  }
  return config.colorMode;
}

function calculateLegacyTotalPrice(pricing: PricingResponse): number {
  if (config.mode === 'scan') {
    return pricing.scanDocument ?? DEFAULT_PRICING.scanDocument;
  }
  const base =
    config.mode === 'copy' ? pricing.copyPerPage : pricing.printPerPage;
  const color = config.colorMode === 'colored' ? pricing.colorSurcharge : 0;
  const pages =
    config.mode === 'print' ? Math.max(1, config.totalPages ?? 1) : 1;
  return (base + color) * pages * Math.max(1, config.copies);
}

if (confirmBtn) {
  confirmBtn.textContent =
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

if (config.mode === 'copy' || config.mode === 'scan') {
  pagesRow?.setAttribute('hidden', '');
}

if (config.mode === 'scan') {
  colorValue?.closest('.summary-row')?.setAttribute('hidden', '');
  copiesValue?.closest('.summary-row')?.setAttribute('hidden', '');
  orientationValue?.closest('.summary-row')?.setAttribute('hidden', '');
  paperSizeValue?.closest('.summary-row')?.setAttribute('hidden', '');
}

if (modeValue) modeValue.textContent = config.mode.toUpperCase();
if (fileValue)
  fileValue.textContent =
    config.mode === 'print'
      ? (uploadedFile ?? 'No uploaded file')
      : config.mode === 'copy'
        ? 'Physical document copy'
        : (config.scanFilename ?? 'Scanned document');
if (colorValue) colorValue.textContent = getDisplayColorMode();
if (copiesValue) copiesValue.textContent = String(config.copies);
if (pagesValue) pagesValue.textContent = pageRangeLabel(config.pageRange);
if (orientationValue) orientationValue.textContent = config.orientation;
if (paperSizeValue) paperSizeValue.textContent = config.paperSize;
if (priceValue) priceValue.textContent = 'Loading...';

function applyLockState(locked: boolean): void {
  coinSlotIsLocked = locked;
  const changeAmount = Math.max(0, currentBalance - totalPrice);
  const coinButtons = document.querySelectorAll<HTMLButtonElement>('.coin-btn');

  const coinPanel = document.querySelector<HTMLElement>('.coin-panel');
  const coinIcon = document.getElementById('coinIcon');
  const padlockIcon = document.getElementById('padlockIcon');
  const changeReadyBadge = document.getElementById('changeReadyBadge');
  const changeReadyAmount = document.getElementById('changeReadyAmount');
  const ctaText = document.querySelector<HTMLElement>('.coin-panel__cta');

  if (locked) {
    coinPanel?.classList.add('coin-panel--locked');
    if (coinIcon) coinIcon.style.display = 'none';
    if (padlockIcon) padlockIcon.style.display = '';
    if (ctaText) ctaText.textContent = 'Coin slot locked — ready to confirm';
    if (changeReadyAmount) {
      changeReadyAmount.textContent =
        changeAmount > 0
          ? `₱${changeAmount} change will be dispensed`
          : 'Exact amount — no change';
    }
    changeReadyBadge?.removeAttribute('hidden');
  } else {
    coinPanel?.classList.remove('coin-panel--locked');
    if (coinIcon) coinIcon.style.display = '';
    if (padlockIcon) padlockIcon.style.display = 'none';
    if (ctaText)
      ctaText.textContent = 'Insert coins into the kiosk slot to pay';
    changeReadyBadge?.setAttribute('hidden', '');
  }

  coinButtons.forEach((button) => {
    button.disabled = locked;
  });
  if (resetBalanceBtn) {
    resetBalanceBtn.disabled = locked;
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

// [PRINTER GUARD] Single source of truth for whether the user can proceed.
// Called whenever any of the three gating conditions change:
//   printerReady, pricingLoaded, or currentBalance.
function applyConfirmGate(statusOverride?: string): void {
  if (!confirmBtn || !statusMessage) return;
  if (isProcessingPayment) {
    confirmBtn.disabled = true;
    confirmBtn.setAttribute('aria-disabled', 'true');
    if (modalConfirmBtn) {
      modalConfirmBtn.disabled = true;
      modalConfirmBtn.setAttribute('aria-disabled', 'true');
    }
    return;
  }

  // Gate 1: pricing not yet loaded
  if (!pricingLoaded) {
    confirmBtn.disabled = true;
    confirmBtn.setAttribute('aria-disabled', 'true');
    if (modalConfirmBtn) {
      modalConfirmBtn.disabled = true;
      modalConfirmBtn.setAttribute('aria-disabled', 'true');
    }
    statusMessage.textContent =
      statusOverride ?? pricingError ?? 'Loading pricing...';
    return;
  }

  // Gate 2: printer not ready — blocks button AND coin insertion guidance
  if (!printerReady) {
    confirmBtn.disabled = true;
    confirmBtn.setAttribute('aria-disabled', 'true');
    if (modalConfirmBtn) {
      modalConfirmBtn.disabled = true;
      modalConfirmBtn.setAttribute('aria-disabled', 'true');
    }
    statusMessage.textContent =
      statusOverride ??
      `Printer not ready (${latestPrinterStatusLabel}). Please wait before inserting coins.`;
    return;
  }

  // Gate 3: insufficient balance
  if (currentBalance >= totalPrice) {
    confirmBtn.disabled = false;
    confirmBtn.setAttribute('aria-disabled', 'false');
    if (modalConfirmBtn) {
      modalConfirmBtn.disabled = false;
      modalConfirmBtn.setAttribute('aria-disabled', 'false');
    }
    statusMessage.textContent =
      statusOverride ?? 'Sufficient balance detected. You can confirm now.';
  } else {
    const needed = totalPrice - currentBalance;
    confirmBtn.disabled = true;
    confirmBtn.setAttribute('aria-disabled', 'true');
    if (modalConfirmBtn) {
      modalConfirmBtn.disabled = true;
      modalConfirmBtn.setAttribute('aria-disabled', 'true');
    }
    statusMessage.textContent =
      statusOverride ?? `Insert more coins: ₱ ${needed} remaining.`;
  }
}

function updateBalanceUI(balance: number): void {
  currentBalance = balance;
  if (balanceValue) balanceValue.textContent = `₱ ${balance}`;
  updateChangeDisplay(balance);
  syncCoinSlotLockState();
  applyConfirmGate();
}

function setCoinEventMessage(message: string): void {
  if (coinEventMessage) coinEventMessage.textContent = message;
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
      printingSubtitle.textContent = `${modePast} completed, but coin change dispensing failed.`;
    }
    if (printingHint) {
      printingHint.textContent =
        'Please contact staff for manual change settlement.';
    }
    return;
  }

  if (phase === 'manual-review') {
    if (printingSubtitle) {
      printingSubtitle.textContent =
        `${modePast} status requires manual review before release.`;
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

  // Accessibility: move focus into the scan QR overlay and trap focus while it is active.
  // Try to focus the dedicated "Done" button if present; otherwise, fall back to the first focusable element.
  const getFocusableElements = (): HTMLElement[] => {
    const focusableSelector =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(
      scanQrOverlay.querySelectorAll<HTMLElement>(focusableSelector),
    ).filter(
      (el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'),
    );
  };

  const focusInitialElement = (): void => {
    // Prefer a specific Done button if the markup provides one.
    const doneButton =
      scanQrOverlay.querySelector<HTMLButtonElement>('#scanQrDoneButton') ??
      scanQrOverlay.querySelector<HTMLButtonElement>(
        'button[data-scan-qr-done]',
      );

    if (doneButton) {
      doneButton.focus();
      return;
    }

    const focusable = getFocusableElements();
    if (focusable.length > 0) {
      focusable[0].focus();
    }
  };

  // Use requestAnimationFrame to ensure the overlay is visible before moving focus.
  if (typeof window !== 'undefined' && 'requestAnimationFrame' in window) {
    window.requestAnimationFrame(focusInitialElement);
  } else {
    focusInitialElement();
  }

  // Initialize a simple focus trap once per overlay element.
  if (!(scanQrOverlay as HTMLElement).dataset.focusTrapInitialized) {
    (scanQrOverlay as HTMLElement).dataset.focusTrapInitialized = 'true';

    scanQrOverlay.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements();
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        // Shift+Tab: cycle from first to last.
        if (activeElement === first || !scanQrOverlay.contains(activeElement)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        // Tab: cycle from last to first.
        if (activeElement === last || !scanQrOverlay.contains(activeElement)) {
          event.preventDefault();
          first.focus();
        }
      }
    });
  }
}

async function fetchInitialBalance(): Promise<void> {
  const response = await fetch('/api/balance');
  const data = (await response.json()) as { balance: number };
  updateBalanceUI(data.balance ?? 0);
}

async function loadPricing(): Promise<void> {
  if (config.mode === 'print') {
    try {
      if (!config.sessionId) {
        throw new Error('Print session is required.');
      }

      const response = await fetch('/api/print/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: config.sessionId,
          documentId: config.documentId ?? uploadedDocumentId ?? undefined,
          copies: config.copies,
          colorMode: config.colorMode,
          orientation: config.orientation,
          paperSize: config.paperSize,
          pageRange: config.pageRange,
          duplex: config.duplex === true,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        quote?: PrintQuote;
      };
      if (!response.ok || !payload.quote) {
        throw new Error(payload.error ?? 'Failed to load print quote.');
      }

      currentPrintQuote = payload.quote;
      totalPrice = payload.quote.requiredAmount;
      pricingLoaded = true;
      pricingError = null;
      if (priceValue) priceValue.textContent = `₱ ${totalPrice}`;
      if (colorValue) colorValue.textContent = getDisplayColorMode();
      if (pagesValue) {
        pagesValue.textContent = `${pageRangeLabel(config.pageRange)} (${payload.quote.selectedPages} of ${payload.quote.totalPages})`;
      }
      updateChangeDisplay(currentBalance);
      syncCoinSlotLockState();
      applyConfirmGate();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load print quote.';
      currentPrintQuote = null;
      totalPrice = 0;
      pricingLoaded = false;
      pricingError = message;
      if (priceValue) priceValue.textContent = 'Unavailable';
      if (colorValue) colorValue.textContent = config.colorMode;
      if (pagesValue) pagesValue.textContent = pageRangeLabel(config.pageRange);
      updateChangeDisplay(currentBalance);
      syncCoinSlotLockState();
      applyConfirmGate();
    }
    return;
  }

  let pricing = DEFAULT_PRICING;
  const response = await fetch('/api/pricing');
  if (!response.ok) throw new Error('Pricing request failed.');

  const payload = (await response.json()) as Partial<PricingResponse>;
  const safePrint =
    typeof payload.printPerPage === 'number' &&
    Number.isFinite(payload.printPerPage)
      ? payload.printPerPage
      : DEFAULT_PRICING.printPerPage;
  const safeCopy =
    typeof payload.copyPerPage === 'number' &&
    Number.isFinite(payload.copyPerPage)
      ? payload.copyPerPage
      : DEFAULT_PRICING.copyPerPage;
  const safeColor =
    typeof payload.colorSurcharge === 'number' &&
    Number.isFinite(payload.colorSurcharge)
      ? payload.colorSurcharge
      : DEFAULT_PRICING.colorSurcharge;
  const safeScan =
    typeof payload.scanDocument === 'number' &&
    Number.isFinite(payload.scanDocument)
      ? payload.scanDocument
      : DEFAULT_PRICING.scanDocument;

  pricing = {
    printPerPage: safePrint,
    copyPerPage: safeCopy,
    colorSurcharge: safeColor,
    scanDocument: safeScan,
  };

  totalPrice = calculateLegacyTotalPrice(pricing);
  pricingLoaded = true;
  pricingError = null;
  if (priceValue) priceValue.textContent = `₱ ${totalPrice}`;
  updateChangeDisplay(currentBalance);
  syncCoinSlotLockState();
  applyConfirmGate();
}

async function resetBalanceForTesting(): Promise<void> {
  if (!resetBalanceBtn) return;
  resetBalanceBtn.disabled = true;
  if (statusMessage) statusMessage.textContent = 'Resetting coin balance...';

  const response = await fetch('/api/balance/reset', { method: 'POST' });
  const payload = (await response.json()) as {
    balance?: number;
    error?: string;
  };

  if (!response.ok) {
    if (statusMessage)
      statusMessage.textContent = payload.error ?? 'Failed to reset balance.';
    resetBalanceBtn.disabled = coinSlotIsLocked;
    return;
  }

  updateBalanceUI(payload.balance ?? 0);
  if (statusMessage)
    statusMessage.textContent = 'Coin balance reset to ₱ 0.00 (testing mode).';
  setCoinEventMessage('Balance reset manually for testing.');
  resetBalanceBtn.disabled = coinSlotIsLocked;
}

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
const modalCopies = document.getElementById('modalCopies');
const modalPages = document.getElementById('modalPages');
const modalPagesRow = document.getElementById('modalPagesRow');
const modalOrientation = document.getElementById('modalOrientation');
const modalPaper = document.getElementById('modalPaper');
const modalPrice = document.getElementById('modalPrice');
const printingOverlay = document.getElementById('printingOverlay');
const printingSubtitle = document.getElementById('printingSubtitle');
const printingHint = document.getElementById('printingHint');
const thankYouOverlay = document.getElementById('thankYouOverlay');
const jamRefundOverlay = document.getElementById('jamRefundOverlay');
const jamRefundTitle = document.getElementById('jamRefundTitle');
const jamRefundMessage = document.getElementById('jamRefundMessage');
const jamRefundHint = document.getElementById('jamRefundHint');
const jamRefundDoneBtn = document.getElementById(
  'jamRefundDoneBtn',
) as HTMLButtonElement | null;
const thankYouDoneBtn = document.getElementById(
  'thankYouDoneBtn',
) as HTMLButtonElement;
let isProcessingPayment = false;
let activeSpoolerCorrelationKey: string | null = null;
const persistedSpoolerCorrelationKeyRaw = sessionStorage.getItem(
  PENDING_PAYMENT_SPOOLER_STORAGE_KEY,
);
const persistedPaymentFingerprintRaw = sessionStorage.getItem(
  PENDING_PAYMENT_FINGERPRINT_STORAGE_KEY,
);
const persistedFingerprintMatchesCurrent =
  config.mode === 'print' &&
  persistedPaymentFingerprintRaw === currentPaymentFingerprint;
const persistedSpoolerCorrelationKey =
  persistedFingerprintMatchesCurrent &&
  persistedSpoolerCorrelationKeyRaw &&
  persistedSpoolerCorrelationKeyRaw.trim().length > 0
    ? persistedSpoolerCorrelationKeyRaw.trim()
    : null;
const persistedPaymentIdempotencyKeyRaw = sessionStorage.getItem(
  PENDING_PAYMENT_IDEMPOTENCY_STORAGE_KEY,
);
const persistedPaymentIdempotencyKey =
  persistedFingerprintMatchesCurrent &&
  persistedPaymentIdempotencyKeyRaw &&
  persistedPaymentIdempotencyKeyRaw.trim().length > 0
    ? persistedPaymentIdempotencyKeyRaw.trim()
    : null;
let lastSpoolerCorrelationKey: string | null = persistedSpoolerCorrelationKey;
let paymentSpoolerCorrelationKey: string | null = persistedSpoolerCorrelationKey;
let paymentIdempotencyKey: string | null = persistedPaymentIdempotencyKey;
if (!persistedFingerprintMatchesCurrent) {
  sessionStorage.removeItem(PENDING_PAYMENT_SPOOLER_STORAGE_KEY);
  sessionStorage.removeItem(PENDING_PAYMENT_IDEMPOTENCY_STORAGE_KEY);
  sessionStorage.removeItem(PENDING_PAYMENT_FINGERPRINT_STORAGE_KEY);
}
let jamRefundFocusTrapHandler: ((event: KeyboardEvent) => void) | null = null;
let latestPrinterStatusLabel = 'Checking...';
let spoolerTimedOut = false;
const NETWORK_REQUEST_TIMEOUT_MS = 30_000;
const COPY_JOB_POLL_INTERVAL_MS = 1_500;
const COPY_JOB_POLL_TIMEOUT_MS = 5 * 60 * 1_000;
let spoolerFinalizationTimer: number | null = null;

type SpoolerFailureEvent = {
  jobStatus: string;
  chargedAmount: number;
  refundId: string;
  pagesPrinted: number;
  totalPages: number;
  printerName: string | null;
  reason: string;
  refundDisposition: 'auto_refunded' | 'pending_admin_review';
  restoredBalanceAmount: number;
  transactionId: string | null;
  spoolerCorrelationKey: string | null;
};

type SpoolerConfirmedEvent = {
  jobStatus: string;
  pagesPrinted: number;
  totalPages: number;
  printerName: string | null;
  transactionId: string | null;
  spoolerCorrelationKey: string | null;
};

type SpoolerTimeoutEvent = {
  jobStatus: string | null;
  pagesPrinted: number;
  totalPages: number;
  printerName: string | null;
  transactionId: string | null;
  spoolerCorrelationKey: string | null;
  monitorWindowMs: number;
};

const CANONICAL_PRINTER_FAULT_STATUSES = new Set([
  'offline',
  'error',
  'paper jam',
  'paper out',
  'door open',
  'user intervention required',
  'paused',
  'not connected',
  'no default printer',
]);

const CANONICAL_COIN_REJECTION_FAULT_REASONS = new Set([
  'printer telemetry is stale',
  'printer not connected',
]);

function setPrinterReadyState(
  ready: boolean,
  status?: string,
  statusMessageOverride?: string,
): void {
  printerReady = ready;
  if (typeof status === 'string' && status.trim()) {
    latestPrinterStatusLabel = status.trim();
  }
  applyConfirmGate(statusMessageOverride);
}

function createSpoolerCorrelationKey(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `spooler_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createPaymentIdempotencyKey(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `payment_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getOrCreatePaymentIdempotencyKey(): string {
  if (config.mode !== 'print') {
    return createPaymentIdempotencyKey();
  }
  if (!paymentIdempotencyKey) {
    paymentIdempotencyKey = createPaymentIdempotencyKey();
    syncPendingPaymentSessionState();
  }
  return paymentIdempotencyKey;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.code === DOMException.ABORT_ERR)
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearSpoolerFinalizationTimer(): void {
  if (spoolerFinalizationTimer !== null) {
    window.clearTimeout(spoolerFinalizationTimer);
    spoolerFinalizationTimer = null;
  }
}

function syncPendingPaymentSessionState(): void {
  if (config.mode !== 'print') {
    sessionStorage.removeItem(PENDING_PAYMENT_IDEMPOTENCY_STORAGE_KEY);
    sessionStorage.removeItem(PENDING_PAYMENT_SPOOLER_STORAGE_KEY);
    sessionStorage.removeItem(PENDING_PAYMENT_FINGERPRINT_STORAGE_KEY);
    return;
  }

  if (paymentIdempotencyKey) {
    sessionStorage.setItem(
      PENDING_PAYMENT_IDEMPOTENCY_STORAGE_KEY,
      paymentIdempotencyKey,
    );
  } else {
    sessionStorage.removeItem(PENDING_PAYMENT_IDEMPOTENCY_STORAGE_KEY);
  }

  if (paymentSpoolerCorrelationKey) {
    sessionStorage.setItem(
      PENDING_PAYMENT_SPOOLER_STORAGE_KEY,
      paymentSpoolerCorrelationKey,
    );
    sessionStorage.setItem(
      PENDING_PAYMENT_FINGERPRINT_STORAGE_KEY,
      currentPaymentFingerprint,
    );
  } else {
    sessionStorage.removeItem(PENDING_PAYMENT_SPOOLER_STORAGE_KEY);
    sessionStorage.removeItem(PENDING_PAYMENT_FINGERPRINT_STORAGE_KEY);
  }
}

function clearPendingPaymentSessionState(): void {
  paymentIdempotencyKey = null;
  paymentSpoolerCorrelationKey = null;
  syncPendingPaymentSessionState();
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

if (config.mode === 'copy' || config.mode === 'scan') {
  modalPagesRow?.setAttribute('hidden', '');
}

function showModal(): void {
  if (!confirmModal) return;
  if (modalFile)
    modalFile.textContent =
      config.mode === 'print'
        ? (uploadedFile ?? 'No file')
        : 'Physical document copy';
  if (modalMode) modalMode.textContent = config.mode.toUpperCase();
  if (modalColor) modalColor.textContent = getDisplayColorMode();
  if (modalCopies) modalCopies.textContent = String(config.copies);
  if (modalPages) {
    const baseLabel = pageRangeLabel(config.pageRange);
    if (config.mode === 'print' && currentPrintQuote) {
      modalPages.textContent = `${baseLabel} (${currentPrintQuote.selectedPages} of ${currentPrintQuote.totalPages})`;
    } else {
      modalPages.textContent = baseLabel;
    }
  }
  if (modalOrientation) modalOrientation.textContent = config.orientation;
  if (modalPaper) modalPaper.textContent = config.paperSize;
  if (modalPrice) modalPrice.textContent = `₱ ${totalPrice}`;
  const change = currentBalance - totalPrice;
  if (modalChangeRow && modalChange) {
    if (change > 0) {
      modalChangeRow.removeAttribute('hidden');
      modalChange.textContent = `₱ ${change}`;
    } else {
      modalChangeRow.setAttribute('hidden', '');
      modalChange.textContent = '—';
    }
  }
  confirmModal.classList.add('is-visible');
  confirmModal.setAttribute('aria-hidden', 'false');
  // Move focus into modal for accessibility
  (modalCancelBtn as HTMLElement | null)?.focus();
}

function hideModal(): void {
  if (!confirmModal) return;
  confirmModal.classList.remove('is-visible');
  confirmModal.setAttribute('aria-hidden', 'true');
  // Return focus to the trigger button
  (confirmBtn as HTMLElement | null)?.focus();
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

function showSpoolerFailureNotice(ev: SpoolerFailureEvent): void {
  hideOverlay(printingOverlay);
  hideOverlay(thankYouOverlay);

  const refundReference = ev.refundId || 'unknown';
  const pagesMessage =
    ev.pagesPrinted > 0
      ? `${ev.pagesPrinted} of ${Math.max(ev.totalPages, ev.pagesPrinted)} page(s) were printed.`
      : 'No pages were printed.';

  if (jamRefundTitle) {
    jamRefundTitle.textContent =
      ev.refundDisposition === 'auto_refunded'
        ? 'Print Failed — Refund Applied'
        : 'Print Failed — Refund Pending Review';
  }

  if (jamRefundMessage) {
    jamRefundMessage.textContent =
      ev.refundDisposition === 'auto_refunded'
        ? `Printer reported "${ev.jobStatus}" on ${ev.printerName ?? 'the printer'}. ${pagesMessage} ₱${ev.chargedAmount.toFixed(2)} was returned to your machine balance.`
        : `Printer reported "${ev.jobStatus}" on ${ev.printerName ?? 'the printer'}. ${pagesMessage} A pending refund record was created (ID: ${refundReference}).`;
  }

  if (jamRefundHint) {
    jamRefundHint.textContent =
      ev.refundDisposition === 'auto_refunded'
        ? 'You may retry once the printer recovers. If the issue persists, contact staff.'
        : 'Please contact staff and provide the refund ID shown above for manual refund handling.';
  }

  if (statusMessage) {
    statusMessage.textContent =
      ev.refundDisposition === 'auto_refunded'
        ? `Printer issue detected. ₱ ${ev.restoredBalanceAmount.toFixed(2)} returned to balance.`
        : 'Printer issue detected. Staff review is required for refund processing.';
  }

  setCoinEventMessage(
    ev.refundDisposition === 'auto_refunded'
      ? `Auto-refund applied: ₱ ${ev.restoredBalanceAmount.toFixed(2)}`
      : `Pending refund recorded (ID: ${refundReference}).`,
  );

  setPrintingPhase('failed');
  setPrinterReadyState(false, ev.jobStatus);
  if (jamRefundOverlay && jamRefundFocusTrapHandler) {
    jamRefundOverlay.removeEventListener('keydown', jamRefundFocusTrapHandler);
    jamRefundFocusTrapHandler = null;
  }
  showOverlay(jamRefundOverlay);
  setupJamRefundFocusTrap();
}

function clearConfirmSessionStorage(): void {
  clearPendingPaymentSessionState();
  sessionStorage.removeItem('printbit.config');
  sessionStorage.removeItem('printbit.copyPreviewPath');
  sessionStorage.removeItem('printbit.uploadedFile');
  sessionStorage.removeItem('printbit.uploadedDocumentId');
  sessionStorage.removeItem('printbit.sessionId');
  sessionStorage.removeItem('printbit.sessionToken');
}

function setupJamRefundFocusTrap(): void {
  if (!jamRefundOverlay) return;
  const getFocusableElements = (): HTMLElement[] => {
    const selector =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(jamRefundOverlay.querySelectorAll<HTMLElement>(selector));
  };

  if (jamRefundFocusTrapHandler) {
    jamRefundOverlay.removeEventListener('keydown', jamRefundFocusTrapHandler);
  }

  jamRefundFocusTrapHandler = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const focusable = getFocusableElements();
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (event.shiftKey) {
      if (active === first || !jamRefundOverlay.contains(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }

    if (active === last || !jamRefundOverlay.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };

  jamRefundOverlay.addEventListener('keydown', jamRefundFocusTrapHandler);
  if (jamRefundDoneBtn) {
    window.requestAnimationFrame(() => {
      jamRefundDoneBtn.focus();
    });
  }
}

function teardownJamRefundFocusTrap(): void {
  if (!jamRefundOverlay || !jamRefundFocusTrapHandler) return;
  jamRefundOverlay.removeEventListener('keydown', jamRefundFocusTrapHandler);
  jamRefundFocusTrapHandler = null;
}

confirmBtn?.addEventListener('click', () => showModal());
modalCancelBtn?.addEventListener('click', () => hideModal());

modalConfirmBtn?.addEventListener('click', async () => {
  modalConfirmBtn.disabled = true;
  hideModal();
  confirmBtn.disabled = true;
  isProcessingPayment = true;
  clearSpoolerFinalizationTimer();
  activeSpoolerCorrelationKey = null;
  lastSpoolerCorrelationKey = paymentSpoolerCorrelationKey;
  spoolerTimedOut = false;

  showOverlay(printingOverlay);

  const printingTitle = document.querySelector('.printingTitle');
  if (printingTitle && config.mode === 'scan') {
    printingTitle.textContent = 'Your file is preparing...';
  }

  if (config.mode === 'scan') {
    if (printingSubtitle)
      printingSubtitle.textContent = 'Processing your payment...';
    if (printingHint)
      printingHint.textContent =
        'Please wait while we secure your download link.';
  } else {
    setPrintingPhase('printing');
  }
  const MIN_OVERLAY_MS = 500;
  const overlayStart = Date.now();

  if (config.mode === 'scan') {
    if (!config.scanFilename) {
      hideOverlay(printingOverlay);
      if (statusMessage)
        statusMessage.textContent =
          'No scan file found. Please go back and scan again.';
      isProcessingPayment = false;
      confirmBtn.disabled = false;
      modalConfirmBtn.disabled = false;
      applyConfirmGate();
      return;
    }

    try {
      const chargeRes = await fetch('/api/scanner/soft-copy/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: config.scanFilename }),
      });
      const chargeData = (await chargeRes.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!chargeRes.ok || chargeData.ok === false) {
        hideOverlay(printingOverlay);
        if (statusMessage)
          statusMessage.textContent =
            chargeData.error ?? 'Payment failed. Please add more coins.';
        isProcessingPayment = false;
        confirmBtn.disabled = false;
        modalConfirmBtn.disabled = false;
        applyConfirmGate();
        return;
      }

      const linkRes = await fetch('/api/scanner/wireless-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: config.scanFilename }),
      });
      const linkData = (await linkRes.json()) as {
        downloadUrl?: string;
        expiresAt?: string;
        error?: string;
      };
      if (!linkRes.ok || !linkData.downloadUrl) {
        hideOverlay(printingOverlay);
        if (statusMessage)
          statusMessage.textContent =
            linkData.error ?? 'Failed to generate download link.';
        isProcessingPayment = false;
        confirmBtn.disabled = false;
        modalConfirmBtn.disabled = false;
        applyConfirmGate();
        return;
      }

      const remaining = MIN_OVERLAY_MS - (Date.now() - overlayStart);
      if (remaining > 0)
        await new Promise<void>((r) => setTimeout(r, remaining));
      hideOverlay(printingOverlay);

      await showScanQrOverlay(linkData.downloadUrl, linkData.expiresAt);

      sessionStorage.removeItem('printbit.config');
      sessionStorage.removeItem('printbit.uploadedFile');
      sessionStorage.removeItem('printbit.uploadedDocumentId');
      sessionStorage.removeItem('printbit.sessionId');
      sessionStorage.removeItem('printbit.sessionToken');
    } catch {
      hideOverlay(printingOverlay);
      if (statusMessage)
        statusMessage.textContent = 'Network error. Please try again.';
      isProcessingPayment = false;
      confirmBtn.disabled = false;
      modalConfirmBtn.disabled = false;
    }
    isProcessingPayment = false;
    applyConfirmGate();
    return;
  } else if (config.mode === 'copy') {
    // Copy flow: print the already checked scan file
    if (!config.copyPreviewPath) {
      hideOverlay(printingOverlay);
      if (statusMessage) {
        statusMessage.textContent =
          'No checked document found. Please go back to /copy and tap Check for Document again.';
      }
      isProcessingPayment = false;
      applyConfirmGate();
      return;
    }

    if (statusMessage)
      statusMessage.textContent = 'Sending checked document to printer...';

    try {
      const createRes = await fetch('/api/copy/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          copies: config.copies,
          colorMode: config.colorMode,
          orientation: config.orientation,
          paperSize: config.paperSize,
          amount: totalPrice,
          previewPath: config.copyPreviewPath,
        }),
      });

      if (!createRes.ok) {
        const payload = (await createRes.json()) as { error?: string };
        hideOverlay(printingOverlay);
        if (statusMessage)
          statusMessage.textContent =
            payload.error ?? 'Failed to start copy job.';
        isProcessingPayment = false;
        applyConfirmGate();
        return;
      }

      const createData = (await createRes.json()) as {
        id: string;
        state: string;
      };
      const jobId = createData.id;

      // Poll job status
      const pollResult = await pollCopyJob(jobId);

      const remaining = MIN_OVERLAY_MS - (Date.now() - overlayStart);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      hideOverlay(printingOverlay);

      if (pollResult.state === 'succeeded') {
        showOverlay(thankYouOverlay);
        if (statusMessage) statusMessage.textContent = 'Your copies are ready!';
        clearConfirmSessionStorage();
      } else if (pollResult.state === 'failed') {
        if (statusMessage)
          statusMessage.textContent =
            pollResult.reason ?? 'Copy job failed. Please try again.';
        isProcessingPayment = false;
        applyConfirmGate();
      } else {
        if (statusMessage) statusMessage.textContent = 'Copy was cancelled.';
        isProcessingPayment = false;
        applyConfirmGate();
      }
    } catch {
      hideOverlay(printingOverlay);
      if (statusMessage)
        statusMessage.textContent = 'Network error during copy job.';
      isProcessingPayment = false;
      applyConfirmGate();
    }
  } else {
    // Print flow: existing behavior
    if (statusMessage) statusMessage.textContent = 'Sending to printer…';
    if (config.mode !== 'print') {
      clearPendingPaymentSessionState();
      activeSpoolerCorrelationKey = null;
      lastSpoolerCorrelationKey = null;
      hideOverlay(printingOverlay);
      isProcessingPayment = false;
      applyConfirmGate('Invalid print mode.');
      return;
    }
    const spoolerCorrelationKey =
      paymentSpoolerCorrelationKey ?? createSpoolerCorrelationKey();
    paymentSpoolerCorrelationKey = spoolerCorrelationKey;
    syncPendingPaymentSessionState();
    const requestIdempotencyKey = getOrCreatePaymentIdempotencyKey();
    activeSpoolerCorrelationKey = spoolerCorrelationKey;
    lastSpoolerCorrelationKey = spoolerCorrelationKey;

    try {
      const response = await fetchWithTimeout('/api/confirm-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': requestIdempotencyKey,
        },
        body: JSON.stringify({
          amount: totalPrice,
          mode: config.mode,
          sessionId: config.sessionId,
          documentId: config.documentId ?? uploadedDocumentId ?? undefined,
          copies: config.copies,
          colorMode: getDisplayColorMode(),
          orientation: config.orientation,
          paperSize: config.paperSize,
          pageRange: config.pageRange,
          duplex: config.duplex === true,
          spoolerCorrelationKey,
        }),
      });

      if (!response.ok) {
        clearSpoolerFinalizationTimer();
        activeSpoolerCorrelationKey = null;
        lastSpoolerCorrelationKey = null;
        clearPendingPaymentSessionState();
        hideOverlay(printingOverlay);
        const payload = (await response.json()) as {
          error?: string;
          printerStatus?: string;
          inkStatus?: string;
          inkReason?: string;
        };
        const actionableMessage = payload.inkReason
          ? `${payload.error ?? 'Payment confirmation failed.'} (${payload.inkReason})`
          : (payload.error ?? 'Payment confirmation failed.');
        const blockingStatus =
          payload.printerStatus ??
          payload.inkStatus ??
          (payload.inkReason ? 'Ink preflight blocked' : undefined);
        if (statusMessage)
          statusMessage.textContent = actionableMessage;

        isProcessingPayment = false;
        if (blockingStatus) {
          setPrinterReadyState(false, blockingStatus, actionableMessage);
          return;
        }
        applyConfirmGate(actionableMessage);
        return;
      }

      const payload = (await response.json()) as {
        change?: {
          state?: 'none' | 'dispensed' | 'failed';
          requested?: number;
          message?: string;
        };
      };
      const awaitingSpoolerTerminal =
        lastSpoolerCorrelationKey === spoolerCorrelationKey;
      if (!awaitingSpoolerTerminal) {
        clearPendingPaymentSessionState();
      }

      if (awaitingSpoolerTerminal && payload.change?.state === 'failed') {
        setPrintingPhase('failed');
        if (statusMessage) {
          statusMessage.textContent =
            'Print job accepted. Change dispensing failed. Please contact staff.';
        }
        setCoinEventMessage(
          `Change owed: ₱ ${payload.change.requested ?? 0}. Staff assistance required.`,
        );
      } else if (
        awaitingSpoolerTerminal &&
        payload.change?.state === 'dispensed'
      ) {
        setPrintingPhase('printing');
        if (statusMessage) {
          statusMessage.textContent =
            'Payment confirmed. Waiting for printer completion...';
        }
      } else if (awaitingSpoolerTerminal && statusMessage) {
        statusMessage.textContent = 'Payment confirmed. Sending to spooler...';
      }

      // Ensure the printing overlay is visible for at least MIN_OVERLAY_MS
      const remaining = MIN_OVERLAY_MS - (Date.now() - overlayStart);
      if (remaining > 0) await wait(remaining);

      if (awaitingSpoolerTerminal && statusMessage) {
        statusMessage.textContent =
          'Waiting for printer spooler confirmation...';
      }
    } catch (error) {
      clearSpoolerFinalizationTimer();
      hideOverlay(printingOverlay);
      isProcessingPayment = false;
      applyConfirmGate();
      if (statusMessage) {
        statusMessage.textContent = isAbortError(error)
          ? 'Printing request timed out. Please check printer status and try again.'
          : 'Network error while starting print. Please try again.';
      }
      // Only clear correlation keys on real failures, not on AbortErrors
      if (!isAbortError(error)) {
        activeSpoolerCorrelationKey = null;
        lastSpoolerCorrelationKey = null;
        clearPendingPaymentSessionState();
      }
    }
  }
  if (config.mode !== 'print' || lastSpoolerCorrelationKey === null) {
    isProcessingPayment = false;
    applyConfirmGate();
  }
});

async function pollCopyJob(
  jobId: string,
): Promise<{ state: 'succeeded' | 'failed' | 'cancelled'; reason?: string }> {
  const startedAt = Date.now();
  let timeoutReason: string | undefined;
  while (Date.now() - startedAt < COPY_JOB_POLL_TIMEOUT_MS) {
    try {
      const res = await fetchWithTimeout(
        `/api/copy/jobs/${encodeURIComponent(jobId)}`,
        { method: 'GET' },
      );
      if (!res.ok) {
        await wait(COPY_JOB_POLL_INTERVAL_MS);
        continue;
      }
      const data = (await res.json()) as {
        state: string;
        progress?: { pagesCompleted: number; pagesTotal: number | null };
        failure?: { message?: string };
      };
      const { state, progress, failure } = data;

      if (state === 'queued' && statusMessage) {
        statusMessage.textContent = 'Preparing printer...';
      } else if (state === 'running' && statusMessage) {
        if (progress && progress.pagesTotal) {
          statusMessage.textContent = `Printing copy ${progress.pagesCompleted} of ${progress.pagesTotal}...`;
        } else {
          statusMessage.textContent = 'Printing your copy... please wait.';
        }
      } else if (state === 'cancel_requested' && statusMessage) {
        statusMessage.textContent = 'Cancelling copy job...';
      }

      if (
        state === 'succeeded' ||
        state === 'failed' ||
        state === 'cancelled'
      ) {
        return {
          state: state as 'succeeded' | 'failed' | 'cancelled',
          reason:
            typeof failure?.message === 'string' && failure.message.trim()
              ? failure.message
              : undefined,
        };
      }
    } catch (error) {
      if (isAbortError(error)) {
        timeoutReason = 'Copy status request timed out.';
      }
      await wait(COPY_JOB_POLL_INTERVAL_MS);
      continue;
    }
    await wait(COPY_JOB_POLL_INTERVAL_MS);
  }

  return {
    state: 'failed',
    reason:
      timeoutReason ??
      'Copy job status timed out. Please check the printer and retry.',
  };
}

thankYouDoneBtn?.addEventListener('click', () => {
  hideOverlay(thankYouOverlay);
  window.location.href = '/';
});
jamRefundDoneBtn?.addEventListener('click', () => {
  teardownJamRefundFocusTrap();
  hideOverlay(jamRefundOverlay);
  clearConfirmSessionStorage();
  window.location.href = '/';
});
const scanQrDoneBtn = document.getElementById(
  'scanQrDoneBtn',
) as HTMLButtonElement | null;
scanQrDoneBtn?.addEventListener('click', () => {
  window.location.href = '/';
});
resetBalanceBtn?.addEventListener('click', () => {
  void resetBalanceForTesting();
});

async function insertTestCoin(value: number): Promise<void> {
  const buttons = document.querySelectorAll<HTMLButtonElement>('.coin-btn');
  buttons.forEach((b) => (b.disabled = true));

  try {
    const response = await fetch('/api/balance/add-test-coin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });

    const payload = (await response.json()) as {
      balance?: number;
      error?: string;
    };
    if (!response.ok) {
      setCoinEventMessage(payload.error ?? 'Failed to insert coin.');
    }
  } catch {
    setCoinEventMessage('Network error inserting test coin.');
  } finally {
    buttons.forEach((b) => (b.disabled = coinSlotIsLocked));
  }
}

document.querySelectorAll<HTMLButtonElement>('.coin-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const value = parseInt(btn.dataset.value ?? '0', 10);
    if (value > 0) void insertTestCoin(value);
  });
});

const ioFactory = (
  window as unknown as { io?: (...args: unknown[]) => SocketLike }
).io;

if (typeof ioFactory === 'function') {
  socket = ioFactory();
  socket.on('balance', (amount: unknown) => {
    if (typeof amount === 'number') {
      updateBalanceUI(amount);
    }
  });

  socket.on('coinAccepted', (payload: unknown) => {
    if (
      payload &&
      typeof payload === 'object' &&
      'value' in payload &&
      typeof (payload as { value: unknown }).value === 'number'
    ) {
      const value = (payload as { value: number }).value;
      setCoinEventMessage(`Last accepted coin: ₱ ${value}`);
    }
  });

  socket.on('coinRejected', (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;
    const reason =
      'reason' in payload &&
      typeof (payload as { reason: unknown }).reason === 'string'
        ? (payload as { reason: string }).reason
        : 'Coin rejected by machine safety checks.';

    if (reason === 'slot_locked') {
      setCoinEventMessage(
        'Coin returned - slot is locked (balance sufficient).',
      );
      return;
    }
    const printerStatus =
      'printerStatus' in payload &&
      typeof (payload as { printerStatus: unknown }).printerStatus === 'string'
        ? (payload as { printerStatus: string }).printerStatus
        : null;

    setCoinEventMessage(`Coin rejected: ${reason}.`);
    if (statusMessage) {
      statusMessage.textContent = printerStatus
        ? `Coin rejected. Printer status: ${printerStatus}.`
        : `Coin rejected. ${reason}.`;
    }

    const reasonLower = reason.trim().toLowerCase();
    const faultLock =
      'faultLock' in payload &&
      (payload as { faultLock: unknown }).faultLock &&
      typeof (payload as { faultLock: unknown }).faultLock === 'object'
        ? ((
            payload as {
              faultLock: {
                source?: unknown;
                reason?: unknown;
                status?: unknown;
                lockedAt?: unknown;
              };
            }
          ).faultLock ?? null)
        : null;
    const fallbackStatusLower =
      typeof printerStatus === 'string' && printerStatus.trim()
        ? printerStatus.trim().toLowerCase()
        : null;
    const faultStatusLower =
      faultLock &&
      typeof faultLock.status === 'string' &&
      faultLock.status.trim()
        ? faultLock.status.trim().toLowerCase()
        : fallbackStatusLower;

    const hasCanonicalFaultStatus =
      faultStatusLower !== null &&
      CANONICAL_PRINTER_FAULT_STATUSES.has(faultStatusLower);
    const hasCanonicalFaultReason =
      CANONICAL_COIN_REJECTION_FAULT_REASONS.has(reasonLower) ||
      /^printer fault lock active:\s.+$/.test(reasonLower) ||
      (reasonLower.startsWith('printer status:') &&
        faultStatusLower !== null &&
        CANONICAL_PRINTER_FAULT_STATUSES.has(faultStatusLower));

    if (hasCanonicalFaultStatus || hasCanonicalFaultReason) {
      setPrinterReadyState(false, printerStatus ?? reason);
    }
  });

  socket.on('coinParserWarning', (payload: unknown) => {
    if (
      payload &&
      typeof payload === 'object' &&
      'message' in payload &&
      typeof (payload as { message: unknown }).message === 'string'
    ) {
      setCoinEventMessage(
        `Serial note: ${(payload as { message: string }).message}`,
      );
    }
  });

  socket.on('changeDispenseStatus', (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;

    const state =
      'state' in payload &&
      typeof (payload as { state: unknown }).state === 'string'
        ? (payload as { state: string }).state
        : '';
    const amount =
      'amount' in payload &&
      typeof (payload as { amount: unknown }).amount === 'number'
        ? (payload as { amount: number }).amount
        : 0;

    if (state === 'dispensing') {
      setPrintingPhase('dispensing');
      if (statusMessage) {
        statusMessage.textContent = `Dispensing change: ₱ ${amount}...`;
      }
      return;
    }

    if (state === 'dispensed') {
      setPrintingPhase('done');
      if (statusMessage) {
        statusMessage.textContent = `Change dispensed: ₱ ${amount}.`;
      }
      return;
    }

    if (state === 'failed') {
      setPrintingPhase('failed');
      if (statusMessage) {
        statusMessage.textContent =
          'Change dispensing failed. Please contact staff for settlement.';
      }
    }
  });

  socket.on('changeDispenseProgress', (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;

    const dispensed =
      'dispensed' in payload &&
      typeof (payload as { dispensed: unknown }).dispensed === 'number'
        ? (payload as { dispensed: number }).dispensed
        : 0;
    const total =
      'total' in payload &&
      typeof (payload as { total: unknown }).total === 'number'
        ? (payload as { total: number }).total
        : 0;

    if (total <= 0) return;

    setPrintingPhase('dispensing');
    if (statusMessage) {
      statusMessage.textContent = `Dispensing change: ${dispensed} / ${total} coin${total === 1 ? '' : 's'}...`;
    }
  });

  // [PRINTER GUARD] React to real-time printer state from printer-monitor.ts.
  // printerMalfunction fires when the printer enters a blocked/offline state.
  // printerRecovered fires when it comes back online.
  socket.on('printerMalfunction', (payload: unknown) => {
    const status =
      payload &&
      typeof payload === 'object' &&
      'status' in payload &&
      typeof (payload as { status: unknown }).status === 'string'
        ? (payload as { status: string }).status
        : 'Printer fault';
    setPrinterReadyState(false, status);
    setCoinEventMessage(
      `⚠ Printer not ready: ${status}. Do not insert coins until resolved.`,
    );
  });

  socket.on('printerRecovered', (payload: unknown) => {
    const status =
      payload &&
      typeof payload === 'object' &&
      'status' in payload &&
      typeof (payload as { status: unknown }).status === 'string'
        ? (payload as { status: string }).status
        : 'Idle';
    setPrinterReadyState(true, status);
    setCoinEventMessage('✓ Printer connected. You may now insert coins.');
  });

  socket.on('printJobDispatched', (payload: unknown) => {
    const spoolerCorrelationKey =
      payload &&
      typeof payload === 'object' &&
      'spoolerCorrelationKey' in payload &&
      typeof (payload as { spoolerCorrelationKey: unknown })
        .spoolerCorrelationKey === 'string'
        ? (payload as { spoolerCorrelationKey: string }).spoolerCorrelationKey
        : null;

    if (
      !activeSpoolerCorrelationKey ||
      spoolerCorrelationKey !== activeSpoolerCorrelationKey
    ) {
      return;
    }

    const printerName =
      payload &&
      typeof payload === 'object' &&
      'printerName' in payload &&
      typeof (payload as { printerName: unknown }).printerName === 'string'
        ? (payload as { printerName: string }).printerName
        : null;

    if (statusMessage) {
      statusMessage.textContent = printerName
        ? `✓ Job sent to "${printerName}". Printing...`
        : '✓ Job sent to printer. Printing...';
    }
    clearSpoolerFinalizationTimer();
    spoolerTimedOut = false;
    activeSpoolerCorrelationKey = null;
    setPrintingPhase('printing');
  });

  socket.on('printerSpoolerConfirmed', (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;

    const event: SpoolerConfirmedEvent = {
      jobStatus:
        'jobStatus' in payload &&
        typeof (payload as { jobStatus: unknown }).jobStatus === 'string'
          ? (payload as { jobStatus: string }).jobStatus
          : 'Printed',
      pagesPrinted:
        'pagesPrinted' in payload &&
        typeof (payload as { pagesPrinted: unknown }).pagesPrinted === 'number'
          ? (payload as { pagesPrinted: number }).pagesPrinted
          : 0,
      totalPages:
        'totalPages' in payload &&
        typeof (payload as { totalPages: unknown }).totalPages === 'number'
          ? (payload as { totalPages: number }).totalPages
          : 0,
      printerName:
        'printerName' in payload &&
        typeof (payload as { printerName: unknown }).printerName === 'string'
          ? (payload as { printerName: string }).printerName
          : null,
      transactionId:
        'transactionId' in payload &&
        typeof (payload as { transactionId: unknown }).transactionId ===
          'string'
          ? (payload as { transactionId: string }).transactionId
          : null,
      spoolerCorrelationKey:
        'spoolerCorrelationKey' in payload &&
        typeof (payload as { spoolerCorrelationKey: unknown })
          .spoolerCorrelationKey === 'string'
          ? (payload as { spoolerCorrelationKey: string }).spoolerCorrelationKey
          : null,
    };

    if (
      !event.spoolerCorrelationKey ||
      event.spoolerCorrelationKey !== lastSpoolerCorrelationKey
    ) {
      return;
    }

    clearSpoolerFinalizationTimer();
    hideOverlay(printingOverlay);
    showOverlay(thankYouOverlay);
    clearPendingPaymentSessionState();
    activeSpoolerCorrelationKey = null;
    if (statusMessage) {
      statusMessage.textContent = event.printerName
        ? `Printing complete on "${event.printerName}". Thank you!`
        : 'Printing complete. Thank you!';
    }
    clearConfirmSessionStorage();
    lastSpoolerCorrelationKey = null;
    spoolerTimedOut = false;
    isProcessingPayment = false;
    applyConfirmGate();
  });

  socket.on('printerSpoolerFailure', (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;

    const spoolerCorrelationKey =
      'spoolerCorrelationKey' in payload &&
      typeof (payload as { spoolerCorrelationKey: unknown })
        .spoolerCorrelationKey === 'string'
        ? (payload as { spoolerCorrelationKey: string }).spoolerCorrelationKey
        : null;
    const correlationMatches = Boolean(
      spoolerCorrelationKey &&
      (spoolerCorrelationKey === activeSpoolerCorrelationKey ||
        spoolerCorrelationKey === lastSpoolerCorrelationKey),
    );
    if (!correlationMatches) {
      return;
    }

    const event: SpoolerFailureEvent = {
      jobStatus:
        'jobStatus' in payload &&
        typeof (payload as { jobStatus: unknown }).jobStatus === 'string'
          ? (payload as { jobStatus: string }).jobStatus
          : 'Unknown',
      chargedAmount:
        'chargedAmount' in payload &&
        typeof (payload as { chargedAmount: unknown }).chargedAmount ===
          'number'
          ? (payload as { chargedAmount: number }).chargedAmount
          : 0,
      refundId:
        'refundId' in payload &&
        typeof (payload as { refundId: unknown }).refundId === 'string'
          ? (payload as { refundId: string }).refundId
          : '',
      pagesPrinted:
        'pagesPrinted' in payload &&
        typeof (payload as { pagesPrinted: unknown }).pagesPrinted === 'number'
          ? (payload as { pagesPrinted: number }).pagesPrinted
          : 0,
      totalPages:
        'totalPages' in payload &&
        typeof (payload as { totalPages: unknown }).totalPages === 'number'
          ? (payload as { totalPages: number }).totalPages
          : 0,
      printerName:
        'printerName' in payload &&
        typeof (payload as { printerName: unknown }).printerName === 'string'
          ? (payload as { printerName: string }).printerName
          : null,
      reason:
        'reason' in payload &&
        typeof (payload as { reason: unknown }).reason === 'string'
          ? (payload as { reason: string }).reason
          : 'Print spooler reported a failure.',
      refundDisposition:
        'refundDisposition' in payload &&
        (payload as { refundDisposition: unknown }).refundDisposition ===
          'pending_admin_review'
          ? 'pending_admin_review'
          : 'auto_refunded',
      restoredBalanceAmount:
        'restoredBalanceAmount' in payload &&
        typeof (payload as { restoredBalanceAmount: unknown })
          .restoredBalanceAmount === 'number'
          ? (payload as { restoredBalanceAmount: number }).restoredBalanceAmount
          : 0,
      transactionId:
        'transactionId' in payload &&
        typeof (payload as { transactionId: unknown }).transactionId ===
          'string'
          ? (payload as { transactionId: string }).transactionId
          : null,
      spoolerCorrelationKey,
    };

    clearSpoolerFinalizationTimer();
    clearPendingPaymentSessionState();
    activeSpoolerCorrelationKey = null;
    lastSpoolerCorrelationKey = null;
    spoolerTimedOut = false;
    isProcessingPayment = false;
    applyConfirmGate();
    showSpoolerFailureNotice(event);
  });

  socket.on('printerSpoolerTimeout', (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;

    const event: SpoolerTimeoutEvent = {
      jobStatus:
        'jobStatus' in payload &&
        typeof (payload as { jobStatus: unknown }).jobStatus === 'string'
          ? (payload as { jobStatus: string }).jobStatus
          : null,
      pagesPrinted:
        'pagesPrinted' in payload &&
        typeof (payload as { pagesPrinted: unknown }).pagesPrinted === 'number'
          ? (payload as { pagesPrinted: number }).pagesPrinted
          : 0,
      totalPages:
        'totalPages' in payload &&
        typeof (payload as { totalPages: unknown }).totalPages === 'number'
          ? (payload as { totalPages: number }).totalPages
          : 0,
      printerName:
        'printerName' in payload &&
        typeof (payload as { printerName: unknown }).printerName === 'string'
          ? (payload as { printerName: string }).printerName
          : null,
      transactionId:
        'transactionId' in payload &&
        typeof (payload as { transactionId: unknown }).transactionId ===
          'string'
          ? (payload as { transactionId: string }).transactionId
          : null,
      spoolerCorrelationKey:
        'spoolerCorrelationKey' in payload &&
        typeof (payload as { spoolerCorrelationKey: unknown })
          .spoolerCorrelationKey === 'string'
          ? (payload as { spoolerCorrelationKey: string }).spoolerCorrelationKey
          : null,
      monitorWindowMs:
        'monitorWindowMs' in payload &&
        typeof (payload as { monitorWindowMs: unknown }).monitorWindowMs ===
          'number'
          ? (payload as { monitorWindowMs: number }).monitorWindowMs
          : 0,
    };

    if (
      !event.spoolerCorrelationKey ||
      event.spoolerCorrelationKey !== lastSpoolerCorrelationKey
    ) {
      return;
    }
    if (spoolerTimedOut) return;

    activeSpoolerCorrelationKey = null;
    spoolerTimedOut = true;
    setPrintingPhase('printing');
    const progressLabel =
      event.totalPages > 0
        ? ` (${event.pagesPrinted}/${event.totalPages} pages reported)`
        : '';
    const timeoutMinutes =
      event.monitorWindowMs > 0
        ? Math.max(1, Math.round(event.monitorWindowMs / 60_000))
        : 3;
    if (statusMessage) {
      statusMessage.textContent = event.printerName
        ? `Still processing on "${event.printerName}"${progressLabel}. Please wait for final printer confirmation.`
        : `Still processing in printer spooler${progressLabel}. Please wait for final confirmation.`;
    }
    if (printingHint) {
      printingHint.textContent = `Processing is taking longer than usual (over ${timeoutMinutes} min). Do not turn off the machine.`;
    }
    setPrintingPhase('manual-review');
    if (statusMessage) {
      statusMessage.textContent = event.printerName
        ? `Spooler monitoring timed out on "${event.printerName}". Recovery review is in progress.`
        : 'Spooler monitoring timed out. Recovery review is in progress.';
    }
    if (printingHint) {
      printingHint.textContent =
        'Please keep this screen open and contact staff for verification.';
    }
    clearSpoolerFinalizationTimer();
  });

  socket.on('coinSlotLocked', (_payload: unknown) => {
    applyLockState(true);
  });

  socket.on('coinSlotUnlocked', (_payload: unknown) => {
    applyLockState(false);
  });
}

// [PRINTER GUARD] Fetches current printer readiness on page load.
// Must resolve before loadPricing/fetchInitialBalance so the gate is set
// before the balance UI attempts to enable the confirm button.
async function loadPrinterStatus(): Promise<void> {
  try {
    const res = await fetch('/api/printer/status');
    if (!res.ok) {
      setPrinterReadyState(false, `HTTP ${res.status}`);
      return;
    }
    const data = (await res.json()) as { ready: boolean; status: string };
    setPrinterReadyState(data.ready, data.status);
    if (!data.ready) {
      setCoinEventMessage(
        `⚠ Printer status: ${data.status}. Do not insert coins yet.`,
      );
    }
  } catch {
    // Network error — fail safe: keep printer locked
    setPrinterReadyState(false, 'Status unavailable');
  }
}

async function boot(): Promise<void> {
  await Promise.all([
    loadPrinterStatus(), // [PRINTER GUARD] must run first
    loadPricing(),
    fetchInitialBalance(),
  ]);
  applyConfirmGate();

  // Emit unlock when the user navigates back so the coin slot re-opens
  const backLink = document.getElementById('backLink');
  backLink?.addEventListener('click', () => {
    if (coinSlotIsLocked) {
      socket?.emit('unlockCoinSlot', { reason: 'navigation' });
    }
  });
}

void boot();
