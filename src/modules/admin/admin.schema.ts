/**
 * Admin module schemas and types.
 */
import type {
  LogMeta,
  TrustedTimestampMeta,
  SupportedLanguage,
  PrintMode,
  ColorMode,
} from '@/core/database/shared.schema';

export type { LogMeta, TrustedTimestampMeta, SupportedLanguage, PrintMode, ColorMode };

export type AdminLockout = {
  failedAttempts: number;
  lockedUntil: string | null;
};

export interface PricingSettings {
  printPerPage: number;
  copyPerPage: number;
  scanDocument: number;
  colorSurcharge: number;
}

export type InkTelemetryUnknownPolicy = 'warn_allow' | 'block';

export interface InkMonitoringSettings {
  enabled: boolean;
  targetPrinterName: string | null;
  lowThresholdPercent: number;
  criticalThresholdPercent: number;
  blockOnLow: boolean;
  blockOnEmpty: boolean;
  telemetryUnknownPolicy: InkTelemetryUnknownPolicy;
}

export interface KioskPreferences {
  language: SupportedLanguage;
  highContrast: boolean;
}

export type AlertChannel = 'dashboard' | 'email';
export type AnomalySeverity = 'warning' | 'critical';
export type AnomalyStatus = 'open' | 'acknowledged' | 'resolved';
export type AnomalyCategory =
  | 'printer'
  | 'spooler'
  | 'serial'
  | 'hopper'
  | 'network'
  | 'security';

export interface AlertDashboardSettings {
  enabled: boolean;
}

export interface AlertEmailSettings {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  secure: boolean;
  username: string;
  from: string;
  to: string;
}

export interface AlertDedupeSettings {
  printerMs: number;
  spoolerMs: number;
  serialMs: number;
  hopperMs: number;
  networkMs: number;
  securityMs: number;
}

export interface AlertSettings {
  severityThreshold: AnomalySeverity;
  dashboard: AlertDashboardSettings;
  email: AlertEmailSettings;
  dedupe: AlertDedupeSettings;
}

export interface AdminSettings {
  pricing: PricingSettings;
  idleTimeoutSeconds: number;
  adminPin: string;
  adminLocalOnly: boolean;
  kioskPreferences: KioskPreferences;
  alerts: AlertSettings;
  inkMonitoring: InkMonitoringSettings;
}

export interface AdminLogEntry {
  id: string;
  timestamp: string;
  timestampMeta?: TrustedTimestampMeta;
  type: string;
  message: string;
  meta?: LogMeta;
}
