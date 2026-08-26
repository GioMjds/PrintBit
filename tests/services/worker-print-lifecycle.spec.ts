import type { Server } from 'socket.io';
import type { SessionStore } from '@/services/session';
import { handleWorkerReturnPrintEvent } from '@/services/worker-print-lifecycle';
import { persistAndEmitPrintLifecycleState } from '@/services/print-lifecycle-state';
import { getRecoverySession, checkpointRecoverySession } from '@/services/recovery';
import { ReceiptService } from '@/modules/receipt/receipt.service';

jest.mock('@/services/print-lifecycle-state', () => ({
	persistAndEmitPrintLifecycleState: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/services/recovery', () => ({
	getRecoverySession: jest.fn(),
	checkpointRecoverySession: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/modules/receipt/receipt.service', () => ({
	ReceiptService: jest.fn().mockImplementation(() => ({
		updateTerminalStatus: jest.fn(),
	})),
}));

jest.mock('@/services/financial-ledger', () => ({
	financialLedgerService: {
		append: jest.fn().mockResolvedValue(undefined),
		getTransactionSummary: jest.fn().mockReturnValue(null),
	},
}));

jest.mock('@/services/anomaly', () => ({
	anomalyService: {
		recordAnomaly: jest.fn(),
	},
}));

describe('worker-print-lifecycle', () => {
	const mockIo = {
		emit: jest.fn(),
	} as unknown as Server;

	const mockSessionStore = {
		deleteSession: jest.fn().mockResolvedValue(undefined),
	} as unknown as SessionStore;

	beforeEach(() => {
		jest.clearAllMocks();
		(getRecoverySession as jest.Mock).mockReturnValue({
			transactionId: 'tx-123',
			mode: 'print',
			requiredAmount: 10,
			chargedAmount: 10,
			sessionId: 'sess-123',
			documentId: 'doc-123',
		});
	});

	it('handles JobPaused event and sets state to paused without failing transaction', async () => {
		await handleWorkerReturnPrintEvent({
			evt: {
				type: 'JobPaused',
				transactionId: 'tx-123',
				spoolerCorrelationKey: 'spool-123',
				printerName: 'EPSON L5290 Series',
				errorMessage: 'Printer Out of Paper',
				timestampUtc: '2026-08-26T10:00:00Z',
			},
			io: mockIo,
			sessionStore: mockSessionStore,
		});

		expect(persistAndEmitPrintLifecycleState).toHaveBeenCalledWith(
			mockIo,
			expect.objectContaining({
				state: 'paused',
				transactionId: 'tx-123',
				spoolerCorrelationKey: 'spool-123',
				printError: expect.objectContaining({
					code: 'PAPER_TRAY_EMPTY',
					severity: 'recoverable',
					canRetry: true,
				}),
			}),
			expect.anything(),
		);
	});

	it('handles JobResumed event and sets state to processing', async () => {
		await handleWorkerReturnPrintEvent({
			evt: {
				type: 'JobResumed',
				transactionId: 'tx-123',
				spoolerCorrelationKey: 'spool-123',
				printerName: 'EPSON L5290 Series',
				message: 'Job resumed by worker',
				timestampUtc: '2026-08-26T10:01:00Z',
			},
			io: mockIo,
			sessionStore: mockSessionStore,
		});

		expect(persistAndEmitPrintLifecycleState).toHaveBeenCalledWith(
			mockIo,
			expect.objectContaining({
				state: 'processing',
				transactionId: 'tx-123',
				spoolerCorrelationKey: 'spool-123',
			}),
			expect.anything(),
		);
	});

	it('handles JobCompleted with completed outcome as success', async () => {
		await handleWorkerReturnPrintEvent({
			evt: {
				type: 'JobCompleted',
				outcome: 'completed',
				transactionId: 'tx-123',
				spoolerCorrelationKey: 'spool-123',
				printerName: 'EPSON L5290 Series',
				timestampUtc: '2026-08-26T10:02:00Z',
			},
			io: mockIo,
			sessionStore: mockSessionStore,
		});

		expect(persistAndEmitPrintLifecycleState).toHaveBeenCalledWith(
			mockIo,
			expect.objectContaining({
				state: 'printed',
				transactionId: 'tx-123',
			}),
			expect.anything(),
		);
		expect(checkpointRecoverySession).toHaveBeenCalledWith(
			expect.objectContaining({
				transactionId: 'tx-123',
				phase: 'reconciled',
			}),
		);
	});

	it('ignores background hardware status events without failing transaction', async () => {
		await handleWorkerReturnPrintEvent({
			evt: {
				type: 'PrinterOffline',
				transactionId: 'tx-123',
				printerName: 'EPSON L5290 Series',
				timestampUtc: '2026-08-26T10:00:00Z',
			},
			io: mockIo,
			sessionStore: mockSessionStore,
		});

		expect(persistAndEmitPrintLifecycleState).not.toHaveBeenCalled();
	});
});
