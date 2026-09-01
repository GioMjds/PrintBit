import type { Request, Response } from 'express';
import { ReportController } from './report.controller';
import type { ReportService } from './report.service';

describe('ReportController direct and non-session based endpoints', () => {
  let controller: ReportController;
  let mockReportService: jest.Mocked<Partial<ReportService>>;

  beforeEach(() => {
    mockReportService = {
      ensureStorageDirs: jest.fn(),
      submitReportIssue: jest.fn(),
      registerAttachment: jest.fn(),
      persistAttachmentWithStaging: jest.fn(),
      resolveAttachmentExtension: jest.fn().mockReturnValue('.jpg'),
      renderReportPortal: jest.fn().mockReturnValue('<!DOCTYPE html><html><head><base href="/report/"></head><body></body></html>'),
      isReportPortalAssetAllowed: jest.fn().mockReturnValue(true),
      getReportPortalAssetPath: jest.fn().mockReturnValue('C:/test/path/styles.css'),
    };

    controller = new ReportController(
      mockReportService as ReportService,
      {
        resolvePublicBaseUrl: () => new URL('http://192.168.4.1:3000'),
      },
    );
  });

  function createMockResponse(): Partial<Response> & {
    _status: number;
    _headers: Record<string, string>;
    _sent: any;
    _type: string;
  } {
    const res: any = {
      _status: 200,
      _headers: {},
      _sent: null,
      _type: '',
      status(code: number) {
        this._status = code;
        return this;
      },
      setHeader(name: string, value: string) {
        this._headers[name.toLowerCase()] = value;
        return this;
      },
      type(val: string) {
        this._type = val;
        return this;
      },
      send(data: any) {
        this._sent = data;
        return this;
      },
      json(data: any) {
        this._sent = data;
        return this;
      },
    };
    return res;
  }

  describe('POST /api/report-issues (direct report submission)', () => {
    it('submits report issue successfully without sessionId or token', async () => {
      (mockReportService.submitReportIssue as jest.Mock).mockResolvedValue({
        id: 'rp-123',
        sessionId: 'direct',
        timestamp: '2026-08-31T10:00:00.000Z',
        title: 'Printer paper jam',
        description: 'Tray 1 is jammed',
        category: 'hardware',
        status: 'open',
        attachmentIds: ['att-1'],
      });

      const req = {
        body: {
          title: 'Printer paper jam',
          description: 'Tray 1 is jammed',
          category: 'hardware',
          attachmentIds: ['att-1'],
        },
      } as unknown as Request;
      const res = createMockResponse();

      const submitDirect = (controller as any).submitDirectReportIssue;
      await submitDirect(req, res);

      expect(mockReportService.submitReportIssue).toHaveBeenCalledWith({
        title: 'Printer paper jam',
        description: 'Tray 1 is jammed',
        category: 'hardware',
        attachmentIds: ['att-1'],
      });
      expect(res._status).toBe(201);
      expect(res._sent).toEqual({ ok: true, reportIssueId: 'rp-123' });
    });

    it('returns 400 when validation fails', async () => {
      (mockReportService.submitReportIssue as jest.Mock).mockRejectedValue(
        new Error('Title is required'),
      );

      const req = {
        body: {
          title: '',
          description: 'something',
        },
      } as unknown as Request;
      const res = createMockResponse();

      const submitDirect = (controller as any).submitDirectReportIssue;
      await submitDirect(req, res);

      expect(res._status).toBe(400);
      expect(res._sent).toEqual({ error: 'Title is required' });
    });
  });

  describe('POST /api/report-issues/attachments (direct attachment upload)', () => {
    it('uploads attachment directly without requiring sessionId or token', async () => {
      (mockReportService.persistAttachmentWithStaging as jest.Mock).mockResolvedValue('C:/test/file.jpg');
      (mockReportService.registerAttachment as jest.Mock).mockResolvedValue({
        id: 'att-123',
        sessionId: 'direct',
        reportIssueId: null,
        timestamp: '2026-08-31T10:00:00.000Z',
        originalName: 'photo.jpg',
        storedName: 'uuid.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 1024,
        filePath: 'C:/test/file.jpg',
      });

      const req = {
        file: {
          originalname: 'photo.jpg',
          mimetype: 'image/jpeg',
          size: 1024,
        },
      } as unknown as Request;
      const res = createMockResponse();

      const uploadDirect = (controller as any).uploadDirectAttachment;
      await uploadDirect(req, res);

      expect(mockReportService.registerAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          originalName: 'photo.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 1024,
        }),
      );
      expect(res._status).toBe(201);
      expect(res._sent).toEqual({
        attachmentId: 'att-123',
        fileName: 'photo.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 1024,
        uploadedAt: '2026-08-31T10:00:00.000Z',
      });
    });
  });

  describe('GET /report (direct report portal rendering)', () => {
    it('renders portal HTML directly', () => {
      const req = {} as unknown as Request;
      const res = createMockResponse();

      const serveDirect = (controller as any).serveDirectReportPortal;
      serveDirect(req, res);

      expect(mockReportService.renderReportPortal).toHaveBeenCalledWith();
      expect(res._type).toBe('html');
      expect(res._sent).toContain('<base href="/report/">');
    });
  });

  describe('GET /api/report-issues/qr-url', () => {
    it('returns the customer-accessible report url using resolvePublicBaseUrl', () => {
      const req = {} as unknown as Request;
      const res = createMockResponse();

      const getReportQrUrl = (controller as any).getReportQrUrl;
      getReportQrUrl(req, res);

      expect(res._status).toBe(200);
      expect(res._sent).toEqual({ url: 'http://192.168.4.1:3000/report' });
    });
  });
});

