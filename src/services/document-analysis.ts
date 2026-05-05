import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { isMainThread, workerData, parentPort } from 'node:worker_threads';
import {
  COLOR_SATURATION_THRESHOLD,
  MAX_PIXELS_TO_SAMPLE,
} from '@/config/document-analysis.config';

export type AnalyzedFileType =
  | 'pdf'
  | 'docx'
  | 'doc'
  | 'xlsx'
  | 'xls'
  | 'pptx'
  | 'ppt'
  | 'image'
  | 'unknown';

export interface PageAnalysis {
  index: number;
  isColor: boolean;
  coverage?: number;
  classification?: 'blank' | 'bw' | 'partial' | 'full_color';
  isBlank?: boolean;
  fallbackReasonFlags?: string[];
}

export type AnalysisConfidence = 'high' | 'medium' | 'low';

export interface DocumentAnalysisResult {
  fileType: AnalyzedFileType;
  pageCount: number;
  pages: PageAnalysis[];
  colorPages: number;
  bwPages: number;
  totalPages: number;
  confidence?: AnalysisConfidence;
}

interface AnalyzeDocumentInput {
  filePath: string;
  contentType?: string;
  filename?: string;
  convertToPdfPreview?: (sourcePath: string) => Promise<string>;
}

interface RgbaFrame {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

interface PdfOperatorList {
  fnArray: number[];
  argsArray: unknown[];
}

interface PdfOps {
  setFillRGBColor?: number;
  setStrokeRGBColor?: number;
  setFillCMYKColor?: number;
  setStrokeCMYKColor?: number;
  paintImageXObject?: number;
  paintInlineImageXObject?: number;
  paintImageMaskXObject?: number;
  paintJpegXObject?: number;
  paintFormXObject?: number;
}

function resolveFileType(
  contentType: string,
  filename: string,
): AnalyzedFileType {
  const ext = path.extname(filename).toLowerCase();

  if (contentType === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (
    contentType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === '.docx'
  ) {
    return 'docx';
  }
  if (contentType === 'application/msword' || ext === '.doc') return 'doc';
  if (
    contentType ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    ext === '.xlsx'
  ) {
    return 'xlsx';
  }
  if (contentType === 'application/vnd.ms-excel' || ext === '.xls')
    return 'xls';
  if (
    contentType ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    ext === '.pptx'
  ) {
    return 'pptx';
  }
  if (contentType === 'application/vnd.ms-powerpoint' || ext === '.ppt')
    return 'ppt';

  if (
    contentType.startsWith('image/') ||
    ext === '.jpg' ||
    ext === '.jpeg' ||
    ext === '.png' ||
    ext === '.webp'
  ) {
    return 'image';
  }

  return 'unknown';
}

function isColorPixel(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === 0) return false;
  const saturation = (max - min) / max;
  return saturation > COLOR_SATURATION_THRESHOLD;
}

/**
 * Checks if a pixel has any content (non-white/non-transparent).
 */
function isContentPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < 8) return false; // Transparent
  // Check if it's not white (with some tolerance)
  return r < 250 || g < 250 || b < 250;
}

interface CoverageMetrics {
  colorCoverage: number;
  contentCoverage: number;
}

function computeFrameMetrics(frame: RgbaFrame): CoverageMetrics {
  const totalPixels = frame.width * frame.height;
  if (totalPixels === 0) return { colorCoverage: 0, contentCoverage: 0 };

  const step = Math.max(1, Math.ceil(totalPixels / MAX_PIXELS_TO_SAMPLE));
  let colorPixels = 0;
  let contentPixels = 0;
  let sampledPixels = 0;

  for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex += step) {
    const offset = pixelIndex * 4;
    const r = frame.data[offset];
    const g = frame.data[offset + 1];
    const b = frame.data[offset + 2];
    const a = frame.data[offset + 3];

    sampledPixels += 1;
    if (isContentPixel(r, g, b, a)) {
      contentPixels += 1;
      if (isColorPixel(r, g, b)) {
        colorPixels += 1;
      }
    }
  }

  return {
    colorCoverage: sampledPixels === 0 ? 0 : colorPixels / sampledPixels,
    contentCoverage: sampledPixels === 0 ? 0 : contentPixels / sampledPixels,
  };
}

