export interface ConfirmationOutcomeIdentity {
  transactionId: string | null;
  spoolerCorrelationKey: string | null;
}

export interface ConfirmationReceipt {
  url: string;
  expiresAt: string | null;
}

export interface ConfirmationOutcomeState {
  outcome: 'pending' | 'success' | 'maintenance';
  identity: ConfirmationOutcomeIdentity;
  receipt: ConfirmationReceipt | null;
}

export type ConfirmationEvidence =
  | {
      type: 'restore-pending';
      identity: Partial<ConfirmationOutcomeIdentity>;
    }
  | {
      type: 'terminal-failure';
      identity: Partial<ConfirmationOutcomeIdentity>;
    }
  | {
      type: 'terminal-success';
      identity: Partial<ConfirmationOutcomeIdentity>;
    }
  | {
      type: 'receipt-available';
      identity: Partial<ConfirmationOutcomeIdentity>;
      receipt: ConfirmationReceipt;
    };

function normalizeIdentifier(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeIdentity(
  identity: Partial<ConfirmationOutcomeIdentity> | undefined,
): ConfirmationOutcomeIdentity {
  return {
    transactionId: normalizeIdentifier(identity?.transactionId),
    spoolerCorrelationKey: normalizeIdentifier(identity?.spoolerCorrelationKey),
  };
}

function hasIdentity(identity: ConfirmationOutcomeIdentity): boolean {
  return Boolean(identity.transactionId || identity.spoolerCorrelationKey);
}

function identitiesMatch(
  active: ConfirmationOutcomeIdentity,
  evidence: ConfirmationOutcomeIdentity,
): boolean {
  if (!hasIdentity(active)) return hasIdentity(evidence);
  if (!hasIdentity(evidence)) return false;

  return Boolean(
    (active.transactionId && active.transactionId === evidence.transactionId) ||
    (active.spoolerCorrelationKey &&
      active.spoolerCorrelationKey === evidence.spoolerCorrelationKey),
  );
}

export function createConfirmationOutcomeState(input?: {
  identity?: Partial<ConfirmationOutcomeIdentity>;
}): ConfirmationOutcomeState {
  return {
    outcome: 'pending',
    identity: normalizeIdentity(input?.identity),
    receipt: null,
  };
}

export function applyConfirmationEvidence(
  state: ConfirmationOutcomeState,
  evidence: ConfirmationEvidence,
): ConfirmationOutcomeState {
  const identity = normalizeIdentity(evidence.identity);

  if (evidence.type === 'restore-pending') {
    return {
      outcome: 'pending',
      identity,
      receipt: identitiesMatch(state.identity, identity) ? state.receipt : null,
    };
  }

  if (evidence.type === 'terminal-failure') {
    if (state.outcome === 'maintenance') return state;
    return {
      ...state,
      outcome: 'maintenance',
      identity: hasIdentity(identity) ? identity : state.identity,
    };
  }

  if (!identitiesMatch(state.identity, identity)) return state;

  if (evidence.type === 'terminal-success') {
    if (state.outcome === 'maintenance') return state;
    return { ...state, outcome: 'success', identity };
  }

  return { ...state, identity, receipt: evidence.receipt };
}
