import fs from 'node:fs';
import path from 'node:path';
import { printFile, detectDefaultPrinter } from '@/services/printer';
import { printerStateProjection } from '@/services/printer-state-projection';

const mockHandoffToWorker = jest.fn();
const mockPrepareWorkerPdf = jest.fn();
const mockExecFile = jest.fn();
const mockSpawn = jest.fn();
const mockExec = jest.fn();

jest.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  spawn: (...args: unknown[]) => mockSpawn(...args),
  exec: (...args: unknown[]) => mockExec(...args),
}));

jest.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  spawn: (...args: unknown[]) => mockSpawn(...args),
  exec: (...args: unknown[]) => mockExec(...args),
}));

jest.mock('@/services/worker-handoff', () => ({
  handoffToWorker: (...args: unknown[]) => mockHandoffToWorker(...args),
  WorkerHandoffError: class extends Error {},
}));

jest.mock('@/services/document-rotation', () => ({
  normalizeRotationDeg: jest.fn((deg) => deg ?? 0),
  preparePrintRotationArtifact: jest.fn(async ({ sourcePath }) => ({
    printPath: sourcePath,
    cleanupPaths: [],
  })),
}));

jest.mock('@/services/prepare-print-pdf', () => ({
  prepareWorkerPdf: (...args: unknown[]) => mockPrepareWorkerPdf(...args),
}));

describe('Printer Worker Handoff', () => {
  const uploadsDir = path.resolve('uploads');
  const validUuid = '12345678-1234-4234-8234-123456789abc';
  const testFilename = `${validUuid}.pdf`;
  const testFilePath = path.join(uploadsDir, testFilename);

  beforeAll(() => {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    fs.writeFileSync(testFilePath, 'dummy pdf content for testing');
  });

  afterAll(() => {
    if (fs.existsSync(testFilePath)) {
      try {
        fs.unlinkSync(testFilePath);
      } catch {
        /* ignore */
      }
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockHandoffToWorker.mockResolvedValue({
      targetPath: path.join(uploadsDir, 'mock_target.pdf'),
      fileName: 'mock_worker_job.pdf',
    });
    mockPrepareWorkerPdf.mockImplementation(async ({ sourcePath }) => ({
      pdfPath: sourcePath,
      cleanupPaths: [],
      pageCount: 2,
    }));
  });

  describe('printFile', () => {
    it('dispatches through handoffToWorker with correct transactionId, settings, and returns success', async () => {
      const result = await printFile(
        testFilename,
        {
          copies: 2,
          colorMode: 'colored',
          orientation: 'landscape',
          rotationDeg: 90,
          paperSize: 'A4',
          pageRange: '1-2',
          quality: 'high',
        },
        {
          transactionId: 'test-tx-001',
          spoolerCorrelationKey: 'test-spool-001',
        },
      );

      expect(result.success).toBe(true);
      expect((result as unknown as { fileName: string }).fileName).toBe('mock_worker_job.pdf');

      expect(mockHandoffToWorker).toHaveBeenCalledTimes(1);
      const callArg = mockHandoffToWorker.mock.calls[0][0];
      expect(callArg.transactionId).toBe('test-tx-001');
      expect(callArg.spoolerCorrelationKey).toBe('test-spool-001');
      expect(callArg.printSettings).toEqual({
        copies: 2,
        color: true,
        orientation: 'landscape',
        rotationDeg: 90,
        paperSize: 'A4',
        pageRange: '1-2',
        quality: 'high',
      });
      expect(callArg.sourcePath).toBe(testFilePath);
      expect(mockPrepareWorkerPdf).toHaveBeenCalledWith({
        sourcePath: testFilePath,
      });
    });

    it('falls back to generated UUIDs when transactionId or spoolerCorrelationKey are omitted', async () => {
      const result = await printFile(
        testFilename,
        {
          copies: 1,
          colorMode: 'grayscale',
          orientation: 'portrait',
          paperSize: 'A4',
        },
      );

      expect(result.success).toBe(true);
      expect(mockHandoffToWorker).toHaveBeenCalledTimes(1);
      const callArg = mockHandoffToWorker.mock.calls[0][0];
      expect(typeof callArg.transactionId).toBe('string');
      expect(callArg.transactionId.length).toBeGreaterThan(0);
      expect(typeof callArg.spoolerCorrelationKey).toBe('string');
      expect(callArg.spoolerCorrelationKey.length).toBeGreaterThan(0);
      expect(callArg.printSettings).toEqual({
        copies: 1,
        color: false,
        orientation: 'portrait',
        rotationDeg: 0,
        paperSize: 'A4',
        pageRange: undefined,
        quality: undefined,
      });
    });
  });

  describe('detectDefaultPrinter', () => {
    it('does not spawn any child processes or PowerShell', async () => {
      printerStateProjection.applyEvent({
        type: 'PrinterStatusSnapshot',
        printerName: 'EPSON L5290 Series',
        message: 'Printer is online',
        timestampUtc: new Date().toISOString(),
      });

      await detectDefaultPrinter();

      expect(mockExecFile).not.toHaveBeenCalled();
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(mockExec).not.toHaveBeenCalled();
    });
  });
});
