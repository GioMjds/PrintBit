import {
  applyPrintTerminalEvent,
  PrintTerminalGuard,
} from '../../src/public/confirm/print-terminal-state';

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

  test.each([
    'printErrorRaised',
    'printLifecycleFailed',
    'workerJobPaused',
    'workerPrintFailed',
  ] as const)(
    '%s keeps the maintenance outcome when the worker later reports success',
    (failureEvent) => {
      const guard = new PrintTerminalGuard();
      const identity = {
        transactionId: 'tx-paper-empty',
        spoolerCorrelationKey: 'spool-paper-empty',
      };

      expect(
        applyPrintTerminalEvent(guard, {
          type: failureEvent,
          identity,
        }),
      ).toBe('maintenance');
      expect(
        applyPrintTerminalEvent(guard, {
          type: 'workerPrintSucceeded',
          identity,
        }),
      ).toBe('maintenance');
    },
  );
});
