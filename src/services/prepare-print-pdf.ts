import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import { GHOSTSCRIPT_PATH } from '@/config/http.config';
import { convertToPdfPreview } from './preview';

const execFileAsync = promisify(execFile);

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const PREPARED_PRINT_DIR = path.resolve('uploads', 'prepared-worker');

type Orientation = 'portrait' | 'landscape';
type ColorMode = 'colored' | 'grayscale';
type RotationDeg = 0 | 90 | 180 | 270;

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

async function ensurePdfSource(
  sourcePath: string,
  colorMode: ColorMode,
): Promise<{ pdfPath: string; cleanupPaths: string[] }> {
  const ext = path.extname(sourcePath).toLowerCase();

  if (ext === '.pdf') {
    return { pdfPath: sourcePath, cleanupPaths: [] };
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    await fs.promises.mkdir(PREPARED_PRINT_DIR, { recursive: true });
    const pdfPath = path.join(PREPARED_PRINT_DIR, `${randomUUID()}.pdf`);
    const pdf = await PDFDocument.create();
    const imageBytes =
      colorMode === 'grayscale'
        ? await sharp(sourcePath).grayscale().toBuffer()
        : await fs.promises.readFile(sourcePath);
    const imageExt = ext === '.png' ? '.png' : '.jpg';
    const image =
      imageExt === '.png'
        ? await pdf.embedPng(imageBytes)
        : await pdf.embedJpg(imageBytes);
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    });
    await fs.promises.writeFile(pdfPath, await pdf.save());
    return { pdfPath, cleanupPaths: [pdfPath] };
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
  if (!GHOSTSCRIPT_PATH) {
    throw new Error(
      'Grayscale PDF preparation requires Ghostscript. Set PRINTBIT_GHOSTSCRIPT_PATH.',
    );
  }

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

export interface PreparePrintPdfInput {
  sourcePath: string;
  colorMode: ColorMode;
  orientation: Orientation;
  rotationDeg?: number;
  pageRange?: unknown;
  duplex?: boolean;
}

export async function preparePrintPdf(
  input: PreparePrintPdfInput,
): Promise<{ pdfPath: string; cleanupPaths: string[]; pageCount: number }> {
  const cleanupPaths: string[] = [];
  const normalizedRotation = normalizeRotationDeg(input.rotationDeg);
  const normalizedPageRange = parsePageRange(input.pageRange);

  try {
    const pdfSource = await ensurePdfSource(input.sourcePath, input.colorMode);
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
