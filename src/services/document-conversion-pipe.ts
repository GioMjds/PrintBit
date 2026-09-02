import net from 'node:net';
import crypto from 'node:crypto';
import { DOCUMENT_CONVERSION_PIPE_NAME } from '@/config/http.config';

export interface DocumentConversionRequest {
  requestId: string;
  sourcePath: string;
  outputDirectory?: string | null;
  targetFormat?: string;
  timeoutSeconds?: number;
}

export interface DocumentConversionResult {
  requestId: string;
  success: boolean;
  outputPath: string | null;
  pageCount: number | null;
  sourceFormat: string | null;
  durationMs: number;
  errorMessage: string | null;
}

export interface ConvertDocumentOptions {
  pipeName?: string;
  outputDirectory?: string;
  targetFormat?: string;
  timeoutSeconds?: number;
  connectTimeoutMs?: number;
}

const OFFLINE_ERROR_MESSAGE =
  'Document conversion service is offline or unavailable. Ensure PrintBit Hardware Service is running.';

export async function convertDocumentViaWorker(
  sourcePath: string,
  options?: ConvertDocumentOptions,
): Promise<DocumentConversionResult> {
  const pipeName = options?.pipeName ?? DOCUMENT_CONVERSION_PIPE_NAME;
  const pipePath = pipeName.startsWith('\\\\.\\pipe\\')
    ? pipeName
    : `\\\\.\\pipe\\${pipeName}`;

  const timeoutSeconds = options?.timeoutSeconds ?? 60;
  const timeoutMs =
    options?.connectTimeoutMs ??
    (timeoutSeconds > 0 ? timeoutSeconds * 1000 : 60_000);

  const request: DocumentConversionRequest = {
    requestId: crypto.randomUUID(),
    sourcePath,
    outputDirectory: options?.outputDirectory ?? null,
    targetFormat: options?.targetFormat ?? 'pdf',
    timeoutSeconds,
  };

  return new Promise<DocumentConversionResult>((resolve, reject) => {
    let settled = false;
    let responseBuffer = '';

    const socket = net.connect(pipePath);

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      callback();
    };

    socket.setTimeout(timeoutMs, () => {
      finish(() => {
        reject(new Error(OFFLINE_ERROR_MESSAGE));
      });
    });

    socket.on('error', (_err) => {
      finish(() => {
        reject(new Error(OFFLINE_ERROR_MESSAGE));
      });
    });

    socket.on('connect', () => {
      try {
        const frame = JSON.stringify(request) + '\n';
        socket.write(frame, 'utf-8', (writeErr) => {
          if (writeErr) {
            finish(() => {
              reject(new Error(OFFLINE_ERROR_MESSAGE));
            });
          }
        });
      } catch (err) {
        finish(() => {
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      }
    });

    socket.on('data', (chunk) => {
      responseBuffer += chunk.toString('utf-8');
      const newlineIndex = responseBuffer.indexOf('\n');
      if (newlineIndex !== -1) {
        const rawLine = responseBuffer.slice(0, newlineIndex).trim();
        try {
          const result = JSON.parse(rawLine) as DocumentConversionResult;
          if (!result.success) {
            finish(() => {
              reject(
                new Error(
                  result.errorMessage ||
                    'Document conversion service reported failure.',
                ),
              );
            });
          } else {
            finish(() => {
              resolve(result);
            });
          }
        } catch (parseErr) {
          finish(() => {
            reject(
              new Error(
                `Failed to parse document conversion response: ${
                  parseErr instanceof Error
                    ? parseErr.message
                    : String(parseErr)
                }`,
              ),
            );
          });
        }
      }
    });

    socket.on('close', () => {
      if (!settled) {
        finish(() => {
          reject(new Error(OFFLINE_ERROR_MESSAGE));
        });
      }
    });
  });
}
