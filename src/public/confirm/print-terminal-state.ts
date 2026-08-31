export interface PrintJobIdentity {
  transactionId?: string | null;
  spoolerCorrelationKey?: string | null;
}

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
