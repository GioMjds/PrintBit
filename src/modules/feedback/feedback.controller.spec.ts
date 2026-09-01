import type { Request, Response } from 'express';
import { FeedbackController } from './feedback.controller';
import type { FeedbackService } from './feedback.service';

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
});
