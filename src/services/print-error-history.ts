import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import { printErrorStore } from '@/core/database/sqlite-storage';
import { adminService } from './admin';
import { anomalyService, buildAnomalyFingerprint } from './anomaly';
import type {
  PrintError,
  PrintErrorLayer,
  PrintErrorRecord,
  PublicPrintError,
} from '@/utils/print-error-types';

export interface RecordPrintErrorOptions {
  io?: Server | null;
  emit?: boolean;
  adminLog?: boolean;
  anomaly?: boolean;
  refundId?: string | null;
  refundDisposition?: string | null;
  restoredBalanceAmount?: number | null;
  pagesPrinted?: number | null;
  totalPages?: number | null;
  chargedAmount?: number | null;
}

const ANOMALY_CATEGORY_BY_LAYER: Record<
  PrintErrorLayer,
  'printer' | 'spooler' | 'serial' | 'hopper' | 'network' | 'security'
> = {
  paper: 'printer',
  ink: 'printer',
  connectivity: 'printer',
  input: 'printer',
  application: 'spooler',
  infrastructure: 'printer',
};

function toPrimitiveMeta(
  value: Record<string, unknown> | null,
): Record<string, string | number | boolean | null> {
  if (!value) return {};
  const meta: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean' ||
      item === null
    ) {
      meta[key] = item;
    } else if (item !== undefined) {
      meta[key] = JSON.stringify(item);
    }
  }
  return meta;
}

export function toPublicPrintError(record: PrintErrorRecord): PublicPrintError {
  const { raw: _raw, ...safe } = record;
  return safe;
}

export class PrintErrorHistoryService {
  record(
    error: PrintError,
    options: RecordPrintErrorOptions = {},
  ): PrintErrorRecord {
    const record: PrintErrorRecord = {
      ...error,
      id: randomUUID(),
      resolutionNote: null,
      resolvedAt: null,
      resolvedBy: null,
    };

    printErrorStore.create(record);

    const publicError = toPublicPrintError(record);
    if (options.emit !== false) {
      options.io?.emit('printErrorRaised', {
        printError: publicError,
        refundId: options.refundId ?? null,
        refundDisposition: options.refundDisposition ?? null,
        restoredBalanceAmount: options.restoredBalanceAmount ?? null,
        pagesPrinted: options.pagesPrinted ?? null,
        totalPages: options.totalPages ?? null,
        chargedAmount: options.chargedAmount ?? null,
      });
    }

    if (options.adminLog !== false) {
      void adminService
        .appendAdminLog('print_error_raised', error.adminMessage, {
          errorId: record.id,
          errorCode: record.code,
          layer: record.layer,
          severity: record.severity,
          detectionConfidence: record.detectionConfidence,
          source: record.source,
          transactionId: record.transactionId,
          sessionId: record.sessionId,
          jobId: record.jobId,
          printerName: record.printerName,
          refundEligible: record.refundEligible,
          systemAction: record.systemAction,
          refundId: options.refundId ?? null,
          refundDisposition: options.refundDisposition ?? null,
          restoredBalanceAmount: options.restoredBalanceAmount ?? null,
          pagesPrinted: options.pagesPrinted ?? null,
          totalPages: options.totalPages ?? null,
          chargedAmount: options.chargedAmount ?? null,
          ...toPrimitiveMeta(record.raw),
        })
        .catch((logError) => {
          console.error('[PRINT-ERROR] Failed to append admin log.', {
            errorId: record.id,
            error:
              logError instanceof Error ? logError.message : String(logError),
          });
        });
    }

    if (options.anomaly !== false && record.severity !== 'WARNING') {
      void anomalyService
        .report({
          type: record.code.toLowerCase(),
          source: record.source,
          category: ANOMALY_CATEGORY_BY_LAYER[record.layer],
          severity: record.severity === 'FATAL' ? 'critical' : 'warning',
          message: record.adminMessage,
          fingerprint: buildAnomalyFingerprint([
            'print-error',
            record.code,
            record.printerName ?? 'unknown-printer',
          ]),
          context: {
            errorId: record.id,
            errorCode: record.code,
            layer: record.layer,
            detectionConfidence: record.detectionConfidence,
            transactionId: record.transactionId,
            sessionId: record.sessionId,
            jobId: record.jobId,
            printerName: record.printerName,
            refundEligible: record.refundEligible,
            systemAction: record.systemAction,
            refundId: options.refundId ?? null,
            refundDisposition: options.refundDisposition ?? null,
          },
        })
        .catch((anomalyError) => {
          console.error('[PRINT-ERROR] Failed to report anomaly.', {
            errorId: record.id,
            error:
              anomalyError instanceof Error
                ? anomalyError.message
                : String(anomalyError),
          });
        });
    }

    return record;
  }
}

export const printErrorHistoryService = new PrintErrorHistoryService();
