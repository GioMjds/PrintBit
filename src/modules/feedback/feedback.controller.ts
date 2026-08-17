import path from 'node:path';
import fs from 'node:fs';
import { Router, Request, Response } from 'express';
import {
  requireAdminLocalAccess,
  requireAdminPin,
} from '@/middleware/admin-auth';
import { createRateLimit } from '@/middleware/rate-limit';
import { serializeForInlineScript } from '@/utils/helpers';
import { FeedbackService } from './feedback.service';
import type { FeedbackStatus } from './feedback.schema';

const FEEDBACK_PORTAL_DIR = path.join(__dirname, '..', '..', 'public', 'feedback');
const FEEDBACK_PORTAL_ASSETS = new Set(['styles.css', 'app.js']);

const EXPIRED_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Session Expired · PrintBit</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f0f2f5;margin:0;color:#333}
.c{background:#fff;border-radius:16px;padding:2rem;max-width:380px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.icon{font-size:2.5rem;margin-bottom:.75rem}h2{margin-bottom:.5rem;font-size:1.2rem}
p{color:#666;font-size:.9rem;line-height:1.5;margin-bottom:.25rem}</style></head>
<body><div class="c">
<div class="icon">⏰</div>
<h2>Session Expired</h2>
<p>This feedback link is no longer valid.</p>
<p>Please go back to the kiosk and scan a new QR code to leave your feedback.</p>
</div></body></html>`;

const FEEDBACK_PORTAL_TEMPLATE = fs.readFileSync(
  path.join(FEEDBACK_PORTAL_DIR, 'index.html'),
  'utf-8',
);

const feedbackPortalAssetRateLimit = createRateLimit({
  keyPrefix: 'feedback-portal-asset',
  windowMs: 60_000,
  max: 120,
  message: 'Too many requests. Please try again later.',
});

function renderFeedbackPortal(token: string): string {
  const safeTokenForScript = serializeForInlineScript(token);
  return FEEDBACK_PORTAL_TEMPLATE.replace(
    '</head>',
    `<base href="/feedback/${encodeURIComponent(token)}/"><script>window.feedbackToken=${safeTokenForScript};</script></head>`,
  );
}

export interface FeedbackControllerDeps {
  resolvePublicBaseUrl: (req: Request) => URL;
}

export class FeedbackController {
  public readonly router: Router;
  public readonly portalRouter: Router;

  constructor(
    private readonly feedbackService: FeedbackService,
    private readonly deps: FeedbackControllerDeps,
  ) {
    this.router = Router();
    this.portalRouter = Router();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    // API routes (mounted at /api/feedback)
    this.router.post('/sessions', this.createSession);
    this.router.get('/sessions/by-token/:token', this.getSessionByToken);
    this.router.post('/sessions/:sessionId/submit', this.submitFeedback);

    // Portal routes (mounted at /feedback)
    this.portalRouter.get('/:token', this.serveFeedbackPortal);
    this.portalRouter.get('/:token/:asset', feedbackPortalAssetRateLimit, this.serveFeedbackAsset);
  }

  // Public API routes
  private createSession = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const baseUrl = this.deps.resolvePublicBaseUrl(req);
      const session = await this.feedbackService.createSession(baseUrl);
      res.json(session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  };

  private getSessionByToken = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const { token } = req.params as { token: string };
    const session = await this.feedbackService.getSessionByToken(token);
    if (!session) {
      res.status(404).json({ error: 'Session not found or expired.' });
      return;
    }
    res.json({ sessionId: session.id, feedbackUrl: session.feedbackUrl });
  };

  private submitFeedback = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const { sessionId } = req.params as { sessionId: string };
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const body = req.body as {
      comment?: unknown;
      category?: unknown;
      rating?: unknown;
    };

    const comment = typeof body.comment === 'string' ? body.comment : '';
    const category = typeof body.category === 'string' ? body.category : null;
    const rating = typeof body.rating === 'number' ? body.rating : null;

    try {
      const entry = await this.feedbackService.submitFeedback({
        sessionId,
        token,
        comment,
        category,
        rating,
      });
      res.status(201).json({ ok: true, feedbackId: entry.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  };

  // Portal routes
  private serveFeedbackPortal = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const { token } = req.params as { token: string };
    const session = await this.feedbackService.getSessionByToken(token);
    if (!session) {
      res.status(410).type('html').send(EXPIRED_HTML);
      return;
    }
    try {
      const html = renderFeedbackPortal(token);
      res.send(html);
    } catch {
      res.status(500).send('Error loading feedback portal.');
    }
  };

  private serveFeedbackAsset = (req: Request, res: Response): void => {
    const { asset } = req.params as { asset: string };
    if (!FEEDBACK_PORTAL_ASSETS.has(asset)) {
      res.status(404).send('Not found.');
      return;
    }
    const filePath = path.join(FEEDBACK_PORTAL_DIR, asset);
    res.sendFile(filePath, (err) => {
      if (err) res.status(404).send('Asset not found.');
    });
  };

  // Admin routes - these are added to a separate router for /api/admin/feedback
  public createAdminRouter(): Router {
    const adminRouter = Router();

    adminRouter.get(
      '/',
      requireAdminLocalAccess,
      requireAdminPin,
      this.listFeedback,
    );

    adminRouter.patch(
      '/:id/resolve',
      requireAdminLocalAccess,
      requireAdminPin,
      this.toggleResolved,
    );

    adminRouter.delete(
      '/:id',
      requireAdminLocalAccess,
      requireAdminPin,
      this.deleteFeedback,
    );

    adminRouter.delete(
      '/',
      requireAdminLocalAccess,
      requireAdminPin,
      this.clearFeedback,
    );

    adminRouter.get(
      '/export.csv',
      requireAdminLocalAccess,
      requireAdminPin,
      this.exportCsv,
    );

    return adminRouter;
  }

  // Admin handlers
  private listFeedback = (req: Request, res: Response): void => {
    const statusParam = req.query.status;
    const status: FeedbackStatus | undefined =
      statusParam === 'open' || statusParam === 'resolved'
        ? statusParam
        : undefined;

    const rawLimit = Number(req.query.limit ?? 100);
    const limit = Number.isFinite(rawLimit) ? rawLimit : 100;

    const rawOffset = Number(req.query.offset ?? 0);
    const offset = Number.isFinite(rawOffset) ? rawOffset : 0;

    const result = this.feedbackService.listFeedback({ status, limit, offset });
    res.json(result);
  };

  private toggleResolved = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const { id } = req.params as { id: string };
    const body = req.body as { resolved?: unknown };
    const resolved = typeof body.resolved === 'boolean' ? body.resolved : true;

    const entry = await this.feedbackService.toggleResolved(id, resolved);
    if (!entry) {
      res.status(404).json({ error: 'Feedback entry not found.' });
      return;
    }
    res.json({ ok: true, entry });
  };

  private deleteFeedback = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const { id } = req.params as { id: string };
    const deleted = await this.feedbackService.deleteFeedback(id);
    if (!deleted) {
      res.status(404).json({ error: 'Feedback entry not found.' });
      return;
    }
    res.json({ ok: true });
  };

  private clearFeedback = async (
    _req: Request,
    res: Response,
  ): Promise<void> => {
    const removed = await this.feedbackService.clearFeedback();
    res.json({ ok: true, removed });
  };

  private exportCsv = (req: Request, res: Response): void => {
    const items = this.feedbackService.listAllFeedback();
    const csv = this.feedbackService.feedbackToCsv(items);
    const date = new Date().toISOString().slice(0, 10);
    res
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header(
        'Content-Disposition',
        `attachment; filename="printbit-feedback-${date}.csv"`,
      )
      .send(csv);
  };
}
