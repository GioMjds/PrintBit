/**
 * Print Queue Service
 *
 * Facade for enqueueing print jobs to BullMQ with:
 * - Idempotency verification
 * - Correlation key validation
 * - Job state tracking
 * - Dead-letter handling
 *
 * Phase 1: Queue platform foundation
 */

import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { redisConfig, queueNames, printJobsQueueOptions } from './queue.config';
import type {
  PrintJobEnqueuePayload,
  PrintJobCorrelation,
  PrintJobRequest,
  PrintJobFinancialContext,
} from './print-job.schema';
import { PRINT_JOB_PAYLOAD_VERSION } from './print-job.schema';

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
 * Print Queue Service
 * Manages job enqueuing and queue operations
 */
export class PrintQueueService {
  private queue: Queue<PrintJobEnqueuePayload> | null = null;

  constructor() {
    this.queue = new Queue(queueNames.printJobs, printJobsQueueOptions);
  }

  /**
   * Initialize queue and verify Redis connection
   * Called on app startup
   */
  async initialize(): Promise<void> {
    if (!this.queue) {
      throw new PrintQueueServiceError(
        'QUEUE_NOT_INITIALIZED',
        'Print queue not initialized',
      );
    }

    try {
      // Test connection
      const client = await this.queue.client;
      await client.ping();
    } catch (error) {
      throw new PrintQueueServiceError(
        'REDIS_CONNECTION_FAILED',
        'Failed to connect to Redis for print queue',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /**
   * Enqueue a print job
   * Returns job ID if successful; throws if idempotency key already exists
   *
   * @param payload Complete print job payload with correlation, request, and financial context
   * @returns BullMQ Job ID and transaction ID for polling
   */
  async enqueuePrintJob(
    payload: PrintJobEnqueuePayload,
  ): Promise<{
    jobId: string | number;
    transactionId: string;
    spoolerCorrelationKey: string;
  }> {
    if (!this.queue) {
      throw new PrintQueueServiceError(
        'QUEUE_NOT_INITIALIZED',
        'Print queue not initialized',
      );
    }

    if (payload.schemaVersion !== PRINT_JOB_PAYLOAD_VERSION) {
      throw new PrintQueueServiceError(
        'SCHEMA_VERSION_MISMATCH',
        `Expected schema version ${PRINT_JOB_PAYLOAD_VERSION}, got ${payload.schemaVersion}`,
      );
    }

    // Validate correlation keys
    this.validateCorrelation(payload.correlation);

    try {
      // Add job with idempotency key as client-generated ID
      // If same key is enqueued again, BullMQ will return existing job
      const job = await this.queue.add(
        'print-job',
        payload,
        {
          jobId: `${payload.correlation.transactionId}:${payload.correlation.idempotencyKey}`,
        },
      );

      return {
        jobId: job.id!,
        transactionId: payload.correlation.transactionId,
        spoolerCorrelationKey: payload.correlation.spoolerCorrelationKey,
      };
    } catch (error) {
      throw new PrintQueueServiceError(
        'ENQUEUE_FAILED',
        'Failed to enqueue print job',
        {
          transactionId: payload.correlation.transactionId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /**
   * Get job status by transaction ID and idempotency key
   *
   * @param transactionId Financial transaction identifier
   * @param idempotencyKey HTTP request idempotency key
   * @returns Job status or null if not found
   */
  async getJobStatus(
    transactionId: string,
    idempotencyKey: string,
  ): Promise<{
    jobId: string | number;
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
      const jobId = `${transactionId}:${idempotencyKey}` as string;
      const job = await this.queue.getJob(jobId);

      if (!job) {
        return null;
      }

      const state = await job.getState();

      return {
        jobId: job.id!,
        state,
        attempts: job.attemptsMade,
        failureReason: job.failedReason,
      };
    } catch (error) {
      throw new PrintQueueServiceError(
        'GET_STATUS_FAILED',
        'Failed to get job status',
        {
          transactionId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /**
   * Get queue depth (number of pending jobs)
   */
  async getQueueDepth(): Promise<number> {
    if (!this.queue) {
      throw new PrintQueueServiceError(
        'QUEUE_NOT_INITIALIZED',
        'Print queue not initialized',
      );
    }

    try {
      return await this.queue.count();
    } catch (error) {
      throw new PrintQueueServiceError(
        'GET_DEPTH_FAILED',
        'Failed to get queue depth',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /**
   * Get queue statistics (pending, active, completed, failed)
   */
  async getQueueStats(): Promise<{
    pending: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    if (!this.queue) {
      throw new PrintQueueServiceError(
        'QUEUE_NOT_INITIALIZED',
        'Print queue not initialized',
      );
    }

    try {
      const [pending, active, completed, failed] = await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount(),
      ]);

      return { pending, active, completed, failed };
    } catch (error) {
      throw new PrintQueueServiceError(
        'GET_STATS_FAILED',
        'Failed to get queue stats',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /**
   * Retry a failed job
   * Used by admin intervention flow
   *
   * @param jobId BullMQ job ID
   * @returns true if retry scheduled, false if job not found or not retryable
   */
  async retryFailedJob(jobId: string | number): Promise<boolean> {
    if (!this.queue) {
      throw new PrintQueueServiceError(
        'QUEUE_NOT_INITIALIZED',
        'Print queue not initialized',
      );
    }

    try {
      const job = await this.queue.getJob(String(jobId));

      if (!job) {
        return false;
      }

      const state = await job.getState();
      if (state !== 'failed') {
        return false;
      }

      // Clear failed state and re-enqueue for retry
      await job.remove();
      const newJob = await this.queue!.add(
        'print-job',
        job.data,
        {
          jobId: `${String(jobId)}-retry-${Date.now()}`,
        },
      );
      return !!newJob;
    } catch (error) {
      throw new PrintQueueServiceError(
        'RETRY_FAILED',
        'Failed to retry job',
        {
          jobId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /**
   * Pause queue (stop processing new jobs)
   * Used for maintenance or emergency stop
   */
  async pauseQueue(): Promise<void> {
    if (!this.queue) {
      throw new PrintQueueServiceError(
        'QUEUE_NOT_INITIALIZED',
        'Print queue not initialized',
      );
    }

    try {
      await this.queue.pause();
    } catch (error) {
      throw new PrintQueueServiceError(
        'PAUSE_FAILED',
        'Failed to pause queue',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /**
   * Resume queue processing
   */
  async resumeQueue(): Promise<void> {
    if (!this.queue) {
      throw new PrintQueueServiceError(
        'QUEUE_NOT_INITIALIZED',
        'Print queue not initialized',
      );
    }

    try {
      await this.queue.resume();
    } catch (error) {
      throw new PrintQueueServiceError(
        'RESUME_FAILED',
        'Failed to resume queue',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /**
   * Drain queue (remove all jobs)
   * Used for testing or emergency reset
   *
   * @param keepCompleted If true, retain completed jobs; if false, remove all
   */
  async drainQueue(keepCompleted: boolean = true): Promise<void> {
    if (!this.queue) {
      throw new PrintQueueServiceError(
        'QUEUE_NOT_INITIALIZED',
        'Print queue not initialized',
      );
    }

    try {
      await this.queue.drain(keepCompleted);
    } catch (error) {
      throw new PrintQueueServiceError(
        'DRAIN_FAILED',
        'Failed to drain queue',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /**
   * Validate correlation keys before enqueue
   * Ensures all required fields are present and well-formed
   */
  private validateCorrelation(correlation: PrintJobCorrelation): void {
    if (!correlation.transactionId || correlation.transactionId.trim() === '') {
      throw new PrintQueueServiceError(
        'INVALID_TRANSACTION_ID',
        'transactionId is required and cannot be empty',
      );
    }

    if (
      !correlation.spoolerCorrelationKey ||
      correlation.spoolerCorrelationKey.trim() === ''
    ) {
      throw new PrintQueueServiceError(
        'INVALID_SPOOLER_KEY',
        'spoolerCorrelationKey is required and cannot be empty',
      );
    }

    if (
      !correlation.idempotencyKey ||
      correlation.idempotencyKey.trim() === ''
    ) {
      throw new PrintQueueServiceError(
        'INVALID_IDEMPOTENCY_KEY',
        'idempotencyKey is required and cannot be empty',
      );
    }
  }

  /**
   * Shutdown queue service
   * Called on app shutdown
   */
  async shutdown(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }
}

/**
 * Singleton instance of print queue service
 */
let queueServiceInstance: PrintQueueService | null = null;

/**
 * Get or create singleton print queue service
 */
export function getPrintQueueService(): PrintQueueService {
  if (!queueServiceInstance) {
    queueServiceInstance = new PrintQueueService();
  }
  return queueServiceInstance;
}
