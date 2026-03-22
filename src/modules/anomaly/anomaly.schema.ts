/**
 * Anomaly module schemas and types.
 */
import type { LogMeta } from '@/core/database/shared.schema';
import type {
  AlertChannel,
  AnomalySeverity,
  AnomalyStatus,
  AnomalyCategory,
  AlertSettings,
} from '@/modules/admin/admin.schema';

export type {
  LogMeta,
  AlertChannel,
  AnomalySeverity,
  AnomalyStatus,
  AnomalyCategory,
  AlertSettings,
};

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
