export {};

// ── Types ──────────────────────────────────────────────────────

type ScannerState = "checking" | "ready" | "scanning" | "done" | "error";
type ScanMode = "single" | "multi";
type ScanColor = "color" | "grayscale";
type ScanDpi = "150" | "300" | "600";

interface ScanStatusResponse {
  connected: boolean;
  name?: string;
  error?: string;
}

interface ScanResponse {
  pages: string[]; // Array of data-URLs or server paths, one per scanned page
  sessionId?: string;
  filename?: string;
}

// ── DOM refs ───────────────────────────────────────────────────

const scannerPill = document.getElementById("scannerPill") as HTMLElement;
const scannerPillText = document.getElementById(
  "scannerPillText",
) as HTMLElement;
const scannerStatusCard = document.getElementById(
  "scannerStatusCard",
) as HTMLElement;
const scannerStatusLabel = document.getElementById(
  "scannerStatusLabel",
) as HTMLElement;
const scannerStatusDetail = document.getElementById(
  "scannerStatusDetail",
) as HTMLElement;
const statusDot = document.getElementById("statusDot") as HTMLElement;

const previewHint = document.getElementById("previewHint") as HTMLElement;
const stateIdle = document.getElementById("stateIdle") as HTMLElement;
const stateScanning = document.getElementById("stateScanning") as HTMLElement;
const stateResult = document.getElementById("stateResult") as HTMLElement;
const stateError = document.getElementById("stateError") as HTMLElement;
const scanProgress = document.getElementById("scanProgress") as HTMLElement;
const errorText = document.getElementById("errorText") as HTMLElement;

const scannedImage = document.getElementById(
  "scannedImage",
) as HTMLImageElement;
const pageCountBadge = document.getElementById("pageCountBadge") as HTMLElement;
const pageCountText = document.getElementById("pageCountText") as HTMLElement;

const previewControls = document.getElementById(
  "previewControls",
) as HTMLElement;
const pagePrev = document.getElementById("pagePrev") as HTMLButtonElement;
const pageNext = document.getElementById("pageNext") as HTMLButtonElement;
const pagerLabel = document.getElementById("pagerLabel") as HTMLElement;

const scanBtn = document.getElementById("scanBtn") as HTMLButtonElement;
const scanBtnLabel = document.getElementById("scanBtnLabel") as HTMLElement;
const rescanBtn = document.getElementById("rescanBtn") as HTMLButtonElement;
const proceedBtn = document.getElementById("proceedBtn") as HTMLButtonElement;

// ── Radio helpers ──────────────────────────────────────────────

function getRadio<T extends string>(name: string): T {
  return document.querySelector<HTMLInputElement>(
    `input[name="${name}"]:checked`,
  )?.value as T;
}

function getScanMode(): ScanMode {
  return getRadio<ScanMode>("scanMode") || "single";
}
function getScanColor(): ScanColor {
  return getRadio<ScanColor>("scanColor") || "color";
}
function getScanDpi(): ScanDpi {
  return getRadio<ScanDpi>("scanDpi") || "300";
}

// ── Scanner state machine ──────────────────────────────────────

let scannerReady = false;
let scannedPages: string[] = [];
let currentPage = 0;
let scanSessionId: string | null = null;
let scanFilename: string | null = null;

function applyState(state: ScannerState): void {
  scannerPill.dataset.state = state;
  scannerStatusCard.dataset.state = state;

  const labels: Record<ScannerState, [string, string, string]> = {
    checking: ["Checking scanner…", "Please wait", "Checking…"],
    ready: ["Scanner Ready", "Place document and scan", "Ready"],
    scanning: ["Scanning…", "Do not move document", "Scanning…"],
    done: ["Scan Complete", "Review your scan below", "Done"],
    error: ["Scanner Unavailable", "Check USB connection", "Error"],
  };

  const [cardTitle, cardDetail, pillText] = labels[state];
  scannerStatusLabel.textContent = cardTitle;
  scannerStatusDetail.textContent = cardDetail;
  scannerPillText.textContent = pillText;
}

// ── Preview state switching ────────────────────────────────────

type PreviewState = "idle" | "scanning" | "result" | "error";

const PREVIEW_STATES: Record<PreviewState, HTMLElement> = {
  idle: stateIdle,
  scanning: stateScanning,
  result: stateResult,
  error: stateError,
};

function showPreview(name: PreviewState, hint?: string): void {
  for (const [key, el] of Object.entries(PREVIEW_STATES)) {
    el.classList.toggle("hidden", key !== name);
  }
  if (hint !== undefined) previewHint.textContent = hint;
}

// ── Page navigation ────────────────────────────────────────────

function goToPage(n: number): void {
  n = Math.max(0, Math.min(scannedPages.length - 1, n));
  currentPage = n;
  scannedImage.src = scannedPages[n];

  // Apply grayscale filter if color mode is grayscale
  if (getScanColor() === "grayscale") {
    scannedImage.setAttribute("data-gray", "");
  } else {
    scannedImage.removeAttribute("data-gray");
  }

  const total = scannedPages.length;
  pagerLabel.textContent = `${n + 1} / ${total}`;
  pagePrev.disabled = n <= 0;
  pageNext.disabled = n >= total - 1;

  pageCountText.textContent = `${total} page${total !== 1 ? "s" : ""}`;
  previewHint.textContent = `Page ${n + 1} of ${total}`;
}

