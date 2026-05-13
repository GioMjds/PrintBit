import { db } from '@/services/db';
import { getPrinterTelemetry } from '@/services';
import { BLOCKED_STATUSES } from '@/utils';
import {
  getPrinterStatusViaEdge,
  pausePrintJobViaEdge,
  resumePrintJobViaEdge,
  type EdgePrinterStatus,
} from '@/services/windows-printer-edge';

export interface PrinterStatusResponse {
  ready: boolean;
  blocked: boolean;
  connected: boolean;
  status: string;
  statusFlags: string[];
  printerName: string | null;
  inkDetectionMethod: string | null;
  inkTelemetryAvailable: boolean;
  inkTelemetryReason: string | null;
  lastCheckedAt: string | null;
}

export interface PrintError {
  code: string;
  severity: 'warning' | 'recoverable' | 'fatal';
  userMessage: string;
  hint?: string;
  timestamp: string;
  canRetry?: boolean;
  canDismiss?: boolean;
}

export class PrinterService {
  getStatusResponse(): PrinterStatusResponse {
    const telemetry = getPrinterTelemetry();
    const blocked =
      !telemetry.connected || BLOCKED_STATUSES.has(telemetry.status);

    return {
      ready: !blocked,
      blocked,
      connected: telemetry.connected,
      status: telemetry.status,
      statusFlags: telemetry.statusFlags,
      printerName: telemetry.name,
      inkDetectionMethod: telemetry.inkDetectionMethod,
      inkTelemetryAvailable: telemetry.inkTelemetryAvailable ?? false,
      inkTelemetryReason: telemetry.inkTelemetryReason ?? null,
      lastCheckedAt: telemetry.lastCheckedAt,
    };
  }

  /**
   * Queries the live printer queue status via the edge-js System.Printing
   * bridge and returns a PrintError if a blocking condition is detected,
   * or null if the printer is healthy.
   */
  async preDispatchCheck(printerName?: string | null): Promise<PrintError | null> {
    const name = printerName ?? getPrinterTelemetry().name;
    if (!name) {
      return {
        code: 'PRINTER_NOT_FOUND',
        severity: 'fatal',
        userMessage: 'No printer configured or detected.',
        hint: 'Please check your printer connection.',
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const result = await getPrinterStatusViaEdge(name);
      if ('error' in result) {
        return {
          code: 'PRINTER_QUERY_FAILED',
          severity: 'fatal',
          userMessage: 'Could not query printer status.',
          hint: result.error,
          timestamp: new Date().toISOString(),
        };
      }

      return this.classifyPrinterStatus(result);
    } catch (error) {
      console.error('[PRINTER_SVC] edge-js preDispatchCheck failed:', error);
      return {
        code: 'PRINTER_QUERY_FAILED',
        severity: 'fatal',
        userMessage: 'Printer status check failed.',
        hint: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Maps System.Printing boolean flags to a structured PrintError.
   * Returns null when the printer is in a healthy state.
   */
  private classifyPrinterStatus(status: EdgePrinterStatus): PrintError | null {
    const now = new Date().toISOString();

    if (status.isOffline) {
      return {
        code: 'PRINTER_OFFLINE',
        severity: 'fatal',
        userMessage: 'Printer is offline.',
        hint: 'Please check the printer power and connection cables.',
        timestamp: now,
      };
    }

    if (status.isPaperJam) {
      return {
        code: 'PAPER_JAM_PRINT',
        severity: 'recoverable',
        userMessage: 'Paper jam detected in the printer.',
        hint: 'Please clear the jammed paper and close all covers.',
        timestamp: now,
        canRetry: true,
      };
    }

    if (status.isOutOfPaper) {
      return {
        code: 'PAPER_TRAY_EMPTY',
        severity: 'recoverable',
        userMessage: 'The printer is out of paper.',
        hint: 'Please load paper into the rear tray, then press Resume.',
        timestamp: now,
        canRetry: true,
      };
    }

    if (status.isPaperProblem) {
      return {
        code: 'PAPER_INSUFFICIENT_PRE_DISPATCH',
        severity: 'recoverable',
        userMessage: 'Paper problem detected — the printer may not have enough paper.',
        hint: 'Please check the paper tray. You can pause and resume once ready.',
        timestamp: now,
        canRetry: true,
      };
    }

    if (status.isNoToner) {
      return {
        code: 'INK_DEPLETED',
        severity: 'fatal',
        userMessage: 'Ink or toner is depleted.',
        hint: 'The printer needs ink/toner replacement before it can print.',
        timestamp: now,
      };
    }

    if (status.isLowOnToner) {
      return {
        code: 'INK_LOW',
        severity: 'warning',
        userMessage: 'Ink or toner is running low.',
        hint: 'Printing may still work but quality could be reduced.',
        timestamp: now,
        canDismiss: true,
      };
    }

    if (status.isDoorOpened) {
      return {
        code: 'PRINTER_DOOR_OPEN',
        severity: 'recoverable',
        userMessage: 'Printer door or cover is open.',
        hint: 'Please close all printer covers and try again.',
        timestamp: now,
        canRetry: true,
      };
    }

    if (status.isOutputBinFull) {
      return {
        code: 'OUTPUT_BIN_FULL',
        severity: 'recoverable',
        userMessage: 'The printer output tray is full.',
        hint: 'Please remove printed pages from the output tray.',
        timestamp: now,
        canRetry: true,
      };
    }

    if (status.isManualFeedRequired) {
      return {
        code: 'MANUAL_FEED_REQUIRED',
        severity: 'recoverable',
        userMessage: 'Manual paper feed is required.',
        hint: 'Please insert paper manually into the feed tray.',
        timestamp: now,
        canRetry: true,
      };
    }

    return null;
  }

  // ── Spooler job control (pause / resume) ──────────────────────

  private findSpoolerJobDetails(spoolerCorrelationKey: string): {
    printerName: string;
    spoolerJobId: number;
  } {
    if (!db.data || !db.data.spoolerLifecycle) {
      throw new Error('Database or spoolerLifecycle not initialized');
    }
    const record = db.data.spoolerLifecycle.find(
      (r) => r.spoolerCorrelationKey === spoolerCorrelationKey,
    );
    if (!record) {
      throw new Error(
        `No spooler lifecycle record found for key: ${spoolerCorrelationKey}`,
      );
    }
    if (!record.printerName || record.spoolerJobId == null) {
      throw new Error(
        'Incomplete spooler details (missing printerName or spoolerJobId)',
      );
    }
    return {
      printerName: record.printerName,
      spoolerJobId: record.spoolerJobId,
    };
  }

  async pauseJob(spoolerCorrelationKey: string): Promise<void> {
    const { printerName, spoolerJobId } =
      this.findSpoolerJobDetails(spoolerCorrelationKey);
    console.log(
      `[PRINTER] Pausing job #${spoolerJobId} on ${printerName} via edge-js`,
    );
    const result = await pausePrintJobViaEdge(printerName, spoolerJobId);
    if (!result.success) {
      throw new Error(result.error ?? 'Unknown pause failure');
    }
  }

  async resumeJob(spoolerCorrelationKey: string): Promise<void> {
    const { printerName, spoolerJobId } =
      this.findSpoolerJobDetails(spoolerCorrelationKey);
    console.log(
      `[PRINTER] Resuming job #${spoolerJobId} on ${printerName} via edge-js`,
    );
    const result = await resumePrintJobViaEdge(printerName, spoolerJobId);
    if (!result.success) {
      throw new Error(result.error ?? 'Unknown resume failure');
    }
  }
}
