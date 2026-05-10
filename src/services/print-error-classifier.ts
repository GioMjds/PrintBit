import type {
  InkPreflightEvaluation,
  PrinterTelemetry,
} from './printer-status';
import type { PrintDispatchResult } from './printer';
import type { PrintDispatchAttemptResult } from './print-dispatcher';
import type {
  PrintError,
  PrintErrorCode,
  PrintErrorDetectionConfidence,
  PrintErrorLayer,
  PrintErrorSeverity,
  PrintErrorSystemAction,
} from '../utils/print-error-types';

interface PrintErrorDefinition {
  layer: PrintErrorLayer;
  severity: PrintErrorSeverity;
  userMessage: string;
  adminMessage: string;
  refundEligible: boolean;
  systemAction: PrintErrorSystemAction;
  detectionConfidence: PrintErrorDetectionConfidence;
}

export interface PrintErrorContext {
  source: string;
  transactionId?: string | null;
  sessionId?: string | null;
  jobId?: string | number | null;
  printerName?: string | null;
  raw?: Record<string, unknown> | null;
  detectionConfidence?: PrintErrorDetectionConfidence;
  userMessage?: string;
  adminMessage?: string;
  refundEligible?: boolean;
  systemAction?: PrintErrorSystemAction;
}

/**
 * This module defines a set of printer error codes and their associated metadata,
 * as well as a classifier that can create structured PrintError objects based on various inputs
 * such as printer telemetry and dispatch results.
 *
 * The classifier uses predefined rules to map specific conditions to error codes,
 * which can then be used for consistent error handling, user messaging,
 * and administrative logging throughout the application.
 */
export const PRINT_ERROR_DEFINITIONS: Record<
  PrintErrorCode,
  PrintErrorDefinition
