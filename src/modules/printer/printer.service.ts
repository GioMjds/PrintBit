import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { db } from '@/services/db';
import { getPrinterTelemetry } from '@/services';
import { BLOCKED_STATUSES } from '@/utils';
import {
  getPrinterStatusViaEdge,
  pausePrintJobViaEdge,
  resumePrintJobViaEdge,
  type EdgePrinterStatus,
} from '@/services/windows-printer-edge';

const execFileAsync = promisify(execFile);

async function findSpoolerJobIdByCorrelationKey(
  printerName: string,
  spoolerCorrelationKey: string,
): Promise<number | null> {
  try {
    const escapedPrinter = printerName.replace(/'/g, "''").replace(/`/g, '``');
    const escapedCorrelation = spoolerCorrelationKey
      .replace(/'/g, "''")
      .replace(/`/g, '``');
    const script = `Get-PrintJob -PrinterName '${escapedPrinter}' -ErrorAction SilentlyContinue | Where-Object { $_.Document -like '*${escapedCorrelation}*' } | Select-Object -ExpandProperty Id`;

    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 10000 },
    );

    const jobIdStr = stdout.trim();
    if (jobIdStr) {
      const lines = jobIdStr
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        const id = parseInt(line, 10);
        if (Number.isInteger(id)) {
          return id;
        }
      }
    }
  } catch (error) {
    console.error(
      `[PRINTER-SERVICE] Failed to query spooler job ID via PowerShell:`,
      error,
    );
  }
  return null;
}

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

  async preDispatchCheck(
    printerName: string | null,
  ): Promise<PrintError | null> {
    const targetPrinter = printerName?.trim() || getPrinterTelemetry().name;
    if (!targetPrinter) {
      return {
        code: 'PRINTER_NOT_FOUND',
        severity: 'fatal',
        userMessage: 'Printer not found or not configured.',
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const edgeStatus = await getPrinterStatusViaEdge(targetPrinter);
      if ('error' in edgeStatus) {
        return {
          code: 'PRINTER_QUERY_FAILED',
          severity: 'fatal',
          userMessage: 'Could not query printer status.',
          hint: edgeStatus.error,
          timestamp: new Date().toISOString(),
        };
      }
      const err = this.mapEdgeStatusToPrintError(edgeStatus);
      if (err) return err;
    } catch (error) {
      console.warn(
        `[PRINTER] Edge preflight query failed, fallback to local cache:`,
        error instanceof Error ? error.message : String(error),
      );
    }

    const telemetry = getPrinterTelemetry();
    if (!telemetry.connected) {
      return {
        code: 'PRINTER_OFFLINE',
        severity: 'fatal',
        userMessage: 'The printer is offline. Please check the connection.',
        timestamp: new Date().toISOString(),
      };
    }

    const blocked = BLOCKED_STATUSES.has(telemetry.status);
    if (blocked) {
      return {
        code: 'PRINTER_BLOCKED_STATE',
        severity: 'fatal',
        userMessage: `Printer is blocked: ${telemetry.status}`,
        timestamp: new Date().toISOString(),
      };
    }

    return null;
  }

  private mapEdgeStatusToPrintError(
    status: EdgePrinterStatus,
  ): PrintError | null {
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
        userMessage:
          'Paper problem detected — the printer may not have enough paper.',
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

  private async findSpoolerJobDetails(spoolerCorrelationKey: string): Promise<{
    printerName: string;
    spoolerJobId: number;
  }> {
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

    let printerName = record.printerName;
    if (!printerName) {
      const telemetry = getPrinterTelemetry();
      if (telemetry.name) {
        printerName = telemetry.name;
        record.printerName = printerName;
      }
    }

    if (!printerName) {
      throw new Error(
        `Missing printerName in spooler details for key: ${spoolerCorrelationKey}`,
      );
    }

    let spoolerJobId = record.spoolerJobId;
    if (spoolerJobId == null) {
      console.log(
        `[PRINTER-SERVICE] spoolerJobId is missing for key ${spoolerCorrelationKey}. Attempting to resolve via Get-PrintJob...`,
      );
      spoolerJobId = await findSpoolerJobIdByCorrelationKey(
        printerName,
        spoolerCorrelationKey,
      );
      if (spoolerJobId !== null) {
        console.log(
          `[PRINTER-SERVICE] Resolved spoolerJobId: ${spoolerJobId} for key ${spoolerCorrelationKey}`,
        );
        record.spoolerJobId = spoolerJobId;
        await db.write();
      }
    }

    if (spoolerJobId == null) {
      throw new Error(
        'Incomplete spooler details (missing printerName or spoolerJobId)',
      );
    }

    return {
      printerName,
      spoolerJobId,
    };
  }

  async pauseJob(spoolerCorrelationKey: string): Promise<void> {
    const { printerName, spoolerJobId } = await this.findSpoolerJobDetails(
      spoolerCorrelationKey,
    );
    console.log(
      `[PRINTER] Pausing job #${spoolerJobId} on ${printerName} via edge-js`,
    );
    const result = await pausePrintJobViaEdge(printerName, spoolerJobId);
    if (!result.success) {
      throw new Error(result.error ?? 'Unknown pause failure');
    }
  }

  async resumeJob(spoolerCorrelationKey: string): Promise<void> {
    const { printerName, spoolerJobId } = await this.findSpoolerJobDetails(
      spoolerCorrelationKey,
    );
    console.log(
      `[PRINTER] Resuming job #${spoolerJobId} on ${printerName} via edge-js`,
    );
    const result = await resumePrintJobViaEdge(printerName, spoolerJobId);
    if (!result.success) {
      throw new Error(result.error ?? 'Unknown resume failure');
    }
  }
}
