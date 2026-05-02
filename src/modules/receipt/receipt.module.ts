import type { Express } from 'express';
import type { ModuleContext } from '../module.types';
import { adminService } from '@/services/admin';
import type { LogMeta } from '@/services/db';
import { ReceiptController } from './receipt.controller';
import { ReceiptService } from './receipt.service';

export interface ReceiptModuleDeps extends ModuleContext {}

type CleanupTrigger = 'startup' | 'interval';

const RECEIPT_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
let receiptCleanupTimer: ReturnType<typeof setInterval> | null = null;

function appendCleanupLog(type: string, message: string, meta: LogMeta): void {
  void adminService.appendAdminLog(type, message, meta).catch((error) => {
    console.error('[RECEIPT] Failed to append cleanup admin log.', {
      type,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function runCleanupCycle(
  service: ReceiptService,
  trigger: CleanupTrigger,
): void {
  const runAt = new Date();
  try {
    const result = service.cleanupExpired(runAt);
    const removedAny =
      result.deletedAccessTokens > 0 || result.deletedReceiptRecords > 0;
    if (removedAny || trigger === 'startup') {
      appendCleanupLog(
        'receipt_cleanup_completed',
        'Receipt cleanup run completed.',
        {
          trigger,
          runAt: runAt.toISOString(),
          deletedAccessTokens: result.deletedAccessTokens,
          deletedReceiptRecords: result.deletedReceiptRecords,
          cleanupIntervalMs: RECEIPT_CLEANUP_INTERVAL_MS,
        },
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[RECEIPT] Receipt cleanup run failed.', {
      trigger,
      runAt: runAt.toISOString(),
      error: message,
    });
    appendCleanupLog('receipt_cleanup_failed', 'Receipt cleanup run failed.', {
      trigger,
      runAt: runAt.toISOString(),
      cleanupIntervalMs: RECEIPT_CLEANUP_INTERVAL_MS,
      error: message,
    });
  }
}

function startCleanupScheduler(service: ReceiptService): void {
  if (receiptCleanupTimer) return;
  runCleanupCycle(service, 'startup');
  receiptCleanupTimer = setInterval(() => {
    runCleanupCycle(service, 'interval');
  }, RECEIPT_CLEANUP_INTERVAL_MS);
  receiptCleanupTimer.unref?.();
  appendCleanupLog(
    'receipt_cleanup_scheduler_started',
    'Receipt cleanup scheduler started.',
    {
      cleanupIntervalMs: RECEIPT_CLEANUP_INTERVAL_MS,
    },
  );
}

export function registerReceiptModule(app: Express): void {
  const service = new ReceiptService();
  startCleanupScheduler(service);
  const controller = new ReceiptController(service);
  app.use(controller.router);
}
