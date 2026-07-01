import net from 'node:net';

export type WorkerPrintEventType =
  | 'PrintStarted'
  | 'PrintProgress'
  | 'PrintSucceeded'
  | 'PrintFailed'
  | 'PrinterOffline'
  | 'PrinterOnline'
  | 'PrinterError';

export interface WorkerPrintEvent {
  type: WorkerPrintEventType;
  transactionId?: string;
  spoolerCorrelationKey?: string;
  spoolerJobId?: string;
  fileName?: string;
  printerName?: string;
  failureStage?: string;
  message?: string;
  /**
   * Pages printed so far, reported by the worker's Win32_PrintJob poller.
   * Only populated on `PrintProgress` events.
   */
  pagesPrinted?: number;
  /**
   * Total pages in the spooler job. Reported alongside `pagesPrinted` so the
   * confirm page can render an "N of M" progress indicator.
   */
  totalPages?: number;
  timestampUtc: string;
}

/**
 * Handle returned by `startWorkerReturnPipeServer`.
 *
 * - `pipePath`  — the full Windows named-pipe path the server listens on.
 * - `server`    — the underlying `net.Server` instance.
 * - `ready`     — resolves when the server is listening; rejects if the bind
 *                 fails (e.g. pipe already in use).  Await this in startup
 *                 sequences to guarantee the pipe is open before proceeding.
 * - `close`     — gracefully stops the server and resolves when all
 *                 connections are drained.
 */
export interface WorkerReturnPipeServerHandle {
  pipePath: string;
  server: net.Server;
  ready: Promise<void>;
  close: () => Promise<void>;
}

export function parseWorkerEventLine(
  line: string,
  maxBytes: number,
): WorkerPrintEvent {
  if (!line.trim()) {
    throw new Error('EmptyPayload');
  }
  if (Buffer.byteLength(line, 'utf8') > maxBytes) {
    throw new Error('PayloadTooLarge');
  }
  const parsed = JSON.parse(line) as WorkerPrintEvent;
  if (!parsed.type || !parsed.timestampUtc) {
    throw new Error('InvalidPayload');
  }
  return parsed;
}

export function mapWorkerEventToSocket(evt: WorkerPrintEvent): {
  event:
  | 'workerPrintStarted'
  | 'workerPrintProgress'
  | 'workerPrintSucceeded'
  | 'workerPrintFailed'
  | 'workerPrinterOffline'
  | 'workerPrinterOnline'
  | 'workerPrinterError';
  payload: WorkerPrintEvent;
} {
  switch (evt.type) {
    case 'PrintStarted':
      return { event: 'workerPrintStarted', payload: evt };
    case 'PrintProgress':
      return { event: 'workerPrintProgress', payload: evt };
    case 'PrintSucceeded':
      return { event: 'workerPrintSucceeded', payload: evt };
    case 'PrintFailed':
      return { event: 'workerPrintFailed', payload: evt };
    case 'PrinterOffline':
      return { event: 'workerPrinterOffline', payload: evt };
    case 'PrinterOnline':
      return { event: 'workerPrinterOnline', payload: evt };
    case 'PrinterError':
      return { event: 'workerPrinterError', payload: evt };
    default: {
      // Exhaustiveness check: if a new WorkerPrintEventType variant is added
      // and not mapped here, fail the type system instead of silently
      // misrouting the event as a print failure (which used to be the
      // behavior of this branch and would corrupt the kiosk UX).
      const _exhaustive: never = evt.type;
      void _exhaustive;
      return { event: 'workerPrintFailed', payload: evt };
    }
  }
}

export function startWorkerReturnPipeServer(input: {
  pipeName: string;
  maxBytes: number;
  onEvent: (evt: WorkerPrintEvent) => void;
  logger?: Pick<Console, 'warn' | 'error' | 'log'>;
}): WorkerReturnPipeServerHandle {
  const logger = input.logger ?? console;
  const pipePath = `\\\\.\\pipe\\${input.pipeName}`;

  const server = net.createServer((socket) => {
    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        try {
          const evt = parseWorkerEventLine(line, input.maxBytes);
          input.onEvent(evt);
        } catch (err) {
          logger.warn(
            `[WORKER_RETURN_PIPE] Ignored payload: ${err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        index = buffer.indexOf('\n');
      }
    });

    // Catch ECONNRESET and other transient socket errors so they don't
    // propagate as unhandled exceptions and crash the process.
    socket.on('error', (err) => {
      logger.warn(
        `[WORKER_RETURN_PIPE] Socket error: ${err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  });

  // Track whether the ready promise has already settled so we don't call
  // resolve/reject twice if both 'listening' and 'error' fire.
  let settled = false;

  const ready = new Promise<void>((resolve, reject) => {
    server.once('listening', () => {
      settled = true;
      logger.log(`[WORKER_RETURN_PIPE] Listening on ${pipePath}`);
      resolve();
    });

    server.once('error', (err) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[WORKER_RETURN_PIPE] Server error: ${message}`);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });

  server.listen(pipePath);

  return {
    pipePath,
    server,
    ready,
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }

        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      }),
  };
}
