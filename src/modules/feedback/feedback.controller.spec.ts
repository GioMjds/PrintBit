import type { Request, Response } from 'express';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { feedbackStore } from '@/core/database/sqlite-storage';
import type { FeedbackEntry } from './feedback.schema';

describe('FeedbackController direct and non-session based endpoints', () => {
  let controller: FeedbackController;
  let mockFeedbackService: jest.Mocked<Partial<FeedbackService>>;

  beforeEach(() => {
    mockFeedbackService = {
      submitFeedback: jest.fn(),
      createSession: jest.fn(),
      getSessionByToken: jest.fn(),
    };

    controller = new FeedbackController(
      mockFeedbackService as FeedbackService,
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

  describe('POST /api/feedback (direct feedback submission)', () => {
    it('submits feedback successfully without requiring sessionId or token', async () => {
      (mockFeedbackService.submitFeedback as jest.Mock).mockResolvedValue({
        id: 'fb-123',
        sessionId: 'direct',
        timestamp: '2026-08-31T10:00:00.000Z',
        comment: 'Great kiosk service!',
        category: 'service',
        rating: 5,
        status: 'open',
      });

      const req = {
        body: {
          comment: 'Great kiosk service!',
          category: 'service',
          rating: 5,
        },
      } as unknown as Request;
      const res = createMockResponse();

      const submitDirect = (controller as any).submitDirectFeedback;
      await submitDirect(req, res);

      expect(mockFeedbackService.submitFeedback).toHaveBeenCalledWith({
        comment: 'Great kiosk service!',
        category: 'service',
        rating: 5,
      });
      expect(res._status).toBe(201);
      expect(res._sent).toEqual({ ok: true, feedbackId: 'fb-123' });
    });

    it('returns 400 when feedback submission fails validation', async () => {
      (mockFeedbackService.submitFeedback as jest.Mock).mockRejectedValue(
        new Error('Comment is required'),
      );

      const req = {
        body: {
          comment: '',
        },
      } as unknown as Request;
      const res = createMockResponse();

      const submitDirect = (controller as any).submitDirectFeedback;
      await submitDirect(req, res);

      expect(res._status).toBe(400);
      expect(res._sent).toEqual({ error: 'Comment is required' });
    });
  });

  describe('GET /feedback (direct portal rendering)', () => {
    it('renders portal HTML with base href /feedback/', () => {
      const req = {} as unknown as Request;
      const res = createMockResponse();

      const serveDirectPortal = (controller as any).serveDirectFeedbackPortal;
      serveDirectPortal(req, res);

      expect(res._type).toBe('html');
      expect(typeof res._sent).toBe('string');
      expect(res._sent).toContain('<base href="/feedback/">');
    });

  });

  describe('GET /api/feedback/qr-url', () => {
    it('returns the customer-accessible feedback url using resolvePublicBaseUrl', () => {
      const req = {} as unknown as Request;
      const res = createMockResponse();

      const getFeedbackQrUrl = (controller as any).getFeedbackQrUrl;
      getFeedbackQrUrl(req, res);

      expect(res._status).toBe(200);
      expect(res._sent).toEqual({ url: 'http://192.168.4.1:3000/feedback' });
    });
  });

  describe('Admin feedback queue views and validation (GET /api/admin/feedback)', () => {
    let realService: FeedbackService;
    let adminController: FeedbackController;

    const openItem: FeedbackEntry = {
      id: 'fb-test-open',
      sessionId: 'sess-test-open',
      timestamp: '2026-09-01T10:00:00.000Z',
      comment: 'Open feedback item',
      category: 'service',
      rating: 4,
      status: 'open',
      resolvedAt: null,
    };

    const resolvedItem: FeedbackEntry = {
      id: 'fb-test-resolved',
      sessionId: 'sess-test-resolved',
      timestamp: '2026-09-01T11:00:00.000Z',
      comment: 'Resolved feedback item',
      category: 'hardware',
      rating: 5,
      status: 'resolved',
      resolvedAt: '2026-09-01T12:00:00.000Z',
    };

    beforeEach(() => {
      realService = new FeedbackService();
      adminController = new FeedbackController(realService, {
        resolvePublicBaseUrl: () => new URL('http://192.168.4.1:3000'),
      });
      feedbackStore.deleteFeedback(openItem.id);
      feedbackStore.deleteFeedback(resolvedItem.id);
      feedbackStore.insertFeedback(openItem);
      feedbackStore.insertFeedback(resolvedItem);
    });

    afterEach(() => {
      feedbackStore.deleteFeedback(openItem.id);
      feedbackStore.deleteFeedback(resolvedItem.id);
    });

    it('returns 400 when view parameter is unknown', () => {
      const req = {
        query: { view: 'invalid-view' },
      } as unknown as Request;
      const res = createMockResponse();

      const listFeedback = (adminController as any).listFeedback;
      listFeedback(req, res);

      expect(res._status).toBe(400);
      expect(res._sent).toEqual({ error: 'view must be active, archived, or all.' });
    });

    it('asserts queue views: no view returns all items (backward compatibility)', () => {
      const req = { query: {} } as unknown as Request;
      const res = createMockResponse();

      const listFeedback = (adminController as any).listFeedback;
      listFeedback(req, res);

      expect(res._status).toBe(200);
      const ids = res._sent.items.map((e: FeedbackEntry) => e.id);
      expect(ids).toContain(openItem.id);
      expect(ids).toContain(resolvedItem.id);
    });

    it('asserts queue views: view=active excludes only resolved items', () => {
      const req = { query: { view: 'active' } } as unknown as Request;
      const res = createMockResponse();

      const listFeedback = (adminController as any).listFeedback;
      listFeedback(req, res);

      expect(res._status).toBe(200);
      const ids = res._sent.items.map((e: FeedbackEntry) => e.id);
      expect(ids).toContain(openItem.id);
      expect(ids).not.toContain(resolvedItem.id);
    });

    it('asserts queue views: view=archived returns only resolved items', () => {
      const req = { query: { view: 'archived' } } as unknown as Request;
      const res = createMockResponse();

      const listFeedback = (adminController as any).listFeedback;
      listFeedback(req, res);

      expect(res._status).toBe(200);
      const ids = res._sent.items.map((e: FeedbackEntry) => e.id);
      expect(ids).not.toContain(openItem.id);
      expect(ids).toContain(resolvedItem.id);
    });

    it('asserts resolving changes result from Active to Archived, and reopening reverses it', async () => {
      let activeRes = createMockResponse();
      (adminController as any).listFeedback({ query: { view: 'active' } } as unknown as Request, activeRes);
      expect(activeRes._sent.items.map((e: FeedbackEntry) => e.id)).toContain(openItem.id);

      let archivedRes = createMockResponse();
      (adminController as any).listFeedback({ query: { view: 'archived' } } as unknown as Request, archivedRes);
      expect(archivedRes._sent.items.map((e: FeedbackEntry) => e.id)).not.toContain(openItem.id);

      await realService.toggleResolved(openItem.id, true);

      activeRes = createMockResponse();
      (adminController as any).listFeedback({ query: { view: 'active' } } as unknown as Request, activeRes);
      expect(activeRes._sent.items.map((e: FeedbackEntry) => e.id)).not.toContain(openItem.id);

      archivedRes = createMockResponse();
      (adminController as any).listFeedback({ query: { view: 'archived' } } as unknown as Request, archivedRes);
      expect(archivedRes._sent.items.map((e: FeedbackEntry) => e.id)).toContain(openItem.id);

      await realService.toggleResolved(openItem.id, false);

      activeRes = createMockResponse();
      (adminController as any).listFeedback({ query: { view: 'active' } } as unknown as Request, activeRes);
      expect(activeRes._sent.items.map((e: FeedbackEntry) => e.id)).toContain(openItem.id);

      archivedRes = createMockResponse();
      (adminController as any).listFeedback({ query: { view: 'archived' } } as unknown as Request, archivedRes);
      expect(archivedRes._sent.items.map((e: FeedbackEntry) => e.id)).not.toContain(openItem.id);
    });
  });
});
