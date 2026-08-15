import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import { printJobStore } from '@/core/database/sqlite-storage';
import type {
  PrintJob,
  PrintJobEnqueuePayload,
} from '@/modules/print-queue/print-job.schema';
import { orchestratePrintJob } from '@/modules/print-queue/print-queue.orchestration';

const MAX_RETRIES = 3;
const RETRY_DELAY_BASE_MS = 2000;

export class JobProcessor {
  private io: Server | null = null;
  private isProcessing = false;

  setIo(io: Server): void {
    this.io = io;
  }

  /**
   * Initialize and resume any pending jobs
   */
  async init(): Promise<void> {
    console.info('[JOB-PROCESSOR] Initializing job processor...');
    this.processNext().catch((err) => {
      console.error('[JOB-PROCESSOR] Initial processing loop failed', err);
    });
  }

  /**
   * Enqueue a new print job
   */
  async enqueue(payload: PrintJobEnqueuePayload): Promise<string> {
    const jobId = randomUUID();
    const now = new Date().toISOString();

    printJobStore.createJob({
      jobId,
      transactionId: payload.correlation.transactionId,
      state: 'pending',
      payloadJson: JSON.stringify(payload),
      attemptsJson: '[]',
      createdAt: now,
      updatedAt: now,
    });

    console.info(
      `[JOB-PROCESSOR] Enqueued job ${jobId} for transaction ${payload.correlation.transactionId}`,
    );

    // Trigger processing loop if not running
    if (!this.isProcessing) {
      this.processNext().catch((err) => {
        console.error(
          '[JOB-PROCESSOR] Processing loop failed after enqueue',
          err,
        );
      });
    }

    return jobId;
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: string) {
    return printJobStore.getJobById(jobId);
  }

  /**
   * Main processing loop
   */
  private async processNext(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (true) {
        const pendingJobs = printJobStore.listPendingJobs();
        if (pendingJobs.length === 0) break;

        const entry = pendingJobs[0];
        console.info(`[JOB-PROCESSOR] Picking up pending job ${entry.jobId} for transaction ${entry.transactionId}`);

        const job: PrintJob = {
          id: entry.jobId,
          data: JSON.parse(entry.payloadJson),
          attemptsMade: JSON.parse(entry.attemptsJson).length,
        };

        try {
          printJobStore.updateJobState(job.id, 'processing');

          if (!this.io) {
            throw new Error('Socket.IO server not set in JobProcessor');
          }

          await orchestratePrintJob(job, this.io);

          printJobStore.updateJobState(
            job.id,
            'processing',
            JSON.stringify(job.data.attempts),
          );
          console.info(
            `[JOB-PROCESSOR] Job ${job.id} dispatched to worker queue`,
          );
        } catch (err) {
          const isRetryable = !String(err).includes('NON_RETRYABLE');
          const attemptCount = job.data.attempts?.length ?? 0;

          if (isRetryable && attemptCount < MAX_RETRIES) {
            const delay = Math.pow(2, attemptCount) * RETRY_DELAY_BASE_MS;
            console.warn(
              `[JOB-PROCESSOR] Job ${job.id} failed, retrying in ${delay}ms...`,
              err,
            );

            printJobStore.updateJobState(
              job.id,
              'retrying',
              JSON.stringify(job.data.attempts),
            );

            // Wait before next attempt
            await new Promise((resolve) => setTimeout(resolve, delay));

            // Mark as pending again to be picked up
            printJobStore.updateJobState(job.id, 'pending');
          } else {
            console.error(
              `[JOB-PROCESSOR] Job ${job.id} failed permanently`,
              err,
            );
            printJobStore.updateJobState(
              job.id,
              'failed',
              JSON.stringify(job.data.attempts),
            );
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
}

let instance: JobProcessor | null = null;

export function getJobProcessor(): JobProcessor {
  if (!instance) {
    instance = new JobProcessor();
  }
  return instance;
}
