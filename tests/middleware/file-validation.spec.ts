import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import {
  createUploadSecurityMiddleware,
  type UploadSecurityMiddlewareDeps,
} from '@/middleware/file-validation';
import type {
  DefenderScanner,
  DefenderHealth,
  DefenderScanResult,
} from '@/services/defender-scanner';

jest.mock('@/services/admin', () => ({
  adminService: {
    appendAdminLog: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('@/services/anomaly', () => ({
  anomalyService: {
    report: jest.fn().mockResolvedValue({}),
  },
  buildAnomalyFingerprint: jest.fn(() => 'fingerprint'),
}));

describe('Upload Security Middleware', () => {
  let tempDir: string;
  let stagingDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `printbit-mv-test-${randomUUID()}`);
    stagingDir = path.join(tempDir, '.staging');
    await fs.promises.mkdir(stagingDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  function fakeScanner(options: {
    health?: Partial<DefenderHealth>;
    scan?: Partial<DefenderScanResult>;
  }): DefenderScanner {
    return {
      getHealth: jest.fn().mockResolvedValue({
        status: options.health?.status ?? 'clean',
        signatureAgeHours: options.health?.signatureAgeHours ?? 10,
        detail: options.health?.detail ?? null,
      }),
      scanFile: jest.fn().mockResolvedValue({
        status: options.scan?.status ?? 'clean',
        detectionName: options.scan?.detectionName ?? null,
        detail: options.scan?.detail ?? null,
      }),
    };
  }

  async function createStagedFile(
    content: Buffer | string,
    originalname = 'test.pdf',
    mimetype = 'application/pdf',
  ): Promise<Express.Multer.File> {
    const fileId = randomUUID();
    const filePath = path.join(stagingDir, `${fileId}.upload`);
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    await fs.promises.writeFile(filePath, buffer);

    return {
      fieldname: 'file',
      originalname,
      encoding: '7bit',
      mimetype,
      size: buffer.length,
      destination: stagingDir,
      filename: `${fileId}.upload`,
      path: filePath,
      buffer: undefined as unknown as Buffer,
      stream: undefined as unknown as any,
    };
  }

  function mockRequest(file?: Express.Multer.File): Request {
    return {
      file,
      params: { sessionId: 'test-session-123' },
      query: { token: 'test-token-456' },
      header: jest.fn().mockReturnValue(null),
      headers: {},
      ip: '127.0.0.1',
      method: 'POST',
      route: { path: '/upload' },
    } as unknown as Request;
  }

  function mockResponse(): Response {
    const res = {} as Response;
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  }

  describe('Scanner gate', () => {
    it.each([
      ['wireless-session-upload', 'scanForMalware'],
      ['legacy-upload', 'scanLegacyUploadForMalware'],
      ['report-issue-attachment', 'scanReportIssueAttachmentForMalware'],
    ] as const)(
      '%s rejects stale Defender before persistence',
      async (_surface, middlewareName) => {
        const scanner = fakeScanner({
          health: { status: 'stale', signatureAgeHours: 169, detail: null },
        });
        const file = await createStagedFile(Buffer.from('%PDF-1.7'), 'doc.pdf');
        const { middleware } = createUploadSecurityMiddleware({ scanner });
        const res = mockResponse();
        const next = jest.fn();

        await (middleware[middlewareName] as any)(
          mockRequest(file),
          res,
          next,
        );

        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'SCAN_UNAVAILABLE' }),
        );
        expect(next).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['wireless-session-upload', 'scanForMalware'],
      ['legacy-upload', 'scanLegacyUploadForMalware'],
      ['report-issue-attachment', 'scanReportIssueAttachmentForMalware'],
    ] as const)(
      '%s rejects unavailable Defender before persistence',
      async (_surface, middlewareName) => {
        const scanner = fakeScanner({
          health: { status: 'unavailable', signatureAgeHours: null, detail: 'disabled' },
        });
        const file = await createStagedFile(Buffer.from('%PDF-1.7'), 'doc.pdf');
        const { middleware } = createUploadSecurityMiddleware({ scanner });
        const res = mockResponse();
        const next = jest.fn();

        await (middleware[middlewareName] as any)(
          mockRequest(file),
          res,
          next,
        );

        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'SCAN_UNAVAILABLE' }),
        );
        expect(next).not.toHaveBeenCalled();
      },
    );

    it('quarantines an infected valid PDF and does not call next', async () => {
      const scanner = fakeScanner({
        scan: {
          status: 'infected',
          detectionName: 'EICAR-Test-File',
          detail: null,
        },
      });
      const file = await createStagedFile(Buffer.from('%PDF-1.7'), 'eicar.pdf');
      const { middleware } = createUploadSecurityMiddleware({ scanner });
      const res = mockResponse();
      const next = jest.fn();

      await middleware.scanForMalware(mockRequest(file), res, next);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'FILE_INFECTED' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next when Defender scan is clean', async () => {
      const scanner = fakeScanner({
        scan: { status: 'clean', detectionName: null, detail: null },
      });
      const file = await createStagedFile(Buffer.from('%PDF-1.7'), 'clean.pdf');
      const { middleware } = createUploadSecurityMiddleware({ scanner });
      const res = mockResponse();
      const next = jest.fn();

      await middleware.scanForMalware(mockRequest(file), res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('rejects with 503 SCAN_FAILED when scan times out', async () => {
      const scanner = fakeScanner({
        scan: { status: 'timeout', detectionName: null, detail: 'Scan timed out' },
      });
      const file = await createStagedFile(Buffer.from('%PDF-1.7'), 'doc.pdf');
      const { middleware } = createUploadSecurityMiddleware({ scanner });
      const res = mockResponse();
      const next = jest.fn();

      await middleware.scanForMalware(mockRequest(file), res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'SCAN_FAILED' }),
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Staged file magic byte validation', () => {
    it('validates a correct PDF magic header on disk', async () => {
      const file = await createStagedFile(Buffer.from('%PDF-1.7 valid pdf contents'), 'test.pdf');
      const { middleware } = createUploadSecurityMiddleware();
      const res = mockResponse();
      const next = jest.fn();

      await middleware.validateMagicBytes(mockRequest(file), res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('quarantines and rejects a file with mismatched magic bytes', async () => {
      // Send an MZ executable disguised as a PDF
      const file = await createStagedFile(Buffer.from('MZ\x90\x00\x03\x00\x00\x00'), 'disguised.pdf');
      const { middleware } = createUploadSecurityMiddleware();
      const res = mockResponse();
      const next = jest.fn();

      await middleware.validateMagicBytes(mockRequest(file), res, next);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'UNSUPPORTED_TYPE' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('validates WebP image headers on report attachments', async () => {
      const validWebpHeader = Buffer.concat([
        Buffer.from('RIFF'),
        Buffer.alloc(4),
        Buffer.from('WEBP'),
      ]);
      const file = await createStagedFile(
        validWebpHeader,
        'photo.webp',
        'image/webp',
      );
      const { middleware } = createUploadSecurityMiddleware();
      const res = mockResponse();
      const next = jest.fn();

      await middleware.validateReportIssueAttachmentMagicBytes(
        mockRequest(file),
        res,
        next,
      );

      expect(next).toHaveBeenCalled();
    });
  });
});
