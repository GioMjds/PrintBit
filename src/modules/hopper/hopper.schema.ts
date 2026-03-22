/**
 * Hopper module schemas and types.
 */
import type { LogMeta, TrustedTimestampMeta } from '@/core/database/shared.schema';

export type { LogMeta, TrustedTimestampMeta };

export interface HopperSettings {
  enabled: boolean;
  timeoutMs: number;
  retryCount: number;
  dispenseCommandPrefix: string;
  selfTestCommand: string;
}

export interface HopperStats {
  dispenseAttempts: number;
  dispenseSuccess: number;
  dispenseFailures: number;
  totalDispensed: number;
  lastDispensedAt: string | null;
  lastError: string | null;
  selfTestPassed: boolean | null;
  lastSelfTestAt: string | null;
}

export interface OwedChangeEntry {
  id: string;
  timestamp: string;
  timestampMeta?: TrustedTimestampMeta;
  amount: number;
  reason: string;
  status: 'open' | 'resolved';
  meta?: LogMeta;
}
