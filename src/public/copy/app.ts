import {
  initializePageIdleTimeout,
  setupPageIdleWarningButton,
} from '@/services/idle-timeout';
import { initKioskLocalization } from '../shared/kiosk-i18n';

export {};

void initKioskLocalization();

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
const previewPaper = document.getElementById('previewPaper') as HTMLElement | null;
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

let previewPath: string | null = null;
let previewReleaseToken: string | null = null;
let previewObjectUrl: string | null = null;
const RELEASE_TIMEOUT_MS = 1_500;

async function releaseCopyPreviewFile(
  releaseToken: string,
  reason: string,
): Promise<void> {
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
  if (errorBanner) errorBanner.style.display = '';
  if (errorText) errorText.textContent = msg;
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
    const paperHeight = Math.max((previewPaper?.clientHeight ?? 1188) - 24, 320);
    const dpr = window.devicePixelRatio || 1;
    const scale =
      Math.min(paperWidth / baseViewport.width, paperHeight / baseViewport.height) *
      dpr;
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
  const response = await fetch(`/api/scan/preview/${encodeURIComponent(filename)}`);
  if (!response.ok) {
    throw new Error(`Preview request failed (${response.status})`);
  }

  const contentType = (response.headers.get('Content-Type') ?? '').toLowerCase();

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
}

async function checkForDocument(): Promise<void> {
  hideError();
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
        void releaseCopyPreviewFile(previewReleaseToken, 'copy_preview_replaced');
      }
      previewPath = data.previewPath;
      previewReleaseToken = data.releaseToken;
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
    sessionStorage.setItem('printbit.copyPreviewReleaseToken', previewReleaseToken);
  } else {
    sessionStorage.removeItem('printbit.copyPreviewReleaseToken');
  }
  window.location.href = '/config?mode=copy';
});

window.addEventListener('beforeunload', clearPreviewImageUrl);
