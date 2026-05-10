import type { Server } from 'socket.io';
import type { LogMeta, SpoolerLifecycleState } from './db';
import { recordSpoolerLifecycleTransition } from './recovery';
import type { PublicPrintError } from '../utils/print-error-types';

export interface PrintLifecycleStatePayload {
  mode: 'print' | 'copy';
  state: SpoolerLifecycleState;
  transactionId: string | null;
  spoolerCorrelationKey?: string | null;
  printerName?: string | null;
  spoolerJobId?: number | null;
  jobStatus?: string | null;
  pagesPrinted?: number;
  totalPages?: number;
  reason?: string | null;
  jobDispatchedAt?: string;
  timedOut?: boolean;
  refundDisposition?: string;
  printError?: PublicPrintError;
  receipt?: any;
}

export interface PersistPrintLifecycleStateOptions {
  requiredAmount?: number;
  sessionId?: string | null;
  documentId?: string | null;
  meta?: LogMeta;
}

export async function persistAndEmitPrintLifecycleState(
  io: Server,
  payload: PrintLifecycleStatePayload,
  options: PersistPrintLifecycleStateOptions = {},
): Promise<void> {
  const transactionId =
    typeof payload.transactionId === 'string' && payload.transactionId.trim()
      ? payload.transactionId.trim()
      : null;

  if (transactionId) {
    const meta: LogMeta = {
      ...(options.meta ?? {}),
    };
    if (typeof payload.jobDispatchedAt === 'string') {
      meta.jobDispatchedAt = payload.jobDispatchedAt;
    }
    if (typeof payload.timedOut === 'boolean') {
      meta.timedOut = payload.timedOut;
    }
    if (payload.printError) {
      meta.printErrorCode = payload.printError.code;
      meta.printErrorLayer = payload.printError.layer;
      meta.printErrorSeverity = payload.printError.severity;
      meta.printErrorMessage = payload.printError.userMessage;
    }
    if (
      typeof payload.refundDisposition === 'string' &&
      payload.refundDisposition.trim()
    ) {
      meta.refundDisposition = payload.refundDisposition.trim();
    }

    try {
      await recordSpoolerLifecycleTransition({
        transactionId,
        mode: payload.mode,
        state: payload.state,
        requiredAmount: options.requiredAmount,
        sessionId: options.sessionId,
        documentId: options.documentId,
        spoolerCorrelationKey: payload.spoolerCorrelationKey,
        spoolerJobId: payload.spoolerJobId,
        printerName: payload.printerName,
        reason: payload.reason,
        jobStatus: payload.jobStatus,
        pagesPrinted: payload.pagesPrinted,
        totalPages: payload.totalPages,
        meta,
      });
    } catch (error) {
      console.error(
        '[LIFECYCLE] Failed to persist print lifecycle transition:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  io.emit('printLifecycleState', payload);
}
