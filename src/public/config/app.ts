import { initializePageIdleTimeout } from '@/services/idle-timeout';
import { initKioskLocalization } from '../shared/kiosk-i18n';

export {};

void initKioskLocalization();

void initializePageIdleTimeout({
  showWarningModal: true,
  onTimeout: async () => {
    console.log('[PAGE IDLE] Config page timeout reached, redirecting to home');
    const sessionId = sessionStorage.getItem('printbit.sessionId');
    const sessionToken = sessionStorage.getItem('printbit.sessionToken');
    if (sessionId && sessionToken) {
      try {
        await fetch(
          `/api/wireless/sessions/${encodeURIComponent(sessionId)}/cancel?token=${encodeURIComponent(sessionToken)}`,
          {
            method: 'DELETE',
          },
        );
      } catch {
        // Best-effort cleanup
      }
    }
    // Clear state before redirect
    sessionStorage.removeItem('printbit.config');
    sessionStorage.removeItem('printbit.mode');
    sessionStorage.removeItem('printbit.sessionId');
    sessionStorage.removeItem('printbit.sessionToken');
    sessionStorage.removeItem('printbit.uploadedFile');
    sessionStorage.removeItem('printbit.uploadedDocumentId');
    sessionStorage.removeItem('printbit.uploadedFiles');
    sessionStorage.removeItem('printbit.copyPreviewPath');
    sessionStorage.removeItem('printbit.copyPreviewReleaseToken');
    window.location.replace('/');
  },
});
type ColorMode = 'colored' | 'grayscale';
type Orientation = 'portrait' | 'landscape';
type PaperSize = 'A4' | 'Legal';
type RotationDeg = 0 | 90 | 180 | 270;
type WorkflowMode = 'print' | 'copy' | 'scan';

type PageRangeSelection =
  | { type: 'all' }
  | { type: 'custom'; range: string }
  | { type: 'single'; page: number };

interface PrintConfig {
  mode: 'print' | 'copy' | 'scan';
  sessionId: string | null;
  documentId: string | null;
  filename: string | null;
  scanFilename?: string | null;
  scanReleaseToken?: string | null;
  copyPreviewPath?: string | null;
  copyPreviewReleaseToken?: string | null;
  detectedColorMode?: ColorMode | null;
  colorMode: ColorMode;
  duplex: boolean;
  copies: number;
  orientation: Orientation;
  rotationDeg: RotationDeg;
  paperSize: PaperSize;
  pageRange: PageRangeSelection;
  totalPages: number;
  quote?: PrintQuote;
}

interface PrintQuote {
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
  requestedColorMode: ColorMode;
  effectiveColorMode: ColorMode;
  pricing: {
    printPerPage: number;
    colorSurcharge: number;
  };
  pricingEngine?: {
    mode: 'legacy' | 'shadow' | 'live';
    perPageBreakdown?: Array<{
      index: number;
      coverage: number;
      classification: 'blank' | 'bw' | 'partial' | 'full_color';
      rawPriceExact: number;
      isBlank: boolean;
      suggestSavings?: boolean;
    }>;
    subtotalExact: number;
    discountExact: number;
    finalExact: number;
    finalPayablePeso: number;
  };
}

interface PreviewConfig {
  colorMode: ColorMode;
  orientation: Orientation;
  paperSize: PaperSize;
  rotationDeg: RotationDeg;
}

interface QuoteRequestBody {
  copies: number;
  colorMode: ColorMode;
  orientation: Orientation;
  rotationDeg: RotationDeg;
  paperSize: PaperSize;
  pageRange: PageRangeSelection;
  duplex: boolean;
  sessionId?: string;
  documentId?: string;
  isCopyJob?: true;
  copyPreviewPath?: string | null;
}

interface StoredConfigSeed {
  mode?: 'print' | 'copy' | 'scan';
  scanFilename?: string | null;
  scanReleaseToken?: string | null;
  orientation?: Orientation;
  rotationDeg?: number;
}

// PDF.js types (loaded dynamically from /libs/pdfjs)
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

const PAPER_MM: Record<PaperSize, [number, number]> = {
  A4: [210, 297], // Short (A4/LTR)
  Legal: [216, 356], // Long (Legal)
};

/** Return [widthPx, heightPx] of the paper sheet at 96 dpi,
 *  capped so the preview column (≤ 100%) never overflows.
 *  Portrait = narrow side first; Landscape = tall side first. */
function paperPx(size: PaperSize, orientation: Orientation): [number, number] {
  const MM_TO_PX = 96 / 25.4;
  let [wMM, hMM] = PAPER_MM[size];
  if (orientation === 'landscape') [wMM, hMM] = [hMM, wMM];
  return [Math.round(wMM * MM_TO_PX), Math.round(hMM * MM_TO_PX)];
}

function normalizeRotationDeg(value: unknown): RotationDeg | null {
  if (value === 0 || value === 90 || value === 180 || value === 270) {
    return value;
  }
  return null;
}

function parseWorkflowMode(
  value: string | null | undefined,
): WorkflowMode | null {
  if (value === 'print' || value === 'copy' || value === 'scan') {
    return value;
  }
  return null;
}