> = {
  PAPER_INSUFFICIENT_PRE_DISPATCH: {
    layer: 'paper',
    severity: 'FATAL',
    userMessage:
      'The printer does not have enough paper for this job. Please wait for staff assistance.',
    adminMessage:
      'Tray paper estimate is lower than requested sheets before dispatch.',
    refundEligible: false,
    systemAction: 'ABORT_NO_REFUND',
    detectionConfidence: 'high',
  },
  PAPER_TRAY_EMPTY: {
    layer: 'paper',
    severity: 'FATAL',
    userMessage:
      'The printer is out of paper. Please wait for staff assistance.',
    adminMessage: 'Printer or inventory telemetry reports an empty paper tray.',
    refundEligible: false,
    systemAction: 'ABORT_NO_REFUND',
    detectionConfidence: 'high',
  },
  PAPER_JAM_PRINT: {
    layer: 'paper',
    severity: 'FATAL',
    userMessage: 'A paper jam was detected. Please wait for staff assistance.',
    adminMessage: 'Printer status indicates a paper jam during printing.',
    refundEligible: true,
    systemAction: 'ABORT_AND_REFUND',
    detectionConfidence: 'high',
  },
  PAPER_JAM_SCAN_ADF: {
    layer: 'paper',
    severity: 'RECOVERABLE',
    userMessage:
      'The document feeder is jammed. Please clear and reload your document.',
    adminMessage: 'Scanner or NAPS2 output indicates an ADF paper jam.',
    refundEligible: false,
    systemAction: 'RESET_SESSION',
    detectionConfidence: 'medium',
  },
  PAPER_DOUBLE_FEED: {
    layer: 'paper',
    severity: 'RECOVERABLE',
    userMessage:
      'Multiple pages may have fed at once. Please reload your document and try again.',
    adminMessage: 'Scanner output suggests an ADF double-feed condition.',
    refundEligible: false,
    systemAction: 'RETRY',
    detectionConfidence: 'low',
  },
  PAPER_MISALIGNED: {
    layer: 'paper',
    severity: 'RECOVERABLE',
    userMessage:
      'The document appears misaligned. Please reload it straight and try again.',
    adminMessage: 'Scanner output suggests skew or paper misalignment.',
    refundEligible: false,
    systemAction: 'RETRY',
    detectionConfidence: 'low',
  },
  PAPER_SIZE_UNSUPPORTED: {
    layer: 'paper',
    severity: 'FATAL',
    userMessage:
      'This printer does not support the selected paper size. Please choose another size.',
    adminMessage:
      'Requested paper size is not in the printer capability snapshot.',
    refundEligible: false,
    systemAction: 'ABORT_NO_REFUND',
    detectionConfidence: 'medium',
  },
  PAPER_TYPE_MISMATCH: {
    layer: 'paper',
    severity: 'RECOVERABLE',
    userMessage:
      'The loaded paper type does not match this job. Please wait for staff assistance.',
    adminMessage: 'Printer reported a paper type mismatch.',
    refundEligible: true,
    systemAction: 'PAUSE_AND_NOTIFY',
    detectionConfidence: 'low',
  },
  MANUAL_FEED_REQUIRED: {
    layer: 'paper',
    severity: 'RECOVERABLE',
    userMessage:
      'The printer is waiting for paper feed assistance. Please wait for staff.',
    adminMessage: 'Printer status indicates manual feed is required.',
    refundEligible: true,
    systemAction: 'PAUSE_AND_NOTIFY',
    detectionConfidence: 'high',
  },
  INK_EMPTY: {
    layer: 'ink',
    severity: 'FATAL',
    userMessage: 'The printer ink is empty. Please wait for staff assistance.',
    adminMessage: 'Ink preflight policy blocked the job due to empty supply.',
    refundEligible: false,
    systemAction: 'ABORT_NO_REFUND',
    detectionConfidence: 'high',
  },
  INK_LOW: {
    layer: 'ink',
    severity: 'WARNING',
    userMessage:
      'Ink is low, so print quality may be reduced. Staff has been notified.',
    adminMessage: 'Ink telemetry reports one or more low supplies.',
    refundEligible: false,
    systemAction: 'PAUSE_AND_NOTIFY',
    detectionConfidence: 'medium',
  },
  PRINTHEAD_CLOGGED: {
    layer: 'ink',
    severity: 'WARNING',
    userMessage:
      'Print quality may be affected. Please ask staff if the output looks wrong.',
    adminMessage:
      'Print quality heuristic suggests banding or a clogged printhead.',
    refundEligible: false,
    systemAction: 'PAUSE_AND_NOTIFY',
    detectionConfidence: 'low',
  },
  COLOR_OUTPUT_MISMATCH: {
    layer: 'ink',
    severity: 'WARNING',
    userMessage:
      'The printer color setup may not match the selected output. Staff has been notified.',
    adminMessage: 'Driver color mode or profile appears mismatched.',
    refundEligible: false,
    systemAction: 'PAUSE_AND_NOTIFY',
    detectionConfidence: 'low',
  },
  PRINTER_POWERED_OFF: {
    layer: 'connectivity',
    severity: 'FATAL',
    userMessage:
      'The printer is currently unavailable. Please wait for staff assistance.',
    adminMessage: 'Printer is unreachable and may be powered off.',
    refundEligible: true,
    systemAction: 'ABORT_AND_REFUND',
    detectionConfidence: 'low',
  },
  USB_DISCONNECTED: {
    layer: 'connectivity',
    severity: 'FATAL',
    userMessage:
      'The printer connection was lost. Please wait for staff assistance.',
    adminMessage: 'USB printer device is missing or disconnected.',
    refundEligible: true,
    systemAction: 'ABORT_AND_REFUND',
    detectionConfidence: 'high',
  },
  NETWORK_PRINTER_UNREACHABLE: {
    layer: 'connectivity',
    severity: 'FATAL',
    userMessage:
      'The printer network connection is unavailable. Please wait for staff assistance.',
    adminMessage: 'Network or WSD printer is unreachable.',
    refundEligible: true,
    systemAction: 'ABORT_AND_REFUND',
    detectionConfidence: 'medium',
  },
  WINDOWS_PRINTER_OFFLINE: {
    layer: 'connectivity',
    severity: 'FATAL',
    userMessage:
      'Windows reports that the printer is offline. Please wait for staff assistance.',
    adminMessage: 'Win32_Printer or spooler status reports Offline.',
    refundEligible: true,
    systemAction: 'ABORT_AND_REFUND',
    detectionConfidence: 'high',
  },
  PRINTER_PAUSED: {
    layer: 'connectivity',
    severity: 'RECOVERABLE',
    userMessage:
      'The printer is paused. Please wait while staff resumes printing.',
    adminMessage: 'Windows spooler reports the printer or job is paused.',
    refundEligible: true,
    systemAction: 'PAUSE_AND_NOTIFY',
    detectionConfidence: 'high',
  },
  POWER_LOSS_DETECTED: {
    layer: 'connectivity',
    severity: 'FATAL',
    userMessage:
      'The kiosk restarted during a print job. Please wait for staff assistance.',
    adminMessage: 'Recovery state indicates a power loss or restart mid-job.',
    refundEligible: true,
    systemAction: 'ABORT_AND_REFUND',
    detectionConfidence: 'medium',
  },
  HARDWARE_OVERTEMP_OR_VOLTAGE: {
    layer: 'connectivity',
    severity: 'FATAL',
    userMessage:
      'The printer reported a hardware safety fault. Please wait for staff.',
    adminMessage: 'Printer reported overheating, voltage, or internal fault.',
    refundEligible: true,
    systemAction: 'RESET_SESSION',
    detectionConfidence: 'low',
  },
  PRINTER_DOOR_OPEN: {
    layer: 'connectivity',
    severity: 'RECOVERABLE',
    userMessage: 'The printer cover is open. Please wait for staff assistance.',
    adminMessage: 'Printer status reports Door Open.',
    refundEligible: true,
    systemAction: 'PAUSE_AND_NOTIFY',
    detectionConfidence: 'high',
  },
  SCANNER_NO_DOCUMENT: {
    layer: 'input',
    severity: 'RECOVERABLE',
    userMessage:
      'No document was detected. Please place your document and try again.',
    adminMessage: 'Scanner completed without a usable document output.',
    refundEligible: false,
    systemAction: 'RETRY',
    detectionConfidence: 'medium',
  },
  SCANNER_DISCONNECTED: {
    layer: 'input',
    severity: 'FATAL',
    userMessage:
      'The scanner is currently unavailable. Please wait for staff assistance.',
    adminMessage:
      'Windows scanner telemetry reports the device is missing or disconnected.',
    refundEligible: false,
    systemAction: 'RESET_SESSION',
    detectionConfidence: 'high',
  },
  SCANNER_ADF_JAM: {
    layer: 'input',
    severity: 'RECOVERABLE',
    userMessage:
      'The document feeder is jammed. Please clear it and try again.',
    adminMessage: 'Scanner reports an ADF jam.',
    refundEligible: false,
    systemAction: 'RESET_SESSION',
    detectionConfidence: 'medium',
  },
  SCANNER_GLASS_DIRTY: {
    layer: 'input',
    severity: 'WARNING',
    userMessage:
      'The scan may show streaks. Please ask staff to clean the scanner glass.',
    adminMessage: 'Image quality heuristic suggests scanner glass streaks.',
    refundEligible: false,
    systemAction: 'PAUSE_AND_NOTIFY',
    detectionConfidence: 'low',
  },
  SCAN_PARTIAL_OUTPUT: {
    layer: 'input',
    severity: 'RECOVERABLE',
    userMessage:
      'The scan looks incomplete. Please reload the document and try again.',
    adminMessage:
      'Scan output dimensions or file size suggests partial output.',
    refundEligible: false,
    systemAction: 'RETRY',
    detectionConfidence: 'low',
  },
  SPOOLER_SERVICE_STOPPED: {
    layer: 'application',
    severity: 'FATAL',
    userMessage:
      'The Windows print service is not running. Please wait for staff assistance.',
    adminMessage: 'Windows Print Spooler service is stopped or unreachable.',
    refundEligible: true,
    systemAction: 'ABORT_AND_REFUND',
    detectionConfidence: 'high',
  },
  SPOOLER_QUEUE_STUCK: {
    layer: 'application',
    severity: 'FATAL',
    userMessage:
      'The print queue did not finish in time. Please wait for staff assistance.',
    adminMessage: 'Spooler job remained non-terminal past the monitor window.',
    refundEligible: true,
    systemAction: 'ABORT_AND_REFUND',
    detectionConfidence: 'medium',
  },
  SPOOLER_QUERY_FAILED: {
    layer: 'application',
    severity: 'WARNING',
    userMessage:
      'The kiosk could not verify the print queue. Staff has been notified.',
    adminMessage: 'Spooler diagnostic query failed repeatedly.',
    refundEligible: true,
    systemAction: 'PAUSE_AND_NOTIFY',
    detectionConfidence: 'high',
  },
  SPOOLER_JOB_FAILED: {
    layer: 'application',
    severity: 'FATAL',
    userMessage:
      'The print job failed in Windows. Please wait for staff assistance.',
    adminMessage: 'Windows spooler reported a terminal job failure.',
    refundEligible: true,
    systemAction: 'ABORT_AND_REFUND',
    detectionConfidence: 'high',
  },
  PRINTER_DRIVER_CORRUPT: {
    layer: 'application',
    severity: 'FATAL',
    userMessage:
      'The printer driver is not working. Please wait for staff assistance.',
    adminMessage: 'Dispatch or diagnostics output indicates driver corruption.',
    refundEligible: true,
    systemAction: 'ABORT_AND_REFUND',
    detectionConfidence: 'medium',
  },
  WRONG_PRINTER_SELECTED: {
    layer: 'application',
    severity: 'FATAL',
    userMessage:
      'The kiosk printer configuration is incorrect. Please wait for staff.',
    adminMessage:
      'Selected printer does not match the configured kiosk printer.',
    refundEligible: false,
    systemAction: 'ABORT_NO_REFUND',
    detectionConfidence: 'high',
  },
  ACCESS_DENIED: {
    layer: 'application',
    severity: 'FATAL',
    userMessage:
      'The kiosk cannot access the printer right now. Please wait for staff.',
    adminMessage: 'Print dispatch failed due to permission or access denial.',
    refundEligible: true,
    systemAction: 'ABORT_AND_REFUND',
    detectionConfidence: 'medium',
  },
  FORMAT_NOT_SUPPORTED: {
    layer: 'application',
    severity: 'FATAL',
    userMessage:
      'This file could not be prepared for printing. Please try another file.',
    adminMessage: 'Dispatch pipeline could not normalize or print the file.',
    refundEligible: false,
    systemAction: 'ABORT_NO_REFUND',
    detectionConfidence: 'medium',
  },
  PAPER_SIZE_MISMATCH: {
    layer: 'application',
    severity: 'FATAL',
    userMessage:
      'The selected paper size does not match the printer setup. Please change paper size.',
    adminMessage: 'Requested paper size conflicts with driver or tray default.',
    refundEligible: false,
    systemAction: 'ABORT_NO_REFUND',
    detectionConfidence: 'medium',
  },
  DUPLEX_UNSUPPORTED: {
    layer: 'application',
    severity: 'RECOVERABLE',
    userMessage:
      'Double-sided printing is not available on this printer. Please choose single-sided.',
    adminMessage:
      'Duplex was requested but printer capabilities do not support it.',
    refundEligible: false,
    systemAction: 'PAUSE_AND_NOTIFY',
    detectionConfidence: 'high',
  },
  COLOR_MODE_MISMATCH: {
    layer: 'application',
    severity: 'RECOVERABLE',
    userMessage:
      'The printer cannot use the selected color setting. Please adjust your print settings.',
    adminMessage: 'Requested color mode conflicts with printer capabilities.',
    refundEligible: false,
    systemAction: 'PAUSE_AND_NOTIFY',
    detectionConfidence: 'medium',
  },
  PAGE_SCALING_RISK: {
    layer: 'application',
    severity: 'WARNING',
    userMessage: 'Some content may be scaled to fit the selected paper size.',
    adminMessage: 'PDF page size differs from selected paper size.',
    refundEligible: false,
    systemAction: 'PAUSE_AND_NOTIFY',
    detectionConfidence: 'low',
  },
  PRINT_PROCESSING_TIMEOUT: {
    layer: 'application',
    severity: 'FATAL',
    userMessage:
      'This file took too long to prepare. Please try a smaller file.',
    adminMessage: 'Print dispatch or conversion exceeded its timeout.',
    refundEligible: false,
    systemAction: 'ABORT_NO_REFUND',
    detectionConfidence: 'high',
  },
  PRINTER_MEMORY_OVERFLOW: {
    layer: 'infrastructure',
    severity: 'FATAL',
    userMessage:
      'The printer could not handle this file. Please wait for staff assistance.',
    adminMessage: 'Printer reported memory overflow or page punt.',
    refundEligible: true,
    systemAction: 'ABORT_AND_REFUND',
    detectionConfidence: 'medium',
  },
  FIRMWARE_FAULT: {
    layer: 'infrastructure',
    severity: 'FATAL',
    userMessage:
      'The printer reported an internal fault. Please wait for staff assistance.',
    adminMessage: 'Printer firmware or device returned an unexpected fault.',
    refundEligible: true,
    systemAction: 'RESET_SESSION',
    detectionConfidence: 'low',
  },
  CONCURRENT_JOB_COLLISION: {
    layer: 'infrastructure',
    severity: 'RECOVERABLE',
    userMessage:
      'Another print job is already in progress. Please wait and try again.',
    adminMessage: 'A second job attempted to enter the printer pipeline.',
    refundEligible: false,
    systemAction: 'RETRY',
    detectionConfidence: 'high',
  },
  USB_PORT_REASSIGNED: {
    layer: 'infrastructure',
    severity: 'WARNING',
    userMessage: 'The printer connection changed. Staff has been notified.',
    adminMessage: 'Printer identity matches but Windows port changed.',
    refundEligible: false,
    systemAction: 'PAUSE_AND_NOTIFY',
    detectionConfidence: 'medium',
  },
  GHOST_PRINTER_DETECTED: {
    layer: 'infrastructure',
    severity: 'WARNING',
    userMessage:
      'Duplicate printer entries were detected. Staff has been notified.',
    adminMessage:
      'Windows reports duplicate or stale printer entries for the kiosk printer.',
    refundEligible: false,
    systemAction: 'PAUSE_AND_NOTIFY',
    detectionConfidence: 'medium',
  },
  DIAGNOSTICS_BRIDGE_FAILED: {
    layer: 'infrastructure',
    severity: 'WARNING',
    userMessage: 'Printer diagnostics are degraded. Staff has been notified.',
    adminMessage: 'Windows diagnostics bridge failed and fallback was needed.',
    refundEligible: false,
    systemAction: 'PAUSE_AND_NOTIFY',
    detectionConfidence: 'high',
  },
  UNKNOWN_PRINTER_FAULT: {
    layer: 'infrastructure',
    severity: 'FATAL',
    userMessage:
      'The printer reported an unknown fault. Please wait for staff assistance.',
    adminMessage: 'Unmapped printer, driver, or spooler fault.',
    refundEligible: true,
    systemAction: 'ABORT_AND_REFUND',
    detectionConfidence: 'low',
  },
};

