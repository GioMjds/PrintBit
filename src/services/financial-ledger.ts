import { createHash, randomUUID } from 'node:crypto';
import {
  db,
  type FinancialEventType,
  type FinancialLedgerEntry,
  type LogMeta,
} from './db';
import { getTrustedTimestamp } from './time-source';
import { adminService } from './admin';

interface AppendLedgerInput {
  eventType: FinancialEventType;
  amount: number;
  referenceId?: string | null;
  meta?: LogMeta;
}

function serializeForHash(entry: {
  id: string;
  timestamp: string;
  eventType: FinancialEventType;
  amount: number;
  referenceId: string | null;
  meta: LogMeta;
  previousHash: string | null;
}): string {
  return JSON.stringify({
    id: entry.id,
    timestamp: entry.timestamp,
    eventType: entry.eventType,
    amount: entry.amount,
    referenceId: entry.referenceId,
    meta: entry.meta,
    previousHash: entry.previousHash,
  });
}

function computeHash(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

class FinancialLedgerService {
  private writeQueue: Promise<void> = Promise.resolve();

  async append(input: AppendLedgerInput): Promise<FinancialLedgerEntry> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previousQueue = this.writeQueue;
    this.writeQueue = previousQueue.then(() => gate);
    await previousQueue;

    try {
      const trusted = getTrustedTimestamp();
      const id = randomUUID();
      const previous = db.data!.financialLedger[0] ?? null;
      const previousHash = previous?.hash ?? null;
      const amount = Number.isFinite(input.amount)
        ? Number(input.amount.toFixed(2))
        : 0;
      const meta = input.meta ?? {};

      const hashPayload = serializeForHash({
        id,
        timestamp: trusted.timestamp,
        eventType: input.eventType,
        amount,
        referenceId: input.referenceId ?? null,
        meta,
        previousHash,
      });

      const entry: FinancialLedgerEntry = {
        id,
        timestamp: trusted.timestamp,
        timestampMeta: trusted.meta,
        eventType: input.eventType,
        amount,
        referenceId: input.referenceId ?? null,
        meta,
        previousHash,
        hash: computeHash(hashPayload),
      };

      db.data!.financialLedger.unshift(entry);
      await db.write();
      if (!entry.timestampMeta.synced) {
        void adminService.appendAdminLog(
          'trusted_time_unsynced',
          'Financial event recorded while trusted time sync is unavailable.',
          {
            ledgerEventType: entry.eventType,
            ledgerEntryId: entry.id,
            source: entry.timestampMeta.source,
            offsetMs: entry.timestampMeta.offsetMs,
          },
        );
      }
      return entry;
    } finally {
      release();
    }
  }

  verifyChain(entries: FinancialLedgerEntry[] = db.data!.financialLedger): {
    valid: boolean;
    brokenAtId: string | null;
  } {
    let prevHash: string | null = null;
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const row = entries[i];
      if (row.previousHash !== prevHash) {
        return { valid: false, brokenAtId: row.id };
      }
      const expected = computeHash(
        serializeForHash({
          id: row.id,
          timestamp: row.timestamp,
          eventType: row.eventType,
          amount: row.amount,
          referenceId: row.referenceId,
          meta: row.meta,
          previousHash: row.previousHash,
        }),
      );
      if (row.hash !== expected) {
        return { valid: false, brokenAtId: row.id };
      }
      prevHash = row.hash;
    }
    return { valid: true, brokenAtId: null };
  }
}

export const financialLedgerService = new FinancialLedgerService();