async function analyzeImage(filePath: string): Promise<DocumentAnalysisResult> {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const metrics = computeFrameMetrics({
    data,
    width: info.width,
    height: info.height,
  });
  const isBlank = metrics.contentCoverage < 0.001;
  const isColor = !isBlank && metrics.colorCoverage > 0.05; // Threshold: > 5% color pixels = colored page

  const page: PageAnalysis = {
    index: 1,
    isColor,
    coverage: metrics.colorCoverage,
    classification: isBlank
      ? 'blank'
      : isColor
        ? metrics.colorCoverage > 0.95
          ? 'full_color'
          : 'partial'
        : 'bw',
    isBlank,
  };

  return {
    fileType: 'image',
    pageCount: 1,
    pages: [page],
    colorPages: page.isColor ? 1 : 0,
    bwPages: page.isColor ? 0 : 1,
    totalPages: 1,
    confidence: 'high',
  };
}

async function analyzePdfFile(
  pdfPath: string,
  fileType: AnalyzedFileType,
): Promise<DocumentAnalysisResult> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const ops = (pdfjs.OPS ?? {}) as PdfOps;
  const data = new Uint8Array(await fs.promises.readFile(pdfPath));

  const pdfjsAllOps = (pdfjs.OPS ?? {}) as Record<string, number>;
  const textOpNums = new Set<number>(
    [
      'beginText',
      'endText',
      'showText',
      'showSpacedText',
      'nextLine',
      'moveText',
      'nextLineShowText',
      'nextLineSetSpacingShowText',
    ]
      .map((k) => pdfjsAllOps[k])
      .filter((v): v is number => typeof v === 'number'),
  );
  const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise;

  const pages: PageAnalysis[] = [];
  let fallbackPageCount = 0;

  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
      const page = await doc.getPage(pageNum);
      let coverage = 0;
      let isColor = false;
      let classification: 'blank' | 'bw' | 'partial' | 'full_color' = 'bw';
      let isBlank = true;

      try {
        const opList = (await page.getOperatorList()) as PdfOperatorList;
        const analysis = analyzePageOperatorList(opList, ops, textOpNums);
        coverage = analysis.coverage;
        isColor = analysis.hasColor;
        isBlank = analysis.isBlank;
        classification = analysis.classification;
      } catch (error) {
        console.warn(
          `[document-analysis] Page ${pageNum} operator scan failed; defaulting to colored.`,
          error,
        );
        coverage = 1;
        isColor = true;
        classification = 'full_color';
        fallbackPageCount += 1;
      } finally {
        page.cleanup();
      }

      pages.push({
        index: pageNum,
        isColor,
        coverage,
        classification,
        isBlank,
        fallbackReasonFlags:
          fallbackPageCount > 0
            ? ['operator_scan_failed_default_color']
            : undefined,
      });
    }
  } finally {
    await doc.destroy();
  }

  const colorPages = pages.filter((page) => page.isColor).length;
  const totalPages = pages.length;
  const confidence: AnalysisConfidence =
    fallbackPageCount === 0
      ? 'high'
      : fallbackPageCount >= totalPages
        ? 'low'
        : 'medium';

  return {
    fileType,
    pageCount: totalPages,
    pages,
    colorPages,
    bwPages: totalPages - colorPages,
    totalPages,
    confidence,
  };
}

function parseRgbArgs(args: unknown): [number, number, number] | null {
  if (!Array.isArray(args) || args.length === 0) return null;

  if (typeof args[0] === 'string' && args[0].startsWith('#')) {
    const hex = args[0].slice(1);
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return [r, g, b];
    }
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return [r, g, b];
    }
    return null;
  }

  if (
    args.length >= 3 &&
    typeof args[0] === 'number' &&
    typeof args[1] === 'number' &&
    typeof args[2] === 'number'
  ) {
    return [
      Math.round(args[0] * 255),
      Math.round(args[1] * 255),
      Math.round(args[2] * 255),
    ];
  }

  return null;
}

interface PageAnalysisMetrics {
  hasColor: boolean;
  coverage: number;
  isBlank: boolean;
  classification: 'blank' | 'bw' | 'partial' | 'full_color';
}

