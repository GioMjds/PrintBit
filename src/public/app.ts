import QRCode from 'qrcode';
import {
  initKioskLocalization,
  KIOSK_LANGUAGE_CHANGED_EVENT,
  translation,
} from './shared/kiosk-i18n';

type SocketLike = {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  emit?: (event: string, ...args: unknown[]) => void;
};

void initKioskLocalization();

function navigateTo(path: string) {
  window.location.href = path;
}

const PRINT_ONBOARDING_TRIGGER_KEY = 'printbit.showPrintOnboardingModal';

// ── State Management ─────────────────────────────────────────────────────────

type KioskState = 'IDLE' | 'ACTIVE';
let currentKioskState: KioskState = 'IDLE';
let enteredPin = '';
const MAX_PIN_LEN = 6;
let isVerifyingPin = false;
let currentBalance = 0;
let sessionTimerHandle: number | null = null;
let sessionRemainingSeconds = 120;
const INACTIVITY_TTL_SECONDS = 120;
let changeToastTimer: number | null = null;

// ── DOM References ───────────────────────────────────────────────────────────

const idleContainer = document.getElementById('idleContainer');
const activeContainer = document.getElementById('activeContainer');
const pinInputContainer = document.getElementById('pinInputContainer');
const pinSlots = document.querySelectorAll<HTMLElement>(
  '#pinInputContainer .pin-slot',
);
const pinErrorText = document.getElementById('pinErrorText');
const touchNumpad = document.getElementById('touchNumpad');
const exitSessionBtn = document.getElementById('exitSessionBtn');
const countdownPill = document.getElementById('countdownPill');
const sessionTimerText = document.getElementById('sessionTimerText');
const kioskStatusLabel = document.getElementById('kioskStatusLabel');
const wifiQrCanvas = document.getElementById(
  'wifiQrCanvas',
) as HTMLCanvasElement | null;
const wifiSsidText = document.getElementById('wifiSsidText');
const wifiPassText = document.getElementById('wifiPassText');
const wifiPassRow = document.getElementById('wifiPassRow');
const changeNoticeToast = document.getElementById('changeNoticeToast');
const changeNoticeDesc = document.getElementById('changeNoticeDesc');
const balanceEl = document.getElementById('balance');

const openPrint = document.getElementById('openPrintBtn');
const openCopy = document.getElementById('openCopyBtn');
const openScan = document.getElementById('openScanBtn');

openPrint?.addEventListener('click', () => {
  sessionStorage.setItem(PRINT_ONBOARDING_TRIGGER_KEY, '1');
  navigateTo('/print');
});
openCopy?.addEventListener('click', () => navigateTo('/copy'));
openScan?.addEventListener('click', () => navigateTo('/scan'));

// ── PIN Display & Feedback ───────────────────────────────────────────────────

function updatePinSlots(): void {
  pinSlots.forEach((slot, i) => {
    if (i < enteredPin.length) {
      slot.classList.add('filled');
      slot.classList.remove('active');
      slot.textContent = enteredPin[i];
    } else if (i === enteredPin.length) {
      slot.classList.remove('filled');
      slot.classList.add('active');
      slot.textContent = '';
    } else {
      slot.classList.remove('filled');
      slot.classList.remove('active');
      slot.textContent = '';
    }
  });

  if (enteredPin.length > 0 && pinErrorText && pinErrorText.textContent) {
    pinErrorText.textContent = '';
  }
}

function triggerPinShake(): void {
  if (!pinInputContainer) return;
  pinInputContainer.classList.remove('shake-animation');
  // Force layout reflow to restart CSS animation
  void pinInputContainer.offsetWidth;
  pinInputContainer.classList.add('shake-animation');
  window.setTimeout(() => {
    pinInputContainer.classList.remove('shake-animation');
  }, 500);
}

// ── PIN Verification & Submission ───────────────────────────────────────────

interface PairingVerifyResponse {
  success: boolean;
  sessionId?: string;
  sessionToken?: string;
  error?: string;
}

