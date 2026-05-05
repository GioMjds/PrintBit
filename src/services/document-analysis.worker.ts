import { parentPort, workerData } from 'node:worker_threads';
import { analyzeDocument } from './document-analysis';

async function run() {
  if (!parentPort) return;

  try {
    const result = await analyzeDocument({
      filePath: workerData.filePath,
      contentType: workerData.contentType,
      filename: workerData.filename,
    });
    parentPort.postMessage({ type: 'success', result });
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

run();
