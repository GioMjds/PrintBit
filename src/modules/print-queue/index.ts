/**
 * Print Queue Module
 *
 * BullMQ-based async orchestration for print jobs with:
 * - Queue infrastructure and configuration
 * - Job payload schema with correlation and versioning
 * - Queue service for enqueuing and status tracking
 * - Worker for job processing with retry classification
 *
 * Phase 1: Queue platform foundation
 */

export {
  redisConfig,
  queueNames,
  printJobsQueueOptions,
  printJobsWorkerOptions,
  deadLetterQueueOptions,
  initializePrintQueues,
  RetryableFailureClass,
  NonRetryableFailureClass,
  type FailureClass,
  isRetryableFailureClass,
  QueueJobState,
} from './queue.config';

export {
  PRINT_JOB_PAYLOAD_VERSION,
  type PrintJobCorrelation,
  type PrintJobRequest,
  type PrintJobFinancialContext,
  type PrintJobDispatchContext,
  type PrintJobAttempt,
  type PrintJobEnqueuePayload,
  type PrintJobContext,
  type PrintQueueJobData,
} from './print-job.schema';

export {
  PrintQueueService,
  PrintQueueServiceError,
  getPrintQueueService,
} from './print-queue.service';

export {
  createPrintJobWorker,
} from './print-queue.worker';

export {
  buildPrintJobEnqueuePayload,
  PrintJobEnqueueError,
} from './print-queue.integration';

export {
  orchestratePrintJob,
  WorkerOrchestrationError,
  recordJobAttempt,
  buildPrintJobContext,
  type PrintWorkerOrchestrationResult,
} from './print-queue.orchestration';