async function submitPin(pin: string): Promise<void> {
  if (isVerifyingPin || pin.length !== MAX_PIN_LEN) return;
  isVerifyingPin = true;

  if (pinErrorText) {
    pinErrorText.textContent = 'Verifying PIN\u2026';
    pinErrorText.style.color = 'var(--lavender)';
  }

  try {
    const res = await fetch('/api/pairing/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });

    const data = (await res.json()) as PairingVerifyResponse;

    if (res.ok && data.success && data.sessionId && data.sessionToken) {
      sessionStorage.setItem('printbit.sessionId', data.sessionId);
      sessionStorage.setItem('printbit.sessionToken', data.sessionToken);
      enteredPin = '';
      updatePinSlots();
      if (pinErrorText) pinErrorText.textContent = '';
      setKioskState('ACTIVE');
    } else {
      triggerPinShake();
      if (pinErrorText) {
        pinErrorText.textContent =
          data.error === 'INVALID_PIN'
            ? 'Invalid or expired PIN. Please try again.'
            : 'Verification failed. Please try again.';
        pinErrorText.style.color = '#f87171';
      }
      enteredPin = '';
      window.setTimeout(() => {
        updatePinSlots();
      }, 200);
    }
  } catch {
    triggerPinShake();
    if (pinErrorText) {
      pinErrorText.textContent = 'Connection error. Please try again.';
      pinErrorText.style.color = '#f87171';
    }
    enteredPin = '';
    updatePinSlots();
  } finally {
    isVerifyingPin = false;
  }
}

// ── Numpad Keypad Handling ───────────────────────────────────────────────────

function handleNumpadKey(key: string): void {
  if (isVerifyingPin) return;

  if (key >= '0' && key <= '9') {
    if (enteredPin.length < MAX_PIN_LEN) {
      enteredPin += key;
      updatePinSlots();
      if (enteredPin.length === MAX_PIN_LEN) {
        void submitPin(enteredPin);
      }
    }
    return;
  }

  if (key === 'clear' || key === 'backspace') {
    if (enteredPin.length > 0) {
      enteredPin = enteredPin.slice(0, -1);
      updatePinSlots();
    }
    return;
  }

  if (key === 'enter') {
    if (enteredPin.length === MAX_PIN_LEN) {
      void submitPin(enteredPin);
    } else {
      triggerPinShake();
      if (pinErrorText) {
        pinErrorText.textContent = 'Please enter all 6 digits.';
        pinErrorText.style.color = '#f87171';
      }
    }
  }
}

touchNumpad?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.numpad-btn');
  if (!btn || btn.disabled) return;
  const key = btn.dataset.key;
  if (key) {
    handleNumpadKey(key);
  }
});

// ── Kiosk State Switching ────────────────────────────────────────────────────

function setKioskState(state: KioskState): void {
  currentKioskState = state;

  if (idleContainer) {
    idleContainer.style.display = state === 'IDLE' ? 'flex' : 'none';
  }
  if (activeContainer) {
    activeContainer.style.display = state === 'ACTIVE' ? 'flex' : 'none';
  }
  if (kioskStatusLabel) {
    kioskStatusLabel.textContent = state === 'ACTIVE' ? 'Active' : 'Ready';
  }

  if (state === 'ACTIVE') {
    startSessionCountdown();
    updateBalanceDisplay(currentBalance);
  } else {
    stopSessionCountdown();
    enteredPin = '';
    updatePinSlots();
    if (pinErrorText) pinErrorText.textContent = '';
    sessionStorage.removeItem('printbit.sessionId');
    sessionStorage.removeItem('printbit.sessionToken');
  }
}

// ── Countdown Timer & Activity Reset ─────────────────────────────────────────

function renderSessionCountdown(): void {
  if (!sessionTimerText) return;
  const mins = Math.floor(sessionRemainingSeconds / 60);
  const secs = sessionRemainingSeconds % 60;
  sessionTimerText.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  if (countdownPill) {
    countdownPill.classList.toggle('is-warning', sessionRemainingSeconds <= 30);
  }
}

function resetActivityTimer(): void {
  sessionRemainingSeconds = INACTIVITY_TTL_SECONDS;
  renderSessionCountdown();
}

function startSessionCountdown(): void {
  sessionRemainingSeconds = INACTIVITY_TTL_SECONDS;
  renderSessionCountdown();

  if (sessionTimerHandle !== null) {
    clearInterval(sessionTimerHandle);
  }

  sessionTimerHandle = window.setInterval(() => {
    sessionRemainingSeconds -= 1;
    if (sessionRemainingSeconds <= 0) {
      stopSessionCountdown();
      void endActiveSession('timeout');
      return;
    }
    renderSessionCountdown();
  }, 1000);
}

function stopSessionCountdown(): void {
  if (sessionTimerHandle !== null) {
    clearInterval(sessionTimerHandle);
    sessionTimerHandle = null;
  }
}

activeContainer?.addEventListener('pointerdown', resetActivityTimer);

// ── Active Session Termination ───────────────────────────────────────────────

