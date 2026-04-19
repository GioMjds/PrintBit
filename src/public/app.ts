import QRCode from 'qrcode';
import {
  initKioskLocalization,
  KIOSK_LANGUAGE_CHANGED_EVENT,
  translation,
} from './shared/kiosk-i18n';

type SocketLike = {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
};

void initKioskLocalization();

const ioFactory = (
  window as unknown as { io?: (...args: unknown[]) => SocketLike }
).io;

if (typeof ioFactory === 'function') {
  const socket = ioFactory();
  socket.on('balance', (amount: unknown) => {
    const el = document.getElementById('balance');
    if (el && typeof amount === 'number') el.textContent = String(amount);
  });
}

function navigateTo(path: string) {
  window.location.href = path;
}

const PRINT_ONBOARDING_TRIGGER_KEY = 'printbit.showPrintOnboardingModal';

const openPrint = document.getElementById('openPrintBtn');
const openCopy = document.getElementById('openCopyBtn');
const openScan = document.getElementById('openScanBtn');
const powerOff = document.getElementById('powerOffBtn');

openPrint?.addEventListener('click', () => {
  sessionStorage.setItem(PRINT_ONBOARDING_TRIGGER_KEY, '1');
  navigateTo('/print');
});
openCopy?.addEventListener('click', () => navigateTo('/copy'));
openScan?.addEventListener('click', () => navigateTo('/scan'));

powerOff?.addEventListener('click', () => {
  const ok = confirm('Power off device?');
  if (!ok) return;
  alert('Powering off...');
});

// ── Homepage clock ─────────────────────────────────────────────────────────────