export const ALL_PRINT_ERROR_CODES = Object.keys(
  PRINT_ERROR_DEFINITIONS,
) as PrintErrorCode[];

function normalizeJobId(
  value: string | number | null | undefined,
): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function statusHas(value: string, token: string): boolean {
  return value.toLowerCase().includes(token.toLowerCase());
}

function rawFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstFailedAttempt(
  result: PrintDispatchResult | null,
): PrintDispatchAttemptResult | null {
  if (!result) return null;
  return (
    result.attempts.find((attempt) => !attempt.success && !attempt.skipped) ??
    result.attempts.find((attempt) => !attempt.success) ??
    null
  );
}

export class PrintErrorClassifier {
  create(code: PrintErrorCode, context: PrintErrorContext): PrintError {
    const definition = PRINT_ERROR_DEFINITIONS[code];
    return {
      code,
      layer: definition.layer,
      severity: definition.severity,
      userMessage: context.userMessage ?? definition.userMessage,
      adminMessage: context.adminMessage ?? definition.adminMessage,
      refundEligible: context.refundEligible ?? definition.refundEligible,
      systemAction: context.systemAction ?? definition.systemAction,
      detectionConfidence:
        context.detectionConfidence ?? definition.detectionConfidence,
      source: context.source,
      raw: context.raw ?? null,
      transactionId: context.transactionId ?? null,
      sessionId: context.sessionId ?? null,
      jobId: normalizeJobId(context.jobId),
      printerName: context.printerName ?? null,
      resolutionStatus: 'open',
      timestamp: new Date().toISOString(),
    };
  }

