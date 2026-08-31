import { PrintTerminalGuard } from '../../src/public/confirm/print-terminal-state';

describe('PrintTerminalGuard', () => {
  test('rejects a late success for a transaction already marked failed', () => {
    const guard = new PrintTerminalGuard();

    guard.markFailed({
      transactionId: 'tx-failed',
      spoolerCorrelationKey: 'spool-failed',
    });

    expect(
      guard.canFinalizeSuccess({
        transactionId: 'tx-failed',
        spoolerCorrelationKey: 'spool-failed',
      }),
    ).toBe(false);
  });

  test('matches the failed job by spooler key when its success omits a transaction ID', () => {
    const guard = new PrintTerminalGuard();

    guard.markFailed({
      transactionId: 'tx-failed',
      spoolerCorrelationKey: 'spool-failed',
    });

    expect(
      guard.canFinalizeSuccess({
        transactionId: null,
        spoolerCorrelationKey: 'spool-failed',
      }),
    ).toBe(false);
  });

  test('allows success for the next job after the guard is reset', () => {
    const guard = new PrintTerminalGuard();
    guard.markFailed({
      transactionId: 'tx-failed',
      spoolerCorrelationKey: 'spool-failed',
    });

    guard.reset();

    expect(
      guard.canFinalizeSuccess({
        transactionId: 'tx-next',
        spoolerCorrelationKey: 'spool-next',
      }),
    ).toBe(true);
  });
});
