import type { Request, Response } from 'express';
import type { Server } from 'socket.io';
import type { SessionStore } from '../../src/services/session';
import { PowerSafetyService } from '../../src/services/power-safety';
import { FinancialService } from '../../src/modules/financial/financial.service';
import { CopyController } from '../../src/modules/copy/copy.controller';
import { CopyService } from '../../src/modules/copy/copy.service';
import { ScannerController } from '../../src/modules/scanner/scanner.controller';
import { ScannerService } from '../../src/modules/scanner/scanner.service';
import { WirelessSessionController } from '../../src/modules/wireless-session/wireless-session.controller';
import { WirelessSessionService } from '../../src/modules/wireless-session/wireless-session.service';
import { enqueuePrintJob } from '../../src/modules/print-queue/print-queue.service';
import { PrintJobEnqueueError } from '../../src/modules/print-queue/print-queue.integration';
import type { PrintJobEnqueuePayload } from '../../src/modules/print-queue/print-job.schema';

function createMockResponse() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  return res as Response & {
    status: jest.Mock;
    json: jest.Mock;
    send: jest.Mock;
  };
}

describe('Power Safety Module Guards', () => {
  let mockSafetyService: PowerSafetyService;

  beforeEach(() => {
    mockSafetyService = new PowerSafetyService({
      store: {
        savePowerSafetyState: jest.fn(),
        getPowerSafetyState: jest.fn(),
        clear: jest.fn(),
      },
      serialService: {
        lockCoinSlot: jest.fn(),
        unlockOwnedCoinSlot: jest.fn(() => true),
        isCoinSlotLocked: jest.fn(() => false),
      },
    });
    // By default, startup state of PowerSafetyService is fail-closed (canAcceptCustomerWork() === false)
  });

  describe('Financial Module Guards', () => {
    let financialService: FinancialService;

    beforeEach(() => {
      financialService = new FinancialService({
        io: {} as Server,
        sessionStore: {} as SessionStore,
        resolvePublicBaseUrl: () => new URL('http://127.0.0.1:3000'),
        powerSafetyService: mockSafetyService,
      });
    });

    test('confirmPayment responds 503 POWER_EMERGENCY before settlement or idempotency', async () => {
      const req = {
        get: jest.fn().mockReturnValue('test-idempotency-key'),
        body: {
          amount: 5,
          mode: 'print',
          sessionId: 'session-123',
          documentId: 'doc-123',
        },
      } as unknown as Request;
      const res = createMockResponse();

      await financialService.confirmPayment(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'POWER_EMERGENCY',
          message: 'Power emergency active; customer work suspended',
        }),
      );
    });

    test('uploadLegacy responds 503 POWER_EMERGENCY during emergency', async () => {
      const req = {
        file: {
          originalname: 'test.pdf',
          size: 1024,
          path: '/tmp/test.pdf',
        },
      } as unknown as Request;
      const res = createMockResponse();

      await financialService.uploadLegacy(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'POWER_EMERGENCY',
          message: 'Power emergency active; customer work suspended',
        }),
      );
    });

    test('printLegacy responds 503 POWER_EMERGENCY during emergency', async () => {
      const req = {
        body: {
          filename: 'test.pdf',
        },
      } as unknown as Request;
      const res = createMockResponse();

      await financialService.printLegacy(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'POWER_EMERGENCY',
          message: 'Power emergency active; customer work suspended',
        }),
      );
    });
  });

  describe('Copy Module Guards', () => {
    test('createCopyJob responds 503 POWER_EMERGENCY before idempotency claim', async () => {
      const mockCopyService = {
        claimIdempotencyKey: jest.fn(),
        createCopyJob: jest.fn(),
      } as unknown as CopyService;

      const copyController = new CopyController(
        mockCopyService,
        mockSafetyService,
      );

      const req = {
        get: jest.fn().mockReturnValue('idempotency-copy-key'),
        body: {
          copies: 1,
          colorMode: 'grayscale',
        },
      } as unknown as Request;
      const res = createMockResponse();

      // Access private createCopyJob via any casting
      await (copyController as any).createCopyJob(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'POWER_EMERGENCY',
          message: 'Power emergency active; customer work suspended',
        }),
      );
      expect(mockCopyService.claimIdempotencyKey).not.toHaveBeenCalled();
    });
  });

  describe('Scanner Module Guards', () => {
    let scannerController: ScannerController;
    let mockScannerService: ScannerService;

    beforeEach(() => {
      mockScannerService = {
        interactiveScan: jest.fn(),
        chargeSoftCopy: jest.fn(),
        createScanJob: jest.fn(),
        previewScan: jest.fn(),
        exportToUsb: jest.fn(),
        createWirelessLink: jest.fn(),
        releaseScanFileByToken: jest.fn(),
        toSafeScanFilename: jest.fn((name) => name),
      } as unknown as ScannerService;

      scannerController = new ScannerController(mockScannerService, {
        io: {} as any,
        resolvePublicBaseUrl: () => new URL('http://127.0.0.1:3000'),
        powerSafetyService: mockSafetyService,
      });
    });

    test('interactiveScan responds 503 POWER_EMERGENCY', async () => {
      const req = { body: { source: 'glass', color: 'grayscale' } } as unknown as Request;
      const res = createMockResponse();

      await (scannerController as any).interactiveScan(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'POWER_EMERGENCY',
        }),
      );
      expect(mockScannerService.interactiveScan).not.toHaveBeenCalled();
    });

    test('chargeSoftCopy responds 503 POWER_EMERGENCY', async () => {
      const req = { body: { filename: 'scan-1.pdf' } } as unknown as Request;
      const res = createMockResponse();

      await (scannerController as any).chargeSoftCopy(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'POWER_EMERGENCY',
        }),
      );
      expect(mockScannerService.chargeSoftCopy).not.toHaveBeenCalled();
    });

    test('createScanJob responds 503 POWER_EMERGENCY', async () => {
      const req = { body: { source: 'feeder', dpi: 300 } } as unknown as Request;
      const res = createMockResponse();

      await (scannerController as any).createScanJob(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'POWER_EMERGENCY',
        }),
      );
      expect(mockScannerService.createScanJob).not.toHaveBeenCalled();
    });

    test('previewScan responds 503 POWER_EMERGENCY', async () => {
      const req = {} as unknown as Request;
      const res = createMockResponse();

      await (scannerController as any).previewScan(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'POWER_EMERGENCY',
        }),
      );
      expect(mockScannerService.previewScan).not.toHaveBeenCalled();
    });

    test('exportToUsb responds 503 POWER_EMERGENCY', async () => {
      const req = { body: { filename: 'scan-1.pdf', drive: 'E:' } } as unknown as Request;
      const res = createMockResponse();

      await (scannerController as any).exportToUsb(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'POWER_EMERGENCY',
        }),
      );
      expect(mockScannerService.exportToUsb).not.toHaveBeenCalled();
    });

    test('createWirelessLink responds 503 POWER_EMERGENCY', async () => {
      const req = { body: { filename: 'scan-1.pdf' } } as unknown as Request;
      const res = createMockResponse();

      await (scannerController as any).createWirelessLink(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'POWER_EMERGENCY',
        }),
      );
      expect(mockScannerService.createWirelessLink).not.toHaveBeenCalled();
    });

    test('releaseScanFile responds 503 POWER_EMERGENCY', async () => {
      const req = { body: { releaseToken: 'tok-123' } } as unknown as Request;
      const res = createMockResponse();

      await (scannerController as any).releaseScanFile(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'POWER_EMERGENCY',
        }),
      );
      expect(mockScannerService.releaseScanFileByToken).not.toHaveBeenCalled();
    });
  });

  describe('Wireless Session Guards', () => {
    test('createSession responds 503 POWER_EMERGENCY', async () => {
      const mockSessionService = new Proxy(
        {
          createSession: jest.fn(),
        } as any,
        {
          get: (target, prop) => {
            if (prop in target) return target[prop];
            return jest.fn();
          },
        },
      ) as unknown as WirelessSessionService;

      const wirelessController = new WirelessSessionController(
        mockSessionService,
        mockSafetyService,
      );

      const req = {} as unknown as Request;
      const res = createMockResponse();
      const next = jest.fn();

      // Test router route handler directly
      const sessionRoute = wirelessController.router.stack.find(
        (layer: any) => layer.route?.path === '/api/wireless/sessions' && layer.route?.methods?.get,
      );
      expect(sessionRoute).toBeDefined();
      expect(sessionRoute?.route).toBeDefined();

      // Invoke the route handlers (last handler in stack or wrapper)
      const stack = sessionRoute!.route!.stack;
      const lastHandler = stack[stack.length - 1].handle;
      await lastHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'POWER_EMERGENCY',
          message: 'Power emergency active; customer work suspended',
        }),
      );
      expect(mockSessionService.createSession).not.toHaveBeenCalled();
    });
  });

  describe('Print Queue Enqueue Guard', () => {
    test('enqueuePrintJob throws PrintJobEnqueueError(POWER_EMERGENCY) during power emergency', async () => {
      const payload = {
        schemaVersion: 1,
        correlation: {
          transactionId: 'tx-123',
          spoolerCorrelationKey: 'spooler-123',
          idempotencyKey: 'idem-123',
          sessionId: null,
          documentId: null,
        },
        request: {
          mode: 'print',
          copies: 1,
          colorMode: 'grayscale',
          orientation: 'portrait',
          rotationDeg: 0,
          paperSize: 'A4',
          duplex: false,
          pageRange: null,
          serverFilename: 'file.pdf',
          printerName: null,
          quality: 'standard',
          settings: { quality: 'standard' },
        },
        financial: {
          requiredAmount: 5,
          billedColorPages: 0,
          billedBwPages: 1,
        },
        dispatch: {
          enqueuedAt: new Date().toISOString(),
        },
      } as PrintJobEnqueuePayload;

      await expect(
        enqueuePrintJob(payload, { powerSafetyService: mockSafetyService }),
      ).rejects.toThrow(PrintJobEnqueueError);

      try {
        await enqueuePrintJob(payload, { powerSafetyService: mockSafetyService });
      } catch (err) {
        expect((err as PrintJobEnqueueError).code).toBe('POWER_EMERGENCY');
      }
    });
  });
});
