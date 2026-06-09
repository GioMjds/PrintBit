/**
 * Print Queue Service
 *
 * Facade for enqueueing print jobs to BullMQ with:
 * - Idempotency verification via transaction ID + idempotency key
 * - Correlation key validation
 * - Job state tracking and status queries
 *
 * Phase 1: Queue platform foundation
 *
 * Note: Admin operations (pause, resume, drain, retry) in separate service
 */

import { createHash } from 'node:crypto';
import { Queue } from 'bullmq';
import type {
  PrintJobEnqueuePayload,
  PrintJobCorrelation,
} from './print-job.schema';
import { PRINT_JOB_PAYLOAD_VERSION } from './print-job.schema';
import { queueNames, printJobsQueueOptions } from './queue.config';

/**
 * Error class for queue service operations
 */
export class PrintQueueServiceError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PrintQueueServiceError';
  }
}

/**
 * Build a deterministic, BullMQ-safe job ID from correlation keys.
 *
 * BullMQ uses queue names as Redis key prefixes separated by colons, so job
 * IDs that contain colons create ambiguous Redis keys and cause errors at
 * runtime.  We hash the two correlation fields that uniquely identify a job
 * (transactionId + idempotencyKey) into a hex digest and prefix it with a
 * human-readable label.
 *
 * The result is:
 *  - Deterministic: same input always produces the same ID (idempotency).
 *  - Colon-free: safe to use as a BullMQ job ID without Redis key collisions.
 *  - Unique: SHA-256 collision probability is negligible for this use case.
 */
export function buildPrintQueueJobId(correlation: PrintJobCorrelation): string {
  const digest = createHash('sha256')
    .update(correlation.transactionId)
    .update('\0')
    .update(correlation.idempotencyKey)
    .digest('hex');

  return `printjob-${digest}`;
}

/**
 * Print Queue Service
 * Manages job enqueuing and status tracking
 */
export class PrintQueueService {
  private queue: Queue<PrintJobEnqueuePayload> | null = null;

  constructor() {
    this.queue = new Queue(queueNames.printJobs, printJobsQueueOptions);
  }

  /**
   * Initialize queue and verify Redis connection
   */
  async initialize(): Promise<void> {
    try {
      if (!this.queue) {
        throw new PrintQueueServiceError(
          'QUEUE_NOT_INITIALIZED',
          'Print queue not initialized',
        );
      }

      const client = await this.queue.client;
      // Redis clients (node-redis / ioredis) expose a ping method
      type PingableClient = { ping?: () => Promise<string> | string };
      const pingable = client as PingableClient | undefined;
      if (pingable && typeof pingable.ping === 'function') {
        await pingable.ping();
      }
    } catch (error) {
      throw new PrintQueueServiceError(
        'INIT_FAILED',
        'Failed to initialize print queue',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /**
   * Enqueue a print job to the queue
   *
   * @param payload Complete print job payload with all context
   * @returns Job ID (colon-free SHA-256 hash of correlation keys)
   */
  async enqueuePrintJob(payload: PrintJobEnqueuePayload): Promise<string> {
    if (!this.queue) {
      throw new PrintQueueServiceError(
        'QUEUE_NOT_INITIALIZED',
        'Print queue not initialized',
      );
    }

    try {
      this.validateCorrelation(payload.correlation);

      if (payload.schemaVersion !== PRINT_JOB_PAYLOAD_VERSION) {
        throw new PrintQueueServiceError(
          'INVALID_SCHEMA_VERSION',
          `Expected schema version ${PRINT_JOB_PAYLOAD_VERSION}, got ${payload.schemaVersion}`,
        );
      }

      // Use a hash-based job ID for deduplication — colon-free to satisfy
      // BullMQ's Redis key constraints.
      const jobId = buildPrintQueueJobId(payload.correlation);

      const job = await this.queue.add('print-job', payload, {
        jobId,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: {
          age: 3600, // 1 hour
        },
        removeOnFail: {
          age: 86400, // 24 hours
        },
      });

      return String(job.id ?? jobId);
    } catch (error) {
      if (error instanceof PrintQueueServiceError) {
        throw error;
      }

      throw new PrintQueueServiceError(
        'ENQUEUE_FAILED',
        'Failed to enqueue print job',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /**
   * Get job status by transaction ID and idempotency key
   */
  async getJobStatus(
    transactionId: string,
    idempotencyKey: string,
  ): Promise<{
    jobId: string;
    state: string;
    attempts: number;
    failureReason?: string;
  } | null> {
    if (!this.queue) {
      throw new PrintQueueServiceError(
        'QUEUE_NOT_INITIALIZED',
        'Print queue not initialized',
      );
    }

    try {
      const jobId = buildPrintQueueJobId({
        transactionId,
        idempotencyKey,
        // spoolerCorrelationKey is not part of the ID hash, so any value works
        // here — we only need transactionId + idempotencyKey for lookup.
        spoolerCorrelationKey: '',
        sessionId: null,
        documentId: null,
      });
      const job = await this.queue.getJob(jobId);

      if (!job) {
        return null;
      }

      const state = await job.getState();
      const attempts = job.attemptsMade;
      const failureReason = job.failedReason ?? undefined;

      return {
        jobId: String(job.id ?? jobId),
        state: state ?? 'unknown',
        attempts,
        failureReason,
      };
    } catch (error) {
      throw new PrintQueueServiceError(
        'STATUS_FAILED',
        'Failed to get job status',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /**
   * Validate correlation keys before enqueue
   */
  private validateCorrelation(correlation: PrintJobCorrelation): void {
    if (!correlation.transactionId?.trim()) {
      throw new PrintQueueServiceError(
        'INVALID_TRANSACTION_ID',
        'transactionId is required and cannot be empty',
      );
    }

    if (!correlation.spoolerCorrelationKey?.trim()) {
      throw new PrintQueueServiceError(
        'INVALID_SPOOLER_KEY',
        'spoolerCorrelationKey is required and cannot be empty',
      );
    }

    if (!correlation.idempotencyKey?.trim()) {
      throw new PrintQueueServiceError(
        'INVALID_IDEMPOTENCY_KEY',
        'idempotencyKey is required and cannot be empty',
      );
    }
  }

  /**
   * Shutdown service (close queue connection)
   */
  async shutdown(): Promise<void> {
    try {
      if (this.queue) {
        await this.queue.close();
        this.queue = null;
      }
    } catch (error) {
      throw new PrintQueueServiceError(
        'SHUTDOWN_FAILED',
        'Failed to shutdown print queue',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }
}

/**
 * Singleton instance of print queue service
 */
let printQueueInstance: PrintQueueService | null = null;

/**
 * Get or create singleton print queue service
 */
export function getPrintQueueService(): PrintQueueService {
  if (!printQueueInstance) {
    printQueueInstance = new PrintQueueService();
  }
  return printQueueInstance;
}