function showChangeDispensedToast(amount: number): void {
  if (!changeNoticeToast) return;
  if (changeNoticeDesc) {
    changeNoticeDesc.textContent = `Dispensed ₱${amount.toFixed(2)}. Please collect your coins below.`;
  }
  changeNoticeToast.style.display = 'flex';
  if (changeToastTimer !== null) clearTimeout(changeToastTimer);
  changeToastTimer = window.setTimeout(() => {
    changeNoticeToast.style.display = 'none';
    changeToastTimer = null;
  }, 6000);
}

async function endActiveSession(reason = 'user_ended'): Promise<void> {
  try {
    const res = await fetch('/api/session/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const data = (await res.json()) as {
      success: boolean;
      dispensedChange?: number;
    };
    setKioskState('IDLE');
    if (typeof data.dispensedChange === 'number' && data.dispensedChange > 0) {
      showChangeDispensedToast(data.dispensedChange);
    }
  } catch {
    setKioskState('IDLE');
  }
}

exitSessionBtn?.addEventListener('click', () => {
  void endActiveSession('user_ended');
});

// ── Balance Display ──────────────────────────────────────────────────────────

function updateBalanceDisplay(amount: number): void {
  currentBalance = amount;
  if (balanceEl) {
    balanceEl.textContent = String(amount);
  }
}

// ── WiFi QR Code Generation ──────────────────────────────────────────────────

interface HotspotConfigResponse {
  ssid?: string;
  password?: string;
  authType?: string;
}

