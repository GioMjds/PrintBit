import { getPrinterTelemetry } from '@/services';
import { BLOCKED_STATUSES } from '@/utils';

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
}
