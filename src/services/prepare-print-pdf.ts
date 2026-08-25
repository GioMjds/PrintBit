import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import { GHOSTSCRIPT_PATH, SUMATRA_PATH } from '@/config/http.config';
import { convertToPdfPreview } from './preview';

const execFileAsync = promisify(execFile);

export const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.bmp',
  '.gif',
]);
const PREPARED_PRINT_DIR = path.resolve('uploads', 'prepared-worker');

import type { PrintQuality } from '@/core/database/shared.schema';
import type { ColorMode, Orientation, PaperSize } from './printer';
export type RotationDeg = 0 | 90 | 180 | 270;

export const PAPER_DIMENSIONS_PT: Record<PaperSize, [number, number]> = {
  A4: [595.28, 841.89],
  Letter: [612.0, 792.0],
  Legal: [612.0, 1008.0],
};

export const SAFE_MARGIN_PT = 14.4; // 0.2 inch / 5.08 mm safe margin from physical printer roller borders

export function getPaperSizePoints(
  paperSize: PaperSize = 'A4',
  orientation: Orientation = 'portrait',
): [number, number] {
  const [w, h] = PAPER_DIMENSIONS_PT[paperSize] ?? PAPER_DIMENSIONS_PT.A4;
  const portraitW = Math.min(w, h);
  const portraitH = Math.max(w, h);
  return orientation === 'landscape'
    ? [portraitH, portraitW]
    : [portraitW, portraitH];
}

function normalizeRotationDeg(value: number | undefined): RotationDeg {
  if (value === 90 || value === 180 || value === 270) {
    return value;
  }
  return 0;
}

function normalizeRangeString(raw: string): string | null {
  const compact = raw.replace(/\s+/g, '');
  if (!compact) return null;
  if (!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(compact)) return null;

  const chunks = compact.split(',');
  for (const chunk of chunks) {
    if (chunk.includes('-')) {
      const [startRaw, endRaw] = chunk.split('-');
      const start = Number(startRaw);
      const end = Number(endRaw);
      if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
      if (start < 1 || end < 1 || start > end) return null;
      continue;
    }

    const page = Number(chunk);
    if (!Number.isInteger(page) || page < 1) return null;
  }

  return compact;
}

function parsePageRange(raw: unknown): string | null {
  if (raw == null) return null;

  if (typeof raw === 'string') {
    const normalized = normalizeRangeString(raw);
    if (!normalized) {
      throw new Error('Invalid page range format.');
    }
    return normalized;
  }

  if (typeof raw !== 'object') {
    throw new Error('Invalid page range payload.');
  }

  const payload = raw as
    | { type: 'all' }
    | { type: 'single'; page?: unknown }
    | { type: 'custom'; range?: unknown };

  if (payload.type === 'all') {
    return null;
  }

  if (payload.type === 'single') {
    const page =
      typeof payload.page === 'number' && Number.isFinite(payload.page)
        ? Math.floor(payload.page)
        : Number(payload.page);
    if (!Number.isInteger(page) || page < 1) {
      throw new Error('Invalid single-page selection.');
    }
    return String(page);
  }

  if (payload.type === 'custom') {
    const normalized = normalizeRangeString(String(payload.range ?? ''));
    if (!normalized) {
      throw new Error('Invalid custom page range.');
    }
    return normalized;
  }

  throw new Error('Invalid page range payload.');
}

function expandPageRange(range: string | null, totalPages: number): number[] {
  if (totalPages < 1) {
    throw new Error('Document has no pages.');
  }

  if (!range) {
    return Array.from({ length: totalPages }, (_, index) => index);
  }

  const selected = new Set<number>();
  for (const chunk of range.split(',')) {
    if (chunk.includes('-')) {
      const [startRaw, endRaw] = chunk.split('-');
      const start = Number(startRaw);
      const end = Number(endRaw);
      if (start > totalPages) {
        throw new Error('Selected page range exceeds document page count.');
      }
      for (let page = start; page <= Math.min(end, totalPages); page += 1) {
        selected.add(page - 1);
      }
      continue;
    }

    const page = Number(chunk);
    if (page > totalPages) {
      throw new Error('Selected page range exceeds document page count.');
    }
    selected.add(page - 1);
  }

  const ordered = Array.from(selected).sort((left, right) => left - right);
  if (ordered.length === 0) {
    throw new Error('Selected page range resolved to no pages.');
  }
  return ordered;
}

