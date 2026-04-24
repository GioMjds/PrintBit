/**
 * Print Queue Worker Entry Point
 *
 * BullMQ Worker for processing print jobs with full orchestration:
 * - Preflight checks
 * - Print dispatch
 * - Settlement-safe transitions
 * - Spooler monitoring
 * - Terminal reconciliation
 *
 * Phase 2: Workerized print pipeline with orchestration
 */

import { Worker } from 'bullmq';
import type { Server } from 'socket.io';
import {
  redisConfig,
  queueNames,
  printJobsWorkerOptions,
  isRetryableFailureClass,
} from './queue.config';
import type { PrintQueueJobData } from './print-job.schema';
import type { Job } from 'bullmq';
import {
  orchestratePrintJob,
  WorkerOrchestrationError,
} from './print-queue.orchestration';

/**
 * Error class for worker operations
 */
export class PrintWorkerError extends Error {
  constructor(
    public failureClass: string,
    public isRetryable: boolean,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PrintWorkerError';
  }
}

/**
 * Process a single print job through the orchestration pipeline
 */
async function processPrintJob(job: Job<PrintQueueJobData>) {
  const io = (global as any).socketIOInstance as Server;

  if (!io) {
    throw new PrintWorkerError(
      'WORKER_NOT_INITIALIZED',
      false,
      'Socket.IO instance not available to worker',
    );
  }

  try {
    const result = await orchestratePrintJob(job, io);

    return {
      success: result.success,
      transactionId: result.transactionId,
      spoolerCorrelationKey: result.spoolerCorrelationKey,
      stage: result.stage,
      durationMs: result.durationMs,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(
      `[PRINT-WORKER] Job ${job.id} failed: ${errorMessage}`,
      error,
    );

    if (error instanceof WorkerOrchestrationError) {
      throw new PrintWorkerError(
        error.failureClass,
        error.isRetryable,
        error.message,
        { stage: error.stage, ...error.details },
      );
    }

    throw new PrintWorkerError(
      'UNKNOWN_FAILURE',
      false,
      `Print job processing failed: ${errorMessage}`,
    );
  }
}

/**
 * Create and start print job worker
 * Called on app startup to attach io instance and event handlers
 */
export function createPrintJobWorker(io: Server) {
  (global as any).socketIOInstance = io;

  const worker = new Worker(queueNames.printJobs, processPrintJob, {
    ...printJobsWorkerOptions,
  });

  worker.on('active', (job) => {
    console.log(
      `[PRINT-WORKER] Job ${job.id} started (attempt ${job.attemptsMade + 1})`,
    );
  });

  worker.on('completed', (job, result) => {
    console.log(
      `[PRINT-WORKER] Job ${job.id} completed: ${JSON.stringify(result)}`,
    );

    io.emit('printQueueJobCompleted', {
      jobId: job.id,
      transactionId: result.transactionId,
      stage: result.stage,
      durationMs: result.durationMs,
    });
  });

  worker.on('failed', (job, err) => {
    if (!job) {
      console.error(
        `[PRINT-WORKER] Job failed with no job context: ${err.message}`,
      );
      return;
    }

    console.error(
      `[PRINT-WORKER] Job ${job.id} failed (attempt ${job.attemptsMade}): ${err.message}`,
    );

    const isRetryable =
      !(err instanceof PrintWorkerError) || err.isRetryable;

    console.log(
      `[PRINT-WORKER] Job ${job.id} will ${
        isRetryable ? `retry (attempt ${job.attemptsMade + 1}/3)` : 'be moved to dead-letter'
      }`,
    );

    io.emit('printQueueJobFailed', {
      jobId: job.id,
      failureClass:
        err instanceof PrintWorkerError ? err.failureClass : 'UNKNOWN_FAILURE',
      isRetryable,
      attemptNumber: job.attemptsMade,
      message: err.message,
    });
  });

  worker.on('stalled', (jobId) => {
    console.warn(
      `[PRINT-WORKER] Job ${jobId} stalled (lockDuration exceeded)`,
    );

    io.emit('printQueueJobStalled', {
      jobId,
      stalledAt: new Date().toISOString(),
    });
  });

  worker.on('error', (err) => {
    console.error(
      `[PRINT-WORKER] Worker error: ${err instanceof Error ? err.message : String(err)}`,
    );

    io.emit('printQueueWorkerError', {
      error: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    });
  });

  return worker;
}
