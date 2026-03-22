/**
 * Feedback module schemas and types.
 */
import type { LogMeta } from '@/core/database/shared.schema';

export type { LogMeta };

export type FeedbackCategory =
  | 'service'
  | 'hardware'
  | 'software'
  | 'print'
  | 'scan'
  | 'copy'
  | 'payment'
  | 'other';

export type FeedbackStatus = 'open' | 'resolved';

export interface FeedbackEntry {
  id: string;
  sessionId: string;
  timestamp: string;
  comment: string;
  category: FeedbackCategory | null;
  rating: number | null;
  status: FeedbackStatus;
  resolvedAt?: string | null;
  meta?: LogMeta;
}

export interface FeedbackSessionEntry {
  id: string;
  token: string;
  feedbackUrl: string;
  createdAt: string;
  expiresAt: string;
  submittedAt: string | null;
}
