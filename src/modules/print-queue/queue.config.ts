/**
 * Print Queue Configuration
 *
 * Defines BullMQ queue setup, Redis connection, and queue names for the
 * async print orchestration pipeline.
 *
 * Phase 1: Queue platform foundation
 */

import { Queue, QueueEvents } from 'bullmq';
import type { QueueOptions, WorkerOptions } from 'bullmq';
import { REDIS_HOST, REDIS_PORT } from '@/config';

/**
 * Redis connection configuration for BullMQ
 * Uses local Redis on kiosk with health fallback to controlled degraded mode
 */
export const redisConfig = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  enableOfflineQueue: false,
  connectTimeout: 5000,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
};

/**
 * Queue names for print operations.
 *
 * NOTE: BullMQ uses queue names as Redis key prefixes separated by colons
 * internally, so queue names MUST NOT contain colons — they would create
 * ambiguous Redis key paths and cause `Queue name cannot contain :` errors
 * at startup.  Use hyphen-separated names only.
 */
export const queueNames = {
  printJobs: 'printbit-print-jobs',
  printJobAttempts: 'printbit-print-attempts',
  deadLetter: 'printbit-print-dead-letter',
} as const;

/**
 * Queue options for print jobs queue
 * Includes settings for retention, cleanup, and processing behavior
 */
export const printJobsQueueOptions: QueueOptions = {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000, // Start with 2s, then 4s, 8s
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
    },
    removeOnFail: {
      age: 86400, // Keep failed jobs for 24 hours
    },
  },
};

/**
 * Worker options for print job processing
 */
export const printJobsWorkerOptions: WorkerOptions = {
  connection: redisConfig,
  concurrency: 1, // Process one print job at a time (printer is single-queue)
  stalledInterval: 5000,
  maxStalledCount: 2,
  lockDuration: 30000,
  lockRenewTime: 15000,
};

/**
 * Dead-letter queue options
 */
export const deadLetterQueueOptions: QueueOptions = {
  connection: redisConfig,
  defaultJobOptions: {
    removeOnComplete: {
      age: 604800, // Keep for 7 days
    },
  },
};

/**
 * Retry classification for print jobs
 * Determines which failures are transient (retryable) vs permanent (non-retryable)
 */
export enum RetryableFailureClass {
  TRANSIENT_CONNECTIVITY = 'transient_connectivity',
  TRANSIENT_TIMEOUT = 'transient_timeout',
  TRANSIENT_QUERY_FAILURE = 'transient_query_failure',
  TRANSIENT_RESOURCE_UNAVAILABLE = 'transient_resource_unavailable',
}

export enum NonRetryableFailureClass {
  INVALID_PAGE_RANGE = 'invalid_page_range',
  UNSUPPORTED_OPTIONS = 'unsupported_options',
  BLOCKED_INK_POLICY = 'blocked_ink_policy',
  INSUFFICIENT_BALANCE = 'insufficient_balance',
  SESSION_EXPIRED = 'session_expired',
  DOCUMENT_MISSING = 'document_missing',
  PRINTER_NOT_READY = 'printer_not_ready',
}

export type FailureClass = RetryableFailureClass | NonRetryableFailureClass;

/**
 * Check if a failure class is retryable
 */
export function isRetryableFailureClass(
  failureClass: FailureClass,
): failureClass is RetryableFailureClass {
  return Object.values(RetryableFailureClass).includes(
    failureClass as RetryableFailureClass,
  );
}

/**
 * Queue lifecycle states for print jobs
 * Aligns with existing print lifecycle states
 */
export enum QueueJobState {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  DISPATCHED = 'dispatched',
  MONITORING_SPOOLER = 'monitoring_spooler',
  SETTLING = 'settling',
  RECONCILING = 'reconciling',
  COMPLETED = 'completed',
  FAILED = 'failed',
  MANUAL_REVIEW = 'manual_review',
}

/**
 * Initialize BullMQ queue instances and worker
 * Called on app startup
 */
export function initializePrintQueues() {
  const printJobsQueue = new Queue(queueNames.printJobs, printJobsQueueOptions);
  const deadLetterQueue = new Queue(
    queueNames.deadLetter,
    deadLetterQueueOptions,
  );
  const queueEvents = new QueueEvents(queueNames.printJobs, {
    connection: redisConfig,
  });

  return {
    printJobsQueue,
    deadLetterQueue,
    queueEvents,
  };
}