function previewLog(message: string, meta?: unknown): void {
  if (meta !== undefined) {
    console.log(`[CONFIG PREVIEW] ${message}`, meta);
    return;
  }
  console.log(`[CONFIG PREVIEW] ${message}`);
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

// ── Smart Pricing ────────────────────────────────────────────────────────────
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

let currentAnalysisData: any = null;

// Update Page Range when Preview navigates
function onPreviewPageChange(pageNum: number): void {
  if (pageModeSingle?.checked) {
    if (singlePageInput) {
      singlePageInput.value = String(pageNum);
      clampSinglePage();
      updateSummary();
      schedulePrintQuoteRefresh();
    }
  }
  updatePageCoverageMeter(pageNum);
}

// Sync Preview when Range Mode changes
function syncPreviewPageWithRange(): void {
  if (pageModeSingle?.checked && singlePageInput) {
    const page = parseInt(singlePageInput.value, 10);
    if (!isNaN(page)) {
      void preview.goToPage(page);
    }
  }
}

function updatePageCoverageMeter(pageNum: number): void {
  if (!coverageMeter) return;
  if (!currentAnalysisData?.pages) {
    coverageMeter.style.display = 'none';
    return;
  }
  const pageIndex = pageNum; // 1-based
  const page: {
    index?: number;
    coverage: number;
    isColor: boolean;
    classification: string;
    suggestSavings?: boolean;
  } =
    currentAnalysisData.pages.find(
      (p: { index?: number }) => p.index === pageIndex,
    ) ?? currentAnalysisData.pages[pageIndex - 1];
  if (!page) {
    coverageMeter.style.display = 'none';
    return;
  }

  const percent = Math.round(page.coverage * 100);
  coverageMeter.style.display = 'flex';
  if (coverageValue) coverageValue.textContent = `${percent}%`;
  if (coverageBar) coverageBar.style.width = `${percent}%`;

  if (tierBadge) {
    if (page.classification === 'bw' || !page.isColor) {
      tierBadge.textContent = 'B&W Rate';
    } else if (page.classification === 'full_color') {
      tierBadge.textContent = 'Full Color Rate';
    } else {
      const decile = Math.max(1, Math.ceil(page.coverage * 10));
      tierBadge.textContent = `Economy Tier ${decile}`;
    }
  }

  // Smart Suggestion Toast
  if (page.suggestSavings && getRadio('colorMode') === 'colored') {
    showSavingsToast(pageIndex);
  } else {
    hideSavingsToast();
  }
}

function showSavingsToast(pageIndex: number): void {
  let toast = document.getElementById('savingsToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'savingsToast';
    toast.className = 'savings-toast';
    toast.innerHTML = `
      <span class="savings-toast__icon">💡</span>
      <span class="savings-toast__text">Page ${pageIndex} is near a lower price tier.</span>
      <button class="savings-toast__btn" id="makeGrayscaleBtn">Go Grayscale</button>
    `;
    document.body.appendChild(toast);

    document
      .getElementById('makeGrayscaleBtn')
      ?.addEventListener('click', () => {
        alert('Tip: Setting this page to grayscale could save you money!');
        hideSavingsToast();
      });
  }

  toast.classList.add('is-visible');
}

function hideSavingsToast(): void {
  document.getElementById('savingsToast')?.classList.remove('is-visible');
}

async function loadFullAnalysis(): Promise<void> {
  if (mode === 'copy') {
    if (copyPreviewPath) {
      try {
        const res = await fetch(
          `/api/scan/color-analysis/${encodeURIComponent(copyPreviewPath)}`,
        );
        if (res.ok) {
          const data = await res.json();
          currentAnalysisData = { pages: [{ ...data, index: 1 }] };
          updatePageCoverageMeter(1);
        }
      } catch {
        // Best-effort, non-critical feature
      }
    }
    return;
  }

  if (sessionId && selectedDocumentId) {
    try {
      const res = await fetch(
        `/api/wireless/sessions/${encodeURIComponent(sessionId)}/analysis/${encodeURIComponent(selectedDocumentId)}`,
      );
      if (res.ok) {
        currentAnalysisData = await res.json();
        updatePageCoverageMeter(preview.currentPageNumber);
      }
    } catch {
      // Best-effort, non-critical feature
    }
  }
}

class PrintPreview {
  private viewport: HTMLElement;
  private sheet: HTMLElement;
  private canvas: HTMLCanvasElement;
  private imgStage: HTMLElement;
  private img: HTMLImageElement;
  private iframe: HTMLIFrameElement;
  private placeholder: HTMLElement;
  private loading: HTMLElement;
  private controls: HTMLElement;
  private hintEl: HTMLElement;
  private pagerLabel: HTMLElement;
  private pagePrev: HTMLButtonElement;
  private pageNext: HTMLButtonElement;

  private naturalW = 794; // natural paper width in px (A4 portrait @ 96dpi)
  private naturalH = 1123; // natural paper height in px

  private zoomScale = 1.0;
  private readonly ZOOM_MIN = 0.5;
  private readonly ZOOM_MAX = 3.0;
  private readonly ZOOM_STEP = 0.25;

  private pdfDoc: PDFDocumentProxy | null = null;
  private currentPage = 1;
  private totalPages = 1;
  private latestImageInfo: {
    naturalWidth: number;
    naturalHeight: number;
  } | null = null;

  get pageCount(): number {
    return this.totalPages;
  }

  get currentPageNumber(): number {
    return this.currentPage;
  }

  get imageInfo(): { naturalWidth: number; naturalHeight: number } | null {
    return this.latestImageInfo;
  }

  private renderTask: Promise<void> | null = null;
  private resizeObserver: ResizeObserver;

  constructor() {
    this.viewport = document.getElementById('paperViewport')! as HTMLElement;
    this.sheet = document.getElementById('paperSheet')! as HTMLElement;
    this.canvas = document.getElementById(
      'previewCanvas',
    )! as HTMLCanvasElement;
    this.imgStage = document.getElementById('previewImgStage')! as HTMLElement;
    this.img = document.getElementById('previewImg')! as HTMLImageElement;
    this.iframe = document.getElementById('previewFrame')! as HTMLIFrameElement;
    this.placeholder = document.getElementById(
      'paperPlaceholder',
    )! as HTMLElement;
    this.loading = document.getElementById('paperLoading')! as HTMLElement;
    this.controls = document.getElementById('previewControls')! as HTMLElement;
    this.hintEl = document.getElementById('previewHint')! as HTMLElement;
    this.pagerLabel = document.getElementById('pagerLabel')! as HTMLElement;
    this.pagePrev = document.getElementById('pagePrev')! as HTMLButtonElement;
    this.pageNext = document.getElementById('pageNext')! as HTMLButtonElement;

    this.pagePrev.addEventListener('click', () =>
      this.goToPage(this.currentPage - 1),
    );
    this.pageNext.addEventListener('click', () =>
      this.goToPage(this.currentPage + 1),
    );

    const zoomInBtn = document.getElementById(
      'zoomIn',
    ) as HTMLButtonElement | null;
    const zoomOutBtn = document.getElementById(
      'zoomOut',
    ) as HTMLButtonElement | null;
    const zoomResetBtn = document.getElementById(
      'zoomReset',
    ) as HTMLButtonElement | null;
    zoomInBtn?.addEventListener('click', () => this.zoomIn());
    zoomOutBtn?.addEventListener('click', () => this.zoomOut());
    zoomResetBtn?.addEventListener('click', () => this.zoomReset());

    // Observe viewport resize → refit sheet, re-render PDF / recalc HTML pages
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeSheet();
      if (this.pdfDoc) void this.renderPage(this.currentPage);
      else if (this.iframe.style.display !== 'none') this.recalcHtmlPages();
    });
    this.resizeObserver.observe(this.viewport);
  }

  /** Scale the paper sheet to fill the viewport while keeping aspect ratio. */
  private resizeSheet(): void {
    const pad = 40;
    const vpW = this.viewport.clientWidth - pad;
    const vpH = this.viewport.clientHeight - pad;
    if (vpW <= 0 || vpH <= 0) return;
    const fitScale = Math.min(vpW / this.naturalW, vpH / this.naturalH);
    const finalScale = fitScale * this.zoomScale;
    this.sheet.style.width = `${Math.floor(this.naturalW * finalScale)}px`;
    this.sheet.style.height = `${Math.floor(this.naturalH * finalScale)}px`;
  }

  applyConfig(cfg: PreviewConfig): void {
    const [w, h] = paperPx(cfg.paperSize, cfg.orientation);
    const rotationScale =
      cfg.rotationDeg === 90 || cfg.rotationDeg === 270
        ? Math.min(w / h, h / w)
        : 1;

    // Store natural paper dimensions for resizeSheet()
    this.naturalW = w;
    this.naturalH = h;
    this.resizeSheet();
    this.sheet.style.setProperty('--preview-rotation', `${cfg.rotationDeg}deg`);
    this.sheet.style.setProperty(
      '--preview-rotation-scale',
      rotationScale.toFixed(4),
    );

    // Grayscale filter via data attribute → CSS handles the transition
    if (cfg.colorMode === 'grayscale') {
      this.sheet.setAttribute('data-gray', '');
    } else {
      this.sheet.removeAttribute('data-gray');
    }

    // Update coverage meter if config changes (e.g. color mode)
    updatePageCoverageMeter(this.currentPage);
  }

  async load(sessionId: string, filename?: string): Promise<void> {
    this.iframe.onload = null; // clear any stale iframe load handler
    this.controls.style.display = 'none';
    this.showLoading(true);
    this.showCanvas(false);
    this.showImg(false);
    this.showFrame(false);
    this.setHint('Loading preview…');
    this.latestImageInfo = null;

    let url = `/api/wireless/sessions/${encodeURIComponent(sessionId)}/preview`;
    if (filename) url += `?filename=${encodeURIComponent(filename)}`;
    previewLog('load() start', { sessionId, filename: filename ?? null, url });

    let response: Response;
    try {
      response = await fetchWithTimeout(url, 20_000);
      previewLog('preview response received', {
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('Content-Type') ?? '',
      });
    } catch (error) {
      previewLog('preview fetch failed', error);
      const isAbortError =
        error instanceof DOMException && error.name === 'AbortError';
      this.showError(
        isAbortError
          ? 'Preview request timed out. Please retry.'
          : 'Network error — could not reach the server.',
      );
      return;
    }

    if (!response.ok) {
      let reason = 'Preview unavailable.';
      try {
        const body = (await response.json()) as {
          error?: string;
          code?: string;
        };
        if (body.code === 'UNSUPPORTED_PREVIEW')
          reason = `No preview for this file type.`;
        else if (body.code === 'PREVIEW_CONVERSION_FAILED')
          reason =
            'Conversion failed — ensure Microsoft Word or LibreOffice is installed on this machine.';
        else if (body.error) reason = body.error;
      } catch {
        /* plain text response */
      }
      this.showError(reason);
      return;
    }

    const contentType = response.headers.get('Content-Type') ?? '';
    previewLog('routing by content type', { contentType });

    if (contentType.startsWith('image/')) {
      // Convert response to blob URL to avoid double-fetch
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      previewLog('image blob created', {
        size: blob.size,
        type: blob.type,
      });
      await this.loadImage(blobUrl, true);
    } else if (contentType.includes('application/pdf')) {
      this.latestImageInfo = null;
      const buf = await response.arrayBuffer();
      previewLog('pdf buffer loaded', { bytes: buf.byteLength });
      await this.loadPdf(buf);
    } else if (contentType.includes('text/html')) {
      this.latestImageInfo = null;
      const html = await response.text();
      previewLog('html preview loaded', { chars: html.length });
      this.loadHtml(html);
    } else {
      previewLog('unsupported preview content type', { contentType });
      this.latestImageInfo = null;
      this.showError('Unsupported preview format.');
    }

    // Load analysis data in parallel
    void loadFullAnalysis();
  }

  private async loadPdf(buf: ArrayBuffer): Promise<void> {
    previewLog('loadPdf() start', { bytes: buf.byteLength });
    if (this.pdfDoc) {
      this.pdfDoc.destroy();
      this.pdfDoc = null;
    }

    let pdfjs: PdfjsLib;
    try {
      const dynImport = new Function('u', 'return import(u)') as (
        u: string,
      ) => Promise<Record<string, unknown>>;
      const mod = await dynImport('/libs/pdfjs/pdf.min.mjs');
      pdfjs = (mod.default ?? mod) as PdfjsLib;
      pdfjs.GlobalWorkerOptions.workerSrc = `${window.location.origin}/libs/pdfjs/pdf.worker.min.mjs`;
    } catch (e) {
      console.error('PDF.js load error:', e);
      this.showError('PDF renderer not loaded.');
      return;
    }

    try {
      this.pdfDoc = await pdfjs.getDocument({ data: buf }).promise;
      this.totalPages = this.pdfDoc.numPages;
      this.currentPage = 1;
      this.updatePager();
      await this.renderPage(1);
    } catch (e) {
      console.error('PDF load error:', e);
      previewLog('loadPdf() failed', e);
      this.showError('Could not parse PDF.');
    }
  }

  private async renderPage(pageNum: number): Promise<void> {
    if (!this.pdfDoc) return;

    // Debounce — if already rendering, skip until it completes
    if (this.renderTask) return;

    this.showLoading(true);

    const renderNow = async () => {
      try {
        const page = await this.pdfDoc!.getPage(pageNum);
        const sheetW = this.sheet.clientWidth || 595;
        const sheetH = this.sheet.clientHeight || 842;
        const baseVP = page.getViewport({ scale: 1 });

        // Scale to fit sheet, accounting for device pixel ratio for crispness
        const dpr = window.devicePixelRatio || 1;
        const scaleW = sheetW / baseVP.width;
        const scaleH = sheetH / baseVP.height;
        const scale = Math.min(scaleW, scaleH) * dpr;
        const viewport = page.getViewport({ scale });

        // Size the canvas in physical pixels; CSS sizes it to 100%/100%
        this.canvas.width = viewport.width;
        this.canvas.height = viewport.height;

        const ctx = this.canvas.getContext('2d')!;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        await page.render({ canvasContext: ctx, viewport }).promise;

        this.showCanvas(true);
        this.showImg(false);
        this.showLoading(false);
        this.setHint(`Page ${pageNum} of ${this.totalPages}`);

        // Update coverage meter for the new page
        updatePageCoverageMeter(pageNum);
      } catch (e) {
        console.error('Render error:', e);
        previewLog('renderPage() failed', e);
        this.showError('Render failed.');
      } finally {
        this.renderTask = null;
      }
    };

    this.renderTask = renderNow();
    await this.renderTask;
  }

  private async loadImage(url: string, isBlobUrl = false): Promise<void> {
    previewLog('loadImage() start', { isBlobUrl });
    return new Promise((resolve) => {
      const timeoutId = window.setTimeout(() => {
        previewLog('loadImage() timeout');
        this.latestImageInfo = null;
        this.showError('Image preview timed out. Please retry.');
        if (isBlobUrl) URL.revokeObjectURL(url);
        resolve();
      }, 15_000);

      this.img.onload = () => {
        window.clearTimeout(timeoutId);
        this.latestImageInfo = {
          naturalWidth: this.img.naturalWidth,
          naturalHeight: this.img.naturalHeight,
        };
        previewLog('loadImage() onload', {
          naturalWidth: this.img.naturalWidth,
          naturalHeight: this.img.naturalHeight,
        });
        this.totalPages = 1;
        this.currentPage = 1;
        this.updatePager();
        this.showImg(true);
        this.showLoading(false);
        this.setHint('Image preview');
        // Revoke blob URL after image loads to free memory
        if (isBlobUrl) URL.revokeObjectURL(url);

        updatePageCoverageMeter(1);
        resolve();
      };
      this.img.onerror = () => {
        window.clearTimeout(timeoutId);
        this.latestImageInfo = null;
        previewLog('loadImage() onerror');
        this.showError('Could not load image.');
        if (isBlobUrl) URL.revokeObjectURL(url);
        resolve();
      };
      this.img.src = url;
      this.img.style.display = 'block';
    });
  }

  async goToPage(n: number): Promise<void> {
    n = Math.max(1, Math.min(this.totalPages, n));
    if (n === this.currentPage) return;
    this.currentPage = n;
    this.updatePager();

    // Notify the app of the page change
    onPreviewPageChange(n);

    if (this.pdfDoc) {
      await this.renderPage(n);
    } else if (this.iframe.style.display !== 'none') {
      const viewH = this.iframe.clientHeight || 1;
      this.iframe.contentWindow?.scrollTo(0, (n - 1) * viewH);
    }
  }

  private updatePager(): void {
    const multi = this.totalPages > 1;
    this.controls.style.display = 'flex';
    this.pagePrev.hidden = !multi;
    this.pageNext.hidden = !multi;
    this.pagerLabel.hidden = !multi;
    this.pagerLabel.textContent = `${this.currentPage} / ${this.totalPages}`;
    this.pagePrev.disabled = this.currentPage <= 1;
    this.pageNext.disabled = this.currentPage >= this.totalPages;
  }

  private loadHtml(html: string): void {
    previewLog('loadHtml() start');
    // Show frame first so its dimensions are available when onload fires
    this.showCanvas(false);
    this.showImg(false);
    this.showFrame(true);
    this.showLoading(true);
    this.iframe.onload = () => {
      previewLog('loadHtml() onload');
      this.recalcHtmlPages();
      this.showLoading(false);
      this.setHint('Document preview');
    };
    this.iframe.srcdoc = html;
  }

  private recalcHtmlPages(): void {
    const docEl = this.iframe.contentDocument?.documentElement;
    if (!docEl) return;
    const viewH = this.iframe.clientHeight || 1;
    this.totalPages = Math.max(1, Math.ceil(docEl.scrollHeight / viewH));
    this.currentPage = 1;
    this.iframe.contentWindow?.scrollTo(0, 0);
    this.updatePager();
    updatePageCoverageMeter(1);
  }

  private showFrame(on: boolean): void {
    this.iframe.style.display = on ? 'block' : 'none';
    this.placeholder.classList.toggle('hidden', on);
    if (on) {
      this.canvas.style.display = 'none';
      this.imgStage.style.display = 'none';
    }
  }

  private showLoading(on: boolean): void {
    this.loading.classList.toggle('hidden', !on);
  }

  private showCanvas(on: boolean): void {
    this.canvas.style.display = on ? 'block' : 'none';
    this.placeholder.classList.toggle('hidden', on);
    if (on) {
      this.iframe.style.display = 'none';
      this.imgStage.style.display = 'none';
    }
  }

  private showImg(on: boolean): void {
    this.imgStage.style.display = on ? 'grid' : 'none';
    this.img.style.display = on ? 'block' : 'none';
    if (on) {
      this.iframe.style.display = 'none';
      this.canvas.style.display = 'none';
      this.placeholder.classList.add('hidden');
    }
  }

  private showError(msg: string): void {
    previewLog('showError()', { message: msg });
    this.latestImageInfo = null;
    this.showLoading(false);
    this.showCanvas(false);
    this.showImg(false);
    this.controls.style.display = 'none';
    this.iframe.style.display = 'none';
    this.imgStage.style.display = 'none';
    const text = document.getElementById('placeholderText');
    if (text) text.textContent = msg;
    this.placeholder.classList.remove('hidden');
    this.setHint(msg);
  }

  private setHint(msg: string): void {
    this.hintEl.textContent = msg;
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.pdfDoc?.destroy();
  }

  zoomIn(): void {
    this.zoomScale = Math.min(
      this.ZOOM_MAX,
      parseFloat((this.zoomScale + this.ZOOM_STEP).toFixed(2)),
    );
    this.resizeSheet();
    if (this.pdfDoc) void this.renderPage(this.currentPage);
    this.updateZoomDisplay();
  }

  zoomOut(): void {
    this.zoomScale = Math.max(
      this.ZOOM_MIN,
      parseFloat((this.zoomScale - this.ZOOM_STEP).toFixed(2)),
    );
    this.resizeSheet();
    if (this.pdfDoc) void this.renderPage(this.currentPage);
    this.updateZoomDisplay();
  }

  zoomReset(): void {
    this.zoomScale = 1.0;
    this.resizeSheet();
    if (this.pdfDoc) void this.renderPage(this.currentPage);
    this.updateZoomDisplay();
  }

  private updateZoomDisplay(): void {
    const el = document.getElementById('zoomLevel');
    if (el) el.textContent = `${Math.round(this.zoomScale * 100)}%`;
  }

  /** Load from a raw ArrayBuffer (used by copy preview) */
  async loadFromBuffer(buf: ArrayBuffer, mime: string): Promise<void> {
    if (mime === 'application/pdf') {
      await this.loadPdf(buf);
    } else if (mime.startsWith('image/')) {
      const blob = new Blob([buf], { type: mime });
      const url = URL.createObjectURL(blob);
      await this.loadImage(url, true);
    } else {
      this.showError('Unsupported preview format.');
    }

    void loadFullAnalysis();
  }
}

