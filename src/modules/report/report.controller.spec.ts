import type { Request, Response } from 'express';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { reportIssueStore, getSqliteDb } from '@/core/database/sqlite-storage';
import type { ReportIssueEntry, ReportIssueAttachmentEntry } from './report.schema';

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

  describe('Admin report issues queue views and validation (GET /api/admin/report-issues)', () => {
    let realService: ReportService;
    let adminController: ReportController;

    const openReport: ReportIssueEntry = {
      id: 'rp-test-open',
      sessionId: 'sess-rp-open',
      timestamp: '2026-09-01T10:00:00.000Z',
      title: 'Open issue report',
      description: 'Paper jammed in tray',
      category: 'hardware',
      status: 'open',
      attachmentIds: [],
      acknowledgedAt: null,
      resolvedAt: null,
    };

    const ackReport: ReportIssueEntry = {
      id: 'rp-test-ack',
      sessionId: 'sess-rp-ack',
      timestamp: '2026-09-01T10:30:00.000Z',
      title: 'Acknowledged issue report',
      description: 'Coin slot stuck',
      category: 'hardware',
      status: 'acknowledged',
      attachmentIds: [],
      acknowledgedAt: '2026-09-01T10:35:00.000Z',
      resolvedAt: null,
    };

    const resolvedReport: ReportIssueEntry = {
      id: 'rp-test-resolved',
      sessionId: 'sess-rp-resolved',
      timestamp: '2026-09-01T11:00:00.000Z',
      title: 'Resolved issue report',
      description: 'Network cable reattached',
      category: 'network',
      status: 'resolved',
      attachmentIds: ['att-test-resolved'],
      acknowledgedAt: '2026-09-01T11:05:00.000Z',
      resolvedAt: '2026-09-01T11:30:00.000Z',
    };

    const attachment: ReportIssueAttachmentEntry = {
      id: 'att-test-resolved',
      sessionId: 'sess-rp-resolved',
      reportIssueId: 'rp-test-resolved',
      timestamp: '2026-09-01T11:00:00.000Z',
      originalName: 'cable-photo.jpg',
      storedName: 'cable-photo-uuid.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 2048,
      filePath: 'uploads/report-issues/cable-photo-uuid.jpg',
    };

    beforeEach(() => {
      realService = new ReportService();
      adminController = new ReportController(realService, {
        resolvePublicBaseUrl: () => new URL('http://192.168.4.1:3000'),
      });

      const db = getSqliteDb();
      db.prepare('DELETE FROM report_issue_entries WHERE id IN (?, ?, ?)').run(
        openReport.id,
        ackReport.id,
        resolvedReport.id,
      );
      db.prepare('DELETE FROM report_issue_attachments WHERE id = ?').run(attachment.id);

      reportIssueStore.createReportIssue(openReport);
      reportIssueStore.createReportIssue(ackReport);
      reportIssueStore.createReportIssue(resolvedReport);
      reportIssueStore.registerAttachment(attachment);
    });

    afterEach(() => {
      const db = getSqliteDb();
      db.prepare('DELETE FROM report_issue_entries WHERE id IN (?, ?, ?)').run(
        openReport.id,
        ackReport.id,
        resolvedReport.id,
      );
      db.prepare('DELETE FROM report_issue_attachments WHERE id = ?').run(attachment.id);
    });

    it('returns 400 when view parameter is unknown', () => {
      const req = {
        query: { view: 'unknown-view' },
      } as unknown as Request;
      const res = createMockResponse();

      (adminController as any).listAdminReportIssues(req, res);

      expect(res._status).toBe(400);
      expect(res._sent).toEqual({ error: 'view must be active, archived, or all.' });
    });

    it('asserts queue views: no view returns all items (backward compatibility)', () => {
      const req = { query: {} } as unknown as Request;
      const res = createMockResponse();

      (adminController as any).listAdminReportIssues(req, res);

      expect(res._status).toBe(200);
      const ids = res._sent.items.map((e: ReportIssueEntry) => e.id);
      expect(ids).toContain(openReport.id);
      expect(ids).toContain(ackReport.id);
      expect(ids).toContain(resolvedReport.id);
    });

    it('asserts queue views: view=active excludes only resolved items', () => {
      const req = { query: { view: 'active' } } as unknown as Request;
      const res = createMockResponse();

      (adminController as any).listAdminReportIssues(req, res);

      expect(res._status).toBe(200);
      const ids = res._sent.items.map((e: ReportIssueEntry) => e.id);
      expect(ids).toContain(openReport.id);
      expect(ids).toContain(ackReport.id);
      expect(ids).not.toContain(resolvedReport.id);
    });

    it('asserts queue views: view=archived returns only resolved items', () => {
      const req = { query: { view: 'archived' } } as unknown as Request;
      const res = createMockResponse();

      (adminController as any).listAdminReportIssues(req, res);

      expect(res._status).toBe(200);
      const ids = res._sent.items.map((e: ReportIssueEntry) => e.id);
      expect(ids).not.toContain(openReport.id);
      expect(ids).not.toContain(ackReport.id);
      expect(ids).toContain(resolvedReport.id);
    });

    it('asserts resolving changes result from Active to Archived, and reopening reverses it', async () => {
      // Initially ackReport is in active, not in archived
      let activeRes = createMockResponse();
      (adminController as any).listAdminReportIssues({ query: { view: 'active' } } as unknown as Request, activeRes);
      expect(activeRes._sent.items.map((e: ReportIssueEntry) => e.id)).toContain(ackReport.id);

      let archivedRes = createMockResponse();
      (adminController as any).listAdminReportIssues({ query: { view: 'archived' } } as unknown as Request, archivedRes);
      expect(archivedRes._sent.items.map((e: ReportIssueEntry) => e.id)).not.toContain(ackReport.id);

      // Resolve ackReport
      await realService.updateStatus(ackReport.id, 'resolved');

      // Now ackReport must be excluded from active and present in archived
      activeRes = createMockResponse();
      (adminController as any).listAdminReportIssues({ query: { view: 'active' } } as unknown as Request, activeRes);
      expect(activeRes._sent.items.map((e: ReportIssueEntry) => e.id)).not.toContain(ackReport.id);

      archivedRes = createMockResponse();
      (adminController as any).listAdminReportIssues({ query: { view: 'archived' } } as unknown as Request, archivedRes);
      expect(archivedRes._sent.items.map((e: ReportIssueEntry) => e.id)).toContain(ackReport.id);

      // Reopen ackReport (set to 'open')
      await realService.updateStatus(ackReport.id, 'open');

      // Reopening reverses: returns to Active, excluded from Archived
      activeRes = createMockResponse();
      (adminController as any).listAdminReportIssues({ query: { view: 'active' } } as unknown as Request, activeRes);
      expect(activeRes._sent.items.map((e: ReportIssueEntry) => e.id)).toContain(ackReport.id);

      archivedRes = createMockResponse();
      (adminController as any).listAdminReportIssues({ query: { view: 'archived' } } as unknown as Request, archivedRes);
      expect(archivedRes._sent.items.map((e: ReportIssueEntry) => e.id)).not.toContain(ackReport.id);
    });

    it('asserts a report attachments are still returned after archiving', () => {
      // Resolved report has attachments
      const detailRes = createMockResponse();
      (adminController as any).getAdminReportIssueDetail(
        { params: { id: resolvedReport.id } } as unknown as Request,
        detailRes,
      );

      expect(detailRes._status).toBe(200);
      expect(detailRes._sent.issue.status).toBe('resolved');
      expect(detailRes._sent.attachments).toBeDefined();
      expect(detailRes._sent.attachments.length).toBe(1);
      expect(detailRes._sent.attachments[0].id).toBe(attachment.id);
      expect(detailRes._sent.attachments[0].originalName).toBe('cable-photo.jpg');

      // Direct service method also returns them
      const attachments = realService.listAttachmentsForReport(resolvedReport.id);
      expect(attachments.length).toBe(1);
      expect(attachments[0].id).toBe(attachment.id);
    });
  });
});

