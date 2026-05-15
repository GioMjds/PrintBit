import type {
  LogMeta,
  TrustedTimestampMeta,
  SupportedLanguage,
  PrintMode,
  ColorMode,
} from '@/core/database/shared.schema';

export type {
  LogMeta,
  TrustedTimestampMeta,
  SupportedLanguage,
  PrintMode,
  ColorMode,
};

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

export type PricingEngineMode = 'legacy' | 'shadow' | 'live';
export type PricingEngineBlankPagePolicy =
  | 'charge_zero'
  | 'charge_bw'
  | 'charge_color';

export interface PricingEnginePaperProfile {
  baseBwPrice: number;
  baseColorPrice: number;
}

export interface PricingEngineBulkDiscountTier {
  minPages: number;
  maxPages?: number;
  discountPerPage: number;
}

export interface PricingEngineSettings {
  enabledMode: PricingEngineMode;
  paperProfiles: {
    a4: PricingEnginePaperProfile;
    shortBond: PricingEnginePaperProfile;
    longBond: PricingEnginePaperProfile;
  };
  thresholds: {
    bwMax: number;
    fullColorMin: number;
  };
  /**
   * Multipliers for each decile (10% increments).
   * Index 0 = 1-10%, Index 1 = 11-20%, ..., Index 9 = 91-100%
   * Values are typically between 0.0 and 1.0, where 1.0 means full color price.
   */
  decileSurcharges?: number[];
  /**
   * Proximity threshold for "Smart Suggestions" (0.0 to 1.0).
   * If a page is within this range of the next (lower) tier, suggest optimization.
   */
  suggestionThreshold?: number;
  nearBlackBwMax?: number;
  colorMultiplier: number;
  blankPagePolicy: PricingEngineBlankPagePolicy;
  bulkDiscountTiers: PricingEngineBulkDiscountTier[];
  rounding: 'whole_peso_total_only';
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

export interface ConsumablesForecastingSettings {
  enabled: boolean;
  rollingWindowDays: number;
  alertDaysThreshold: number;
  paperTrayCapacitySheets: number;
  paperCurrentSheets: number;
  paperRefillUpdatedAt: string | null;
}

export interface ConsumableEstimationCoefficients {
  bwBlack: number;
  colorCyan: number;
  colorMagenta: number;
  colorYellow: number;
  colorBlack: number;
}

export interface ConsumableEstimationSettings {
  defaultCoefficients: ConsumableEstimationCoefficients;
  printerOverrides: Record<string, Partial<ConsumableEstimationCoefficients>>;
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
  pricingEngine: PricingEngineSettings;
  idleTimeoutSeconds: number;
  adminPin: string;
  adminLocalOnly: boolean;
  kioskPreferences: KioskPreferences;
  alerts: AlertSettings;
  inkMonitoring: InkMonitoringSettings;
  consumablesForecasting: ConsumablesForecastingSettings;
  consumableEstimation: ConsumableEstimationSettings;
}

export interface AdminLogEntry {
  id: string;
  timestamp: string;
  timestampMeta?: TrustedTimestampMeta;
  type: string;
  message: string;
  meta?: LogMeta;
}
