import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PDFDocument, degrees } from 'pdf-lib';
import { convertToPdfPreview } from './preview';

export type RotationDeg = 0 | 90 | 180 | 270;

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const OFFICE_EXTENSIONS = new Set([
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
]);
const ROTATED_PRINT_DIR = path.resolve('uploads', 'rotated');

export function parseRotationDeg(value: unknown): RotationDeg | null {
  if (value === 0 || value === 90 || value === 180 || value === 270) {
    return value;
  }
  return null;
}

export function normalizeRotationDeg(
  value: unknown,
  fallback: RotationDeg = 0,
): RotationDeg {
  return parseRotationDeg(value) ?? fallback;
}

function normalizeFileExtension(ext: string): string {
  if (ext === '.jpeg') return '.jpg';
  return ext;
}

async function rotatePdfFile(
  sourcePath: string,
  outputPath: string,
  rotationDeg: RotationDeg,
): Promise<void> {
  const bytes = await fs.promises.readFile(sourcePath);
  const pdf = await PDFDocument.load(bytes);
  for (const page of pdf.getPages()) {
    const current = page.getRotation().angle;
    const next = ((current + rotationDeg) % 360 + 360) % 360;
    page.setRotation(degrees(next));
  }
  const rotatedBytes = await pdf.save();
  await fs.promises.writeFile(outputPath, rotatedBytes);
}

async function rotateImageFile(
  sourcePath: string,
  outputPath: string,
  rotationDeg: RotationDeg,
): Promise<void> {
  await sharp(sourcePath).rotate(rotationDeg).toFile(outputPath);
}

async function rotateFileToPath(
  sourcePath: string,
  outputPath: string,
  rotationDeg: RotationDeg,
): Promise<void> {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.pdf') {
    await rotatePdfFile(sourcePath, outputPath, rotationDeg);
    return;
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    await rotateImageFile(sourcePath, outputPath, rotationDeg);
    return;
  }
  throw new Error(
    `Rotation is not supported for ${extension || 'this'} file type.`,
  );
}

export async function preparePrintRotationArtifact(input: {
  sourcePath: string;
  rotationDeg: RotationDeg;
}): Promise<{ printPath: string; cleanupPaths: string[] }> {
  const { sourcePath, rotationDeg } = input;
  if (rotationDeg === 0) {
    return { printPath: sourcePath, cleanupPaths: [] };
  }

  const sourceExt = path.extname(sourcePath).toLowerCase();
  let workingSourcePath = sourcePath;
  if (OFFICE_EXTENSIONS.has(sourceExt)) {
    try {
      workingSourcePath = await convertToPdfPreview(sourcePath);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown conversion error';
      throw new Error(`Failed to convert document for rotation: ${message}`);
    }
  }

  const workingExt = normalizeFileExtension(
    path.extname(workingSourcePath).toLowerCase(),
  );
  if (workingExt !== '.pdf' && !IMAGE_EXTENSIONS.has(workingExt)) {
    throw new Error(
      `Rotation is not supported for ${sourceExt || 'this'} file type.`,
    );
  }

  await fs.promises.mkdir(ROTATED_PRINT_DIR, { recursive: true });
  const outputPath = path.join(
    ROTATED_PRINT_DIR,
    `${path.basename(workingSourcePath, path.extname(workingSourcePath))}-${rotationDeg}-${randomUUID()}${workingExt}`,
  );
  await rotateFileToPath(workingSourcePath, outputPath, rotationDeg);
  return { printPath: outputPath, cleanupPaths: [outputPath] };
}

export async function prepareScanRotationArtifact(input: {
  sourcePath: string;
  orientation: 'portrait' | 'landscape';
  rotationDeg: RotationDeg;
}): Promise<{ filePath: string; transformed: boolean }> {
  const { sourcePath, orientation, rotationDeg } = input;
  const orientationRotation = orientation === 'landscape' ? 90 : 0;
  const finalRotation = normalizeRotationDeg(
    (orientationRotation + rotationDeg) % 360,
  );

  if (finalRotation === 0) {
    return { filePath: sourcePath, transformed: false };
  }

  const sourceExt = normalizeFileExtension(path.extname(sourcePath).toLowerCase());
  if (sourceExt !== '.pdf' && !IMAGE_EXTENSIONS.has(sourceExt)) {
    throw new Error(
      `Rotation is not supported for ${sourceExt || 'this'} scan format.`,
    );
  }

  const outputPath = path.join(
    path.dirname(sourcePath),
    `${path.basename(sourcePath, path.extname(sourcePath))}-r${finalRotation}-${randomUUID()}${sourceExt}`,
  );
  await rotateFileToPath(sourcePath, outputPath, finalRotation);
  return { filePath: outputPath, transformed: true };
}