  classifyPrinterTelemetry(
    telemetry: PrinterTelemetry,
    context: Omit<PrintErrorContext, 'raw'> & {
      raw?: Record<string, unknown> | null;
    },
  ): PrintError | null {
    const flags = telemetry.statusFlags;
    const status = telemetry.status;
    const raw = {
      connected: telemetry.connected,
      status: telemetry.status,
      statusFlags: telemetry.statusFlags.join(','),
      connectionType: telemetry.connectionType,
      driverName: telemetry.driverName,
      portName: telemetry.portName,
      ...(context.raw ?? {}),
    };

    if (flags.includes('Paper Jam') || status === 'Paper Jam') {
      return this.create('PAPER_JAM_PRINT', { ...context, raw });
    }
    if (flags.includes('Paper Out') || status === 'Paper Out') {
      return this.create('PAPER_TRAY_EMPTY', { ...context, raw });
    }
    if (
      flags.includes('Manual Feed Required') ||
      status === 'Manual Feed Required'
    ) {
      return this.create('MANUAL_FEED_REQUIRED', { ...context, raw });
    }
    if (flags.includes('Door Open') || status === 'Door Open') {
      return this.create('PRINTER_DOOR_OPEN', { ...context, raw });
    }
    if (flags.includes('Out of Memory') || flags.includes('Page Punt')) {
      return this.create('PRINTER_MEMORY_OVERFLOW', { ...context, raw });
    }
    if (status === 'Paused' || flags.includes('Paused')) {
      return this.create('PRINTER_PAUSED', { ...context, raw });
    }
    if (!telemetry.connected) {
      if (
        telemetry.connectionType === 'usb' ||
        flags.includes('Device Not Connected')
      ) {
        return this.create('USB_DISCONNECTED', { ...context, raw });
      }
      if (
        telemetry.connectionType === 'network' ||
        telemetry.connectionType === 'wsd'
      ) {
        return this.create('NETWORK_PRINTER_UNREACHABLE', { ...context, raw });
      }
      if (statusHas(status, 'offline')) {
        return this.create('WINDOWS_PRINTER_OFFLINE', { ...context, raw });
      }
      return this.create('PRINTER_POWERED_OFF', {
        ...context,
        raw,
        detectionConfidence: 'low',
      });
    }
    if (status === 'Offline' || flags.includes('Offline')) {
      return this.create('WINDOWS_PRINTER_OFFLINE', { ...context, raw });
    }
    if (status === 'Error' || flags.includes('Error')) {
      return this.create('UNKNOWN_PRINTER_FAULT', { ...context, raw });
    }
    return null;
  }

