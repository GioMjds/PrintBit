import type { LogMeta } from './common';

export interface OwedChangeEntry {
  id: string;
  timestamp: string;
  amount: number;
  reason: string;
  status: 'open' | 'resolved';
  meta?: LogMeta;
}

export interface AdminLogEntry {
  id: string;
  timestamp: string;
  type: string;
  message: string;
  meta?: LogMeta;
}

export interface PendingRefundEntry {
  id: string;
  timestamp: string;
  chargedAmount: number;
  reason: string;
  status: 'open' | 'refunded' | 'dismissed';
  closedAt: string | null;
  jobContext: Record<string, string | number | boolean | null>;
}
