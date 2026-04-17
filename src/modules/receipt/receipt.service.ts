import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { receiptStore } from '@/core/database/sqlite-storage';
import type {
  LogMeta,
  ReceiptAccessTokenEntry,
  ReceiptMode,
  ReceiptRecordEntry,
  ReceiptRecordStatus,
} from '@/services/db';
import { adminService } from '@/services/admin';

const RECEIPT_RETENTION_MS = 24 * 60 * 60 * 1000;
const RECEIPT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STATUS: ReceiptRecordStatus = 'settled_pending_terminal';

export interface ReceiptSnapshotInput {
  transactionId: string;
  mode: ReceiptMode;
  chargedAmount: number;
  status?: ReceiptRecordStatus;
  settledAt?: string | null;
  terminalAt?: string | null;
  expiresAt?: string;
}

export interface ReceiptTerminalUpdateInput {
  transactionId: string;
  status: ReceiptRecordStatus;
  terminalAt?: string | null;
}

export interface MintReceiptTokenOptions {
  ttlMs?: number;
  revokeExisting?: boolean;
}

export interface MintReceiptTokenResult {
  token: string;
  tokenId: string;
  transactionId: string;
  receiptId: string;
  expiresAt: string;
}

export interface ReceiptPayload {
  transactionId: string;
  mode: ReceiptMode;
  chargedAmount: number;
  status: ReceiptRecordStatus;
  settledAt: string | null;
  terminalAt: string | null;
  generatedAt: string;
}

export type ResolveReceiptByTokenResult =
  | {
      status: 'ok';
      receipt: ReceiptRecordEntry;
      accessToken: ReceiptAccessTokenEntry;
      payload: ReceiptPayload;
    }
  | { status: 'unknown' | 'expired' | 'revoked' };

export type ResolveReceiptByTransactionResult =
  | { status: 'ok'; receipt: ReceiptRecordEntry; payload: ReceiptPayload }
  | { status: 'not_found' | 'expired' };

export interface ReceiptCleanupResult {
  deletedReceiptRecords: number;
  deletedAccessTokens: number;
}

function parseTimestampMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeIsoTimestamp(
  value: string | null | undefined,
  fallback: string | null,
): string | null {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const parsed = parseTimestampMs(trimmed);
  if (parsed === null) return fallback;
  return new Date(parsed).toISOString();
}

function isExpired(value: string, nowMs: number): boolean {
  const parsed = parseTimestampMs(value);
  if (parsed === null) return true;
  return parsed <= nowMs;
}

export class ReceiptService {
  upsertReceiptSnapshot(
    input: ReceiptSnapshotInput,
    now = new Date(),
  ): ReceiptRecordEntry {
    const transactionId = input.transactionId.trim();
    if (!transactionId) {
      throw new Error('transactionId is required.');
    }

    const nowIso = now.toISOString();
    const existing = receiptStore.getReceiptByTransactionId(transactionId);
    const expiresAt = this.resolveExpiryTimestamp(
      input.expiresAt,
      existing?.expiresAt,
      now,
    );
    const settledAt = normalizeIsoTimestamp(
      input.settledAt,
      existing?.settledAt ?? nowIso,
    );
    const terminalAt = normalizeIsoTimestamp(
      input.terminalAt,
      existing?.terminalAt ?? null,
    );

    const entry: ReceiptRecordEntry = {
      id: existing?.id ?? randomUUID(),
      transactionId,
      mode: input.mode === 'copy' ? 'copy' : 'print',
      chargedAmount: this.normalizeChargedAmount(input.chargedAmount),
      status: input.status ?? existing?.status ?? DEFAULT_STATUS,
      settledAt,
      terminalAt,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
      expiresAt,
    };

    receiptStore.upsertReceiptRecord(entry);
    if (!existing) {
      this.appendLifecycleLog(
        'receipt_snapshot_created',
        'Receipt snapshot created.',
        {
          transactionId: entry.transactionId,
          receiptId: entry.id,
          mode: entry.mode,
          status: entry.status,
          chargedAmount: entry.chargedAmount,
          expiresAt: entry.expiresAt,
        },
      );
    }
    return entry;
  }

  mintToken(
    transactionIdRaw: string,
    options: MintReceiptTokenOptions = {},
    now = new Date(),
  ): MintReceiptTokenResult | null {
    const transactionId = transactionIdRaw.trim();
    if (!transactionId) return null;

    const resolution = this.resolveByTransactionId(transactionId, now);
    if (resolution.status !== 'ok') return null;

    const nowIso = now.toISOString();
    const nowMs = now.getTime();
    const receiptExpiresMs = parseTimestampMs(resolution.receipt.expiresAt);
    const requestedTtlMs = Math.max(
      1_000,
      Math.floor(options.ttlMs ?? RECEIPT_TOKEN_TTL_MS),
    );
    const candidateExpiryMs = nowMs + requestedTtlMs;
    const expiresAtMs =
      receiptExpiresMs === null
        ? candidateExpiryMs
        : Math.min(candidateExpiryMs, receiptExpiresMs);
    const expiresAt = new Date(expiresAtMs).toISOString();

    let revokedTokenCount = 0;
    if (options.revokeExisting) {
      const currentTokens = receiptStore.listAccessTokensForReceipt(
        resolution.receipt.id,
      );
      for (const token of currentTokens) {
        if (token.revokedAt === null) {
          if (receiptStore.revokeAccessToken(token.tokenHash, nowIso)) {
            revokedTokenCount += 1;
          }
        }
      }
    }

    const token = randomBytes(32).toString('base64url');
    const entry: ReceiptAccessTokenEntry = {
      id: randomUUID(),
      receiptId: resolution.receipt.id,
      tokenHash: this.hashToken(token),
      createdAt: nowIso,
      expiresAt,
      revokedAt: null,
    };

    receiptStore.createAccessToken(entry);
    this.appendLifecycleLog(
      'receipt_token_minted',
      'Receipt access token minted.',
      {
        transactionId: resolution.receipt.transactionId,
        receiptId: resolution.receipt.id,
        tokenId: entry.id,
        expiresAt: entry.expiresAt,
        revokedExisting: options.revokeExisting === true,
        revokedTokenCount,
      },
    );
    return {
      token,
      tokenId: entry.id,
      transactionId: resolution.receipt.transactionId,
      receiptId: resolution.receipt.id,
      expiresAt: entry.expiresAt,
    };
  }