  classifyInkPreflight(
    evaluation: InkPreflightEvaluation,
    context: PrintErrorContext,
  ): PrintError | null {
    if (evaluation.blocked) {
      const code =
        evaluation.code === 'ink_empty_blocked' ? 'INK_EMPTY' : 'INK_LOW';
      return this.create(code, {
        ...context,
        raw: {
          code: evaluation.code,
          reason: evaluation.reason,
          telemetryAvailable: evaluation.telemetryAvailable,
          lowSupplies: evaluation.lowSupplies
            .map((entry) => entry.name)
            .join(','),
          emptySupplies: evaluation.emptySupplies
            .map((entry) => entry.name)
            .join(','),
          ...(context.raw ?? {}),
        },
        userMessage: evaluation.reason ?? undefined,
      });
    }

    if (evaluation.lowSupplies.length > 0) {
      return this.create('INK_LOW', {
        ...context,
        raw: {
          code: evaluation.code,
          reason: evaluation.reason,
          lowSupplies: evaluation.lowSupplies
            .map((entry) => entry.name)
            .join(','),
          ...(context.raw ?? {}),
        },
      });
    }

    return null;
  }

  classifySpoolerStatus(
    status: string,
    context: PrintErrorContext,
  ): PrintError {
    const normalized = status.toLowerCase();
    if (
      normalized.includes('manual feed') ||
      normalized.includes('manualfeed')
    ) {
      return this.create('MANUAL_FEED_REQUIRED', context);
    }
    if (normalized.includes('paperout')) {
      return this.create('PAPER_TRAY_EMPTY', { ...context, raw: context.raw });
    }
    if (normalized.includes('paper') && normalized.includes('jam')) {
      return this.create('PAPER_JAM_PRINT', { ...context, raw: context.raw });
    }
    if (normalized.includes('offline')) {
      return this.create('WINDOWS_PRINTER_OFFLINE', context);
    }
    if (normalized.includes('paused')) {
      return this.create('PRINTER_PAUSED', context);
    }
    if (normalized.includes('blockeddevq')) {
      return this.create('SPOOLER_QUEUE_STUCK', context);
    }
    if (normalized.includes('userintervention')) {
      return this.create('MANUAL_FEED_REQUIRED', {
        ...context,
        detectionConfidence: 'low',
      });
    }
    return this.create('SPOOLER_JOB_FAILED', context);
  }