function analyzePageOperatorList(
  opList: PdfOperatorList,
  ops: PdfOps,
  textOpNums: Set<number> = new Set(),
): PageAnalysisMetrics {
  const imagePaintOps = new Set(
    [
      ops.paintImageXObject,
      ops.paintInlineImageXObject,
      ops.paintImageMaskXObject,
      ops.paintJpegXObject,
    ].filter((op): op is number => typeof op === 'number'),
  );

  let hasColor = false;
  let hasImages = false;
  let hasContent = false;

  // Revised logic: Content detection should be broader.
  // Many PDFs have invisible operators or metadata-only ops.
  // We need to count actual drawing ops, not just color-changing ops.
  let contentOpsCount = 0;
  for (let i = 0; i < opList.fnArray.length; i += 1) {
    const op = opList.fnArray[i];
    const isDrawingOp =
      op === ops.paintImageXObject ||
      op === ops.paintInlineImageXObject ||
      op === ops.paintImageMaskXObject ||
      op === ops.paintJpegXObject ||
      op === ops.paintFormXObject ||
      textOpNums.has(op);

    const isColorOp =
      op === ops.setFillRGBColor ||
      op === ops.setStrokeRGBColor ||
      op === ops.setFillCMYKColor ||
      op === ops.setStrokeCMYKColor;

    if (isDrawingOp || isColorOp) {
      contentOpsCount += 1;
      hasContent = true;

      // Color detection logic
      if (imagePaintOps.has(op)) {
        hasImages = true;
        hasColor = true;
      } else if (op === ops.setFillRGBColor || op === ops.setStrokeRGBColor) {
        const rgb = parseRgbArgs(opList.argsArray[i]);
        if (rgb) {
          const [r, g, b] = rgb;
          if (Math.max(r, g, b) - Math.min(r, g, b) > 15) {
            hasColor = true;
          }
        }
      } else if (op === ops.setFillCMYKColor || op === ops.setStrokeCMYKColor) {
        const args = opList.argsArray[i];
        if (Array.isArray(args) && args.length >= 4) {
          const [c, m, y] = args as number[];
          if (c > 0.05 || m > 0.05 || y > 0.05) {
            hasColor = true;
          }
        }
      }
    }
  }

  const isBlank = !hasContent;
  const estimatedCoverage =
    !isBlank && opList.fnArray.length > 0
      ? Math.min(1.0, contentOpsCount / opList.fnArray.length)
      : 0;
  let classification: 'blank' | 'bw' | 'partial' | 'full_color';
  if (isBlank) {
    classification = 'blank';
  } else if (!hasColor) {
    classification = 'bw';
  } else if (estimatedCoverage > 0.8 || hasImages) {
    classification = 'full_color';
  } else {
    classification = 'partial';
  }

  return {
    hasColor,
    coverage: estimatedCoverage,
    isBlank,
    classification,
  };
}

/**
 * Direct implementation of document analysis, used within worker threads or as fallback.
 */
async function analyzeDocumentDirect(
  input: AnalyzeDocumentInput,
): Promise<DocumentAnalysisResult> {
  const contentType = (input.contentType ?? '').toLowerCase();
  const filename = input.filename ?? path.basename(input.filePath);
  const fileType = resolveFileType(contentType, filename);

  if (fileType === 'image') return analyzeImage(input.filePath);
  if (fileType === 'pdf') return analyzePdfFile(input.filePath, fileType);

  if (
    fileType === 'docx' ||
    fileType === 'doc' ||
    fileType === 'xlsx' ||
    fileType === 'xls' ||
    fileType === 'pptx' ||
    fileType === 'ppt'
  ) {
    if (!input.convertToPdfPreview) {
      throw new Error(
        'Document conversion function is required for Office document analysis.',
      );
    }

    const pdfPath = await input.convertToPdfPreview(input.filePath);
    return analyzePdfFile(pdfPath, fileType);
  }

  throw new Error('Unsupported file type for analysis.');
}

/**
 * Public entry point for document analysis. Spawns a worker thread for heavy tasks
 * (PDF/Image) to ensure the main event loop remains responsive.
 */
export async function analyzeDocument(
  input: AnalyzeDocumentInput,
): Promise<DocumentAnalysisResult> {
  if (!isMainThread) return analyzeDocumentDirect(input);
  return analyzeDocumentDirect(input);
}

// Worker thread entry point
if (!isMainThread && parentPort) {
  (async () => {
    try {
      const result = await analyzeDocumentDirect(workerData);
      parentPort!.postMessage({ type: 'success', result });
    } catch (error) {
      parentPort!.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
}