const params = new URLSearchParams(window.location.search);
const rawStoredConfig = sessionStorage.getItem('printbit.config');
let storedConfig: StoredConfigSeed | null = null;
if (rawStoredConfig) {
  try {
    storedConfig = JSON.parse(rawStoredConfig) as StoredConfigSeed;
  } catch {
    storedConfig = null;
  }
}

const modeFromQuery = params.get('mode');
const modeFromStorage = sessionStorage.getItem('printbit.mode');
const mode: WorkflowMode =
  parseWorkflowMode(modeFromQuery) ??
  parseWorkflowMode(modeFromStorage) ??
  parseWorkflowMode(storedConfig?.mode) ??
  'print';
const sessionId =
  params.get('sessionId') ?? sessionStorage.getItem('printbit.sessionId');
const sessionToken =
  params.get('token') ?? sessionStorage.getItem('printbit.sessionToken');
const selectedFile =
  params.get('file') ?? sessionStorage.getItem('printbit.uploadedFile');
const selectedDocumentId =
  params.get('documentId') ??
  sessionStorage.getItem('printbit.uploadedDocumentId');
const copyPreviewPath = sessionStorage.getItem('printbit.copyPreviewPath');
const copyPreviewReleaseToken = sessionStorage.getItem(
  'printbit.copyPreviewReleaseToken',
);
const scanFilename =
  typeof storedConfig?.scanFilename === 'string'
    ? storedConfig.scanFilename.trim()
    : '';