  classifyDispatchFailure(
    error: unknown,
    result: PrintDispatchResult | null,
    context: PrintErrorContext,
  ): PrintError {
    const message = error instanceof Error ? error.message : String(error);
    const attempt = firstFailedAttempt(result);
    const combinedOutput = [
      message,
      attempt?.stderr ?? '',
      attempt?.stdout ?? '',
      attempt?.skipReason ?? '',
      result?.failureCode ?? '',
      result?.requiredCapabilities.join(',') ?? '',
    ]
      .join('\n')
      .toLowerCase();

    const baseContext: PrintErrorContext = {
      ...context,
      raw: {
        message,
        failureCode: result?.failureCode ?? null,
        selectedEngine: result?.selectedEngine ?? null,
        requiredCapabilities: result?.requiredCapabilities.join(',') ?? null,
        requestedOptions: result
          ? JSON.stringify(result.requestedOptions)
          : null,
        failedEngine: attempt?.engine ?? null,
        exitCode: attempt?.exitCode ?? null,
        timedOut: attempt?.timedOut ?? null,
        stderrHash: attempt?.stderrHash ?? null,
        ...(context.raw ?? {}),
      },
    };

    if (attempt?.timedOut || combinedOutput.includes('timeout')) {
      return this.create('PRINT_PROCESSING_TIMEOUT', baseContext);
    }
    if (
      combinedOutput.includes('access') &&
      combinedOutput.includes('denied')
    ) {
      return this.create('ACCESS_DENIED', baseContext);
    }
    if (combinedOutput.includes('driver')) {
      return this.create('PRINTER_DRIVER_CORRUPT', baseContext);
    }
    if (
      combinedOutput.includes('memory') ||
      combinedOutput.includes('page punt')
    ) {
      return this.create('PRINTER_MEMORY_OVERFLOW', baseContext);
    }
    if (combinedOutput.includes('paper') && combinedOutput.includes('size')) {
      return this.create('PAPER_SIZE_MISMATCH', baseContext);
    }
    if (result?.failureCode === 'no_capable_engine') {
      if (result.requiredCapabilities.includes('duplex')) {
        return this.create('DUPLEX_UNSUPPORTED', baseContext);
      }
      if (result.requiredCapabilities.includes('grayscale')) {
        return this.create('COLOR_MODE_MISMATCH', baseContext);
      }
      if (result.requiredCapabilities.includes('page-range')) {
        return this.create('FORMAT_NOT_SUPPORTED', baseContext);
      }
      return this.create('FORMAT_NOT_SUPPORTED', baseContext);
    }
    if (
      message.startsWith('Rotation is not supported') ||
      message.startsWith('Failed to convert document for rotation')
    ) {
      return this.create('FORMAT_NOT_SUPPORTED', baseContext);
    }
    return this.create('UNKNOWN_PRINTER_FAULT', baseContext);
  }

