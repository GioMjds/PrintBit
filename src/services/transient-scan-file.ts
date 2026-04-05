import fs from 'node:fs';
import path from 'node:path';

const SCANS_ROOT = path.resolve('uploads', 'scans');

export interface TransientScanDeleteResult {
  deleted: boolean;
  alreadyMissing: boolean;
  fileName: string;
}

export function toSafeTransientScanFileName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === '.' || trimmed === '..') return null;
  const safe = path.basename(trimmed);
  return safe === trimmed ? safe : null;
}

function resolveTransientScanFilePath(fileName: string): string {
  const safeFileName = toSafeTransientScanFileName(fileName);
  if (!safeFileName) throw new Error('Invalid filename.');

  const filePath = path.resolve(SCANS_ROOT, safeFileName);
  const relativePath = path.relative(SCANS_ROOT, filePath);
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error('Invalid filename.');
  }

  return filePath;
}

export async function deleteTransientScanFile(
  fileName: string,
): Promise<TransientScanDeleteResult> {
  const safeFileName = toSafeTransientScanFileName(fileName);
  if (!safeFileName) throw new Error('Invalid filename.');

  const filePath = resolveTransientScanFilePath(safeFileName);
  try {
    await fs.promises.unlink(filePath);
    return {
      deleted: true,
      alreadyMissing: false,
      fileName: safeFileName,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return {
        deleted: true,
        alreadyMissing: true,
        fileName: safeFileName,
      };
    }
    throw new Error(
      `Failed to release scan file: ${err.message ?? 'Unknown error'}`,
    );
  }
}
