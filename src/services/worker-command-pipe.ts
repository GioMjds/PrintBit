import net from 'node:net';

export type WorkerCommandType = 'cancel_job' | 'pause_job' | 'resume_job';

export interface WorkerCommandPayload {
  type: WorkerCommandType;
  transactionId: string;
  spoolerCorrelationKey: string;
  reason: string;
  timestampUtc: string;
}

export interface SendWorkerCommandOptions {
  pipeName?: string;
  timeoutMs?: number;
  logger?: Pick<Console, 'warn' | 'error' | 'log'>;
}

export async function sendWorkerCommand(
  payload: WorkerCommandPayload,
  options?: SendWorkerCommandOptions,
): Promise<boolean> {
  const pipeName = options?.pipeName ?? 'printbit-worker-commands';
  const timeoutMs = options?.timeoutMs ?? 3000;
  const logger = options?.logger ?? console;
  const pipePath = pipeName.startsWith('\\\\.\\pipe\\')
    ? pipeName
    : `\\\\.\\pipe\\${pipeName}`;

  return new Promise<boolean>((resolve) => {
    let resolved = false;
    let socket: net.Socket;

    const finish = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      try {
        socket?.removeAllListeners();
        socket?.destroy();
      } catch {}
      resolve(result);
    };

    try {
      socket = net.connect(pipePath);
    } catch (err) {
      logger.warn(`[WORKER_COMMAND_PIPE] Failed to create socket connection to ${pipePath}: ${err instanceof Error ? err.message : String(err)}`);
      return resolve(false);
    }

    socket.setTimeout(timeoutMs, () => {
      logger.warn(`[WORKER_COMMAND_PIPE] Connection timeout to ${pipePath}`);
      finish(false);
    });

    socket.on('connect', () => {
      try {
        const frame = JSON.stringify(payload) + '\n';
        socket.end(frame, 'utf-8', () => {
          finish(true);
        });
      } catch (err) {
        logger.warn(`[WORKER_COMMAND_PIPE] Serialization failure: ${err instanceof Error ? err.message : String(err)}`);
        finish(false);
      }
    });

    socket.on('error', (err) => {
      logger.warn(`[WORKER_COMMAND_PIPE] Socket error connecting to ${pipePath}: ${err.message}`);
      finish(false);
    });
  });
}