  classifyScannerError(error: unknown, context: PrintErrorContext): PrintError {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    const baseContext = {
      ...context,
      raw: { message, ...(context.raw ?? {}) },
    };

    if (
      lower.includes('scanner unavailable') ||
      lower.includes('scanner disconnected') ||
      lower.includes('device unavailable') ||
      lower.includes('device not found') ||
      lower.includes('no scanner')
    ) {
      return this.create('SCANNER_DISCONNECTED', baseContext);
    }
    if (
      lower.includes('no document') ||
      lower.includes('no pages') ||
      lower.includes('no output')
    ) {
      return this.create('SCANNER_NO_DOCUMENT', baseContext);
    }
    if (lower.includes('jam') || lower.includes('adf')) {
      return this.create('SCANNER_ADF_JAM', baseContext);
    }
    if (lower.includes('double') || lower.includes('multi-feed')) {
      return this.create('PAPER_DOUBLE_FEED', baseContext);
    }
    if (lower.includes('skew') || lower.includes('misalign')) {
      return this.create('PAPER_MISALIGNED', baseContext);
    }
    if (lower.includes('partial') || lower.includes('cut')) {
      return this.create('SCAN_PARTIAL_OUTPUT', baseContext);
    }
    return this.create('UNKNOWN_PRINTER_FAULT', {
      ...baseContext,
      detectionConfidence: 'low',
    });
  }

  classifyScanQuality(input: {
    streakScore: number;
    outputPath: string;
    source: string;
  }): PrintError | null {
    if (input.streakScore < 0.68) return null;
    return this.create('SCANNER_GLASS_DIRTY', {
      source: input.source,
      raw: {
        outputPath: input.outputPath,
        streakScore: input.streakScore,
      },
      detectionConfidence: 'low',
    });
  }

  rawFrom(value: unknown): Record<string, unknown> | null {
    return rawFromUnknown(value);
  }
}

export const printErrorClassifier = new PrintErrorClassifier();
