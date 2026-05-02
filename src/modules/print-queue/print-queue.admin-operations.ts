/**
 * Print Queue Admin Operations Service
 *
 * Administrative operations on the queue:
 * - Pause/resume queue processing
 * - Drain completed/failed jobs
 * - Retry failed jobs
 * - Query queue statistics
 *
 * Phase 1: Admin queue control (separated from core service)
 */

import { Queue } from 'bullmq';
import { queueNames, printJobsQueueOptions } from './queue.config';
import type { PrintJobEnqueuePayload } from './print-job.schema';

/**
 * Error class for admin operations
 */
export class PrintQueueAdminError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PrintQueueAdminError';
  }
}

/**
 * Print Queue Admin Operations Service
 * Manages administrative actions on queue (pause, resume, drain, stats)
 */
export class PrintQueueAdminOperations {
  private queue: Queue<PrintJobEnqueuePayload> | null = null;

  constructor() {
    this.queue = new Queue(queueNames.printJobs, printJobsQueueOptions);
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
    try {
      if (!this.queue) {
        throw new PrintQueueAdminError('QUEUE_NOT_INITIALIZED', 'Queue not initialized');
      }

      const [pending, active, completed, failed] = await Promise.all([
        this.queue.count(),
        this.queue.getActiveCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount(),
      ]);

      return { pending, active, completed, failed };
    } catch (err) {
      throw new PrintQueueAdminError(
        'STATS_ERROR',
        'Failed to get queue stats',
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  /**
   * Retry a failed job
   */
  async retryFailedJob(jobId: string | number): Promise<boolean> {
    try {
      if (!this.queue) {
        throw new PrintQueueAdminError('QUEUE_NOT_INITIALIZED', 'Queue not initialized');
      }

      const job = await this.queue.getJob(String(jobId));

      if (!job) {
        throw new PrintQueueAdminError(
          'JOB_NOT_FOUND',
          `Job ${jobId} not found`,
          { jobId },
        );
      }

      const isFailed = await job.isFailed();
      if (!isFailed) {
        throw new PrintQueueAdminError(
          'JOB_NOT_FAILED',
          `Job ${jobId} is not in failed state`,
          { jobId, state: job.getState() },
        );
      }

      // Move job back to waiting for retry
      await job.retry();
      return true;
    } catch (err) {
      if (err instanceof PrintQueueAdminError) {
        throw err;
      }

      throw new PrintQueueAdminError(
        'RETRY_ERROR',
        `Failed to retry job ${jobId}`,
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  /**
   * Pause queue from processing new jobs
   */
  async pauseQueue(): Promise<void> {
    try {
      if (!this.queue) {
        throw new PrintQueueAdminError('QUEUE_NOT_INITIALIZED', 'Queue not initialized');
      }

      await this.queue.pause();
    } catch (err) {
      throw new PrintQueueAdminError(
        'PAUSE_ERROR',
        'Failed to pause queue',
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  /**
   * Resume queue processing
   */
  async resumeQueue(): Promise<void> {
    try {
      if (!this.queue) {
        throw new PrintQueueAdminError('QUEUE_NOT_INITIALIZED', 'Queue not initialized');
      }

      await this.queue.resume();
    } catch (err) {
      throw new PrintQueueAdminError(
        'RESUME_ERROR',
        'Failed to resume queue',
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  /**
   * Drain queue (remove jobs)
   * @param keepCompleted If true, keep completed jobs; remove if false
   */
  async drainQueue(keepCompleted: boolean = true): Promise<void> {
    try {
      if (!this.queue) {
        throw new PrintQueueAdminError('QUEUE_NOT_INITIALIZED', 'Queue not initialized');
      }

      await this.queue.drain(keepCompleted);
    } catch (err) {
      throw new PrintQueueAdminError(
        'DRAIN_ERROR',
        'Failed to drain queue',
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  /**
   * Shutdown admin operations (close queue connection)
   */
  async shutdown(): Promise<void> {
    try {
      if (this.queue) {
        await this.queue.close();
        this.queue = null;
      }
    } catch (err) {
      throw new PrintQueueAdminError(
        'SHUTDOWN_ERROR',
        'Failed to shutdown admin operations',
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }
}

/**
 * Singleton instance of print queue admin operations service
 */
let printQueueAdminInstance: PrintQueueAdminOperations | null = null;

/**
 * Get or create singleton print queue admin operations service
 */
export function getPrintQueueAdminOperations(): PrintQueueAdminOperations {
  if (!printQueueAdminInstance) {
    printQueueAdminInstance = new PrintQueueAdminOperations();
  }
  return printQueueAdminInstance;
}
