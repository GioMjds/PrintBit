import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { StorageEngine } from 'multer';

export const MAX_STAGING_FILE_BYTES = 25 * 1024 * 1024; // 25 MiB
export const MAX_ACTIVE_STAGING_BYTES_PER_SCOPE = 100 * 1024 * 1024; // 100 MiB
export const MAX_ACTIVE_STAGING_BYTES = 256 * 1024 * 1024; // 256 MiB
export const STAGING_RETENTION_MS = 60 * 60 * 1000; // 1 hour
export const QUARANTINE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const MAX_QUARANTINE_BYTES = 256 * 1024 * 1024; // 256 MiB

const UPLOADS_ROOT = path.resolve('uploads');
const DEFAULT_STAGING_DIR = path.resolve(UPLOADS_ROOT, '.staging');

export interface StagingConfig {
  readonly maxFileBytes: number;
  readonly maxActiveBytesPerScope: number;
  readonly maxActiveBytes: number;
  readonly stagingRetentionMs: number;
  readonly quarantineRetentionMs: number;
  readonly maxQuarantineBytes: number;
}

export function getStagingConfig(): StagingConfig {
  return {
    maxFileBytes: MAX_STAGING_FILE_BYTES,
    maxActiveBytesPerScope: MAX_ACTIVE_STAGING_BYTES_PER_SCOPE,
    maxActiveBytes: MAX_ACTIVE_STAGING_BYTES,
    stagingRetentionMs: STAGING_RETENTION_MS,
    quarantineRetentionMs: QUARANTINE_RETENTION_MS,
    maxQuarantineBytes: MAX_QUARANTINE_BYTES,
  };
}

// Active bytes accounting
class StagingQuotaManager {
  private activeGlobalBytes = 0;
  private readonly activeScopeBytes = new Map<string, number>();
  private readonly activeFileBytes = new Map<string, { scope: string; bytes: number }>();

  canAllocate(scope: string, additionalBytes: number): boolean {
    const currentScope = this.activeScopeBytes.get(scope) ?? 0;
    if (this.activeGlobalBytes + additionalBytes > MAX_ACTIVE_STAGING_BYTES) {
      return false;
    }
    if (currentScope + additionalBytes > MAX_ACTIVE_STAGING_BYTES_PER_SCOPE) {
      return false;
    }
    return true;
  }

  trackChunk(filePath: string, scope: string, chunkBytes: number): boolean {
    if (!this.canAllocate(scope, chunkBytes)) {
      return false;
    }

    this.activeGlobalBytes += chunkBytes;
    const currentScope = this.activeScopeBytes.get(scope) ?? 0;
    this.activeScopeBytes.set(scope, currentScope + chunkBytes);

    const record = this.activeFileBytes.get(filePath) ?? { scope, bytes: 0 };
    record.bytes += chunkBytes;
    this.activeFileBytes.set(filePath, record);
    return true;
  }

  release(filePath: string): void {
    const record = this.activeFileBytes.get(filePath);
    if (!record) return;

    this.activeFileBytes.delete(filePath);
    this.activeGlobalBytes = Math.max(0, this.activeGlobalBytes - record.bytes);

    const currentScope = this.activeScopeBytes.get(record.scope) ?? 0;
    const remaining = Math.max(0, currentScope - record.bytes);
    if (remaining === 0) {
      this.activeScopeBytes.delete(record.scope);
    } else {
      this.activeScopeBytes.set(record.scope, remaining);
    }
  }
}

export const stagingQuotaManager = new StagingQuotaManager();

