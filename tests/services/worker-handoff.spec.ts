import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { handoffToWorker } from '@/services/worker-handoff';

describe('worker print sidecar contract', () => {
  test('persists every physical print setting for the C# worker', async () => {
    const tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'printbit-worker-handoff-'),
    );
    const sourcePath = path.join(tempDirectory, 'source.pdf');
    const queueDir = path.join(tempDirectory, 'queue');
    await fs.mkdir(queueDir);
    await fs.writeFile(sourcePath, '%PDF-1.7');

    try {
      const result = await handoffToWorker({
        sourcePath,
        queueDir,
        transactionId: 'tx-123',
        spoolerCorrelationKey: 'spool-456',
        printSettings: {
          copies: 3,
          color: true,
          quality: 'high',
          orientation: 'landscape',
          rotationDeg: 270,
          paperSize: 'Legal',
          pageRange: '2-4',
          duplex: true,
        },
      });

      const sidecarPath = result.targetPath.replace(/\.pdf$/i, '.json');
      const sidecar = JSON.parse(await fs.readFile(sidecarPath, 'utf8'));
      expect(sidecar).toMatchObject({
        copies: 3,
        color: true,
        quality: 'high',
        orientation: 'landscape',
        rotationDeg: 270,
        paperSize: 'Legal',
        pageRange: '2-4',
        duplex: true,
      });
    } finally {
      await fs.rm(tempDirectory, { recursive: true, force: true });
    }
  });
});
