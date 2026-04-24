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
 * Phase 2: Workerized print pipeline and retries (detailed implementation)
 * Phase 1: Worker scaffolding and retry classification
 */

import { Worker } from 'bullmq';
import { redisConfig, queueNames, printJobsWorkerOptions, isRetryableFailureClass } from './queue.config';
import type { PrintQueueJobData } from './print-job.schema';
import type { Job } from 'bullmq';

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
 * Worker handler stub for processing print jobs
 * Full implementation in Phase 2
 *
 * @param job BullMQ job with print request payload
 * @returns Print result with completion status
 */
async function processPrintJob(
  job: Job<PrintQueueJobData>,
): Promise<{
  success: boolean;
  transactionId: string;
  spoolerCorrelationKey: string;
  stage: string;
  durationMs: number;
}> {
  const startTime = Date.now();
  const { correlation, request, financial, dispatch } = job.data;

  try {
    console.log(
      `[PRINT-WORKER] Job ${job.id} processing: transactionId=${correlation.transactionId}`,
    );

    // TODO Phase 2: Implement full orchestration
    // 1. Preflight checks (printer state, ink policy)
    // 2. Print dispatch to physical printer
    // 3. Settlement-safe balance transition
    // 4. Spooler monitoring and timeout handling
    // 5. Terminal reconciliation and receipt generation

    // Placeholder: Job accepted to queue
    const durationMs = Date.now() - startTime;
    return {
      success: true,
      transactionId: correlation.transactionId,
      spoolerCorrelationKey: correlation.spoolerCorrelationKey,
      stage: 'queued',
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(
      `[PRINT-WORKER] Job ${job.id} failed: ${errorMessage}`,
      error,
    );

    // TODO Phase 2: Classify failure and determine retry strategy
    if (error instanceof PrintWorkerError) {
      throw error;
    }

    throw new PrintWorkerError(
      'UNKNOWN_FAILURE',
      false,
      `Print job processing failed: ${errorMessage}`,
      { transactionId: correlation.transactionId, durationMs },
    );
  }
}

/**
 * Create and start print job worker
 * Called on app startup
 */
export function createPrintJobWorker() {
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
  });

  worker.on('failed', (job, err) => {
    console.error(
      `[PRINT-WORKER] Job ${job?.id} failed: ${err.message}`,
    );

    // TODO Phase 2: Route to dead-letter queue based on retry classification
    if (job) {
      const isRetryable = !(err instanceof PrintWorkerError) || err.isRetryable;
      console.log(
        `[PRINT-WORKER] Job ${job.id} will ${isRetryable ? 'retry' : 'be moved to DLQ'}`,
      );
    }
  });

  worker.on('stalled', (jobId) => {
    console.warn(
      `[PRINT-WORKER] Job ${jobId} stalled (exceeded lockDuration)`,
    );
  });

  worker.on('error', (err) => {
    console.error(`[PRINT-WORKER] Worker error: ${err.message}`);
  });

  return worker;
}