  resolveByToken(
    tokenRaw: string,
    now = new Date(),
  ): ResolveReceiptByTokenResult {
    const token = tokenRaw.trim();
    if (!token) return { status: 'unknown' };

    const tokenEntry = receiptStore.getAccessTokenByHash(this.hashToken(token));
    if (!tokenEntry) return { status: 'unknown' };
    if (tokenEntry.revokedAt) return { status: 'revoked' };

    const nowMs = now.getTime();
    if (isExpired(tokenEntry.expiresAt, nowMs)) return { status: 'expired' };

    const receipt = receiptStore.getReceiptById(tokenEntry.receiptId);
    if (!receipt) return { status: 'unknown' };
    if (isExpired(receipt.expiresAt, nowMs)) return { status: 'expired' };

    return {
      status: 'ok',
      receipt,
      accessToken: tokenEntry,
      payload: this.toPayload(receipt, now),
    };
  }

  resolveByTransactionId(
    transactionIdRaw: string,
    now = new Date(),
  ): ResolveReceiptByTransactionResult {
    const transactionId = transactionIdRaw.trim();
    if (!transactionId) return { status: 'not_found' };

    const receipt = receiptStore.getReceiptByTransactionId(transactionId);
    if (!receipt) return { status: 'not_found' };
    if (isExpired(receipt.expiresAt, now.getTime()))
      return { status: 'expired' };

    return { status: 'ok', receipt, payload: this.toPayload(receipt, now) };
  }

  updateTerminalStatus(
    input: ReceiptTerminalUpdateInput,
    now = new Date(),
  ): ReceiptRecordEntry | null {
    const transactionId = input.transactionId.trim();
    if (!transactionId) return null;

    const existing = receiptStore.getReceiptByTransactionId(transactionId);
    if (!existing) return null;

    const nowIso = now.toISOString();
    const previousStatus = existing.status;
    const entry: ReceiptRecordEntry = {
      ...existing,
      status: input.status,
      terminalAt: normalizeIsoTimestamp(input.terminalAt, nowIso),
      updatedAt: nowIso,
    };

    receiptStore.upsertReceiptRecord(entry);
    if (previousStatus !== entry.status) {
      this.appendLifecycleLog(
        'receipt_terminal_status_updated',
        'Receipt terminal status updated.',
        {
          transactionId: entry.transactionId,
          receiptId: entry.id,
          mode: entry.mode,
          previousStatus,
          status: entry.status,
          terminalAt: entry.terminalAt,
        },
      );
    }
    return entry;
  }

  cleanupExpired(now = new Date()): ReceiptCleanupResult {
    return receiptStore.cleanupExpired(now);
  }

  cleanupExpiredTokens(now = new Date()): number {
    return receiptStore.cleanupExpiredAccessTokens(now);
  }

  cleanupExpiredRecords(now = new Date()): number {
    return receiptStore.cleanupExpiredReceiptRecords(now);
  }

  private toPayload(record: ReceiptRecordEntry, now: Date): ReceiptPayload {
    return {
      transactionId: record.transactionId,
      mode: record.mode,
      chargedAmount: record.chargedAmount,
      status: record.status,
      settledAt: record.settledAt,
      terminalAt: record.terminalAt,
      generatedAt: now.toISOString(),
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private resolveExpiryTimestamp(
    requestedExpiryIso: string | undefined,
    existingExpiryIso: string | undefined,
    now: Date,
  ): string {
    const requestedMs =
      typeof requestedExpiryIso === 'string'
        ? parseTimestampMs(requestedExpiryIso)
        : null;
    if (requestedMs !== null) return new Date(requestedMs).toISOString();

    const existingMs =
      typeof existingExpiryIso === 'string'
        ? parseTimestampMs(existingExpiryIso)
        : null;
    if (existingMs !== null) return new Date(existingMs).toISOString();

    return new Date(now.getTime() + RECEIPT_RETENTION_MS).toISOString();
  }

  private normalizeChargedAmount(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, value);
  }

  private appendLifecycleLog(
    type: string,
    message: string,
    meta: LogMeta,
  ): void {
    void adminService.appendAdminLog(type, message, meta).catch((error) => {
      console.error('[RECEIPT] Failed to append lifecycle admin log.', {
        type,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
