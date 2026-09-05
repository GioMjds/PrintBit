import fs from 'node:fs';
import path from 'node:path';

const SCAN_DIR = path.resolve(
  process.env.PRINTBIT_SCAN_DIR ?? path.join('uploads', 'scans'),
);
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

const parsedRetention = Number(process.env.PRINTBIT_SCAN_FILE_RETENTION_MS);
const RETENTION_MS =
  Number.isFinite(parsedRetention) && parsedRetention > 0
    ? parsedRetention
    : DEFAULT_RETENTION_MS;

export class ScanStorageService {
  getScanDir(): string {
    return SCAN_DIR;
  }

  async ensureStorageDir(): Promise<void> {
    await fs.promises.mkdir(SCAN_DIR, { recursive: true });
  }

  /**
   * Resolves an absolute path for a filename within the scans directory.
   * Ensures path traversal safety (cannot break out of uploads/scans).
   */
  resolveScanPath(filename: string): string | null {
    const safeName = path.basename(filename);
    const fullPath = path.resolve(SCAN_DIR, safeName);
    if (!fullPath.startsWith(SCAN_DIR)) {
      return null;
    }
    return fullPath;
  }

  /**
   * Performs retention cleanup by unlinking files older than RETENTION_MS.
   * Returns the count of deleted files.
   */
  async cleanup(): Promise<number> {
    await this.ensureStorageDir();
    const entries = await fs.promises.readdir(SCAN_DIR, {
      withFileTypes: true,
    });
    const now = Date.now();
    let unlinkedCount = 0;

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fullPath = path.join(SCAN_DIR, entry.name);
      try {
        const stat = await fs.promises.stat(fullPath);
        if (now - stat.mtimeMs <= RETENTION_MS) continue;
        await fs.promises.unlink(fullPath);
        unlinkedCount++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[SCAN-STORAGE] Failed cleanup for ${fullPath}: ${message}`,
        );
      }
    }
    return unlinkedCount;
  }

  startCleanup(): void {
    void this.cleanup();
    const timer = setInterval(() => {
      void this.cleanup();
    }, CLEANUP_INTERVAL_MS);
    timer.unref?.();
  }
}

export const scanStorageService = new ScanStorageService();

export function startScanStorageCleanup(): void {
  scanStorageService.startCleanup();
}

export function getScanStorageDir(): string {
  return scanStorageService.getScanDir();
}
