import fs from 'node:fs/promises';
import path from 'node:path';

export type WorkerHandoffErrorCode =
  | 'WORKER_QUEUE_UNAVAILABLE'
  | 'WORKER_HANDOFF_FAILED';

export class WorkerHandoffError extends Error {
  constructor(
    public code: WorkerHandoffErrorCode,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WorkerHandoffError';
  }
}

export async function handoffToWorker(input: {
  sourcePath: string;
  queueDir: string;
  transactionId: string;
  spoolerCorrelationKey: string;
}): Promise<{ targetPath: string; fileName: string }> {
  if (!input.queueDir || input.queueDir.trim().length === 0) {
    throw new WorkerHandoffError(
      'WORKER_QUEUE_UNAVAILABLE',
      'Worker queue directory is not configured',
    );
  }

  try {
    const stat = await fs.stat(input.queueDir);
    if (!stat.isDirectory()) {
      throw new WorkerHandoffError(
        'WORKER_QUEUE_UNAVAILABLE',
        'Worker queue path is not a directory',
        { queueDir: input.queueDir },
      );
    }
  } catch (error) {
    if (error instanceof WorkerHandoffError) {
      throw error;
    }

    throw new WorkerHandoffError(
      'WORKER_QUEUE_UNAVAILABLE',
      'Worker queue directory not found',
      { queueDir: input.queueDir },
    );
  }

  const ext = path.extname(input.sourcePath).toLowerCase() || '.pdf';
  if (ext !== '.pdf') {
    throw new WorkerHandoffError(
      'WORKER_HANDOFF_FAILED',
      'Source file is not a PDF',
      { sourcePath: input.sourcePath },
    );
  }

  const fileName = `${input.transactionId}_${input.spoolerCorrelationKey}_${Date.now()}${ext}`;
  const targetPath = path.join(input.queueDir, fileName);
  const tempPath = `${targetPath}.tmp`;

  try {
    await fs.copyFile(input.sourcePath, tempPath);
    await fs.rename(tempPath, targetPath);
    return { targetPath, fileName };
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // ignore cleanup errors
    }

    throw new WorkerHandoffError(
      'WORKER_HANDOFF_FAILED',
      'Failed to hand off file to worker queue',
      { sourcePath: input.sourcePath, queueDir: input.queueDir },
    );
  }
}
