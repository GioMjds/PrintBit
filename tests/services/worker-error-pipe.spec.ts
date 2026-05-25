import {
	buildWorkerErrorPayload,
	serializeWorkerError,
} from '@/services/worker-error-pipe';

describe('worker-error-pipe', () => {
	it('serializes payload with newline', () => {
		const payload = buildWorkerErrorPayload({
			message: 'Print failed',
			code: 'WORKER_HANDOFF_FAILED',
			source: 'print-queue-worker',
			transactionId: 'tx-1',
			spoolerCorrelationKey: 'spool-1',
		});

		const line = serializeWorkerError(payload);
		expect(line.endsWith('\n')).toBe(true);

		const parsed = JSON.parse(line.trim());
		expect(parsed).toMatchObject({
			message: 'Print failed',
			code: 'WORKER_HANDOFF_FAILED',
			source: 'print-queue-worker',
			transactionId: 'tx-1',
			spoolerCorrelationKey: 'spool-1',
		});
	});
});
