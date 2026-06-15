import { LogMeta } from '../shared.schema';

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

export interface AnomalyIncidentEntry {
  id: string;
  type: string;
  source: string;
  category: AnomalyCategory;
  severity: AnomalySeverity;
  status: AnomalyStatus;
  fingerprint: string;
  message: string;
  context?: LogMeta;
  occurrenceCount: number;
  firstDetectedAt: string;
  lastDetectedAt: string;
  createdAt: string;
  updatedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  lastNotificationAt: string | null;
  lastNotifiedChannels: AlertChannel[];
}
