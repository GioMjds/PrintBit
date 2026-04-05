import fs from 'node:fs';
import path from 'node:path';
import { adminService } from './admin';

const DEFAULT_STARTUP_RETENTION_MS = 30 * 60 * 1000;
const parsedRetention = Number(
  process.env.PRINTBIT_TRANSIENT_FILE_STARTUP_RETENTION_MS,
);
const STARTUP_RETENTION_MS =
  Number.isFinite(parsedRetention) && parsedRetention > 0
    ? parsedRetention
    : DEFAULT_STARTUP_RETENTION_MS;

const TRANSIENT_PRINT_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.jpg',
  '.jpeg',
  '.png',
]);

interface CleanupStats {
  inspected: number;
  eligible: number;
  deleted: number;
  alreadyMissing: number;
  failed: number;
}

function isTransientPrintUpload(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return TRANSIENT_PRINT_EXTENSIONS.has(ext);
}

async function listDirectoryEntries(
  dirPath: string,
): Promise<fs.Dirent[]> {
  try {
    return await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return [];
    throw error;
  }
}

async function deleteIfStale(
  filePath: string,
  nowMs: number,
  stats: CleanupStats,
): Promise<void> {
  let fileStat: fs.Stats;
  try {
    fileStat = await fs.promises.stat(filePath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      stats.alreadyMissing += 1;
      return;
    }
    stats.failed += 1;
    console.error('[STARTUP-CLEANUP] Failed to stat transient file.', {
      filePath,
      error: err.message,
    });
    return;
  }

  if (!fileStat.isFile()) return;
  if (nowMs - fileStat.mtimeMs <= STARTUP_RETENTION_MS) return;

  stats.eligible += 1;
  try {
    await fs.promises.unlink(filePath);
    stats.deleted += 1;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      stats.alreadyMissing += 1;
      return;
    }
    stats.failed += 1;
    console.error('[STARTUP-CLEANUP] Failed to delete transient file.', {
      filePath,
      error: err.message,
    });
  }
}

async function sweepDirectory(
  dirPath: string,
  shouldConsiderFile: (filename: string) => boolean,
): Promise<CleanupStats> {
  const stats: CleanupStats = {
    inspected: 0,
    eligible: 0,
    deleted: 0,
    alreadyMissing: 0,
    failed: 0,
  };
  const nowMs = Date.now();
  const entries = await listDirectoryEntries(dirPath);

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filename = entry.name.toString();
    if (!shouldConsiderFile(filename)) continue;
    stats.inspected += 1;
    await deleteIfStale(path.join(dirPath, filename), nowMs, stats);
  }

  return stats;
}

export async function cleanupTransientFilesOnStartup(): Promise<void> {
  const uploadsRoot = path.resolve('uploads');
  const scansRoot = path.resolve('uploads', 'scans');
  const printStats = await sweepDirectory(uploadsRoot, isTransientPrintUpload);
  const scanStats = await sweepDirectory(scansRoot, () => true);
  const totalDeleted = printStats.deleted + scanStats.deleted;
  const totalMissing = printStats.alreadyMissing + scanStats.alreadyMissing;
  const totalFailed = printStats.failed + scanStats.failed;

  console.log('[STARTUP-CLEANUP] Transient file cleanup completed.', {
    retentionMs: STARTUP_RETENTION_MS,
    printUploadsInspected: printStats.inspected,
    printUploadsEligible: printStats.eligible,
    printUploadsDeleted: printStats.deleted,
    scanFilesInspected: scanStats.inspected,
    scanFilesEligible: scanStats.eligible,
    scanFilesDeleted: scanStats.deleted,
    alreadyMissing: totalMissing,
    failedDeletesOrStats: totalFailed,
  });

  try {
    await adminService.appendAdminLog(
      'transient_startup_cleanup_completed',
      'Startup transient file cleanup completed.',
      {
        retentionMs: STARTUP_RETENTION_MS,
        printUploadsInspected: printStats.inspected,
        printUploadsEligible: printStats.eligible,
        printUploadsDeleted: printStats.deleted,
        scanFilesInspected: scanStats.inspected,
        scanFilesEligible: scanStats.eligible,
        scanFilesDeleted: scanStats.deleted,
        alreadyMissing: totalMissing,
        failedDeletesOrStats: totalFailed,
      },
    );
  } catch (error) {
    console.error('[STARTUP-CLEANUP] Failed to append completion admin log.', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