const scanReleaseToken =
  typeof storedConfig?.scanReleaseToken === 'string' &&
  storedConfig.scanReleaseToken.trim().length > 0
    ? storedConfig.scanReleaseToken.trim()
    : null;
const initialOrientation: Orientation =
  storedConfig?.orientation === 'landscape' ? 'landscape' : 'portrait';
let rotationDeg: RotationDeg =
  normalizeRotationDeg(storedConfig?.rotationDeg) ?? 0;

const backLink = document.getElementById(
  'backLink',
) as HTMLAnchorElement | null;
const continueBtn = document.getElementById(
  'continueBtn',
) as HTMLButtonElement | null;
const filePillLabel = document.getElementById(
  'filePillLabel',
) as HTMLElement | null;
const footerSummary = document.getElementById(
  'footerSummary',
) as HTMLElement | null;
const openPricingAnalyzerBtn = document.getElementById(
  'openPricingAnalyzerBtn',
) as HTMLButtonElement | null;
const pricingAnalyzerTriggerMeta = document.getElementById(
  'pricingAnalyzerTriggerMeta',
) as HTMLElement | null;
const pricingAnalyzerModal = document.getElementById(
  'pricingAnalyzerModal',
) as HTMLElement | null;
const pricingAnalyzerBackdrop = document.getElementById(
  'pricingAnalyzerBackdrop',
) as HTMLElement | null;
const closePricingAnalyzerBtn = document.getElementById(
  'closePricingAnalyzerBtn',
) as HTMLButtonElement | null;
const pricingAnalyzerModalSummary = document.getElementById(
  'pricingAnalyzerModalSummary',
) as HTMLElement | null;
const pricingAnalyzerModalFormula = document.getElementById(
  'pricingAnalyzerModalFormula',
) as HTMLElement | null;
const pricingAnalyzerModalTotals = document.getElementById(
  'pricingAnalyzerModalTotals',
) as HTMLElement | null;
const pricingAnalyzerModalPages = document.getElementById(
  'pricingAnalyzerModalPages',
) as HTMLElement | null;
const copiesInput = document.getElementById(
  'copies',
) as HTMLInputElement | null;
const copiesDec = document.getElementById(
  'copiesDec',
) as HTMLButtonElement | null;
const copiesInc = document.getElementById(
  'copiesInc',
) as HTMLButtonElement | null;

const pageModeAll = document.getElementById(
  'pageModeAll',
) as HTMLInputElement | null;
const pageModeCustom = document.getElementById(
  'pageModeCustom',
) as HTMLInputElement | null;
const pageModeSingle = document.getElementById(
  'pageModeSingle',
) as HTMLInputElement | null;
const pageRangeGroup = document.getElementById(
  'pageRangeGroup',
) as HTMLElement | null;
const pageRangeCustomWrap = document.getElementById(
  'pageRangeCustomWrap',
) as HTMLElement | null;
const pageRangeSingleWrap = document.getElementById(
  'pageRangeSingleWrap',
) as HTMLElement | null;
const pageRangeInput = document.getElementById(
  'pageRangeInput',
) as HTMLInputElement | null;
const customRangeDisplay = document.getElementById(
  'customRangeDisplay',
) as HTMLElement | null;
const customRangeStartInput = document.getElementById(
  'customRangeStartInput',
) as HTMLInputElement | null;
const customRangeStartDec = document.getElementById(
  'customRangeStartDec',
) as HTMLButtonElement | null;
const customRangeStartInc = document.getElementById(
  'customRangeStartInc',
) as HTMLButtonElement | null;
const customRangeEndInput = document.getElementById(
  'customRangeEndInput',
) as HTMLInputElement | null;
const customRangeEndDec = document.getElementById(
  'customRangeEndDec',
) as HTMLButtonElement | null;
const customRangeEndInc = document.getElementById(
  'customRangeEndInc',
) as HTMLButtonElement | null;
const singlePageInput = document.getElementById(
  'singlePageInput',
) as HTMLInputElement | null;
const singlePageDec = document.getElementById(
  'singlePageDec',
) as HTMLButtonElement | null;
const singlePageInc = document.getElementById(
  'singlePageInc',
) as HTMLButtonElement | null;
const colorModeGroup = document.getElementById(
  'colorModeGroup',
) as HTMLElement | null;
const orientationGroup = document.getElementById(
  'orientationGroup',
) as HTMLElement | null;
const rotationGroup = document.getElementById(
  'rotationGroup',
) as HTMLElement | null;
const paperSizeGroup = document.getElementById(
  'paperSizeGroup',
) as HTMLElement | null;
const copiesGroup = document.getElementById(
  'copiesGroup',
) as HTMLElement | null;
const rotateLeftBtn = document.getElementById(
  'rotateLeftBtn',
) as HTMLButtonElement | null;
const rotateRightBtn = document.getElementById(
  'rotateRightBtn',
) as HTMLButtonElement | null;
const rotationValue = document.getElementById('rotationValue');

const initialOrientationInput = document.querySelector<HTMLInputElement>(
  `input[name="orientation"][value="${initialOrientation}"]`,
);
if (initialOrientationInput) {
  initialOrientationInput.checked = true;
}

function setContinueEnabled(canContinue: boolean): void {
  if (!continueBtn) return;
  continueBtn.disabled = !canContinue;
  continueBtn.setAttribute('aria-disabled', canContinue ? 'false' : 'true');
}

if (backLink) {
  backLink.href =
    mode === 'copy' ? '/copy' : mode === 'scan' ? '/scan' : '/print';
}
if (filePillLabel) {
  filePillLabel.textContent =
    mode === 'scan' ? scanFilename || '—' : (selectedFile ?? '—');
}

if (mode === 'print' && continueBtn) {
  setContinueEnabled(false);
}

if (mode === 'copy' && continueBtn) {
  pageRangeGroup?.classList.add('hidden');
  const hasCopyPreview = Boolean(copyPreviewPath);
  setContinueEnabled(hasCopyPreview);
  if (footerSummary)
    footerSummary.textContent = hasCopyPreview
      ? 'Copy mode — checked document ready.'
      : 'No checked document found — go back to /copy first.';
}

if (mode === 'scan') {
  colorModeGroup?.classList.add('hidden');
  orientationGroup?.classList.remove('hidden');
  rotationGroup?.classList.remove('hidden');
  paperSizeGroup?.classList.add('hidden');
  pageRangeGroup?.classList.add('hidden');
  copiesGroup?.classList.add('hidden');
  const hasScanPreview = scanFilename.length > 0;
  setContinueEnabled(hasScanPreview);
  if (footerSummary) {
    footerSummary.textContent = hasScanPreview
      ? 'Scan preview loaded — set orientation and rotation.'
      : 'No scanned file found — go back to /scan first.';
  }
}

let currentPrintQuote: PrintQuote | null = null;
let detectedColorMode: ColorMode | null = null;
let detectedOrientation: Orientation | null = null;
let currentOrientationDetectionKey: string | null = null;
const orientationAutoAppliedKeys = new Set<string>();
const orientationManuallyAdjustedKeys = new Set<string>();
let suppressOrientationChangeTracking = false;
let quoteError: string | null = null;
let quoteLoading = false;
let quoteRequestVersion = 0;
let quoteDebounceHandle: number | null = null;
const QUOTE_409_RETRY_ATTEMPTS = 20;
const QUOTE_409_RETRY_DELAY_MS = 500;
const ANALYSIS_UNAVAILABLE_ERROR =
  'Document analysis is unavailable. Re-upload the file and try again.';

function getPageRangeMaxPages(): number {
  return Math.max(1, preview.pageCount || 1);
}

