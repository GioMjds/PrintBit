import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  getAdapter,
  getScannerStatus,
  type ScannerCapabilities,
  type ScannerRuntimeStatus,
} from '@/services/scanner';
import {
  createScanDownloadLink,
  resolveScanDownload,
  type ScanDownloadLink,
} from '@/services/scan-delivery';
import {
  exportScanToUsbDrive,
  listRemovableDrives,
  type RemovableDrive,
} from '@/services/usb-drives';
import { detectPdfColorContent } from '@/services/color-detection';
import { jobStore, type ScanJobSettings } from '@/services/job-store';
import { adminService } from '@/services/admin';
import { db } from '@/services/db';
import { settlementService } from '@/services';
import { financialLedgerService } from '@/services/financial-ledger';
import {
  assertTrustedTimeForFinancialOperation,
  isTrustedTimeError,
} from '@/services/time-source';
import type { Server as SocketIOServer } from 'socket.io';

const VALID_SOURCES = new Set(['adf', 'flatbed']);
const VALID_DPI = new Set([150, 300, 600]);
const VALID_COLOR_MODES = new Set(['colored', 'grayscale']);
const VALID_FORMATS = new Set(['pdf', 'jpg', 'png']);

const FORMAT_CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

const CHARGED_SCAN_TTL_MS = 30 * 60 * 1000;

type ScannerPageSource = 'feeder' | 'glass';
type ScannerPageColor = 'color' | 'grayscale';

export interface ScannerStatusResponse {
  connected: boolean;
  name?: string;
  driver: string;
  preferredName: string;
  sources: string[];
  colorModes: string[];
  dpiOptions: number[];
  duplex: boolean;
  preflight: ScannerRuntimeStatus['preflight'];
  error?: string;
}

export interface InteractiveScanInput {
  source: ScannerPageSource;
  color: ScannerPageColor;
  dpi: string | number;
}

export interface InteractiveScanResult {
  pages: string[];
  filename: string;
  pageCount: number;
}

export interface SoftCopyChargeInput {
  filename: string;
  io: SocketIOServer;
}

export interface SoftCopyChargeResult {
  ok: boolean;
  charged: boolean;
  alreadyPaid: boolean;
  requiredAmount: number;
  amount: number;
  balance: number;
  change?: {
    state: string;
    requested: number;
    dispensed: number;
  };
}

export interface UsbExportResult {
  ok: boolean;
  drive: string;
  exportPath: string;
}

export interface ScanJobInput {
  source: string;
  dpi: number;
  colorMode: string;
  duplex: boolean;
  format: string;
}

export interface ColorAnalysisResult {
  hasColor: boolean;
  isGrayscale: boolean;
  sampledPages: number;
}

export interface ScanFileReleaseResult {
  deleted: boolean;
  alreadyMissing: boolean;
  filePath: string;
}

export class ScannerService {
  private readonly chargedScanFiles = new Map<string, number>();

  toSafeScanFilename(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const safe = path.basename(trimmed);
    return safe === trimmed ? safe : null;
  }

  getContentType(ext: string): string {
    return FORMAT_CONTENT_TYPES[ext.toLowerCase()] ?? 'application/octet-stream';
  }

  private toScanSource(source: ScannerPageSource): 'flatbed' | 'adf' {
    return source === 'feeder' ? 'adf' : 'flatbed';
  }

  private toColorMode(color: ScannerPageColor): 'colored' | 'grayscale' {
    return color === 'grayscale' ? 'grayscale' : 'colored';
  }

  private markSoftCopyPaid(filename: string): void {
    this.chargedScanFiles.set(filename, Date.now() + CHARGED_SCAN_TTL_MS);
  }

  clearSoftCopyPaid(filename: string): void {
    this.chargedScanFiles.delete(filename);
  }

  private isSoftCopyPaid(filename: string): boolean {
    const expiresAt = this.chargedScanFiles.get(filename);
    if (!expiresAt) return false;
    if (expiresAt <= Date.now()) {
      this.chargedScanFiles.delete(filename);
      return false;
    }
    return true;
  }

  private mapCapabilitiesForUi(caps: ScannerCapabilities | null): {
    sources: string[];
    colorModes: string[];
    dpiOptions: number[];
    duplex: boolean;
  } {
    if (!caps) {
      return {
        sources: [],
        colorModes: [],
        dpiOptions: [150, 300, 600],
        duplex: false,
      };
    }
    return {
      sources: caps.sources,
      colorModes: caps.colorModes,
      dpiOptions: caps.dpiOptions,
      duplex: caps.duplex,
    };
  }

