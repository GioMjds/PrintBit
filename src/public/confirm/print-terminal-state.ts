export interface PrintJobIdentity {
  transactionId?: string | null;
  spoolerCorrelationKey?: string | null;
}

export type PrintTerminalEventType =
  | 'printErrorRaised'
  | 'printLifecycleFailed'
  | 'workerJobPaused'
  | 'workerPrintFailed'
  | 'workerPrintSucceeded';

export interface PrintTerminalEvent {
  type: PrintTerminalEventType;
  identity: PrintJobIdentity;
}

export type PrintTerminalDisposition = 'maintenance' | 'success';

interface NormalizedPrintJobIdentity {
  transactionId: string | null;
  spoolerCorrelationKey: string | null;
}

function normalizeIdentifier(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export class PrintTerminalGuard {
  private failedIdentity: NormalizedPrintJobIdentity | null = null;

  markFailed(identity: PrintJobIdentity): void {
    this.failedIdentity = {
      transactionId: normalizeIdentifier(identity.transactionId),
      spoolerCorrelationKey: normalizeIdentifier(
        identity.spoolerCorrelationKey,
      ),
    };
  }

  canFinalizeSuccess(identity: PrintJobIdentity): boolean {
    if (!this.failedIdentity) return true;

    const candidate = {
      transactionId: normalizeIdentifier(identity.transactionId),
      spoolerCorrelationKey: normalizeIdentifier(
        identity.spoolerCorrelationKey,
      ),
    };
    const failureHasNoIdentity =
      !this.failedIdentity.transactionId &&
      !this.failedIdentity.spoolerCorrelationKey;
    const successHasNoIdentity =
      !candidate.transactionId && !candidate.spoolerCorrelationKey;

    if (failureHasNoIdentity || successHasNoIdentity) return false;

    if (
      this.failedIdentity.transactionId &&
      candidate.transactionId === this.failedIdentity.transactionId
    ) {
      return false;
    }
    if (
      this.failedIdentity.spoolerCorrelationKey &&
      candidate.spoolerCorrelationKey ===
        this.failedIdentity.spoolerCorrelationKey
    ) {
      return false;
    }

    return true;
  }

  reset(): void {
    this.failedIdentity = null;
  }
}

/**
 * Applies a terminal worker event to the active print job. A failure is
 * terminal for the kiosk session, so a later success for that same job must
 * leave the maintenance outcome in place.
 */
export function applyPrintTerminalEvent(
  guard: PrintTerminalGuard,
  event: PrintTerminalEvent,
): PrintTerminalDisposition {
  if (event.type !== 'workerPrintSucceeded') {
    guard.markFailed(event.identity);
    return 'maintenance';
  }

  return guard.canFinalizeSuccess(event.identity) ? 'success' : 'maintenance';
}