function syncCustomRangeInputs(
  changed: 'start' | 'end' | 'both' = 'both',
): void {
  if (!pageRangeInput) return;
  const max = getPageRangeMaxPages();
  let start = parseInt(customRangeStartInput?.value ?? '1', 10) || 1;
  let end = parseInt(customRangeEndInput?.value ?? '1', 10) || 1;

  start = Math.max(1, Math.min(max, start));
  end = Math.max(1, Math.min(max, end));

  if (start > end) {
    if (changed === 'start') end = start;
    else start = end;
  }

  if (customRangeStartInput) {
    customRangeStartInput.min = '1';
    customRangeStartInput.max = String(max);
    customRangeStartInput.value = String(start);
  }
  if (customRangeEndInput) {
    customRangeEndInput.min = '1';
    customRangeEndInput.max = String(max);
    customRangeEndInput.value = String(end);
  }

  const normalizedRange = start === end ? String(start) : `${start}-${end}`;
  pageRangeInput.value = normalizedRange;
  if (customRangeDisplay) {
    customRangeDisplay.textContent = `Selected: ${normalizedRange}`;
  }
}

function updateCustomRangeWithDelta(
  target: 'start' | 'end',
  delta: number,
): void {
  const input =
    target === 'start' ? customRangeStartInput : customRangeEndInput;
  if (!input) return;
  const next = (parseInt(input.value || '1', 10) || 1) + delta;
  input.value = String(next);
  syncCustomRangeInputs(target);
  syncCustomRangeValidity();
  updateSummary();
  schedulePrintQuoteRefresh();
}

const customRangeStepperControls: Array<{
  el: HTMLButtonElement | null;
  target: 'start' | 'end';
  delta: number;
}> = [
  { el: customRangeStartDec, target: 'start', delta: -1 },
  { el: customRangeStartInc, target: 'start', delta: 1 },
  { el: customRangeEndDec, target: 'end', delta: -1 },
  { el: customRangeEndInc, target: 'end', delta: 1 },
];

customRangeStepperControls.forEach(({ el, target, delta }) => {
  el?.addEventListener('click', () => {
    updateCustomRangeWithDelta(target, delta);
  });
});

customRangeStartInput?.addEventListener('change', () => {
  syncCustomRangeInputs('start');
  syncCustomRangeValidity();
  updateSummary();
  schedulePrintQuoteRefresh();
});

customRangeEndInput?.addEventListener('change', () => {
  syncCustomRangeInputs('end');
  syncCustomRangeValidity();
  updateSummary();
  schedulePrintQuoteRefresh();
});

singlePageDec?.addEventListener('click', () => {
  if (!singlePageInput) return;
  const next = Math.max(1, clampSinglePage() - 1);
  singlePageInput.value = String(next);
  clampSinglePage();
  void preview.goToPage(next);
  updateSummary();
  schedulePrintQuoteRefresh();
});

singlePageInc?.addEventListener('click', () => {
  if (!singlePageInput) return;
  const next = Math.min(getPageRangeMaxPages(), clampSinglePage() + 1);
  singlePageInput.value = String(next);
  clampSinglePage();
  void preview.goToPage(next);
  updateSummary();
  schedulePrintQuoteRefresh();
});

singlePageInput?.addEventListener('change', () => {
  const page = clampSinglePage();
  void preview.goToPage(page);
  updateSummary();
  schedulePrintQuoteRefresh();
});

function clampSinglePage(): number {
  const max = getPageRangeMaxPages();
  const raw = parseInt(singlePageInput?.value ?? '1', 10) || 1;
  const next = Math.max(1, Math.min(max, raw));
  if (singlePageInput) {
    singlePageInput.max = String(max);
    singlePageInput.value = String(next);
  }
  return next;
}

function isValidCustomRange(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  return /^\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*$/.test(value);
}

function syncCustomRangeValidity(): void {
  if (!pageRangeInput) return;
  syncCustomRangeInputs();
  if (!pageModeCustom?.checked) {
    pageRangeInput.setCustomValidity('');
    return;
  }

  const raw = pageRangeInput.value;
  if (isValidCustomRange(raw)) {
    pageRangeInput.setCustomValidity('');
    return;
  }

  pageRangeInput.setCustomValidity(
    'Use formats like 1-3, 5, 7-9 or a single page number.',
  );
}

function getPageRange(): PageRangeSelection {
  if (!hasMultiplePages()) {
    return { type: 'all' };
  }
  if (pageModeCustom?.checked) {
    const range = (pageRangeInput?.value ?? '').trim();
    return { type: 'custom', range };
  }
  if (pageModeSingle?.checked) {
    return { type: 'single', page: clampSinglePage() };
  }
  return { type: 'all' };
}

function pageRangeLabel(sel: PageRangeSelection): string {
  if (sel.type === 'single') return `Page ${sel.page}`;
  if (sel.type === 'custom')
    return sel.range ? `Pages ${sel.range}` : 'Pages (custom)';
  return 'All pages';
}

function syncPageRangeUI(): void {
  const rangeVisible = pageRangeGroup
    ? !pageRangeGroup.classList.contains('hidden')
    : true;
  const isCustom = Boolean(pageModeCustom?.checked);
  const isSingle = Boolean(pageModeSingle?.checked);
  pageRangeCustomWrap?.classList.toggle('hidden', !(rangeVisible && isCustom));
  pageRangeSingleWrap?.classList.toggle('hidden', !(rangeVisible && isSingle));
}

function hasMultiplePages(): boolean {
  return mode === 'print' && getPageRangeMaxPages() > 1;
}

function syncPageRangeAvailability(): void {
  const visible = hasMultiplePages();
  const maxPages = getPageRangeMaxPages();
  const maxAllowed: number = 30; // Maximum pages allowed for custom range selection

  pageRangeGroup?.classList.toggle('hidden', !visible);

  if (pageModeAll) {
    if (!visible) {
      pageModeAll.checked = true;
      pageModeAll.disabled = false;
    } else if (maxPages > maxAllowed) {
      pageModeAll.disabled = true; // Disable "All Pages"
      if (pageModeAll.checked) {
        if (pageModeCustom) pageModeCustom.checked = true; // Auto-select "Page Range"
        if (customRangeStartInput) customRangeStartInput.value = '1';
        if (customRangeEndInput)
          customRangeEndInput.value = String(Math.min(maxAllowed, maxPages));
      }
    } else {
      pageModeAll.disabled = false;
    }
  }

  const allPagesLabel = pageModeAll?.closest<HTMLElement>('.option-card');
  if (allPagesLabel) {
    allPagesLabel.style.display = maxPages > maxAllowed ? 'none' : '';
    allPagesLabel.setAttribute(
      'title',
      maxPages > maxAllowed ? 'Max 30 pages allowed' : '',
    );
  }

  syncPageRangeUI();
  syncCustomRangeInputs();
  syncCustomRangeValidity();
}

function getRadio(name: string): string {
  return (
    document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)
      ?.value ?? ''
  );
}

function getCopies(): number {
  return Math.max(
    1,
    Math.min(30, parseInt(copiesInput?.value ?? '1', 10) || 1),
  );
}

function orientationDetectionKey(): string | null {
  if (mode !== 'print' || !sessionId) return null;
  const id = selectedDocumentId ?? selectedFile;
  if (!id) return null;
  return `${sessionId}:${id}`;
}

function clearOrientationNotice(): void {
  document.querySelector('.orientation-detect-notice')?.remove();
}

function syncOrientationDetectionContext(): string | null {
  const key = orientationDetectionKey();
  if (key !== currentOrientationDetectionKey) {
    currentOrientationDetectionKey = key;
    detectedOrientation = null;
    clearOrientationNotice();
  }
  return key;
}

function showOrientationNotice(detected: Orientation): void {
  const orientationGroup = document.querySelector<HTMLElement>(
    '.option-group:has(input[name="orientation"])',
  );
  if (!orientationGroup) return;

  let notice = orientationGroup.querySelector<HTMLElement>(
    '.orientation-detect-notice',
  );
  if (!notice) {
    notice = document.createElement('p');
    notice.className = 'orientation-detect-notice';
    orientationGroup.appendChild(notice);
  }

  const detectedLabel = detected === 'landscape' ? 'landscape' : 'portrait';
  const oppositeLabel = detected === 'landscape' ? 'Portrait' : 'Landscape';
  notice.textContent = `Auto-detected ${detectedLabel} orientation. Switch to ${oppositeLabel} if this looks wrong.`;
}