async function prepareImagePrintPdf(input: {
  sourcePath: string;
  colorMode: ColorMode;
  orientation: Orientation;
  rotationDeg: RotationDeg;
  paperSize: PaperSize;
  quality?: PrintQuality;
}): Promise<{ pdfPath: string; cleanupPaths: string[]; pageCount: number }> {
  await fs.promises.mkdir(PREPARED_PRINT_DIR, { recursive: true });
  const pdfPath = path.join(PREPARED_PRINT_DIR, `${randomUUID()}.pdf`);

  let imagePipeline = sharp(input.sourcePath).rotate(); // auto-rotate based on EXIF
  if (input.rotationDeg !== 0) {
    imagePipeline = imagePipeline.rotate(input.rotationDeg);
  }
  if (input.colorMode === 'grayscale') {
    imagePipeline = imagePipeline.grayscale();
  }

  // Convert to PNG buffer to preserve quality and embed cleanly
  const pngOptions =
    input.quality === 'high'
      ? { compressionLevel: 6, adaptiveFiltering: true }
      : {};
  const { data, info } = await imagePipeline
    .png(pngOptions)
    .toBuffer({ resolveWithObject: true });

  const [pageWidth, pageHeight] = getPaperSizePoints(
    input.paperSize,
    input.orientation,
  );

  const maxW = Math.max(10, pageWidth - 2 * SAFE_MARGIN_PT);
  const maxH = Math.max(10, pageHeight - 2 * SAFE_MARGIN_PT);

  const scale = Math.min(maxW / info.width, maxH / info.height);
  const drawW = info.width * scale;
  const drawH = info.height * scale;

  const x = (pageWidth - drawW) / 2;
  const y = (pageHeight - drawH) / 2;

  const pdf = await PDFDocument.create();
  const embeddedImage = await pdf.embedPng(data);
  const page = pdf.addPage([pageWidth, pageHeight]);
  page.drawImage(embeddedImage, {
    x,
    y,
    width: drawW,
    height: drawH,
  });

  await fs.promises.writeFile(pdfPath, await pdf.save());
  return { pdfPath, cleanupPaths: [pdfPath], pageCount: 1 };
}

async function ensurePdfSource(
  sourcePath: string,
): Promise<{ pdfPath: string; cleanupPaths: string[] }> {
  const ext = path.extname(sourcePath).toLowerCase();

  if (ext === '.pdf') {
    return { pdfPath: sourcePath, cleanupPaths: [] };
  }

  const pdfPath = await convertToPdfPreview(sourcePath);
  return { pdfPath, cleanupPaths: [] };
}

function needsOrientationRotation(
  width: number,
  height: number,
  orientation: Orientation,
): boolean {
  const isLandscape = width > height;
  return orientation === 'landscape' ? !isLandscape : isLandscape;
}

async function applyTransforms(input: {
  sourcePdfPath: string;
  orientation: Orientation;
  rotationDeg: RotationDeg;
  pageRange: string | null;
  duplex: boolean;
}): Promise<{ pdfPath: string; cleanupPaths: string[]; pageCount: number }> {
  const sourceBytes = await fs.promises.readFile(input.sourcePdfPath);
  const sourcePdf = await PDFDocument.load(sourceBytes);
  const pageIndexes = expandPageRange(input.pageRange, sourcePdf.getPageCount());

  await fs.promises.mkdir(PREPARED_PRINT_DIR, { recursive: true });
  const outputPath = path.join(PREPARED_PRINT_DIR, `${randomUUID()}.pdf`);
  const outputPdf = await PDFDocument.create();

  const copiedPages = await outputPdf.copyPages(sourcePdf, pageIndexes);
  for (const page of copiedPages) {
    const extraRotation = needsOrientationRotation(
      page.getWidth(),
      page.getHeight(),
      input.orientation,
    )
      ? 90
      : 0;
    const nextRotation =
      (((page.getRotation().angle + input.rotationDeg + extraRotation) % 360) +
        360) %
      360;
    page.setRotation(degrees(nextRotation));
    outputPdf.addPage(page);
  }

  if (input.duplex && outputPdf.getPageCount() % 2 === 1) {
    const lastPage = outputPdf.getPage(outputPdf.getPageCount() - 1);
    const blankPage = outputPdf.addPage([lastPage.getWidth(), lastPage.getHeight()]);
    blankPage.drawRectangle({
      x: 0,
      y: 0,
      width: blankPage.getWidth(),
      height: blankPage.getHeight(),
      color: rgb(1, 1, 1),
      borderWidth: 0,
    });
  }

  await fs.promises.writeFile(outputPath, await outputPdf.save());
  return {
    pdfPath: outputPath,
    cleanupPaths: [outputPath],
    pageCount: outputPdf.getPageCount(),
  };
}