  async getStatus(): Promise<ScannerStatusResponse> {
    const runtime = getScannerStatus();
    const probeCaps = await getAdapter()
      .probe()
      .catch(() => null);
    const capabilities = this.mapCapabilitiesForUi(
      probeCaps ?? runtime.capabilities,
    );

    const connected =
      runtime.adapter === 'naps2' && Boolean(probeCaps?.available);
    const error = connected
      ? undefined
      : (runtime.lastError ??
        'Scanner unavailable. Check Epson driver, NAPS2 installation, and USB connection.');

    return {
      connected,
      name: connected ? runtime.deviceName ?? undefined : undefined,
      driver: runtime.driver,
      preferredName: runtime.preferredName,
      sources: capabilities.sources,
      colorModes: capabilities.colorModes,
      dpiOptions: capabilities.dpiOptions,
      duplex: capabilities.duplex,
      preflight: runtime.preflight,
      error,
    };
  }

  async interactiveScan(input: InteractiveScanInput): Promise<InteractiveScanResult> {
    const { source, color, dpi } = input;

    const runtime = getScannerStatus();
    if (runtime.adapter !== 'naps2') {
      throw new Error(
        runtime.lastError ??
          'No scanner device is currently available. Please check your Epson scanner connection.',
      );
    }

    if (!source || (source !== 'feeder' && source !== 'glass')) {
      throw new Error('Invalid source. Accepted: "feeder", "glass"');
    }
    if (!color || (color !== 'color' && color !== 'grayscale')) {
      throw new Error('Invalid color. Accepted: "color", "grayscale"');
    }

    const safeDpi =
      typeof dpi === 'number'
        ? dpi
        : typeof dpi === 'string'
          ? Number(dpi)
          : NaN;
    if (!VALID_DPI.has(safeDpi)) {
      throw new Error('Invalid dpi. Accepted: 150, 300, 600');
    }

    const settings = {
      source: this.toScanSource(source),
      dpi: safeDpi,
      colorMode: this.toColorMode(color),
      duplex: false,
      format: 'jpg' as const,
    };

    const result = await getAdapter().scan(settings, 'uploads/scans');
    const filename = path.basename(result.outputPath);
    this.clearSoftCopyPaid(filename);

    void adminService.appendAdminLog(
      'scan_completed',
      'Interactive scan completed.',
      {
        source: settings.source,
        dpi: settings.dpi,
        colorMode: settings.colorMode,
        filename,
      },
    );

    await adminService.incrementJobStats('scan');

    return {
      pages: [`/api/scan/preview/${encodeURIComponent(filename)}`],
      filename,
      pageCount: result.pageCount,
    };
  }