function applyImageOrientationDetection(): void {
  if (mode !== 'print') {
    detectedOrientation = null;
    clearOrientationNotice();
    return;
  }

  const key = syncOrientationDetectionContext();
  if (!key) {
    detectedOrientation = null;
    clearOrientationNotice();
    return;
  }

  const imageInfo = preview.imageInfo;
  if (
    !imageInfo ||
    imageInfo.naturalWidth <= 0 ||
    imageInfo.naturalHeight <= 0
  ) {
    detectedOrientation = null;
    clearOrientationNotice();
    return;
  }

  detectedOrientation =
    imageInfo.naturalWidth > imageInfo.naturalHeight ? 'landscape' : 'portrait';
  showOrientationNotice(detectedOrientation);

  if (
    orientationManuallyAdjustedKeys.has(key) ||
    orientationAutoAppliedKeys.has(key)
  ) {
    return;
  }

  const selected = (getRadio('orientation') as Orientation) || 'portrait';
  if (selected !== detectedOrientation) {
    const target = document.querySelector<HTMLInputElement>(
      `input[name="orientation"][value="${detectedOrientation}"]`,
    );
    if (target) {
      suppressOrientationChangeTracking = true;
      try {
        target.checked = true;
        target.dispatchEvent(new Event('change', { bubbles: true }));
      } finally {
        suppressOrientationChangeTracking = false;
      }
    }
  }

  orientationAutoAppliedKeys.add(key);
}

function currentPreviewConfig(): PreviewConfig {
  return {
    colorMode: (getRadio('colorMode') as ColorMode) || 'colored',
    orientation: (getRadio('orientation') as Orientation) || 'portrait',
    paperSize: (getRadio('paperSize') as PaperSize) || 'A4',
    rotationDeg,
  };
}

function setPrintContinueState(): void {
  if (mode !== 'print') return;
  const hasCustomRangeError =
    hasMultiplePages() &&
    Boolean(pageModeCustom?.checked) &&
    Boolean(pageRangeInput?.validationMessage);
  const canContinue =
    Boolean(currentPrintQuote) && !quoteLoading && !hasCustomRangeError;
  setContinueEnabled(canContinue);
}

