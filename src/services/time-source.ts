import type { TrustedTimestampMeta } from './db';

export interface TrustedTimestamp {
  timestamp: string;
  meta: TrustedTimestampMeta;
}

let lastKnownOffsetMs: number | null = null;

function readConfiguredOffsetMs(): number | null {
  const raw = process.env.PRINTBIT_NTP_OFFSET_MS;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

export function updateTrustedClockOffset(offsetMs: number | null): void {
  if (offsetMs !== null && Number.isFinite(offsetMs)) {
    lastKnownOffsetMs = Math.round(offsetMs);
    return;
  }
  lastKnownOffsetMs = null;
}

export function getTrustedTimestamp(): TrustedTimestamp {
  const configuredOffset = readConfiguredOffsetMs();
  const offsetMs = configuredOffset ?? lastKnownOffsetMs;
  const synced = offsetMs !== null;
  const adjustedMs = Date.now() + (offsetMs ?? 0);

  return {
    timestamp: new Date(adjustedMs).toISOString(),
    meta: {
      source: synced ? 'ntp' : 'system',
      synced,
      offsetMs,
      detail: synced
        ? 'Using configured/known clock offset for trusted timestamp.'
        : 'No trusted offset configured; using local system clock.',
    },
  };
}