  async chargeSoftCopy(input: SoftCopyChargeInput): Promise<SoftCopyChargeResult> {
    const { filename, io } = input;

    const sourcePath = path.resolve('uploads', 'scans', filename);
    if (!fs.existsSync(sourcePath)) {
      throw new Error('Scanned file not found.');
    }

    const requiredAmount = adminService.getPricingSettings().scanDocument;

    if (requiredAmount <= 0 || this.isSoftCopyPaid(filename)) {
      return {
        ok: true,
        charged: false,
        alreadyPaid: true,
        requiredAmount,
        amount: 0,
        balance: db.data!.balance,
      };
    }

    try {
      assertTrustedTimeForFinancialOperation('scan_soft_copy_charge');
    } catch (error) {
      if (isTrustedTimeError(error)) {
        throw {
          code: error.code,
          error: `Scan soft-copy charging is temporarily unavailable: ${error.trustedTime.detail}`,
          trustedTime: {
            operation: error.operation,
            source: error.trustedTime.source,
            synced: error.trustedTime.synced,
            offsetMs: error.trustedTime.offsetMs,
            driftExceeded: error.trustedTime.driftExceeded,
            maxDriftMs: error.trustedTime.maxDriftMs,
            detail: error.trustedTime.detail,
            checkedAt: error.trustedTime.checkedAt,
            ntpSource: error.trustedTime.ntpSource,
          },
          isTrustedTimeError: true,
        };
      }
      throw {
        code: 'TRUSTED_TIME_UNAVAILABLE',
        error:
          'Scan soft-copy charging is temporarily unavailable because trusted time is not synchronized.',
        isTrustedTimeError: true,
      };
    }

    await financialLedgerService.append({
      eventType: 'job_started',
      amount: requiredAmount,
      referenceId: filename,
      meta: {
        mode: 'scan',
        filename,
      },
    });

    const settlement = await settlementService.settle({
      requiredAmount,
      io,
      jobContext: { mode: 'scan', filename },
    });

    if (!settlement.ok) {
      await adminService.appendAdminLog(
        'scan_soft_copy_charge_failed',
        'Failed to charge for soft copy access.',
        {
          filename,
          requiredAmount,
          balance: settlement.remainingBalance,
        },
      );

      const shortFall = Math.max(
        requiredAmount - settlement.remainingBalance,
        0,
      );

      throw {
        code: 'INSUFFICIENT_BALANCE',
        error: `Insufficient balance. Please add ₱${shortFall} to access this scan.`,
        requiredAmount,
        balance: settlement.remainingBalance,
      };
    }

    this.markSoftCopyPaid(filename);
    await financialLedgerService.append({
      eventType: 'job_completed',
      amount: settlement.chargedAmount,
      referenceId: filename,
      meta: {
        mode: 'scan',
        filename,
        changeState: settlement.change.state,
        changeRequested: settlement.change.requested,
        changeDispensed: settlement.change.dispensed,
      },
    });

    void adminService
      .appendAdminLog('scan_soft_copy_charged', 'Soft copy access charged.', {
        filename,
        amount: settlement.chargedAmount,
        requiredAmount,
        balance: settlement.remainingBalance,
        changeState: settlement.change.state,
        changeRequested: settlement.change.requested,
        changeDispensed: settlement.change.dispensed,
      })
      .catch(() => {});

    if (settlement.change.state === 'failed') {
      void adminService
        .appendAdminLog(
          'hopper_dispense_failed',
          'Coin change dispense failed after scan soft-copy charge.',
          {
            filename,
            requested: settlement.change.requested,
            dispensed: settlement.change.dispensed,
            attempts: settlement.change.attempts ?? 0,
            owedChangeId: settlement.change.owedChangeId ?? null,
            message: settlement.change.message ?? null,
          },
        )
        .catch(() => {});
    }

    return {
      ok: true,
      charged: true,
      alreadyPaid: false,
      requiredAmount,
      amount: settlement.chargedAmount,
      balance: settlement.remainingBalance,
      change: settlement.change,
    };
  }

  async listRemovableDrives(): Promise<RemovableDrive[]> {
    return listRemovableDrives();
  }

  async exportToUsb(filename: string, drive: string): Promise<UsbExportResult> {
    const sourcePath = path.resolve('uploads', 'scans', filename);
    if (!fs.existsSync(sourcePath)) {
      throw new Error('Scanned file not found.');
    }

    const exported = await exportScanToUsbDrive(sourcePath, drive);
    await adminService.appendAdminLog(
      'scan_usb_exported',
      'Scanned file exported to USB.',
      {
        filename,
        drive: exported.drive,
        exportPath: exported.exportPath,
      },
    );

    return {
      ok: true,
      drive: exported.drive,
      exportPath: exported.exportPath,
    };
  }

  createWirelessLink(filename: string, publicBaseUrl: URL): ScanDownloadLink {
    const sourcePath = path.resolve('uploads', 'scans', filename);
    if (!fs.existsSync(sourcePath)) {
      throw new Error('Scanned file not found.');
    }

    const link = createScanDownloadLink(sourcePath, publicBaseUrl);
    void adminService.appendAdminLog(
      'scan_wireless_link_created',
      'Wireless scan download link created.',
      {
        filename,
        expiresAt: link.expiresAt,
      },
    );

    return link;
  }

  resolveDownload(token: string): { filePath: string; filename: string } | null {
    const session = resolveScanDownload(token);
    if (!session) return null;
    return { filePath: session.filePath, filename: session.filename };
  }

  validateScanJobInput(input: ScanJobInput): ScanJobSettings {
    const { source, dpi, colorMode, duplex, format } = input;

    if (!source || !VALID_SOURCES.has(source)) {
      throw new Error('Invalid source. Accepted: "adf", "flatbed"');
    }
    if (typeof dpi !== 'number' || !VALID_DPI.has(dpi)) {
      throw new Error('Invalid dpi. Accepted: 150, 300, 600');
    }
    if (!colorMode || !VALID_COLOR_MODES.has(colorMode)) {
      throw new Error('Invalid colorMode. Accepted: "colored", "grayscale"');
    }
    if (typeof duplex !== 'boolean') {
      throw new Error('duplex must be a boolean');
    }
    if (!format || !VALID_FORMATS.has(format)) {
      throw new Error('Invalid format. Accepted: "pdf", "jpg", "png"');
    }

    return {
      source: source as 'adf' | 'flatbed',
      dpi,
      colorMode: colorMode as 'colored' | 'grayscale',
      duplex,
      format: format as 'pdf' | 'jpg' | 'png',
    };
  }

