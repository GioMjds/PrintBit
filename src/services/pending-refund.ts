import { randomUUID } from 'node:crypto';
import { db, type PendingRefundEntry } from './db';

export class PendingRefundServiceError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'PendingRefundServiceError';
  }
}

function ensureDb(): void {
  if (!db.data) {
    throw new PendingRefundServiceError(
      500,
      'Database not initialized for refund operation.',
    );
  }
}

function normalizeJobContext(
  context: Record<string, string | number | boolean | null | undefined>,
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [key, value ?? null]),
  ) as Record<string, string | number | boolean | null>;
}

function getContextString(
  context: Record<string, string | number | boolean | null>,
  key: string,
): string | null {
  const value = context[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function getContextNumber(
  context: Record<string, string | number | boolean | null>,
  key: string,
): number | null {
  const value = context[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function findDuplicateByCorrelation(
  context: Record<string, string | number | boolean | null>,
): PendingRefundEntry | null {
  ensureDb();
  const transactionId = getContextString(context, 'transactionId');
  const spoolerCorrelationKey = getContextString(
    context,
    'spoolerCorrelationKey',
  );
  const spoolerJobId = getContextNumber(context, 'spoolerJobId');

  if (transactionId) {
    const byTransaction = db.data!.pendingRefunds.find(
      (entry) => entry.jobContext.transactionId === transactionId,
    );
    if (byTransaction) return byTransaction;
  }

  if (spoolerCorrelationKey) {
    const bySpoolerKey = db.data!.pendingRefunds.find(
      (entry) =>
        entry.jobContext.spoolerCorrelationKey === spoolerCorrelationKey,
    );
    if (bySpoolerKey) return bySpoolerKey;
  }

  if (spoolerJobId !== null) {
    const bySpoolerJob = db.data!.pendingRefunds.find(
      (entry) => entry.jobContext.spoolerJobId === spoolerJobId,
    );
    if (bySpoolerJob) return bySpoolerJob;
  }

  return null;
}

export async function createPendingRefund(input: {
  chargedAmount: number;
  reason: string;
  jobContext: Record<string, string | number | boolean | null | undefined>;
  status?: PendingRefundEntry['status'];
  closedAt?: string | null;
}): Promise<PendingRefundEntry> {
  ensureDb();
  const entry: PendingRefundEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    chargedAmount: input.chargedAmount,
    reason: input.reason,
    status: input.status ?? 'open',
    closedAt: input.closedAt ?? null,
    jobContext: normalizeJobContext(input.jobContext),
  };
  db.data!.pendingRefunds.unshift(entry);
  await db.write();
  return entry;
}

export async function upsertSpoolerFailureRefund(input: {
  chargedAmount: number;
  reason: string;
  jobContext: Record<string, string | number | boolean | null | undefined>;
  autoRefund: boolean;
}): Promise<{
  entry: PendingRefundEntry;
  created: boolean;
  autoRefunded: boolean;
  restoredBalanceAmount: number;
}> {
  ensureDb();

  const normalizedContext = normalizeJobContext(input.jobContext);
  const duplicate = findDuplicateByCorrelation(normalizedContext);
  if (duplicate) {
    return {
      entry: duplicate,
      created: false,
      autoRefunded: duplicate.status === 'refunded',
      restoredBalanceAmount: 0,
    };
  }

  const autoRefunded = input.autoRefund;
  const contextWithDisposition: Record<
    string,
    string | number | boolean | null | undefined
  > = {
    ...normalizedContext,
    refundDisposition: autoRefunded ? 'auto_refunded' : 'pending_admin_review',
    restoredBalanceAmount: autoRefunded ? input.chargedAmount : 0,
  };
  const entry = await createPendingRefund({
    chargedAmount: input.chargedAmount,
    reason: input.reason,
    jobContext: contextWithDisposition,
    status: autoRefunded ? 'refunded' : 'open',
    closedAt: autoRefunded ? new Date().toISOString() : null,
  });

  let restoredBalanceAmount = 0;
  if (autoRefunded) {
    db.data!.balance += input.chargedAmount;
    db.data!.earnings = Math.max(0, db.data!.earnings - input.chargedAmount);
    restoredBalanceAmount = input.chargedAmount;
    await db.write();
  }

  return {
    entry,
    created: true,
    autoRefunded,
    restoredBalanceAmount,
  };
}

function findEntryById(entryId: string): PendingRefundEntry {
  ensureDb();
  const entry = db.data!.pendingRefunds.find((item) => item.id === entryId);
  if (!entry) {
    throw new PendingRefundServiceError(404, 'Pending refund not found.');
  }
  return entry;
}

export async function processPendingRefund(input: {
  entryId: string;
  restoreBalance: boolean;
}): Promise<{
  entry: PendingRefundEntry;
  balance: number;
  restoreBalance: boolean;
}> {
  ensureDb();
  const entry = findEntryById(input.entryId);
  if (entry.status !== 'open') {
    throw new PendingRefundServiceError(
      409,
      `Entry is already ${entry.status}.`,
    );
  }

  entry.status = 'refunded';
  entry.closedAt = new Date().toISOString();

  if (input.restoreBalance) {
    db.data!.balance += entry.chargedAmount;
    db.data!.earnings = Math.max(0, db.data!.earnings - entry.chargedAmount);
  }

  await db.write();
  return {
    entry,
    balance: db.data!.balance,
    restoreBalance: input.restoreBalance,
  };
}

export async function dismissPendingRefund(
  entryId: string,
): Promise<PendingRefundEntry> {
  ensureDb();
  const entry = findEntryById(entryId);
  if (entry.status !== 'open') {
    throw new PendingRefundServiceError(
      409,
      `Entry is already ${entry.status}.`,
    );
  }

  entry.status = 'dismissed';
  entry.closedAt = new Date().toISOString();
  await db.write();
  return entry;
}
