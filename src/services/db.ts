import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { DEFAULT_DATA, normalizeSchema, type Schema } from '@/state';
import {
  withBalanceLock,
  acquireIdempotencyKey,
  storeIdempotencyKey,
  releaseIdempotencyKey,
  type IdempotencyEntry,
} from '@/runtime';

export type {
  LogMeta,
  PrintMode,
  ColorMode,
  AdminLockout,
  PricingSettings,
  AdminSettings,
  CoinStats,
  JobStats,
  HopperSettings,
  HopperStats,
  OwedChangeEntry,
  AdminLogEntry,
  FeedbackCategory,
  FeedbackStatus,
  FeedbackEntry,
  FeedbackSessionEntry,
  ReportIssueCategory,
  ReportIssueStatus,
  ReportIssueSessionEntry,
  ReportIssueAttachmentEntry,
  ReportIssueEntry,
  PendingRefundEntry,
} from '@/state';
export type { Schema } from '@/state';
export {
  withBalanceLock,
  acquireIdempotencyKey,
  storeIdempotencyKey,
  releaseIdempotencyKey,
};
export type { IdempotencyEntry };

const adapter = new JSONFile<Schema>('db.json');
export const db = new Low(adapter, DEFAULT_DATA);

export async function initDB() {
  try {
    await db.read();
  } catch (err) {
    // If the file is empty or malformed, initialize with defaults
    db.data = { ...DEFAULT_DATA };
    await db.write();
    return;
  }

  db.data = normalizeSchema(db.data);
  await db.write();
}
