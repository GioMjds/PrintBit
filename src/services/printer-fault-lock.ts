import type { LogMeta } from './db';

export interface PrinterFaultLockState {
  active: boolean;
  source: string | null;
  reason: string | null;
  status: string | null;
  lockedAt: string | null;
  updatedAt: string | null;
  context: LogMeta;
}

const state: PrinterFaultLockState = {
  active: false,
  source: null,
  reason: null,
  status: null,
  lockedAt: null,
  updatedAt: null,
  context: {},
};

function normalizeContext(
  context:
    | Record<string, string | number | boolean | null | undefined>
    | undefined,
): LogMeta {
  return Object.fromEntries(
    Object.entries(context ?? {}).map(([key, value]) => [key, value ?? null]),
  ) as LogMeta;
}

function snapshot(): PrinterFaultLockState {
  return {
    ...state,
    context: { ...state.context },
  };
}

export function setPrinterFaultLock(input: {
  source: string;
  reason: string;
  status?: string | null;
  context?: Record<string, string | number | boolean | null | undefined>;
}): PrinterFaultLockState {
  const now = new Date().toISOString();
  state.active = true;
  state.source = input.source;
  state.reason = input.reason;
  state.status = input.status ?? null;
  state.context = normalizeContext(input.context);
  state.updatedAt = now;
  if (!state.lockedAt) {
    state.lockedAt = now;
  }
  return snapshot();
}

export function clearPrinterFaultLock(): PrinterFaultLockState {
  state.active = false;
  state.source = null;
  state.reason = null;
  state.status = null;
  state.lockedAt = null;
  state.updatedAt = new Date().toISOString();
  state.context = {};
  return snapshot();
}

export function getPrinterFaultLock(): PrinterFaultLockState {
  return snapshot();
}

export function isPrinterFaultLocked(): boolean {
  return state.active;
}