function escapeWifiValue(value: string): string {
  return value.replace(/([\\;,:"])/g, '\\$1');
}

async function loadAndRenderWifiQr(): Promise<void> {
  let ssid = 'PrintBit';
  let password = 'printbit123';
  let authType = 'WPA';

  try {
    const res = await fetch('/api/config/hotspot');
    if (res.ok) {
      const cfg = (await res.json()) as HotspotConfigResponse;
      if (cfg.ssid && cfg.ssid.trim()) ssid = cfg.ssid.trim();
      if (cfg.password !== undefined) password = cfg.password;
      if (cfg.authType) authType = cfg.authType.trim().toUpperCase();
    }
  } catch {
    // Default fallback
  }

  if (wifiSsidText) wifiSsidText.textContent = ssid;
  if (wifiPassText) wifiPassText.textContent = password || 'None (Open Network)';
  if (wifiPassRow && wifiPassText && (!password || authType === 'NOPASS' || authType === 'OPEN')) {
    wifiPassText.textContent = 'None';
  }

  if (wifiQrCanvas) {
    const safeSsid = escapeWifiValue(ssid);
    const safePass = escapeWifiValue(password);
    const isOpen = !password || authType === 'NOPASS' || authType === 'OPEN';
    const wifiPayload = isOpen
      ? `WIFI:T:nopass;S:${safeSsid};;`
      : `WIFI:T:WPA;S:${safeSsid};P:${safePass};;`;

    void QRCode.toCanvas(wifiQrCanvas, wifiPayload, {
      width: 220,
      margin: 1,
      color: { dark: '#0e0d1f', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    });
  }
}

void loadAndRenderWifiQr();
updatePinSlots();

// ── Socket.IO Real-Time Sync ─────────────────────────────────────────────────

const ioFactory = (
  window as unknown as { io?: (...args: unknown[]) => SocketLike }
).io;

if (typeof ioFactory === 'function') {
  const socket = ioFactory();

  socket.on('kiosk:state_changed', (payload: unknown) => {
    const data = payload as {
      state?: string;
      sessionId?: string;
      sessionToken?: string;
    };
    if (data?.state === 'ACTIVE') {
      if (data.sessionId && data.sessionToken) {
        sessionStorage.setItem('printbit.sessionId', data.sessionId);
        sessionStorage.setItem('printbit.sessionToken', data.sessionToken);
      }
      setKioskState('ACTIVE');
    } else if (data?.state === 'IDLE') {
      setKioskState('IDLE');
    }
  });

  socket.on('session:state_changed', (payload: unknown) => {
    const data = payload as {
      state?: string;
      sessionId?: string;
      sessionToken?: string;
    };
    if (data?.state === 'ACTIVE') {
      if (data.sessionId && data.sessionToken) {
        sessionStorage.setItem('printbit.sessionId', data.sessionId);
        sessionStorage.setItem('printbit.sessionToken', data.sessionToken);
      }
      setKioskState('ACTIVE');
    } else if (data?.state === 'IDLE') {
      setKioskState('IDLE');
    }
  });

  socket.on('balance', (amount: unknown) => {
    if (typeof amount === 'number') {
      updateBalanceDisplay(amount);
    }
  });

  socket.on('session:balance_updated', (payload: unknown) => {
    const data = payload as { balance?: number };
    if (typeof data?.balance === 'number') {
      updateBalanceDisplay(data.balance);
    }
  });

  socket.on('session:ended', (payload: unknown) => {
    const data = payload as { dispensedChange?: number; reason?: string };
    setKioskState('IDLE');
    updateBalanceDisplay(0);
    if (typeof data?.dispensedChange === 'number' && data.dispensedChange > 0) {
      showChangeDispensedToast(data.dispensedChange);
    }
  });
}

// ── Physical Keyboard Input Support ──────────────────────────────────────────

document.addEventListener('keydown', (event) => {
  const isOverlayOpen =
    (guideOverlay && isGuideOverlayVisible()) ||
    (feedbackOverlay && feedbackOverlay.classList.contains('is-visible')) ||
    (reportOverlay && reportOverlay.classList.contains('is-visible')) ||
    (adminOverlay && adminOverlay.classList.contains('is-visible'));

  if (isOverlayOpen) return;

  if (currentKioskState === 'IDLE') {
    if (event.key >= '0' && event.key <= '9') {
      event.preventDefault();
      handleNumpadKey(event.key);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      handleNumpadKey('backspace');
    } else if (event.key === 'Enter') {
      event.preventDefault();
      handleNumpadKey('enter');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      enteredPin = '';
      updatePinSlots();
    }
  }
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

interface GuideStep {
  imageUrl: string;
  captionKey: string;
  captionFallback: string;
}

const guides: Record<string, GuideStep[]> = {
  print: [
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
  ],
  copy: [
    {
      imageUrl: '/assets/copy-steps/copy-1.png',
      captionKey: 'copy.guide.step1',
      captionFallback: 'Place your document face-down first on the scanner glass. If it is ready, press "Check Document" on the kiosk screen to preview the scan.',
    },
    {
      imageUrl: '/assets/copy-steps/copy-2.png',
      captionKey: 'copy.guide.step2',
      captionFallback: 'Please wait for your document to finish scanning.',
    },
    {
      imageUrl: '/assets/copy-steps/copy-3.png',
      captionKey: 'copy.guide.step3',
      captionFallback: 'Review the scanned preview on the screen. If it is correct, press "Continue to Config" for the next step.',
    },
    {
      imageUrl: '/assets/copy-steps/copy-4.png',
      captionKey: 'copy.guide.step4',
      captionFallback: 'Select your preferred copy settings (size, color, copies) and proceed.',
    },
    {
      imageUrl: '/assets/copy-steps/copy-5.png',
      captionKey: 'copy.guide.step5',
      captionFallback: 'Insert the required coins for your copy job and confirm payment.',
    },
    {
      imageUrl: '/assets/copy-steps/copy-6.png',
      captionKey: 'copy.guide.step6',
      captionFallback: 'Wait for the copying to finish and collect your documents.',
    },
  ],
  scan: [
    {
      imageUrl: '/assets/scan-steps/scan-1.png',
      captionKey: 'scan.guide.step1',
      captionFallback: 'Place your document in the printer document feeder. If it is ready, press "Scan Document".',
    },
    {
      imageUrl: '/assets/scan-steps/scan-2.png',
      captionKey: 'scan.guide.step2',
      captionFallback: 'Your physical document is feeding into the printer. Please wait for it to finish scanning.',
    },
    {
      imageUrl: '/assets/scan-steps/scan-3.png',
      captionKey: 'scan.guide.step3',
      captionFallback: 'Your scanned document will appear on the kiosk screen. Review the preview.',
    },
    {
      imageUrl: '/assets/scan-steps/scan-4.png',
      captionKey: 'scan.guide.step4',
      captionFallback: 'Insert the required coins for your scan job and confirm payment.',
    },
    {
      imageUrl: '/assets/scan-steps/scan-5.png',
      captionKey: 'scan.guide.step5',
      captionFallback: 'After confirmation, the kiosk generates the image QR code link to download as soft copy.',
    },
  ],
};

const guideOverlay = document.getElementById('guideOverlay');
const guideCards = guideOverlay?.querySelectorAll<HTMLElement>('.guide-card');

let activeGuide: string | null = null;
const guideIndices: Record<string, number> = { print: 0, copy: 0, scan: 0 };

const GUIDE_NEXT_KEY = 'guide.next';
const GUIDE_GOT_IT_KEY = 'guide.got_it';
const GUIDE_NEXT_ARIA_KEY = 'guide.next_aria';
const GUIDE_CLOSE_ARIA_KEY = 'guide.close_aria';

function isGuideOverlayVisible(): boolean {
  return guideOverlay?.classList.contains('is-visible') ?? false;
}

function getGuideElements(name: string) {
  return {
    image: document.getElementById(`${name}GuideImage`) as HTMLImageElement | null,
    counter: document.getElementById(`${name}GuideCounter`),
    caption: document.getElementById(`${name}GuideCaption`),
    prevBtn: document.getElementById(`${name}GuidePrevBtn`) as HTMLButtonElement | null,
    nextBtn: document.getElementById(`${name}GuideNextBtn`) as HTMLButtonElement | null,
  };
}

function renderGuideStep(name: string): void {
  const steps = guides[name];
  const elements = getGuideElements(name);
  if (!steps || !steps.length || !elements.image || !elements.counter || !elements.caption || !elements.prevBtn || !elements.nextBtn) {
    return;
  }

  const index = guideIndices[name];
  const step = steps[index];
  const isLastStep = index === steps.length - 1;
  const nextActionLabel = translation(GUIDE_NEXT_KEY, 'Next');
  const nextVisualLabel = isLastStep
    ? translation(GUIDE_GOT_IT_KEY, '✖')
    : '❯';
  const isCloseIconState =
    isLastStep && nextVisualLabel.trim().replace(/\uFE0F/g, '').length <= 1;
  const nextAriaLabel = isLastStep
    ? translation(GUIDE_CLOSE_ARIA_KEY, `Close ${name} guide modal`)
    : translation(GUIDE_NEXT_ARIA_KEY, `Next ${name} guide step`);

  elements.counter.textContent = `Step ${index + 1} of ${steps.length}`;
  elements.caption.textContent = translation(step.captionKey, step.captionFallback);
  elements.image.alt = `${name} guide step ${index + 1}`;
  elements.image.style.visibility = 'visible';
  elements.image.src = step.imageUrl;
  elements.prevBtn.disabled = index === 0;
  elements.nextBtn.disabled = false;
  elements.nextBtn.textContent = nextVisualLabel;
  elements.nextBtn.classList.toggle('is-label', isLastStep && !isCloseIconState);
  elements.nextBtn.classList.toggle('is-close-icon', isCloseIconState);
  elements.nextBtn.title = isLastStep ? nextAriaLabel : nextActionLabel;
  elements.nextBtn.setAttribute('aria-label', nextAriaLabel);
}

function setGuideStep(name: string, nextIndex: number): void {
  const steps = guides[name];
  if (!steps || !steps.length) return;
  if (nextIndex < 0) nextIndex = 0;
  if (nextIndex > steps.length - 1) {
    nextIndex = steps.length - 1;
  }
  guideIndices[name] = nextIndex;
  renderGuideStep(name);
}

function openGuide(name: string): void {
  if (!guideOverlay || !guideCards) return;

  guideCards.forEach((card) => {
    card.style.display = 'none';
  });

  activeGuide = name;
  const target = document.getElementById(`guide-${name}`) as HTMLElement | null;
  if (target) target.style.display = 'flex';
  if (guides[name]) setGuideStep(name, 0);

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
  if (activeGuide && isGuideOverlayVisible() && guides[activeGuide]) {
    renderGuideStep(activeGuide);
  }
});

['print', 'copy', 'scan'].forEach((name) => {
  const elements = getGuideElements(name);
  if (elements.image) {
    elements.image.addEventListener('load', () => {
      elements.image!.style.visibility = 'visible';
    });
    elements.image.addEventListener('error', () => {
      elements.image!.style.visibility = 'hidden';
      if (elements.caption) {
        elements.caption.textContent = 'Step image unavailable for this step.';
      }
    });
  }

  elements.prevBtn?.addEventListener('click', () => {
    setGuideStep(name, guideIndices[name] - 1);
  });

  elements.nextBtn?.addEventListener('click', () => {
    const steps = guides[name];
    if (guideIndices[name] === steps.length - 1) {
      closeGuide();
      return;
    }
    setGuideStep(name, guideIndices[name] + 1);
  });
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
  if (!activeGuide || !isGuideOverlayVisible()) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeGuide();
    return;
  }

  const steps = guides[activeGuide];
  if (!steps) return;

  if (event.key === 'ArrowLeft') {
    if (guideIndices[activeGuide] === 0) return;
    event.preventDefault();
    setGuideStep(activeGuide, guideIndices[activeGuide] - 1);
    return;
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    if (guideIndices[activeGuide] === steps.length - 1) {
      closeGuide();
      return;
    }
    setGuideStep(activeGuide, guideIndices[activeGuide] + 1);
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
