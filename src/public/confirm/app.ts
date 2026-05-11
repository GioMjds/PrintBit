import QRCode from 'qrcode';
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
  duplex?: boolean;
  copies: number;
  orientation: 'portrait' | 'landscape';
  rotationDeg?: number;
  paperSize: 'A4' | 'Legal';
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
  pricingEngine?: {
    mode: 'legacy' | 'shadow' | 'live';
    subtotalExact: number;
    discountExact: number;
    finalExact: number;
    finalPayablePeso: number;
    pages: Array<{
      index: number;
      coverage: number;
      classification: string;
      rawPriceExact: number;
      isBlank: boolean;
    }>;
  };
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
const copiesValue = document.getElementById('copiesValue');
const pagesValue = document.getElementById('pagesValue');
const pagesRow = document.getElementById('pagesRow');
const smartPricingBreakdown = document.getElementById('smartPricingBreakdown');
const breakdownList = document.getElementById('breakdownList');

function updateSmartPricingBreakdown(quote: any): void {
  if (!smartPricingBreakdown || !breakdownList) return;

  if (!quote || !quote.pricingEngine || !quote.pricingEngine.pages) {
    smartPricingBreakdown.style.display = 'none';
    return;
  }

  const pe = quote.pricingEngine;
  if (pe.pages.length === 0) {
    smartPricingBreakdown.style.display = 'none';
    return;
  }

  smartPricingBreakdown.style.display = 'block';
  breakdownList.innerHTML = '';

  const tiers: Record<string, number> = {};
  pe.pages.forEach((page: any) => {
    let label = 'B&W Rate';
    if (page.classification === 'full_color') label = 'Full Color Rate';
    else if (page.classification === 'partial') {
      const decile = Math.max(1, Math.ceil(page.coverage * 10));
      label = `Economy Tier ${decile}`;
    } else if (page.classification === 'blank') label = 'Blank (No Charge)';

    tiers[label] = (tiers[label] || 0) + 1;
  });

  Object.entries(tiers).forEach(([label, count]) => {
    const li = document.createElement('li');
    li.className = 'breakdown-item';
    li.innerHTML = `
      <span class="breakdown-item__tier">${label}</span>
      <span class="breakdown-item__count">${count} page${count > 1 ? 's' : ''}</span>
    `;
    breakdownList.appendChild(li);
  });
}

const orientationRow = document.getElementById('orientationRow');
const rotationValue = document.getElementById('rotationValue');
const paperSizeValue = document.getElementById('paperSizeValue');
const priceValue = document.getElementById('priceValue');
const balanceValue = document.getElementById('balanceValue');
const changeValue = document.getElementById('changeValue');
const changeRow = document.getElementById('changeRow');
const statusMessage = document.getElementById('statusMessage');
const printErrorPanel = document.getElementById('printErrorPanel');
const printErrorTitle = document.getElementById('printErrorTitle');
const printErrorMessage = document.getElementById('printErrorMessage');
const printErrorHint = document.getElementById('printErrorHint');
const printErrorDismissBtn = document.getElementById(
  'printErrorDismissBtn',
) as HTMLButtonElement | null;
const coinInsertNote = document.getElementById('coinInsertNote');
const footerNote = document.getElementById('footerNote');
const coinToast = document.getElementById('coinToast');
const confirmBtn = document.getElementById('confirmBtn') as HTMLButtonElement;

const DEFAULT_COIN_INSERT_GUIDANCE_MESSAGE =
  'Tip: Insert one coin at a time. Rapid insertion may not be detected by the kiosk.';
const COIN_INSERT_GUIDANCE_MESSAGE =
  coinInsertNote?.textContent?.trim() ||
  footerNote?.textContent?.trim() ||
  DEFAULT_COIN_INSERT_GUIDANCE_MESSAGE;

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
let printerReady = false;
let activeWarningMessage: string | null = null;
let activeBlockingError: PublicPrintError | null = null;

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
currentPrintQuote = config.mode === 'print' ? (config.quote ?? null) : null;

if (currentPrintQuote) {
  updateSmartPricingBreakdown(currentPrintQuote);
}