function updatePager(): void {
  const multi = scannedPages.length > 1;
  previewControls.style.display = multi ? "flex" : "none";
  pageCountBadge.style.display = multi ? "inline-flex" : "none";
  if (multi) goToPage(currentPage);
}

pagePrev.addEventListener("click", () => goToPage(currentPage - 1));
pageNext.addEventListener("click", () => goToPage(currentPage + 1));

// ── Grayscale live toggle ──────────────────────────────────────

// When user changes color mode after a scan, update the preview image immediately
document
  .querySelectorAll<HTMLInputElement>('input[name="scanColor"]')
  .forEach((el) => {
    el.addEventListener("change", () => {
      if (scannedPages.length > 0) goToPage(currentPage);
    });
  });

// ── Scanner status check ───────────────────────────────────────

async function checkScanner(): Promise<void> {
  applyState("checking");
  scanBtn.disabled = true;
  scanBtn.setAttribute("aria-disabled", "true");

  try {
    const res = await fetch("/api/scanner/status");

    if (!res.ok) throw new Error("Scanner API unavailable");

    const data = (await res.json()) as ScanStatusResponse;

    if (data.connected) {
      applyState("ready");
      scannerStatusDetail.textContent = data.name
        ? `Connected: ${data.name}`
        : "Connected and ready";
      scannerReady = true;
      scanBtn.disabled = false;
      scanBtn.setAttribute("aria-disabled", "false");
      showPreview("idle", "Place document and press Scan");
    } else {
      throw new Error(data.error ?? "No scanner found");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Scanner check failed";
    applyState("error");
    errorText.textContent = msg;
    scannerStatusDetail.textContent = msg;
    scannerReady = false;
    showPreview("error", "Scanner unavailable");
  }
}

// ── Scan ───────────────────────────────────────────────────────

async function startScan(): Promise<void> {
  if (!scannerReady) return;

  const mode = getScanMode();
  const color = getScanColor();
  const dpi = getScanDpi();

  // UI — scanning state
  applyState("scanning");
  showPreview("scanning", "Scanning your document…");
  scanBtn.disabled = true;
  scanBtn.setAttribute("aria-disabled", "true");
  rescanBtn.style.display = "none";
  proceedBtn.style.display = "none";
  scanProgress.textContent = "Initialising scanner";

  const progressMessages = [
    "Initialising scanner",
    "Calibrating sensor",
    "Scanning page…",
    "Processing image",
    "Finalising…",
  ];
  let progIdx = 0;
  const progTimer = window.setInterval(() => {
    progIdx = Math.min(progIdx + 1, progressMessages.length - 1);
    scanProgress.textContent = progressMessages[progIdx];
  }, 1200);

  try {
    const res = await fetch("/api/scanner/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, color, dpi }),
    });

    clearInterval(progTimer);

    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      throw new Error(body.error ?? "Scan failed");
    }

    const data = (await res.json()) as ScanResponse;

    if (!data.pages || data.pages.length === 0) {
      throw new Error("No pages returned from scanner");
    }

    scannedPages = data.pages;
    scanSessionId = data.sessionId ?? null;
    scanFilename = data.filename ?? null;
    currentPage = 0;

    // Show result
    applyState("done");
    showPreview("result", `Page 1 of ${data.pages.length}`);
    goToPage(0);
    updatePager();

    // Reveal rescan + proceed buttons
    rescanBtn.style.display = "flex";
    proceedBtn.style.display = "flex";
    proceedBtn.disabled = false;
    proceedBtn.setAttribute("aria-disabled", "false");

    // Swap scan btn label
    scanBtnLabel.textContent = "Scan Document";
  } catch (err) {
    clearInterval(progTimer);
    const msg = err instanceof Error ? err.message : "Scan failed";
    applyState("error");
    errorText.textContent = msg;
    showPreview("error", msg);

    // Allow retry
    scanBtn.disabled = false;
    scanBtn.setAttribute("aria-disabled", "false");
    rescanBtn.style.display = "none";
  }
}

// ── Rescan ─────────────────────────────────────────────────────

function resetToIdle(): void {
  scannedPages = [];
  scanSessionId = null;
  scanFilename = null;
  currentPage = 0;

  applyState("ready");
  showPreview("idle", "Place document and press Scan");

  previewControls.style.display = "none";
  pageCountBadge.style.display = "none";
  rescanBtn.style.display = "none";
  proceedBtn.style.display = "none";
  proceedBtn.disabled = true;

  scanBtn.disabled = false;
  scanBtn.setAttribute("aria-disabled", "false");
  scanBtnLabel.textContent = "Scan Document";
}

scanBtn.addEventListener("click", () => {
  if (!scanBtn.disabled) void startScan();
});

rescanBtn.addEventListener("click", resetToIdle);

// ── Proceed to config ──────────────────────────────────────────

proceedBtn.addEventListener("click", () => {
  if (!scannedPages.length) return;

  // Persist scan context for the config/confirm pages
  if (scanSessionId)
    sessionStorage.setItem("printbit.sessionId", scanSessionId);
  if (scanFilename)
    sessionStorage.setItem("printbit.uploadedFile", scanFilename);
  sessionStorage.setItem("printbit.mode", "print");
  sessionStorage.setItem("printbit.scanColor", getScanColor());
  sessionStorage.setItem("printbit.scanDpi", getScanDpi());

  window.location.href = "/config";
});

// ── Boot ───────────────────────────────────────────────────────

void checkScanner();