export function isPathContained(baseDir: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedBase, resolvedTarget);
  return (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export class UploadStagingStorageEngine implements StorageEngine {
  private readonly surface: string;
  private readonly stagingDir: string;

  constructor(surface: string, stagingDir = DEFAULT_STAGING_DIR) {
    this.surface = surface;
    this.stagingDir = stagingDir;
  }

  _handleFile(
    req: Request,
    file: Express.Multer.File,
    cb: (error?: unknown, info?: Partial<Express.Multer.File>) => void,
  ): void {
    const scope =
      (typeof req.params?.sessionId === 'string' && req.params.sessionId) ||
      this.surface ||
      'default';

    // Proactively purge expired staging files before accepting a new file
    void purgeStaging(this.stagingDir).catch(() => {});

    fs.mkdir(this.stagingDir, { recursive: true }, (mkdirErr) => {
      if (mkdirErr) {
        cb(mkdirErr);
        return;
      }

      const fileId = randomUUID();
      const filename = `${fileId}.upload`;
      const filePath = path.join(this.stagingDir, filename);

      if (!isPathContained(this.stagingDir, filePath)) {
        cb(new Error('Invalid staging path calculation.'));
        return;
      }

      const outStream = fs.createWriteStream(filePath, { flags: 'wx' });
      let writtenBytes = 0;
      let aborted = false;

      const cleanupAndFail = (err: Error) => {
        if (aborted) return;
        aborted = true;
        file.stream.unpipe(outStream);
        outStream.destroy();
        stagingQuotaManager.release(filePath);
        fs.unlink(filePath, () => {});
        cb(err);
      };

      file.stream.on('data', (chunk: Buffer) => {
        if (aborted) return;
        const chunkSize = chunk.length;
        writtenBytes += chunkSize;

        if (writtenBytes > MAX_STAGING_FILE_BYTES) {
          cleanupAndFail(
            Object.assign(new Error('File size exceeds upload staging limit.'), {
              code: 'LIMIT_FILE_SIZE',
            }),
          );
          return;
        }

        const allocated = stagingQuotaManager.trackChunk(
          filePath,
          scope,
          chunkSize,
        );
        if (!allocated) {
          cleanupAndFail(
            Object.assign(
              new Error('Upload rejected: staging byte quota exceeded.'),
              { code: 'STAGING_QUOTA_EXCEEDED' },
            ),
          );
        }
      });

      outStream.on('error', (err) => {
        cleanupAndFail(err);
      });

      file.stream.on('error', (err) => {
        cleanupAndFail(err);
      });

      outStream.on('finish', () => {
        if (aborted) return;
        cb(null, {
          destination: this.stagingDir,
          filename,
          path: filePath,
          size: writtenBytes,
        });
      });

      file.stream.pipe(outStream);
    });
  }

  _removeFile(
    _req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null) => void,
  ): void {
    if (file.path) {
      stagingQuotaManager.release(file.path);
      fs.unlink(file.path, cb);
    } else {
      cb(null);
    }
  }
}

export function createUploadStagingStorage(
  surface: string,
  stagingDir = DEFAULT_STAGING_DIR,
): StorageEngine {
  return new UploadStagingStorageEngine(surface, stagingDir);
}

export async function promoteStagedUpload(
  file: Express.Multer.File | { path: string; destination?: string },
  destinationPath: string,
): Promise<string> {
  const stagedPath = file.path;
  if (!stagedPath) {
    throw new Error('Staged file has no path for promotion.');
  }

  const resolvedDest = path.resolve(destinationPath);
  const targetDir = path.dirname(resolvedDest);

  // Validate destination containment (cannot traverse out of base root)
  const uploadsBase = path.resolve(UPLOADS_ROOT);
  const tempBase = path.resolve(path.dirname(stagedPath), '..');
  const allowedBase = isPathContained(uploadsBase, resolvedDest)
    ? uploadsBase
    : isPathContained(tempBase, resolvedDest)
      ? tempBase
      : null;

  if (!allowedBase || !isPathContained(allowedBase, resolvedDest)) {
    throw new Error(
      `Destination path traversal violation: ${resolvedDest} is outside allowed destination directory.`,
    );
  }

  await fs.promises.mkdir(targetDir, { recursive: true });

  try {
    await fs.promises.rename(stagedPath, resolvedDest);
  } finally {
    stagingQuotaManager.release(stagedPath);
  }

  return resolvedDest;
}

export async function discardStagedUpload(
  file: Express.Multer.File | { path: string } | string,
): Promise<void> {
  const stagedPath = typeof file === 'string' ? file : file.path;
  if (!stagedPath) return;

  stagingQuotaManager.release(stagedPath);
  await fs.promises.unlink(stagedPath).catch(() => {});
}

export async function purgeStaging(
  stagingDir = DEFAULT_STAGING_DIR,
  retentionMs = STAGING_RETENTION_MS,
): Promise<number> {
  let purgedCount = 0;
  try {
    const exists = await fs.promises
      .access(stagingDir)
      .then(() => true)
      .catch(() => false);
    if (!exists) return 0;

    const entries = await fs.promises.readdir(stagingDir);
    const cutoff = Date.now() - retentionMs;

    for (const entry of entries) {
      if (!entry.endsWith('.upload')) continue;
      const fullPath = path.join(stagingDir, entry);
      if (!isPathContained(stagingDir, fullPath)) continue;

      try {
        const stats = await fs.promises.stat(fullPath);
        if (stats.mtimeMs < cutoff) {
          stagingQuotaManager.release(fullPath);
          await fs.promises.unlink(fullPath);
          purgedCount += 1;
        }
      } catch {
        // ignore errors on individual files
      }
    }
  } catch {
    // ignore directory read errors
  }
  return purgedCount;
}

export async function readStagedFileRange(
  filePath: string,
  offset: number,
  length: number,
): Promise<Buffer> {
  if (offset < 0 || length <= 0) {
    return Buffer.alloc(0);
  }

  const boundedLength = Math.min(length, 10 * 1024 * 1024);
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(boundedLength);
    const { bytesRead } = await handle.read(
      buffer,
      0,
      boundedLength,
      offset,
    );
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