const currentPaymentFingerprint = JSON.stringify({
  mode: config.mode,
  sessionId: config.sessionId ?? null,
  documentId: config.documentId ?? null,
  copies: config.copies,
  colorMode: config.colorMode,
  duplex: config.duplex === true,
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
  if (config.mode === 'print' && currentPrintQuote) {
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
if (colorValue) colorValue.textContent = getColorModeSummaryLabel();
if (copiesValue) copiesValue.textContent = String(config.copies);
if (pagesValue) pagesValue.textContent = pageRangeLabel(config.pageRange);
if (orientationRow) orientationRow.setAttribute('hidden', '');
if (rotationValue) rotationValue.textContent = `${config.rotationDeg}°`;
if (paperSizeValue)
  paperSizeValue.textContent = formatPaperSizeForPricing(config.paperSize);
if (priceValue) priceValue.textContent = 'Loading...';

function applyLockState(locked: boolean): void {
  coinSlotIsLocked = locked;
  const changeAmount = Math.max(0, currentBalance - totalPrice);

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
    return;
  }

  if (activeWarningMessage) {
    confirmBtn.disabled = true;
    confirmBtn.setAttribute('aria-disabled', 'true');
    statusMessage.textContent = activeWarningMessage;
    return;
  }

  if (!pricingLoaded) {
    confirmBtn.disabled = true;
    confirmBtn.setAttribute('aria-disabled', 'true');
    statusMessage.textContent =
      statusOverride ?? pricingError ?? 'Loading pricing...';
    return;
  }

  if (!printerReady) {
    confirmBtn.disabled = true;
    confirmBtn.setAttribute('aria-disabled', 'true');
    statusMessage.textContent =
      statusOverride ??
      `Printer not ready (${latestPrinterStatusLabel}). Please wait before inserting coins.`;
    return;
  }

  if (currentBalance >= totalPrice) {
    confirmBtn.disabled = false;
    confirmBtn.setAttribute('aria-disabled', 'false');
    statusMessage.textContent =
      statusOverride ?? 'Sufficient balance detected. You can confirm now.';
  } else {
    const needed = totalPrice - currentBalance;
    confirmBtn.disabled = true;
    confirmBtn.setAttribute('aria-disabled', 'true');
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
  if (config.mode === 'print') {
    try {
      if (!config.sessionId) throw new Error('Print session is required.');

      const response = await fetch('/api/print/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: config.sessionId,
          documentId: config.documentId ?? uploadedDocumentId ?? undefined,
          copies: config.copies,
          colorMode: config.colorMode,
          orientation: config.orientation,
          rotationDeg: config.rotationDeg,
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
      updateSmartPricingBreakdown(currentPrintQuote);
      totalPrice = payload.quote.requiredAmount;
      pricingLoaded = true;
      pricingError = null;
      if (priceValue) priceValue.textContent = `₱ ${totalPrice}`;
      if (colorValue) colorValue.textContent = getColorModeSummaryLabel();
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
    printPerPage: payload.printPerPage ?? DEFAULT_PRICING.printPerPage,
    copyPerPage: payload.copyPerPage ?? DEFAULT_PRICING.copyPerPage,
    colorSurcharge: payload.colorSurcharge ?? DEFAULT_PRICING.colorSurcharge,
    scanDocument: payload.scanDocument ?? DEFAULT_PRICING.scanDocument,
  };

  totalPrice = calculateLegacyTotalPrice(safePricing);
  pricingLoaded = true;
  pricingError = null;
  if (priceValue) priceValue.textContent = `₱ ${totalPrice}`;
  updateChangeDisplay(currentBalance);
  syncCoinSlotLockState();
  applyConfirmGate();
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
const modalPrice = document.getElementById('modalPrice');
const printingOverlay = document.getElementById('printingOverlay');
const printingSubtitle = document.getElementById('printingSubtitle');
const printingHint = document.getElementById('printingHint');
const thankYouOverlay = document.getElementById('thankYouOverlay');
const thankYouDoneBtn = document.getElementById(
  'thankYouDoneBtn',
) as HTMLButtonElement;
const jamRefundOverlay = document.getElementById('jamRefundOverlay');
const jamRefundTitle = document.getElementById('jamRefundTitle');
const jamRefundMessage = document.getElementById('jamRefundMessage');
const jamRefundHint = document.getElementById('jamRefundHint');
const jamRefundDoneBtn = document.getElementById(
  'jamRefundDoneBtn',
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
const thankYouCountdown = document.getElementById(
  'thankYouCountdown',
) as HTMLElement | null;
const thankYouCountdownSeconds = document.getElementById(
  'thankYouCountdownSeconds',
) as HTMLElement | null;
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
let thankYouAutoRedirectHandle: number | null = null;
const THANKYOU_AUTO_REDIRECT_SECONDS = 10;
const NETWORK_REQUEST_TIMEOUT_MS = 30_000;

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
  showOverlay(thankYouOverlay);
  clearPendingPaymentSessionState();
  activeSpoolerCorrelationKey = null;
  clearPrintErrorPanel();
  if (statusMessage)
    statusMessage.textContent = 'Printing complete. Thank you!';
  renderReceiptCta();
  lastSpoolerCorrelationKey = null;
  isProcessingPayment = false;
  applyConfirmGate();
  void checkRemainingFilesAndPrompt();
}

function syncPendingPaymentSessionState(): void {
  if (config.mode !== 'print') return;
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

function clearPrintErrorPanel(): void {
  if (printErrorPanel) {
    printErrorPanel.hidden = true;
    printErrorPanel.removeAttribute('data-severity');
  }
  if (printErrorTitle) printErrorTitle.textContent = '';
  if (printErrorMessage) printErrorMessage.textContent = '';
  if (printErrorHint) {
    printErrorHint.textContent = '';
    printErrorHint.setAttribute('hidden', '');
  }
  if (printErrorDismissBtn) printErrorDismissBtn.setAttribute('hidden', '');
  activeWarningMessage = null;
  activeBlockingError = null;
}

function showPrintErrorPanel(error: PublicPrintError): void {
  if (activeBlockingError && error.severity === 'WARNING') {
    return;
  }
  const titleKey = getPrintErrorTitleKey(error.severity);
  const message = getPrintErrorMessageKey(error);
  const hintKey = getPrintErrorHintKey(error);

  if (printErrorTitle) printErrorTitle.textContent = titleKey;
  if (printErrorMessage) printErrorMessage.textContent = message;
  if (printErrorHint) {
    if (hintKey) {
      printErrorHint.textContent = hintKey;
      printErrorHint.removeAttribute('hidden');
    } else {
      printErrorHint.textContent = '';
      printErrorHint.setAttribute('hidden', '');
    }
  }
  if (printErrorPanel) {
    printErrorPanel.hidden = false;
    printErrorPanel.setAttribute('data-severity', error.severity);
  }
  if (printErrorDismissBtn) {
    if (error.severity === 'WARNING') {
      printErrorDismissBtn.removeAttribute('hidden');
    } else {
      printErrorDismissBtn.setAttribute('hidden', '');
    }
  }

  if (error.severity === 'WARNING') {
    activeWarningMessage = message;
    return;
  }

  activeWarningMessage = null;
  activeBlockingError = error;
}

function showPrintWarningToast(error: PublicPrintError): void {
  if (!coinToast) return;
  coinToast.textContent = error.userMessage;
  window.setTimeout(() => {
    if (coinToast.textContent === error.userMessage) {
      coinToast.textContent = '';
    }
  }, 6000);
}

function formatRefundHint(payload?: PrintErrorPayload): string {
  const disposition =
    payload?.refundDisposition ?? payload?.printError?.refundDisposition ?? null;
  const restored =
    typeof payload?.restoredBalanceAmount === 'number'
      ? payload.restoredBalanceAmount
      : null;
  const charged =
    typeof payload?.chargedAmount === 'number' ? payload.chargedAmount : null;

  if (disposition === 'auto_refunded') {
    const amount = restored ?? charged;
    return typeof amount === 'number' && amount > 0
      ? `Your ₱${amount} has been returned to your kiosk balance.`
      : 'Your payment has been returned to your kiosk balance.';
  }
  if (disposition === 'pending_admin_review') {
    return 'A refund review has been created for staff. Please keep your reference ID.';
  }
  if (disposition === 'refund_blocked_trusted_time') {
    return 'Staff must review this refund because kiosk time is not synchronized.';
  }
  return 'Please contact staff if you need assistance.';
}

function showPrintErrorModal(
  error: PublicPrintError,
  payload?: PrintErrorPayload,
): void {
  if (error.severity === 'WARNING') {
    showPrintWarningToast(error);
    return;
  }

  hideOverlay(printingOverlay);
  hideOverlay(thankYouOverlay);
  if (jamRefundTitle) {
    jamRefundTitle.textContent =
      error.severity === 'FATAL'
        ? 'Printing Stopped'
        : 'Printer Needs Attention';
  }
  if (jamRefundMessage) jamRefundMessage.textContent = error.userMessage;
  if (jamRefundHint) jamRefundHint.textContent = formatRefundHint(payload);
  showOverlay(jamRefundOverlay);
  jamRefundDoneBtn?.focus();
}

function printEventMatchesCurrentJob(payload: PrintErrorPayload): boolean {
  const eventCorrelation =
    typeof payload.spoolerCorrelationKey === 'string'
      ? payload.spoolerCorrelationKey
      : null;
  const eventTransaction =
    typeof payload.transactionId === 'string'
      ? payload.transactionId
      : (payload.printError?.transactionId ?? null);
  const eventSession = payload.printError?.sessionId ?? null;

  if (
    activeSpoolerCorrelationKey &&
    eventCorrelation &&
    eventCorrelation === activeSpoolerCorrelationKey
  ) {
    return true;
  }
  if (
    currentTransactionId &&
    eventTransaction &&
    eventTransaction === currentTransactionId
  ) {
    return true;
  }
  return Boolean(config.sessionId && eventSession === config.sessionId);
}

function handlePrintErrorPayload(payload: unknown): void {
  const error = extractPrintError(payload);
  if (!error) return;
  const printPayload =
    payload && typeof payload === 'object' ? (payload as PrintErrorPayload) : {};
  if (!printEventMatchesCurrentJob(printPayload) && error.severity !== 'WARNING') {
    return;
  }
  const errorMessage = getPrintErrorMessageKey(error);
  showPrintErrorPanel(error);
  showPrintErrorModal(error, printPayload);
  if (error.severity === 'WARNING') {
    applyConfirmGate(errorMessage);
    return;
  }

  isProcessingPayment = false;
  clearPendingPaymentSessionState();
  activeSpoolerCorrelationKey = null;
  applyConfirmGate(errorMessage);
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
  if (modalColor) modalColor.textContent = getColorModeSummaryLabel();
  if (modalCopies) modalCopies.textContent = String(config.copies);
  if (modalPages) modalPages.textContent = pageRangeLabel(config.pageRange);
  if (modalPrice) modalPrice.textContent = `₱ ${totalPrice}`;
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
  clearPrintErrorPanel();
  sessionStorage.removeItem('printbit.config');
  sessionStorage.removeItem('printbit.copyPreviewPath');
  sessionStorage.removeItem('printbit.copyPreviewReleaseToken');
  sessionStorage.removeItem('printbit.uploadedFile');
  sessionStorage.removeItem('printbit.uploadedDocumentId');
  sessionStorage.removeItem('printbit.sessionId');
  sessionStorage.removeItem('printbit.sessionToken');
}

function startThankYouAutoRedirect(): void {
  let remaining = THANKYOU_AUTO_REDIRECT_SECONDS;
  if (thankYouCountdownSeconds)
    thankYouCountdownSeconds.textContent = String(remaining);
  thankYouCountdown?.removeAttribute('hidden');
  thankYouAutoRedirectHandle = window.setInterval(() => {
    remaining -= 1;
    if (thankYouCountdownSeconds)
      thankYouCountdownSeconds.textContent = String(Math.max(0, remaining));
    if (remaining <= 0) {
      window.clearInterval(thankYouAutoRedirectHandle!);
      clearConfirmSessionStorage();
      window.location.href = '/';
    }
  }, 1000);
}

async function checkRemainingFilesAndPrompt(): Promise<void> {
  if (config.mode !== 'print' || !config.sessionId) {
    clearConfirmSessionStorage();
    startThankYouAutoRedirect();
    return;
  }
  // Simplified for brevity
  startThankYouAutoRedirect();
}

confirmBtn?.addEventListener('click', () => showModal());
modalCancelBtn?.addEventListener('click', () => hideModal());
printErrorDismissBtn?.addEventListener('click', () => {
  clearPrintErrorPanel();
  applyConfirmGate();
});

modalConfirmBtn?.addEventListener('click', async () => {
  modalConfirmBtn.disabled = true;
  hideModal();
  confirmBtn.disabled = true;
  isProcessingPayment = true;
  showOverlay(printingOverlay);
  setPrintingPhase('printing');

  try {
    if (config.mode === 'scan') {
      // Scan implementation...
    } else if (config.mode === 'copy') {
      // Copy implementation...
    } else {
      // Print implementation...
      const spoolerCorrelationKey =
        paymentSpoolerCorrelationKey ?? createSpoolerCorrelationKey();
      paymentSpoolerCorrelationKey = spoolerCorrelationKey;
      syncPendingPaymentSessionState();

      const response = await fetchWithTimeout('/api/confirm-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: totalPrice,
          mode: config.mode,
          sessionId: config.sessionId,
          documentId: config.documentId,
          copies: config.copies,
          colorMode: getDisplayColorMode(),
          pageRange: config.pageRange,
          spoolerCorrelationKey,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as
        ReceiptLinkPayload &
          PrintErrorPayload & {
            transactionId?: string | null;
            printWarnings?: PublicPrintError[];
          };
      if (!response.ok) {
        const printError = extractPrintError(payload);
        if (printError) {
          showPrintErrorModal(printError, payload);
          isProcessingPayment = false;
          modalConfirmBtn.disabled = false;
          applyConfirmGate(printError.userMessage);
          return;
        }
        throw new Error('Payment failed');
      }
      if (Array.isArray(payload.printWarnings)) {
        payload.printWarnings.forEach((warning) =>
          showPrintWarningToast(warning),
        );
        const latestWarning =
          payload.printWarnings[payload.printWarnings.length - 1];
        if (latestWarning) {
          showPrintErrorPanel(latestWarning);
          applyConfirmGate(getPrintErrorMessageKey(latestWarning));
        }
      }
      const successPayload = payload as ReceiptLinkPayload & {
        transactionId?: string | null;
      };
      captureReceiptCta(successPayload);
      if (config.mode === 'print') {
        activeSpoolerCorrelationKey = spoolerCorrelationKey;
        lastSpoolerCorrelationKey = spoolerCorrelationKey;
        setTransactionReference(successPayload.transactionId ?? null);
        if (statusMessage) {
          statusMessage.textContent =
            'Payment accepted. Waiting for printer confirmation...';
        }
        setPrintingPhase('printing');
        return;
      }
      finalizePrintSuccess(successPayload.transactionId ?? null);
    }
  } catch {
    hideOverlay(printingOverlay);
    isProcessingPayment = false;
    modalConfirmBtn.disabled = false;
    applyConfirmGate('Error processing payment.');
  }
});

thankYouDoneBtn?.addEventListener('click', () => {
  if (thankYouAutoRedirectHandle)
    window.clearInterval(thankYouAutoRedirectHandle);
  clearConfirmSessionStorage();
  window.location.href = '/';
});

jamRefundDoneBtn?.addEventListener('click', () => {
  hideOverlay(jamRefundOverlay);
  clearConfirmSessionStorage();
  window.location.href = '/';
});

const ioFactory = (window as any).io;
if (typeof ioFactory === 'function') {
  const connectedSocket = ioFactory() as SocketLike;
  socket = connectedSocket;
  connectedSocket.on('balance', (amount: unknown) => {
    if (typeof amount === 'number') updateBalanceUI(amount);
  });
  connectedSocket.on('printErrorRaised', handlePrintErrorPayload);
  connectedSocket.on('printerMalfunction', handlePrintErrorPayload);
  connectedSocket.on('printerSpoolerFailure', handlePrintErrorPayload);
  connectedSocket.on('printerSpoolerTimeout', handlePrintErrorPayload);
  connectedSocket.on('printLifecycleState', (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;
    const lifecycle = payload as PrintErrorPayload & {
      state?: string;
      receipt?: ReceiptLinkPayload['receipt'];
    };
    if (!printEventMatchesCurrentJob(lifecycle)) return;
    if (lifecycle.printError) {
      handlePrintErrorPayload(lifecycle);
      return;
    }
    if (lifecycle.state === 'printed') {
      if (lifecycle.receipt) captureReceiptCta({ receipt: lifecycle.receipt });
      finalizePrintSuccess(lifecycle.transactionId ?? currentTransactionId);
    }
  });
  connectedSocket.on('printerSpoolerConfirmed', (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;
    const event = payload as PrintErrorPayload & {
      receipt?: ReceiptLinkPayload['receipt'];
    };
    if (!printEventMatchesCurrentJob(event)) return;
    if (event.receipt) captureReceiptCta({ receipt: event.receipt });
    finalizePrintSuccess(event.transactionId ?? currentTransactionId);
  });
}

async function loadPrinterStatus(): Promise<void> {
  try {
    const res = await fetch('/api/printer/status');
    const data = await res.json();
    printerReady = data.ready;
    latestPrinterStatusLabel = data.status;
    applyConfirmGate();
  } catch {
    printerReady = false;
    applyConfirmGate();
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
