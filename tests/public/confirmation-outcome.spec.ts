import {
  applyConfirmationEvidence,
  createConfirmationOutcomeState,
} from '../../src/public/confirm/confirmation-outcome';

describe('Confirmation outcome', () => {
  const identity = {
    transactionId: 'tx-paper-empty',
    spoolerCorrelationKey: 'spool-paper-empty',
  };

  test('keeps maintenance after a correlated late success', () => {
    const maintenance = applyConfirmationEvidence(
      createConfirmationOutcomeState({ identity }),
      { type: 'terminal-failure', identity },
    );

    expect(maintenance.outcome).toBe('maintenance');
    expect(
      applyConfirmationEvidence(maintenance, {
        type: 'terminal-success',
        identity,
      }),
    ).toBe(maintenance);
  });

  test('matches terminal evidence by spooler key when transaction ID is absent', () => {
    const maintenance = applyConfirmationEvidence(
      createConfirmationOutcomeState({ identity }),
      {
        type: 'terminal-failure',
        identity: {
          transactionId: null,
          spoolerCorrelationKey: identity.spoolerCorrelationKey,
        },
      },
    );

    expect(maintenance.outcome).toBe('maintenance');
  });

  test('keeps an uncorrelated terminal failure ahead of later success', () => {
    const maintenance = applyConfirmationEvidence(
      createConfirmationOutcomeState(),
      {
        type: 'terminal-failure',
        identity: {
          transactionId: null,
          spoolerCorrelationKey: null,
        },
      },
    );

    expect(maintenance.outcome).toBe('maintenance');
    expect(
      applyConfirmationEvidence(maintenance, {
        type: 'terminal-success',
        identity,
      }),
    ).toBe(maintenance);
  });

  test('keeps a delayed receipt on the maintenance outcome', () => {
    const maintenance = applyConfirmationEvidence(
      createConfirmationOutcomeState({ identity }),
      { type: 'terminal-failure', identity },
    );

    expect(
      applyConfirmationEvidence(maintenance, {
        type: 'receipt-available',
        identity,
        receipt: {
          url: 'https://kiosk.test/receipt/t/maintenance',
          expiresAt: '2026-09-03T00:00:00.000Z',
        },
      }),
    ).toMatchObject({
      outcome: 'maintenance',
      receipt: {
        url: 'https://kiosk.test/receipt/t/maintenance',
      },
    });
  });

  test('keeps a receipt collected before the matching worker-pending transition', () => {
    const withReceipt = applyConfirmationEvidence(
      createConfirmationOutcomeState(),
      {
        type: 'receipt-available',
        identity,
        receipt: {
          url: 'https://kiosk.test/receipt/t/ready',
          expiresAt: null,
        },
      },
    );

    expect(
      applyConfirmationEvidence(withReceipt, {
        type: 'restore-pending',
        identity,
      }),
    ).toMatchObject({
      outcome: 'pending',
      receipt: { url: 'https://kiosk.test/receipt/t/ready' },
    });
  });

  test('restores persisted payment identity as a pending outcome', () => {
    const restored = applyConfirmationEvidence(
      createConfirmationOutcomeState(),
      { type: 'restore-pending', identity },
    );

    expect(restored).toMatchObject({
      outcome: 'pending',
      identity,
    });
  });
});
