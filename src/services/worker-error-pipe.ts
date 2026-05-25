import net from 'node:net';

export interface WorkerErrorPayload {
  message: string;
  code?: string;
  source?: string;
  stack?: string;
  transactionId?: string;
  spoolerCorrelationKey?: string;
  timestampUtc: string;
}

export function buildWorkerErrorPayload(input: {
  message: string;
  code?: string;
  source?: string;
  stack?: string;
  transactionId?: string;
  spoolerCorrelationKey?: string;
}): WorkerErrorPayload {
  return {
    message: input.message,
    code: input.code,
    source: input.source,
    stack: input.stack,
    transactionId: input.transactionId,
    spoolerCorrelationKey: input.spoolerCorrelationKey,
    timestampUtc: new Date().toISOString(),
  };
}

export function serializeWorkerError(payload: WorkerErrorPayload): string {
  return `${JSON.stringify(payload)}\n`;
}

export async function sendWorkerError(
  payload: WorkerErrorPayload,
  pipeName: string,
  logger: Pick<Console, 'warn'> = console,
): Promise<void> {
  if (!pipeName || pipeName.trim().length === 0) {
    logger.warn('[WORKER_PIPE] Missing pipe name; skipping error send.');
    return;
  }

  const pipePath = `\\\\.\\pipe\\${pipeName}`;

  await new Promise<void>((resolve) => {
    const client = net.createConnection(pipePath);

    const finish = () => resolve();

    client.once('connect', () => {
      client.write(serializeWorkerError(payload), () => {
        client.end();
      });
    });

    client.once('error', (err) => {
      logger.warn(
        `[WORKER_PIPE] Failed to send error to ${pipePath}: ${err.message}`,
      );
      finish();
    });

    client.once('close', finish);
  });
}