const clockTimeEl = document.getElementById('clockTime');
const clockDateEl = document.getElementById('clockDate');

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function updateClock(): void {
  if (!clockTimeEl || !clockDateEl) return;

  const now = new Date();
  const hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;

  clockTimeEl.textContent = `${h12}:${minutes} ${ampm}`;
  clockDateEl.textContent = `${DAY_NAMES[now.getDay()]}, ${MONTH_NAMES[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
}

updateClock();
window.setInterval(updateClock, 1000);

// ── Guide overlay modal ────────────────────────────────────────────────────────

interface PrintGuideStep {
  imageUrl: string;
  captionKey: string;
  captionFallback: string;
}

const printGuideSteps: PrintGuideStep[] = [
  {
    imageUrl: '/assets/print-steps/step-1.png',
    captionKey: 'print.guide.step1',
    captionFallback: 'Scan "PrintBit"\'s QR code from your device to connect first.',
  },
  {
    imageUrl: '/assets/print-steps/step-2.png',
    captionKey: 'print.guide.step2',
    captionFallback: 'Scan the QR code shown in the kiosk to open the upload page on your device.',
  },
  {
    imageUrl: '/assets/print-steps/step-3.jpg',
    captionKey: 'print.guide.step3',
    captionFallback: 'Upload your document file(s) from your device.',
  },
  {
    imageUrl: '/assets/print-steps/step-4.jpg',
    captionKey: 'print.guide.step4',
    captionFallback: 'Press "Send to Kiosk" to transfer your file(s) to the kiosk.',
  },
  {
    imageUrl: '/assets/print-steps/step-5.jpg',
    captionKey: 'print.guide.step5',
    captionFallback: 'Wait for the upload to complete. If it is successful, please check in the kiosk to review your file(s).',
  },
  {
    imageUrl: '/assets/print-steps/step-6.png',
    captionKey: 'print.guide.step6',
    captionFallback: 'Your uploaded file(s) will appear on the kiosk screen. Review your file(s) and press "Proceed to Config" for the next step.',
  },
  {
    imageUrl: '/assets/print-steps/step-7.png',
    captionKey: 'print.guide.step7',
    captionFallback: 'Configure your print settings (e.g. number of copies, color or black & white) and then press "Continue" for confirmation step and to insert coins.',
  },
  {
    imageUrl: '/assets/print-steps/step-8.png',
    captionKey: 'print.guide.step8',
    captionFallback: 'You may now proceed to insert coins. Press "Confirm & Print" and wait for the printing to start.',
  },
];

const guideOverlay = document.getElementById('guideOverlay');
const guideCards = guideOverlay?.querySelectorAll<HTMLElement>('.guide-card');
const printGuideImage = document.getElementById(
  'printGuideImage',
) as HTMLImageElement | null;
const printGuideCounter = document.getElementById('printGuideCounter');
const printGuideCaption = document.getElementById('printGuideCaption');
const printGuidePrevBtn = document.getElementById(
  'printGuidePrevBtn',
) as HTMLButtonElement | null;
const printGuideNextBtn = document.getElementById(
  'printGuideNextBtn',
) as HTMLButtonElement | null;

let activeGuide: string | null = null;
let printGuideIndex = 0;
const PRINT_GUIDE_NEXT_KEY = 'print.guide.next';
const PRINT_GUIDE_GOT_IT_KEY = 'print.guide.got_it';
const PRINT_GUIDE_NEXT_ARIA_KEY = 'print.guide.next_aria';
const PRINT_GUIDE_CLOSE_ARIA_KEY = 'print.guide.close_aria';

function isGuideOverlayVisible(): boolean {
  return guideOverlay?.classList.contains('is-visible') ?? false;
}

function renderPrintGuideStep(): void {
  if (
    !printGuideSteps.length ||
    !printGuideImage ||
    !printGuideCounter ||
    !printGuideCaption ||
    !printGuidePrevBtn ||
    !printGuideNextBtn
  ) {
    return;
  }

  const step = printGuideSteps[printGuideIndex];
  const isLastStep = printGuideIndex === printGuideSteps.length - 1;
  const nextActionLabel = translation(PRINT_GUIDE_NEXT_KEY, 'Next');
  const nextVisualLabel = isLastStep
    ? translation(PRINT_GUIDE_GOT_IT_KEY, '✖')
    : '❯';
  const isCloseIconState =
    isLastStep && nextVisualLabel.trim().replace(/\uFE0F/g, '').length <= 1;
  const nextAriaLabel = isLastStep
    ? translation(PRINT_GUIDE_CLOSE_ARIA_KEY, 'Close print guide modal')
    : translation(PRINT_GUIDE_NEXT_ARIA_KEY, 'Next print guide step');
  printGuideCounter.textContent = `Step ${printGuideIndex + 1} of ${printGuideSteps.length}`;
  printGuideCaption.textContent = translation(step.captionKey, step.captionFallback);
  printGuideImage.alt = `Print guide step ${printGuideIndex + 1}`;
  printGuideImage.style.visibility = 'visible';
  printGuideImage.src = step.imageUrl;
  printGuidePrevBtn.disabled = printGuideIndex === 0;
  printGuideNextBtn.disabled = false;
  printGuideNextBtn.textContent = nextVisualLabel;
  printGuideNextBtn.classList.toggle('is-label', isLastStep && !isCloseIconState);
  printGuideNextBtn.classList.toggle('is-close-icon', isCloseIconState);
  printGuideNextBtn.title = isLastStep ? nextAriaLabel : nextActionLabel;
  printGuideNextBtn.setAttribute('aria-label', nextAriaLabel);
}

function setPrintGuideStep(nextIndex: number): void {
  if (!printGuideSteps.length) return;
  if (nextIndex < 0) nextIndex = 0;
  if (nextIndex > printGuideSteps.length - 1) {
    nextIndex = printGuideSteps.length - 1;
  }
  printGuideIndex = nextIndex;
  renderPrintGuideStep();
}

function openGuide(name: string): void {
  if (!guideOverlay || !guideCards) return;

  guideCards.forEach((card) => {
    card.style.display = 'none';
  });

  activeGuide = name;
  const target = document.getElementById(`guide-${name}`) as HTMLElement | null;
  if (target) target.style.display = 'flex';
  if (name === 'print') setPrintGuideStep(0);

  guideOverlay.classList.add('is-visible');
  guideOverlay.setAttribute('aria-hidden', 'false');
}

function closeGuide(): void {
  if (!guideOverlay) return;
  guideOverlay.classList.remove('is-visible');
  guideOverlay.setAttribute('aria-hidden', 'true');
  activeGuide = null;
}

window.addEventListener(KIOSK_LANGUAGE_CHANGED_EVENT, () => {
  if (activeGuide === 'print' && isGuideOverlayVisible()) {
    renderPrintGuideStep();
  }
});

if (printGuideImage) {
  printGuideImage.addEventListener('load', () => {
    printGuideImage.style.visibility = 'visible';
  });
  printGuideImage.addEventListener('error', () => {
    printGuideImage.style.visibility = 'hidden';
    if (printGuideCaption) {
      printGuideCaption.textContent = 'Step image unavailable for this step.';
    }
  });
}

printGuidePrevBtn?.addEventListener('click', () => {
  setPrintGuideStep(printGuideIndex - 1);
});

printGuideNextBtn?.addEventListener('click', () => {
  if (printGuideIndex === printGuideSteps.length - 1) {
    closeGuide();
    return;
  }
  setPrintGuideStep(printGuideIndex + 1);
});

document.querySelectorAll<HTMLElement>('.action-card__help').forEach((btn) => {
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    event.preventDefault();

    const guideName = btn.dataset.guide;
    if (!guideName) return;
    openGuide(guideName);
  });
});

guideOverlay
  ?.querySelectorAll<HTMLElement>('.guide-card__close')
  .forEach((btn) => {
    btn.addEventListener('click', closeGuide);
  });

guideOverlay?.addEventListener('click', (event) => {
  if (event.target === guideOverlay) closeGuide();
});

document.addEventListener('keydown', (event) => {
  if (!isGuideOverlayVisible()) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeGuide();
    return;
  }

  if (activeGuide !== 'print') return;

  if (event.key === 'ArrowLeft') {
    if (printGuideIndex === 0) return;
    event.preventDefault();
    setPrintGuideStep(printGuideIndex - 1);
    return;
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    if (printGuideIndex === printGuideSteps.length - 1) {
      closeGuide();
      return;
    }
    setPrintGuideStep(printGuideIndex + 1);
  }
});

// ── Feedback QR modal ─────────────────────────────────────────────────────────

const openFeedbackBtn = document.getElementById('openFeedbackBtn');
const feedbackOverlay = document.getElementById('feedbackOverlay');
const closeFeedbackBtn = document.getElementById('closeFeedbackBtn');
const feedbackQrCanvas = document.getElementById(
  'feedbackQrCanvas',
) as HTMLCanvasElement | null;
const feedbackModalStatus = document.getElementById('feedbackModalStatus');
const feedbackModalTimer = document.getElementById('feedbackModalTimer');
const feedbackTimerCount = document.getElementById('feedbackTimerCount');

let feedbackTimerHandle: number | null = null;

interface FeedbackSessionResponse {
  sessionId: string;
  token: string;
  feedbackUrl: string;
  expiresAt: string;
}

function setFeedbackStatus(msg: string): void {
  if (feedbackModalStatus) feedbackModalStatus.textContent = msg;
}

function openFeedbackModal(): void {
  feedbackOverlay?.classList.add('is-visible');
  feedbackOverlay?.setAttribute('aria-hidden', 'false');
  void loadFeedbackSession();
}

function closeFeedbackModal(): void {
  feedbackOverlay?.classList.remove('is-visible');
  feedbackOverlay?.setAttribute('aria-hidden', 'true');
  if (feedbackTimerHandle !== null) {
    clearInterval(feedbackTimerHandle);
    feedbackTimerHandle = null;
  }
  if (feedbackModalTimer) feedbackModalTimer.style.display = 'none';
  if (feedbackQrCanvas) {
    const ctx = feedbackQrCanvas.getContext('2d');
    ctx?.clearRect(0, 0, feedbackQrCanvas.width, feedbackQrCanvas.height);
  }
  setFeedbackStatus('Generating QR code\u2026');
}

function startExpiryCountdown(expiresAt: string): void {
  if (feedbackModalTimer) feedbackModalTimer.style.display = 'block';

  const tick = (): void => {
    const remaining = new Date(expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      if (feedbackTimerCount) feedbackTimerCount.textContent = '0:00';
      if (feedbackTimerHandle !== null) clearInterval(feedbackTimerHandle);
      setFeedbackStatus(
        'Session expired. Close and reopen to get a new QR code.',
      );
      return;
    }
    const mins = Math.floor(remaining / 60000);
    const secs = String(Math.floor((remaining % 60000) / 1000)).padStart(
      2,
      '0',
    );
    if (feedbackTimerCount) feedbackTimerCount.textContent = `${mins}:${secs}`;
  };

  tick();
  feedbackTimerHandle = window.setInterval(tick, 1000);
}

async function loadFeedbackSession(): Promise<void> {
  setFeedbackStatus('Generating QR code\u2026');
  try {
    const res = await fetch('/api/feedback/sessions', { method: 'POST' });
    if (!res.ok) {
      setFeedbackStatus('Failed to create session. Please try again.');
      return;
    }
    const data = (await res.json()) as FeedbackSessionResponse;

    if (!feedbackQrCanvas) return;
    await QRCode.toCanvas(feedbackQrCanvas, data.feedbackUrl, {
      width: 220,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    });

    setFeedbackStatus(data.feedbackUrl);
    startExpiryCountdown(data.expiresAt);
  } catch {
    setFeedbackStatus('Could not generate QR code. Please try again.');
  }
}

openFeedbackBtn?.addEventListener('click', openFeedbackModal);
closeFeedbackBtn?.addEventListener('click', closeFeedbackModal);
feedbackOverlay?.addEventListener('click', (e) => {
  if (e.target === feedbackOverlay) closeFeedbackModal();
});

// ── Report QR modal ───────────────────────────────────────────────────────────

const openReportBtn = document.getElementById('openReportBtn');
const reportOverlay = document.getElementById('reportOverlay');
const closeReportBtn = document.getElementById('closeReportBtn');
const reportQrCanvas = document.getElementById(
  'reportQrCanvas',
) as HTMLCanvasElement | null;
const reportModalStatus = document.getElementById('reportModalStatus');
const reportModalTimer = document.getElementById('reportModalTimer');
const reportTimerCount = document.getElementById('reportTimerCount');

let reportTimerHandle: number | null = null;

interface ReportSessionResponse {
  sessionId: string;
  token: string;
  reportUrl: string;
  expiresAt: string;
}

function setReportStatus(msg: string): void {
  if (reportModalStatus) reportModalStatus.textContent = msg;
}

function openReportModal(): void {
  reportOverlay?.classList.add('is-visible');
  reportOverlay?.setAttribute('aria-hidden', 'false');
  void loadReportSession();
}

function closeReportModal(): void {
  reportOverlay?.classList.remove('is-visible');
  reportOverlay?.setAttribute('aria-hidden', 'true');
  if (reportTimerHandle !== null) {
    clearInterval(reportTimerHandle);
    reportTimerHandle = null;
  }
  if (reportModalTimer) reportModalTimer.style.display = 'none';
  if (reportQrCanvas) {
    const ctx = reportQrCanvas.getContext('2d');
    ctx?.clearRect(0, 0, reportQrCanvas.width, reportQrCanvas.height);
  }
  setReportStatus('Generating QR code…');
}

function startReportExpiry(expiresAt: string): void {
  if (reportModalTimer) reportModalTimer.style.display = 'block';
  const tick = (): void => {
    const remaining = new Date(expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      if (reportTimerHandle !== null) clearInterval(reportTimerHandle);
      reportTimerHandle = null;
      setReportStatus('Session expired. Close and reopen to try again.');
      if (reportModalTimer) reportModalTimer.style.display = 'none';
      return;
    }
    const mins = Math.floor(remaining / 60000);
    const secs = String(Math.floor((remaining % 60000) / 1000)).padStart(
      2,
      '0',
    );
    if (reportTimerCount) reportTimerCount.textContent = `${mins}:${secs}`;
  };
  tick();
  reportTimerHandle = window.setInterval(tick, 1000);
}

async function loadReportSession(): Promise<void> {
  setReportStatus('Generating QR code…');
  try {
    const res = await fetch('/api/report-issues/sessions', { method: 'POST' });
    if (!res.ok) {
      setReportStatus('Failed to create session. Please try again.');
      return;
    }
    const data = (await res.json()) as ReportSessionResponse;

    if (!reportQrCanvas) return;
    await QRCode.toCanvas(reportQrCanvas, data.reportUrl, {
      width: 220,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    });

    setReportStatus(data.reportUrl);
    startReportExpiry(data.expiresAt);
  } catch {
    setReportStatus('Could not generate QR code. Please try again.');
  }
}

openReportBtn?.addEventListener('click', openReportModal);
closeReportBtn?.addEventListener('click', closeReportModal);
reportOverlay?.addEventListener('click', (e) => {
  if (e.target === reportOverlay) closeReportModal();
});

export { navigateTo };

const brandArea = document.querySelector('.brand') as HTMLElement | null;
const adminOverlay = document.getElementById('adminOverlay');
const adminPinInput = document.getElementById(
  'adminPinInput',
) as HTMLInputElement | null;
const adminPinError = document.getElementById('adminPinError');
const adminCancelBtn = document.getElementById('adminCancelBtn');
const adminSubmitBtn = document.getElementById('adminSubmitBtn');

const REQUIRED_TAPS = 5;
const TAP_WINDOW_MS = 3000;

let tapCount = 0;
let tapTimer: number | null = null;

function openAdminModal(): void {
  adminOverlay?.classList.add('is-visible');
  adminOverlay?.setAttribute('aria-hidden', 'false');
  adminPinInput?.focus();
  if (adminPinError) adminPinError.textContent = '';
  if (adminPinInput) adminPinInput.value = '';
}

function closeAdminModal(): void {
  adminOverlay?.classList.remove('is-visible');
  adminOverlay?.setAttribute('aria-hidden', 'true');
  if (adminPinInput) adminPinInput.value = '';
  if (adminPinError) adminPinError.textContent = '';
}

function setAdminError(msg: string): void {
  if (adminPinError) adminPinError.textContent = msg;
}

async function submitAdminPin(): Promise<void> {
  const pin = adminPinInput?.value.trim() ?? '';
  if (!pin) {
    setAdminError('Please enter a PIN.');
    return;
  }

  if (adminSubmitBtn) adminSubmitBtn.textContent = 'Checking…';

  try {
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });

    const data = (await res.json()) as {
      ok: boolean;
      sessionToken?: string;
      error?: string;
    };

    if (data.ok && data.sessionToken) {
      // Store session token for the admin panel to pick up
      sessionStorage.setItem('adminSessionToken', data.sessionToken);
      closeAdminModal();
      navigateTo('/admin/dashboard');
    } else {
      setAdminError(data.error ?? 'Incorrect PIN.');
      if (adminPinInput) adminPinInput.value = '';
      adminPinInput?.focus();
    }
  } catch {
    setAdminError('Connection error. Please try again.');
  } finally {
    if (adminSubmitBtn) adminSubmitBtn.textContent = 'Enter';
  }
}

brandArea?.addEventListener('click', () => {
  tapCount += 1;

  if (tapTimer !== null) clearTimeout(tapTimer);

  if (tapCount >= REQUIRED_TAPS) {
    tapCount = 0;
    openAdminModal();
    return;
  }

  tapTimer = window.setTimeout(() => {
    tapCount = 0;
  }, TAP_WINDOW_MS);
});

adminCancelBtn?.addEventListener('click', closeAdminModal);

adminSubmitBtn?.addEventListener('click', () => void submitAdminPin());

adminPinInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void submitAdminPin();
});

adminOverlay?.addEventListener('click', (e) => {
  if (e.target === adminOverlay) closeAdminModal();
});
