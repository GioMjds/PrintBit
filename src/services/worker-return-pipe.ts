import net from 'node:net';

export type WorkerPrintEventType =
  | 'PrintStarted'
  | 'PrintSucceeded'
  | 'PrintFailed';

export interface WorkerPrintEvent {
  type: WorkerPrintEventType;
  transactionId?: string;
  spoolerCorrelationKey?: string;
  fileName?: string;
  printerName?: string;
  failureStage?: string;
  message?: string;
  timestampUtc: string;
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

export function mapWorkerEventToSocket(
  evt: WorkerPrintEvent,
): {
  event: 'workerPrintStarted' | 'workerPrintSucceeded' | 'workerPrintFailed';
  payload: WorkerPrintEvent;
} {
  switch (evt.type) {
    case 'PrintStarted':
      return { event: 'workerPrintStarted', payload: evt };
    case 'PrintSucceeded':
      return { event: 'workerPrintSucceeded', payload: evt };
    case 'PrintFailed':
      return { event: 'workerPrintFailed', payload: evt };
    default:
      return { event: 'workerPrintFailed', payload: evt };
  }
}

export function startWorkerReturnPipeServer(input: {
  pipeName: string;
  maxBytes: number;
  onEvent: (evt: WorkerPrintEvent) => void;
  logger?: Pick<Console, 'warn' | 'error' | 'log'>;
}): net.Server {
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
  });

  server.listen(pipePath, () => {
    logger.log(`[WORKER_RETURN_PIPE] Listening on ${pipePath}`);
  });

  return server;
}
