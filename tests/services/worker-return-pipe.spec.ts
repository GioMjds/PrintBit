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

	it('accepts an unversioned legacy terminal event', () => {
		const result = parseWorkerEventLine(
			JSON.stringify({
				type: 'JobCompleted',
				transactionId: 'tx-legacy',
				outcome: 'cancelled',
				timestampUtc: '2026-05-25T02:00:00Z',
			}),
			8_192,
		);

		expect(result).toMatchObject({
			type: 'JobCompleted',
			transactionId: 'tx-legacy',
			outcome: 'cancelled',
		});
	});

	it('parses a valid v2 event with its event ordering metadata', () => {
		const result = parseWorkerEventLine(
			JSON.stringify({
				type: 'JobCompleted',
				transactionId: 'tx-v2',
				outcome: 'partially_completed',
				protocolVersion: 2,
				eventId: 'evt-001',
				sequence: 0,
				timestampUtc: '2026-05-25T02:00:00Z',
			}),
			8_192,
		);

		expect(result).toMatchObject({
			protocolVersion: 2,
			eventId: 'evt-001',
			sequence: 0,
		});
	});

	it('rejects a v2 terminal event with an unsupported outcome', () => {
		expect(() =>
			parseWorkerEventLine(
				JSON.stringify({
					type: 'JobCompleted',
					protocolVersion: 2,
					eventId: 'evt-invalid-outcome',
					sequence: 1,
					outcome: 'retrying',
					timestampUtc: '2026-05-25T02:00:00Z',
				}),
				8_192,
			),
		).toThrow('InvalidV2Payload');
	});

	it.each([
		['a wrong protocol version', { protocolVersion: 1, eventId: 'evt-1', sequence: 0 }],
		['a missing event ID', { protocolVersion: 2, sequence: 0 }],
		['an empty event ID', { protocolVersion: 2, eventId: '   ', sequence: 0 }],
		['a fractional sequence', { protocolVersion: 2, eventId: 'evt-1', sequence: 1.5 }],
		['a negative sequence', { protocolVersion: 2, eventId: 'evt-1', sequence: -1 }],
	])('rejects a v2 event with %s', (_description, v2Fields) => {
		expect(() =>
			parseWorkerEventLine(
				JSON.stringify({
					type: 'JobCompleted',
					timestampUtc: '2026-05-25T02:00:00Z',
					...v2Fields,
				}),
				8_192,
			),
		).toThrow('InvalidV2Payload');
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