function waitForQuoteRetry(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function requestDocumentAnalysisRetry(): Promise<boolean> {
  if (mode !== 'print' || !sessionId || !sessionToken) {
    return false;
  }

  const payload = selectedDocumentId ? { documentId: selectedDocumentId } : {};

  try {
    const response = await fetch(
      `/api/wireless/sessions/${encodeURIComponent(sessionId)}/analyze?token=${encodeURIComponent(sessionToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function refreshPrintQuote(): Promise<void> {
  if ((mode !== 'print' && mode !== 'copy') || (!sessionId && mode === 'print'))
    return;

  if (
    mode === 'print' &&
    hasMultiplePages() &&
    pageModeCustom?.checked &&
    pageRangeInput &&
    !pageRangeInput.checkValidity()
  ) {
    quoteRequestVersion += 1;
    currentPrintQuote = null;
    quoteError = pageRangeInput.validationMessage || 'Invalid page range.';
    quoteLoading = false;
    updateSummary();
    setPrintContinueState();
    return;
  }

  const requestVersion = ++quoteRequestVersion;
  quoteLoading = true;
  quoteError = null;
  updateSummary();
  setPrintContinueState();

  try {
    const cfg = currentPreviewConfig();
    const requestBody: QuoteRequestBody = {
      copies: getCopies(),
      colorMode: cfg.colorMode,
      orientation: cfg.orientation,
      rotationDeg: cfg.rotationDeg,
      paperSize: cfg.paperSize,
      pageRange: getPageRange(),
      duplex: false,
    };

    if (mode === 'print') {
      requestBody.sessionId = sessionId ?? undefined;
      requestBody.documentId = selectedDocumentId ?? undefined;
    } else if (mode === 'copy') {
      requestBody.sessionId = 'copy-session';
      requestBody.isCopyJob = true;
      requestBody.copyPreviewPath = copyPreviewPath;
    }

    let resolvedQuote: PrintQuote | null = null;
    let resolvedError: string | null = null;
    let attemptedAnalysisRecovery = false;

    const endpoint = mode === 'print' ? '/api/print/quote' : '/api/copy/quote';

    for (let attempt = 0; attempt < QUOTE_409_RETRY_ATTEMPTS; attempt += 1) {
      if (requestVersion !== quoteRequestVersion) return;

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
      } catch {
        resolvedError = 'Network error while calculating price.';
        break;
      }

      if (requestVersion !== quoteRequestVersion) return;

      let payload: { error?: string; code?: string; quote?: PrintQuote } = {};
      try {
        payload = (await response.json()) as {
          error?: string;
          code?: string;
          quote?: PrintQuote;
        };
      } catch {
        payload = {};
      }

      const responseCode =
        typeof payload.code === 'string' ? payload.code : null;
      const isAnalysisPending = responseCode === 'ANALYSIS_PENDING';
      const isAnalysisFailed = responseCode === 'ANALYSIS_FAILED';
      const isAnalysisUnavailable =
        responseCode === 'ANALYSIS_UNAVAILABLE' ||
        payload.error === ANALYSIS_UNAVAILABLE_ERROR;

      if (
        response.status === 409 &&
        (isAnalysisPending || isAnalysisFailed || isAnalysisUnavailable) &&
        attempt < QUOTE_409_RETRY_ATTEMPTS - 1
      ) {
        if (
          (isAnalysisFailed || isAnalysisUnavailable) &&
          !attemptedAnalysisRecovery
        ) {
          attemptedAnalysisRecovery = true;
          const retryQueued = await requestDocumentAnalysisRetry();
          if (!retryQueued) {
            console.warn('[config] Failed to queue analysis retry.');
          }
        }
        await waitForQuoteRetry(QUOTE_409_RETRY_DELAY_MS);
        continue;
      }

      if (response.status === 409 && attempt < QUOTE_409_RETRY_ATTEMPTS - 1) {
        await waitForQuoteRetry(QUOTE_409_RETRY_DELAY_MS);
        continue;
      }

      if (!response.ok || !payload.quote) {
        resolvedError = payload.error ?? 'Failed to calculate price.';
        break;
      }

      resolvedQuote = payload.quote;
      break;
    }

    if (requestVersion !== quoteRequestVersion) return;

    if (resolvedQuote) {
      currentPrintQuote = resolvedQuote;
      quoteError = null;
    } else {
      currentPrintQuote = null;
      quoteError = resolvedError ?? 'Failed to calculate price.';
    }
  } catch {
    if (requestVersion !== quoteRequestVersion) return;
    currentPrintQuote = null;
    quoteError = 'Network error while calculating price.';
  } finally {
    if (requestVersion === quoteRequestVersion) {
      quoteLoading = false;
      updateSummary();
      setPrintContinueState();
    }
  }
}

function schedulePrintQuoteRefresh(): void {
  if (mode !== 'print' && mode !== 'copy') return;
  if (quoteDebounceHandle !== null) {
    window.clearTimeout(quoteDebounceHandle);
  }
  quoteDebounceHandle = window.setTimeout(() => {
    quoteDebounceHandle = null;
    void refreshPrintQuote();
  }, 120);
}

function formatPeso(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return `₱${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2)}`;
}

function setPricingAnalyzerModalOpen(open: boolean): void {
  if (!pricingAnalyzerModal) return;
  pricingAnalyzerModal.hidden = !open;
  pricingAnalyzerModal.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function renderPricingAnalyzer(): void {
  if (
    !openPricingAnalyzerBtn ||
    !pricingAnalyzerTriggerMeta ||
    !pricingAnalyzerModalSummary ||
    !pricingAnalyzerModalFormula ||
    !pricingAnalyzerModalTotals ||
    !pricingAnalyzerModalPages
  ) {
    return;
  }

  if (mode === 'scan') {
    openPricingAnalyzerBtn.hidden = true;
    pricingAnalyzerTriggerMeta.textContent = 'Unavailable in scan mode';
    pricingAnalyzerModalSummary.textContent =
      'Smart pricing analyzer is available for print and copy jobs.';
    pricingAnalyzerModalFormula.textContent =
      'No page-tier billing applies in scan mode.';
    pricingAnalyzerModalTotals.innerHTML = '';
    pricingAnalyzerModalPages.innerHTML = '';
    setPricingAnalyzerModalOpen(false);
    return;
  }
  openPricingAnalyzerBtn.hidden = false;

  if (quoteLoading) {
    pricingAnalyzerTriggerMeta.textContent = 'Recomputing smart pricing...';
    pricingAnalyzerModalSummary.textContent = 'Recomputing smart pricing...';
    pricingAnalyzerModalFormula.textContent =
      'Please wait while we analyze pages.';
    pricingAnalyzerModalTotals.innerHTML = '';
    pricingAnalyzerModalPages.innerHTML = '';
    return;
  }

  if (!currentPrintQuote?.pricingEngine) {
    const selectedPages = currentPrintQuote?.selectedPages ?? 0;
    const totalPages = currentPrintQuote?.totalPages ?? preview.pageCount;
    const copies = currentPrintQuote?.copies ?? getCopies();
    pricingAnalyzerTriggerMeta.textContent = `${selectedPages}/${totalPages} pages · ${copies} copy${copies === 1 ? '' : 'ies'}`;
    pricingAnalyzerModalSummary.textContent = `Selected ${selectedPages} of ${totalPages} pages · ${copies} copy${copies === 1 ? '' : 'ies'}`;
    pricingAnalyzerModalFormula.textContent =
      currentPrintQuote !== null
        ? `Estimated total: ${formatPeso(currentPrintQuote.requiredAmount)}`
        : 'No pricing breakdown available yet.';
    pricingAnalyzerModalTotals.innerHTML = '';
    pricingAnalyzerModalPages.innerHTML =
      '<p class="pricing-analyzer-modal__summary">Per-page details will appear after quote breakdown is available.</p>';
    return;
  }

  const quote = currentPrintQuote;
  const pe = quote.pricingEngine!;
  const pages = Array.isArray(pe.perPageBreakdown) ? pe.perPageBreakdown : [];
  const copies = quote.copies;

  const buckets = {
    blank: { count: 0, total: 0 },
    bw: { count: 0, total: 0 },
    partial: { count: 0, total: 0 },
    full_color: { count: 0, total: 0 },
  };

  let lowCoverageColorPages = 0;
  for (const page of pages) {
    const bucket = buckets[page.classification];
    bucket.count += 1;
    bucket.total += page.rawPriceExact * copies;
    if (
      (page.classification === 'partial' ||
        page.classification === 'full_color') &&
      page.coverage <= 0.03
    ) {
      lowCoverageColorPages += 1;
    }
  }

  pricingAnalyzerTriggerMeta.textContent = `${quote.selectedPages} pages · ${formatPeso(pe.finalPayablePeso)} payable`;

  pricingAnalyzerModalSummary.textContent = `Selected ${quote.selectedPages} of ${quote.totalPages} pages · ${copies} copy${copies === 1 ? '' : 'ies'} · ${quote.effectiveColorMode === 'colored' ? 'Colored mode' : 'Grayscale mode'}`;

  pricingAnalyzerModalTotals.innerHTML = `
    <article class="pricing-chip pricing-chip--bw">
      <span class="pricing-chip__label">B/W pages</span>
      <span class="pricing-chip__value">${buckets.bw.count}</span>
      <span class="pricing-chip__sub">${formatPeso(buckets.bw.total)}</span>
    </article>
    <article class="pricing-chip pricing-chip--partial">
      <span class="pricing-chip__label">Smart tier pages</span>
      <span class="pricing-chip__value">${buckets.partial.count}</span>
      <span class="pricing-chip__sub">${formatPeso(buckets.partial.total)}</span>
    </article>
    <article class="pricing-chip pricing-chip--color">
      <span class="pricing-chip__label">Full-color pages</span>
      <span class="pricing-chip__value">${buckets.full_color.count}</span>
      <span class="pricing-chip__sub">${formatPeso(buckets.full_color.total)}</span>
    </article>
    <article class="pricing-chip pricing-chip--blank">
      <span class="pricing-chip__label">Blank pages</span>
      <span class="pricing-chip__value">${buckets.blank.count}</span>
      <span class="pricing-chip__sub">${formatPeso(buckets.blank.total)}</span>
    </article>
  `;

  pricingAnalyzerModalFormula.textContent = `${formatPeso(pe.subtotalExact)}${pe.discountExact > 0 ? ` − ${formatPeso(pe.discountExact)} bulk discount` : ''} = ${formatPeso(pe.finalPayablePeso)} payable`;

  const classificationLabel: Record<
    'blank' | 'bw' | 'partial' | 'full_color',
    string
  > = {
    blank: 'Blank',
    bw: 'B/W',
    partial: 'Smart Tier',
    full_color: 'Full Color',
  };

  const classificationClass: Record<
    'blank' | 'bw' | 'partial' | 'full_color',
    string
  > = {
    blank: 'is-blank',
    bw: 'is-bw',
    partial: 'is-partial',
    full_color: 'is-color',
  };

  const rows = pages
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((page) => {
      const pageClass = classificationClass[page.classification];
      const coveragePercent = `${(page.coverage * 100).toFixed(1)}%`;
      const rowPrice = formatPeso(page.rawPriceExact * copies);
      return `<div class="pricing-analyzer-page-row ${pageClass}">
        <span class="pricing-analyzer-page-row__page">Page ${page.index}</span>
        <span class="pricing-analyzer-page-row__class">${classificationLabel[page.classification]}</span>
        <span class="pricing-analyzer-page-row__coverage">${coveragePercent} coverage</span>
        <span class="pricing-analyzer-page-row__price">${rowPrice}</span>
      </div>`;
    })
    .join('');

  pricingAnalyzerModalPages.innerHTML = rows;

  if (quote.totalPages > quote.selectedPages) {
    pricingAnalyzerModalSummary.textContent += ` · Session cap active: only ${quote.selectedPages} pages are billed per job.`;
  } else if (lowCoverageColorPages > 0) {
    pricingAnalyzerModalSummary.textContent += ` · ${lowCoverageColorPages} page(s) were detected as color with low coverage. These often come from embedded color objects/logos in grayscale-looking PDFs.`;
  }
}

function updateSummary(): void {
  if (!footerSummary) return;
  if (mode === 'scan') {
    const cfg = currentPreviewConfig();
    footerSummary.classList.add('ready');
    footerSummary.textContent =
      `Scan mode · ${cfg.orientation === 'portrait' ? 'Portrait' : 'Landscape'} · ` +
      `Rotate ${cfg.rotationDeg}°`;
    renderPricingAnalyzer();
    return;
  }

  const cfg = currentPreviewConfig();
  const n = getCopies();
  const pages = pageRangeLabel(getPageRange());
  let suffix = '';

  if (quoteLoading) {
    suffix = ' · Calculating price...';
    footerSummary.classList.remove('ready');
  } else if (currentPrintQuote) {
    footerSummary.classList.add('ready');
    const isLongBond = cfg.paperSize === 'Legal';
    const paperLabel = isLongBond ? 'Long Bond' : 'Short Bond';

    if (currentPrintQuote.pricingEngine) {
      const pe = currentPrintQuote.pricingEngine;
      suffix = ` · ${paperLabel} · ₱${pe.finalPayablePeso}`;
      if (pe.discountExact > 0) {
        suffix += ` (Incl. ₱${pe.discountExact.toFixed(2)} discount)`;
      }
    } else {
      suffix = ` · ${paperLabel} · ₱${currentPrintQuote.requiredAmount}`;
    }
  } else if (quoteError) {
    suffix = ` · ${quoteError}`;
    footerSummary.classList.remove('ready');
  } else if (mode === 'copy') {
    const hasCopyPreview = Boolean(copyPreviewPath);
    if (hasCopyPreview) {
      suffix = ' · Ready to calculate';
    } else {
      suffix = ' · No document';
    }
  }

  footerSummary.textContent =
    `${n} cop${n === 1 ? 'y' : 'ies'} · ${pages} · ${cfg.paperSize} · ` +
    `${cfg.orientation === 'portrait' ? 'Portrait' : 'Landscape'} · ` +
    `Rotate ${cfg.rotationDeg}° · ` +
    `${cfg.colorMode === 'colored' ? 'Colour' : 'Grayscale'}${suffix}`;
  renderPricingAnalyzer();
}

const preview = new PrintPreview();

function renderRotationValue(): void {
  if (rotationValue) {
    rotationValue.textContent = `${rotationDeg}°`;
  }
}

function setRotation(next: number): void {
  const normalized = normalizeRotationDeg(((next % 360) + 360) % 360);
  rotationDeg = normalized ?? 0;
  renderRotationValue();
  const cfg = currentPreviewConfig();
  preview.applyConfig(cfg);
  updateSummary();
  schedulePrintQuoteRefresh();
}

renderRotationValue();
preview.applyConfig(currentPreviewConfig());

document
  .querySelectorAll<HTMLInputElement>('input[type=radio]')
  .forEach((el) => {
    el.addEventListener('change', () => {
      if (el.name === 'pageRangeMode') {
        syncPreviewPageWithRange();
        syncPageRangeUI();
        syncCustomRangeInputs();
        syncCustomRangeValidity();
      }
      const cfg = currentPreviewConfig();
      preview.applyConfig(cfg);
      updateSummary();
      schedulePrintQuoteRefresh();
    });
  });

document
  .querySelectorAll<HTMLInputElement>('input[name="orientation"]')
  .forEach((el) => {
    el.addEventListener('change', () => {
      if (suppressOrientationChangeTracking) return;
      const key = orientationDetectionKey();
      if (!key) return;
      orientationManuallyAdjustedKeys.add(key);
    });
  });

rotateLeftBtn?.addEventListener('click', () => {
  setRotation(rotationDeg - 90);
});

rotateRightBtn?.addEventListener('click', () => {
  setRotation(rotationDeg + 90);
});

copiesDec?.addEventListener('click', () => {
  const v = getCopies();
  if (v > 1 && copiesInput) {
    copiesInput.value = String(v - 1);
    updateSummary();
    schedulePrintQuoteRefresh();
  }
});
copiesInc?.addEventListener('click', () => {
  const v = getCopies();
  if (v < 30 && copiesInput) {
    copiesInput.value = String(v + 1);
    updateSummary();
    schedulePrintQuoteRefresh();
  }
});
copiesInput?.addEventListener('change', () => {
  if (copiesInput) {
    copiesInput.value = String(getCopies());
    updateSummary();
    schedulePrintQuoteRefresh();
  }
});

openPricingAnalyzerBtn?.addEventListener('click', () => {
  setPricingAnalyzerModalOpen(true);
});

const closePricingAnalyzerModal = (): void => {
  setPricingAnalyzerModalOpen(false);
};

closePricingAnalyzerBtn?.addEventListener('click', closePricingAnalyzerModal);
pricingAnalyzerBackdrop?.addEventListener('click', closePricingAnalyzerModal);

window.addEventListener('keydown', (event) => {
  if (
    event.key === 'Escape' &&
    pricingAnalyzerModal &&
    !pricingAnalyzerModal.hidden
  ) {
    closePricingAnalyzerModal();
  }
});

updateSummary();
syncPageRangeAvailability();
clampSinglePage();
syncCustomRangeValidity();
setPrintContinueState();

async function loadPreview(): Promise<void> {
  previewLog('loadPreview() start', {
    mode,
    sessionId: sessionId ?? null,
    selectedFile: selectedFile ?? null,
    selectedDocumentId: selectedDocumentId ?? null,
  });
  if (mode === 'copy') {
    clearOrientationNotice();
    detectedOrientation = null;
    const copyPreview = copyPreviewPath;
    if (!copyPreview) return;

    const url = `/api/scan/preview/${encodeURIComponent(copyPreview)}`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) return;
      const buf = await resp.arrayBuffer();
      await preview.loadFromBuffer(buf, 'application/pdf');
    } catch {
      // Preview not critical for copy mode
    }

    try {
      const analysisResp = await fetch(
        `/api/scan/color-analysis/${encodeURIComponent(copyPreview)}`,
      );
      if (analysisResp.ok) {
        const { isGrayscale } = (await analysisResp.json()) as {
          isGrayscale: boolean;
        };
        if (isGrayscale) {
          resetColorLock(); // ensure clean state
          lockColorMode();
        }
      }
    } catch {
      // non-fatal
    }

    if (footerSummary)
      footerSummary.textContent =
        'Copy preview loaded — adjust settings above.';
    return;
  }

  if (mode === 'scan') {
    clearOrientationNotice();
    detectedOrientation = null;
    if (!scanFilename) {
      previewLog('loadPreview() scan mode - no scanFilename');
      return;
    }

    const url = `/api/scan/preview/${encodeURIComponent(scanFilename)}`;
    previewLog('loadPreview() scan mode - loading', { url });
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) {
        previewLog('loadPreview() scan mode - HTTP error', {
          status: resp.status,
          statusText: resp.statusText,
        });
        return;
      }
      let mime = (resp.headers.get('Content-Type') ?? '').toLowerCase();
      previewLog('loadPreview() scan mode - content type', { mime });

      if (!mime || mime === '' || mime === 'application/octet-stream') {
        const ext = scanFilename.toLowerCase().split('.').pop() || '';
        if (ext === 'pdf') mime = 'application/pdf';
        else if (['jpg', 'jpeg'].includes(ext)) mime = 'image/jpeg';
        else if (ext === 'png') mime = 'image/png';
      }

      const buf = await resp.arrayBuffer();
      await preview.loadFromBuffer(buf, mime || 'application/octet-stream');
    } catch (err) {
      previewLog('loadPreview() scan mode - exception', err);
    }

    updateSummary();
    return;
  }

  if (mode !== 'print') {
    clearOrientationNotice();
    detectedOrientation = null;
    return;
  }

  if (!sessionId) {
    const text = document.getElementById('placeholderText');
    if (text) text.textContent = 'No session — go back to /print';
    document.getElementById('paperLoading')?.classList.add('hidden');
    return;
  }

  syncOrientationDetectionContext();
  await preview.load(sessionId, selectedFile ?? undefined);
  applyImageOrientationDetection();
  if (sessionId) await applyColorAnalysis(sessionId, selectedFile);
  syncPageRangeAvailability();
  clampSinglePage();
  updateSummary();
  await refreshPrintQuote();
}

function lockColorMode(): void {
  const grayRadio = document.querySelector<HTMLInputElement>(
    'input[name="colorMode"][value="grayscale"]',
  );
  if (grayRadio) {
    grayRadio.checked = true;
    grayRadio.dispatchEvent(new Event('change', { bubbles: true }));
  }

  document
    .querySelectorAll<HTMLInputElement>('input[name="colorMode"]')
    .forEach((radio) => {
      radio.disabled = true;
      radio
        .closest<HTMLElement>('.option-card')
        ?.setAttribute('data-locked', 'true');
    });

  const colorGroup = document.querySelector<HTMLElement>(
    '.option-group:has(input[name="colorMode"])',
  );
  if (colorGroup && !colorGroup.querySelector('.color-lock-notice')) {
    const notice = document.createElement('p');
    notice.className = 'color-lock-notice';
    notice.textContent =
      'Color printing is unavailable — this document contains only black & white content.';
    colorGroup.appendChild(notice);
  }
}

function resetColorLock(): void {
  document
    .querySelectorAll<HTMLInputElement>('input[name="colorMode"]')
    .forEach((radio) => {
      radio.disabled = false;
      radio
        .closest<HTMLElement>('.option-card')
        ?.removeAttribute('data-locked');
    });

  document.querySelector('.color-lock-notice')?.remove();
}

async function applyColorAnalysis(
  sessionId: string,
  filename?: string | null,
): Promise<void> {
  resetColorLock();
  detectedColorMode = null;

  let url = `/api/wireless/sessions/${encodeURIComponent(sessionId)}/color-analysis`;
  if (filename) url += `?filename=${encodeURIComponent(filename)}`;

  try {
    const resp = await fetchWithTimeout(url, 10_000);
    if (!resp.ok) return;

    const { isGrayscale } = (await resp.json()) as { isGrayscale: boolean };
    detectedColorMode = isGrayscale ? 'grayscale' : 'colored';
    if (!isGrayscale) return;

    const grayRadio = document.querySelector<HTMLInputElement>(
      'input[name="colorMode"][value="grayscale"]',
    );
    if (grayRadio) {
      grayRadio.checked = true;
      grayRadio.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const colorGroup = document.querySelector<HTMLElement>(
      '.option-group:has(input[name="colorMode"])',
    );
    if (colorGroup && !colorGroup.querySelector('.color-lock-notice')) {
      const notice = document.createElement('p');
      notice.className = 'color-lock-notice';
      notice.textContent =
        'Auto-detected grayscale. Switch to Colored if your file has color.';
      colorGroup.appendChild(notice);
    }
  } catch {
    detectedColorMode = null;
  }
}

continueBtn?.addEventListener('click', () => {
  if (mode === 'print' && !sessionId) return;
  if (mode === 'print' && !currentPrintQuote) return;
  if (mode === 'copy' && !copyPreviewPath) return;
  if (mode === 'scan' && !scanFilename) return;

  const cfg = currentPreviewConfig();
  const config: PrintConfig = {
    mode,
    sessionId: mode === 'scan' ? null : sessionId,
    documentId: mode === 'print' ? selectedDocumentId : null,
    filename: mode === 'scan' ? scanFilename : selectedFile,
    scanFilename: mode === 'scan' ? scanFilename : null,
    scanReleaseToken: mode === 'scan' ? scanReleaseToken : null,
    copyPreviewPath: mode === 'copy' ? copyPreviewPath : null,
    copyPreviewReleaseToken: mode === 'copy' ? copyPreviewReleaseToken : null,
    detectedColorMode: mode === 'print' ? detectedColorMode : null,
    colorMode: cfg.colorMode,
    duplex: false,
    copies: mode === 'scan' ? 1 : getCopies(),
    orientation: cfg.orientation,
    rotationDeg: cfg.rotationDeg,
    paperSize: cfg.paperSize,
    pageRange: mode === 'scan' ? { type: 'all' } : getPageRange(),
    totalPages: preview.pageCount,
    quote: mode === 'print' ? (currentPrintQuote ?? undefined) : undefined,
  };

  sessionStorage.setItem('printbit.mode', mode);
  if (sessionId) sessionStorage.setItem('printbit.sessionId', sessionId);
  if (sessionToken)
    sessionStorage.setItem('printbit.sessionToken', sessionToken);
  if (selectedFile)
    sessionStorage.setItem('printbit.uploadedFile', selectedFile);
  if (selectedDocumentId)
    sessionStorage.setItem('printbit.uploadedDocumentId', selectedDocumentId);
  sessionStorage.setItem('printbit.config', JSON.stringify(config));

  window.location.href = '/confirm';
});

void loadPreview();