async function applyGrayscalePdf(input: {
  sourcePdfPath: string;
}): Promise<{ pdfPath: string; cleanupPaths: string[] }> {
  // Priority 1: SumatraPDF is available.
  // Grayscale/monochrome is enforced at the driver level via SumatraPDF's
  // -print-settings "monochrome" argument. No PDF-level pre-conversion is
  // needed — skip Ghostscript entirely and pass the source PDF through.
  if (SUMATRA_PATH && fs.existsSync(SUMATRA_PATH)) {
    return { pdfPath: input.sourcePdfPath, cleanupPaths: [] };
  }

  // Priority 2: Ghostscript is configured and SumatraPDF is not available.
  // Use Ghostscript to bake the grayscale into the PDF for downstream engines
  // (PDFtoPrinter, LibreOffice) that cannot enforce monochrome at the driver level.
  if (GHOSTSCRIPT_PATH) {
    await fs.promises.mkdir(PREPARED_PRINT_DIR, { recursive: true });
    const outputPath = path.join(PREPARED_PRINT_DIR, `${randomUUID()}-gray.pdf`);
    await execFileAsync(
      GHOSTSCRIPT_PATH,
      [
        '-dBATCH',
        '-dNOPAUSE',
        '-dSAFER',
        '-sDEVICE=pdfwrite',
        '-sColorConversionStrategy=Gray',
        '-dProcessColorModel=/DeviceGray',
        `-sOutputFile=${outputPath}`,
        input.sourcePdfPath,
      ],
      { timeout: 60_000, windowsHide: true },
    );
    return { pdfPath: outputPath, cleanupPaths: [outputPath] };
  }

  // Priority 3: Neither SumatraPDF nor Ghostscript is available.
  // Warn and pass through — the print engine will apply best-effort monochrome.
  console.warn(
    '[PREPARE_PRINT_PDF] Neither SumatraPDF nor Ghostscript is available. ' +
      'Skipping PDF-level grayscale conversion; the print engine will apply monochrome via driver settings.',
  );
  return { pdfPath: input.sourcePdfPath, cleanupPaths: [] };
}

export interface PreparePrintPdfInput {
  sourcePath: string;
  colorMode: ColorMode;
  orientation: Orientation;
  rotationDeg?: number;
  paperSize?: PaperSize;
  pageRange?: unknown;
  duplex?: boolean;
  quality?: PrintQuality;
}

export async function preparePrintPdf(
  input: PreparePrintPdfInput,
): Promise<{ pdfPath: string; cleanupPaths: string[]; pageCount: number }> {
  const cleanupPaths: string[] = [];
  const normalizedRotation = normalizeRotationDeg(input.rotationDeg);
  const normalizedPageRange = parsePageRange(input.pageRange);
  const ext = path.extname(input.sourcePath).toLowerCase();

  try {
    if (IMAGE_EXTENSIONS.has(ext)) {
      const imageResult = await prepareImagePrintPdf({
        sourcePath: input.sourcePath,
        colorMode: input.colorMode,
        orientation: input.orientation,
        rotationDeg: normalizedRotation,
        paperSize: input.paperSize ?? 'A4',
        quality: input.quality,
      });
      return imageResult;
    }

    const pdfSource = await ensurePdfSource(input.sourcePath);
    cleanupPaths.push(...pdfSource.cleanupPaths);

    const transformed = await applyTransforms({
      sourcePdfPath: pdfSource.pdfPath,
      orientation: input.orientation,
      rotationDeg: normalizedRotation,
      pageRange: normalizedPageRange,
      duplex: input.duplex === true,
    });
    cleanupPaths.push(...transformed.cleanupPaths);

    if (input.colorMode !== 'grayscale') {
      return {
        pdfPath: transformed.pdfPath,
        cleanupPaths,
        pageCount: transformed.pageCount,
      };
    }

    const grayscale = await applyGrayscalePdf({
      sourcePdfPath: transformed.pdfPath,
    });
    cleanupPaths.push(...grayscale.cleanupPaths);

    return {
      pdfPath: grayscale.pdfPath,
      cleanupPaths,
      pageCount: transformed.pageCount,
    };
  } catch (error) {
    for (const filePath of cleanupPaths) {
      try {
        await fs.promises.unlink(filePath);
      } catch (unlinkError) {
        console.error('[PREPARE_PRINT_PDF] Failed to clean up intermediate file:', {
          filePath,
          error: unlinkError instanceof Error ? unlinkError.message : String(unlinkError),
        });
      }
    }
    throw error;
  }
}
