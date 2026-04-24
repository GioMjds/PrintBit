/**
 * Print Queue Worker Orchestration
 *
 * Full print job execution pipeline with:
 * - Preflight checks (printer state, ink policy)
 * - Print dispatch
 * - Settlement-safe balance transition
 * - Spooler monitoring
 * - Terminal reconciliation and receipt generation
 *
 * Phase 2: Workerized print pipeline orchestration
 */

import type { Job } from 'bullmq';
import type { Server } from 'socket.io';
import type {
  PrintQueueJobData,
  PrintJobAttempt,
  PrintJobContext,
} from './print-job.schema';
import { RetryableFailureClass, NonRetryableFailureClass, isRetryableFailureClass, QueueJobState } from './queue.config';

/**
 * Print worker orchestration result
 */
export interface PrintWorkerOrchestrationResult {
  success: boolean;
  transactionId: string;
  spoolerCorrelationKey: string;
  stage: QueueJobState;
  durationMs: number;
  chargedAmount?: number;
  failureClass?: string;
  failureReason?: string;
}

/**
 * Worker orchestration error with retry classification
 */
export class WorkerOrchestrationError extends Error {
  constructor(
    public failureClass: string,
    public isRetryable: boolean,
    message: string,
    public stage: QueueJobState,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WorkerOrchestrationError';
  }
}

/**
 * Print job context builder for Socket.IO and logging
 */
export function buildPrintJobContext(
  job: Job<PrintQueueJobData>,
): PrintJobContext {
  const { correlation, request } = job.data;
  return {
    transactionId: correlation.transactionId,
    mode: request.mode,
    copies: request.copies,
    colorMode: request.colorMode,
    spoolerCorrelationKey: correlation.spoolerCorrelationKey,
    sessionId: correlation.sessionId,
    documentId: correlation.documentId,
    filename: request.serverFilename,
    dispatchEngine: null, // Set after dispatch
  };
}

/**
 * Orchestrate full print job execution
 *
 * Sequence:
 * 1. Preflight checks (printer state, ink policy)
 * 2. Print dispatch to physical printer
 * 3. Settlement-safe balance transition
 * 4. Spooler monitoring and timeout handling
 * 5. Terminal reconciliation and receipt generation
 *
 * Phase 2 placeholder: Full implementation integrated with existing services
 */
export async function orchestratePrintJob(
  job: Job<PrintQueueJobData>,
  io: Server,
): Promise<PrintWorkerOrchestrationResult> {
  const startTime = Date.now();
  const { correlation, request, financial, dispatch } = job.data;
  const jobContext = buildPrintJobContext(job);

  console.log(
    `[WORKER-ORCHESTRATION] Job ${job.id} starting: transactionId=${correlation.transactionId}`,
  );

  try {
    // TODO Phase 2: Full orchestration implementation
    // Stage 1: Preflight checks
    // - Verify printer connected and not in BLOCKED_STATUSES
    // - Evaluate ink preflight policy via evaluateInkPreflight()
    // - Check balance not decreased since enqueue (financial safety)
    // - Verify document exists (for print mode)
    //
    // Stage 2: Dispatch
    // - Call printFile() with dispatch options
    // - Capture dispatchResult (engine, mode, MIME type, attempts)
    // - Update job.data.dispatch.jobDispatchedAt and dispatchEngine
    // - Checkpoint recovery session at 'job_dispatched' phase
    //
    // Stage 3: Settlement
    // - Call settlementService.settle() with required amount
    // - Verify settlement.ok before proceeding
    // - Update job.data.financial.chargedAmount
    // - Checkpoint recovery session at 'settled' phase
    //
    // Stage 4: Spooler Monitoring
    // - Call monitorSpoolerJob() with settled context
    // - Poll spooler until confirmed/timeout/failure
    // - Emit Socket.IO printerSpoolerConfirmed on success
    // - On confirmed: trigger consumables usage event and cleanup
    //
    // Stage 5: Reconciliation
    // - Generate receipt snapshot and status update
    // - Emit Socket.IO printJobCompleted event
    // - Return success result

    // Placeholder: Job accepted and queued
    const durationMs = Date.now() - startTime;

    console.log(
      `[WORKER-ORCHESTRATION] Job ${job.id} queued (placeholder): transactionId=${correlation.transactionId}, durationMs=${durationMs}`,
    );

    return {
      success: true,
      transactionId: correlation.transactionId,
      spoolerCorrelationKey: correlation.spoolerCorrelationKey,
      stage: QueueJobState.QUEUED,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(
      `[WORKER-ORCHESTRATION] Job ${job.id} failed: ${errorMessage}`,
      error,
    );

    if (error instanceof WorkerOrchestrationError) {
      throw error;
    }

    // Classify unknown error as non-retryable for safety
    throw new WorkerOrchestrationError(
      NonRetryableFailureClass.PRINTER_NOT_READY,
      false,
      `Print job orchestration failed: ${errorMessage}`,
      QueueJobState.FAILED,
      { transactionId: correlation.transactionId, durationMs },
    );
  }
}

/**
 * Record attempt in job data for admin diagnostics
 */
export function recordJobAttempt(
  job: Job<PrintQueueJobData>,
  result: PrintWorkerOrchestrationResult,
): PrintJobAttempt {
  const attempt: PrintJobAttempt = {
    attemptNumber: job.attemptsMade,
    timestamp: new Date().toISOString(),
    result: result.success ? 'success' : 'retryable_failure',
    failureClass: result.failureClass,
    failureReason: result.failureReason,
    engine: result.stage === QueueJobState.DISPATCHED ? 'pending' : undefined,
    durationMs: result.durationMs,
  };

  if (!job.data.attempts) {
    job.data.attempts = [];
  }
  job.data.attempts.push(attempt);

  return attempt;
}
