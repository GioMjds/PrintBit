import { randomUUID } from 'node:crypto';
import { sendWorkerRequest, type WorkerHardwareResponse } from './worker-command-pipe';
import type { WorkerPrintEvent } from './worker-return-pipe';

export class CoinSimulationError extends Error {
  constructor(public readonly statusCode: number, public readonly reason: string, message: string) {
    super(message);
  }
}

type Sender = (command: Record<string, unknown>) => Promise<WorkerHardwareResponse | null>;
interface PendingCoin {
  value: number;
  processing: boolean;
  finish: (balance?: number, error?: CoinSimulationError) => void;
}

/** Only a matching return event may credit a requested test coin. Never retry automatically. */
export class CoinSimulation {
  private readonly pending = new Map<string, PendingCoin>();

  constructor(private readonly send: Sender = (command) =>
    sendWorkerRequest(command, { timeoutMs: 5000 })) {}

  insert(value: number): Promise<number> {
    if (![1, 5, 10, 20].includes(value)) {
      return Promise.reject(new CoinSimulationError(400, 'invalid_value', 'Accepted coins: 1, 5, 10, 20.'));
    }
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(undefined, new CoinSimulationError(
        504, 'simulation_timeout',
        'No completed worker coin event received. Check the live balance and worker logs before trying again.',
      )), 15000);
      const finish = (balance?: number, error?: CoinSimulationError): void => {
        if (!this.pending.delete(requestId)) return;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(balance!);
      };
      const pending: PendingCoin = { value, processing: false, finish };
      this.pending.set(requestId, pending);
      void Promise.resolve().then(() => this.send({ type: 'SimulateCoin', requestId, coinValue: value }))
        .then((response) => {
          // An event can be processed before the command reply arrives.
          if (pending.processing) return;
          if (!response || response.requestId !== requestId || response.type !== 'SimulateCoin') {
            finish(undefined, new CoinSimulationError(503, 'worker_unavailable',
              'Worker unavailable or incompatible. Start the updated C# Worker and check pipe access.'));
          } else if (!response.success) {
            finish(undefined, new CoinSimulationError(response.errorCode === 'slot_locked' ? 409 : 503,
              response.errorCode ?? 'worker_rejected', response.message ?? 'Worker rejected the simulated coin.'));
          }
        }).catch(() => {
          if (!pending.processing) finish(undefined, new CoinSimulationError(503, 'worker_unavailable',
            'Could not send the simulated coin to the worker.'));
        });
    });
  }

  async applyEvent(evt: WorkerPrintEvent, credit: () => Promise<number>): Promise<void> {
    if (evt.simulated !== true || !evt.requestId) return;
    const pending = this.pending.get(evt.requestId);
    if (!pending || pending.processing || pending.value !== evt.coinValue) return;
    if (evt.type === 'CoinRejected') {
      pending.finish(undefined, new CoinSimulationError(409, evt.rejectReason ?? 'slot_locked',
        'Worker rejected the simulated coin: ' + (evt.rejectReason ?? 'slot_locked')));
      return;
    }
    if (evt.type !== 'CoinInserted') return;
    // Claim synchronously before awaiting persistence so repeated events cannot double-credit.
    pending.processing = true;
    try {
      pending.finish(await credit());
    } catch {
      pending.finish(undefined, new CoinSimulationError(500, 'coin_processing_failed',
        'Worker event received, but coin recording failed. Check the balance and server logs before retrying.'));
    }
  }
}

export const coinSimulation = new CoinSimulation();
