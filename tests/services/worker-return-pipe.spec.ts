import {
	parseWorkerEventLine,
	mapWorkerEventToSocket,
} from '@/services/worker-return-pipe';

describe('worker-return-pipe', () => {
	it('parses valid event JSON', () => {
		const line = JSON.stringify({
			type: 'PrintSucceeded',
			transactionId: 'tx-1',
			spoolerCorrelationKey: 'spool-1',
			fileName: 'tx-1_spool-1_1.pdf',
			printerName: 'EPSON',
			timestampUtc: '2026-05-25T02:00:00Z',
		});

		const result = parseWorkerEventLine(line, 8_192);
		expect(result).toMatchObject({
			type: 'PrintSucceeded',
			transactionId: 'tx-1',
			spoolerCorrelationKey: 'spool-1',
		});
	});

	it('rejects oversize payloads', () => {
		const big = 'x'.repeat(9_000);
		expect(() => parseWorkerEventLine(big, 8_192)).toThrow('PayloadTooLarge');
	});

	it('maps events to socket payload', () => {
		const mapped = mapWorkerEventToSocket({
			type: 'PrintFailed',
			transactionId: 'tx-1',
			spoolerCorrelationKey: 'spool-1',
			message: 'spooler failed',
			failureStage: 'SpoolerVerification',
			timestampUtc: '2026-05-25T02:00:00Z',
		});
		expect(mapped.event).toBe('workerPrintFailed');
		expect(mapped.payload).toMatchObject({
			transactionId: 'tx-1',
			failureStage: 'SpoolerVerification',
		});
	});

	it('maps JobCompleted with completed outcome to workerPrintSucceeded', () => {
		const mapped = mapWorkerEventToSocket({
			type: 'JobCompleted',
			transactionId: 'tx-1',
			spoolerCorrelationKey: 'spool-1',
			outcome: 'completed',
			timestampUtc: '2026-05-25T02:00:00Z',
		});
		expect(mapped.event).toBe('workerPrintSucceeded');
	});
});
