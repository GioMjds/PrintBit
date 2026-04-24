/**
 * Print Queue Orchestration - Full Worker Pipeline
 *
 * 5-stage print job execution pipeline:
 * 1. Preflight: Printer state, ink policy, balance, document validation
 * 2. Dispatch: Send to printer, capture result
 * 3. Settlement: Process payment and change dispensing
 * 4. Spooler: Monitor job lifecycle until terminal state
 * 5. Reconciliation: Generate receipt and emit completion
 *
 * Phase 2: Full orchestration with service integration
 */

import type { Job } from 'bullmq';
import type { Server } from 'socket.io';
import type { PrintJobEnqueuePayload } from './print-job.schema';
import { isRetryableFailureClass } from './queue.config';

/**
 * Result of orchestration execution
 */
export interface PrintWorkerOrchestrationResult {
  success: boolean;
  transactionId: string;
  spoolerCorrelationKey: string;
  stage: string;
  durationMs: number;
  chargedAmount: number;
  failureClass?: string;
  failureReason?: string;
}

/**
 * Error class for worker orchestration
 */
export class WorkerOrchestrationError extends Error {
  constructor(
    public failureClass: string,
    public isRetryable: boolean,
    public stage: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WorkerOrchestrationError';
    Error.captureStackTrace(this, WorkerOrchestrationError);
  }
}

/**
 * Build context for logging and Socket.IO emissions
 */
export function buildPrintJobContext(job: Job<PrintJobEnqueuePayload>): {
  transactionId: string;
  spoolerCorrelationKey: string;
  jobId: string | number;
  mode: 'print' | 'copy';
  copies: number;
  printerName: string;
} {
  return {
    transactionId: job.data.correlation.transactionId,
    spoolerCorrelationKey: job.data.correlation.spoolerCorrelationKey,
    jobId: job.id ?? 'unknown',
    mode: job.data.request.mode,
    copies: job.data.request.copies,
    printerName: job.data.request.printerName ?? 'default',
  };
}

/**
 * Record attempt in job history for diagnostics
 */
export function recordJobAttempt(
  job: Job<PrintJobEnqueuePayload>,
  attemptNumber: number,
  result: 'success' | 'retryable_failure' | 'non_retryable_failure',
  failureClass?: string,
  failureReason?: string,
  durationMs?: number,
): void {
  const now = new Date().toISOString();

  if (!job.data.attempts) {
    job.data.attempts = [];
  }

  job.data.attempts.push({
    attemptNumber,
    timestamp: now,
    result,
    failureClass,
    failureReason,
    durationMs,
  });
}

/**
 * Orchestrate print job execution through 5-stage pipeline
 *
 * Stage 1: Preflight - Validate printer, ink, document, balance
 * Stage 2: Dispatch - Send job to printer
 * Stage 3: Settlement - Process payment and change
 * Stage 4: Spooler - Monitor print completion
 * Stage 5: Reconciliation - Generate receipt
 *
 * TODO Phase 2 Implementation:
 *
 * Stage 1 (Preflight):
 *   - Call getPrinterTelemetry() for printer state
 *   - Call evaluateInkPreflight() to check ink policy
 *   - Verify document exists in uploads/staging
 *   - Validate balance >= requiredAmount
 *   - Emit Socket.IO: printQueueJobStarted
 *
 * Stage 2 (Dispatch):
 *   - Call printFile() with job.data.request options
 *   - Capture dispatchResult (engine, mode, mimeType, etc.)
 *   - Call checkpointRecoverySession() for dispatch checkpoint
 *   - On error: throw WorkerOrchestrationError
 *   - Emit Socket.IO: printQueueJobDispatched
 *
 * Stage 3 (Settlement):
 *   - Call settlementService.settle()
 *   - Verify settlement.ok === true
 *   - Capture chargedAmount from result
 *   - Call checkpointRecoverySession() for settled checkpoint
 *   - Emit Socket.IO: transactionSettled
 *
 * Stage 4 (Spooler):
 *   - Call monitorSpoolerJob() to poll lifecycle
 *   - Poll until terminal or timeout
 *   - On error: throw retryable/non-retryable per reason
 *   - Emit Socket.IO: printQueueJobPrinted
 *   - Call checkpointRecoverySession() for print_confirmed
 *
 * Stage 5 (Reconciliation):
 *   - Call receiptService.upsertReceiptSnapshot()
 *   - Emit Socket.IO: printQueueJobCompleted
 *   - Emit Socket.IO: transactionReceiptStatusChanged
 *   - Return success with chargedAmount
 */
export async function orchestratePrintJob(
  job: Job<PrintJobEnqueuePayload>,
  io: Server,
): Promise<PrintWorkerOrchestrationResult> {
  const startTime = Date.now();
  const ctx = buildPrintJobContext(job);
  let currentStage = 'initialization';
  const chargedAmount = job.data.financial.chargedAmount ?? 0;

  try {
    // Stage 1: Preflight validation
    currentStage = 'preflight';

    // Stage 2: Dispatch to printer
    currentStage = 'dispatch';

    // Stage 3: Settlement and payment
    currentStage = 'settlement';

    // Stage 4: Spooler monitoring
    currentStage = 'spooler';

    // Stage 5: Reconciliation
    currentStage = 'reconciliation';

    return {
      success: true,
      transactionId: ctx.transactionId,
      spoolerCorrelationKey: ctx.spoolerCorrelationKey,
      stage: 'reconciliation',
      durationMs: Date.now() - startTime,
      chargedAmount,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;

    let failureClass: string;
    let isRetryable: boolean;
    let failureReason: string;

    if (err instanceof WorkerOrchestrationError) {
      failureClass = err.failureClass;
      isRetryable = err.isRetryable;
      failureReason = err.message;
    } else {
      failureClass = 'UNKNOWN_ERROR';
      isRetryable = false;
      failureReason = err instanceof Error ? err.message : String(err);
    }

    recordJobAttempt(
      job,
      job.attemptsMade,
      isRetryable ? 'retryable_failure' : 'non_retryable_failure',
      failureClass,
      failureReason,
      durationMs,
    );

    io.emit('printQueueJobFailed', {
      jobId: job.id,
      transactionId: ctx.transactionId,
      attemptNumber: job.attemptsMade,
      stage: currentStage,
      failureReason,
      failureClass,
      isRetryable,
      failedAt: new Date().toISOString(),
    });

    if (isRetryable) {
      throw new Error(`${failureClass}: ${failureReason}`);
    }

    throw new Error(`NON_RETRYABLE - ${failureClass}: ${failureReason}`);
  }
}