  async createScanJob(settings: ScanJobSettings) {
    const job = jobStore.createScanJob(settings);

    void adminService.appendAdminLog('scan_job_created', 'Scan job created.', {
      jobId: job.id,
      source: settings.source,
      dpi: settings.dpi,
      colorMode: settings.colorMode,
      format: settings.format,
    });

    // Start scan asynchronously
    void (async () => {
      jobStore.updateJobState(job.id, 'running');
      try {
        const result = await getAdapter().scan(settings, 'uploads/scans');
        jobStore.updateJobState(job.id, 'succeeded', {
          resultPath: result.outputPath,
        });
        await adminService.incrementJobStats('scan');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        jobStore.updateJobState(job.id, 'failed', {
          failure: {
            code: 'SCAN_ERROR',
            message,
            retryable: true,
            stage: 'running',
          },
        });
      }
    })();

    return job;
  }

  getJob(jobId: string) {
    return jobStore.getJob(jobId);
  }

  getJobResultPath(jobId: string): { absPath: string; format: string } | null {
    const job = jobStore.getJob(jobId);
    if (!job || job.type !== 'scan') return null;
    if (job.state !== 'succeeded' || !job.resultPath) return null;

    const absPath = path.resolve(job.resultPath);
    if (!fs.existsSync(absPath)) return null;

    return { absPath, format: job.settings.format };
  }

  async previewScan(): Promise<{
    detected: boolean;
    previewPath?: string;
    pageCount?: number;
    error?: string;
  }> {
    console.log('[SCAN-PREVIEW] Starting copy pre-scan (300 DPI color)…');

    const previewSettings = {
      source: 'flatbed' as const,
      dpi: 300,
      colorMode: 'colored' as const,
      duplex: false,
      format: 'pdf' as const,
    };

    try {
      const result = await getAdapter().scan(previewSettings, 'uploads/scans');

      const absPath = path.resolve(result.outputPath);
      const stat = fs.statSync(absPath);
      console.log(
        `[SCAN-PREVIEW] ✓ Preview scan complete: ${absPath} (${stat.size} bytes)`,
      );

      const filename = path.basename(result.outputPath);
      this.clearSoftCopyPaid(filename);

      return {
        detected: true,
        previewPath: filename,
        pageCount: result.pageCount,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[SCAN-PREVIEW] ✗ Preview scan failed: ${message}`);

      void adminService.appendAdminLog('scan_preview_failed', 'Preview scan failed.', {
        error: message,
      });

      return {
        detected: false,
        error:
          'No document detected. Place your document face-down on the scanner glass and try again.',
      };
    }
  }

  getPreviewPath(filename: string): string | null {
    const absPath = path.resolve('uploads', 'scans', filename);
    if (!fs.existsSync(absPath)) return null;
    return absPath;
  }

  async releaseScanFile(filename: string): Promise<ScanFileReleaseResult> {
    const safeFilename = this.toSafeScanFilename(filename);
    if (!safeFilename) {
      throw new Error('Invalid filename.');
    }

    const filePath = path.resolve('uploads', 'scans', safeFilename);
    try {
      await fs.promises.unlink(filePath);
      return {
        deleted: true,
        alreadyMissing: false,
        filePath,
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return {
          deleted: true,
          alreadyMissing: true,
          filePath,
        };
      }
      throw new Error(
        `Failed to release scan file: ${err.message ?? 'Unknown error'}`,
      );
    }
  }

  async analyzeColor(filename: string): Promise<ColorAnalysisResult> {
    const absPath = path.resolve('uploads', 'scans', filename);

    if (!fs.existsSync(absPath)) {
      return { hasColor: true, isGrayscale: false, sampledPages: 0 };
    }

    try {
      const result = await detectPdfColorContent(absPath);
      return {
        hasColor: result.hasColor,
        isGrayscale: !result.hasColor,
        sampledPages: result.sampledPages,
      };
    } catch {
      return { hasColor: true, isGrayscale: false, sampledPages: 0 };
    }
  }

  cancelJob(jobId: string): boolean {
    const job = jobStore.getJob(jobId);
    if (!job) return false;

    const cancelled = jobStore.requestCancel(job.id);
    if (!cancelled) return false;

    getAdapter().cancel();
    return true;
  }
}
