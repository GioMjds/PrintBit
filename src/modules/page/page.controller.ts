import { Router, Request, Response } from 'express';
import { requireAdminLocalAccess } from '@/middleware/admin-auth';
import type { SessionStore } from '@/services/session';
import { db } from '@/services/db';

export type PageRoute = { route: string; filePath: string };

export interface PageControllerDeps {
  sessionStore: SessionStore;
  publicPageRoutes: PageRoute[];
  resolvePublicBaseUrl: (req: Request) => URL;
}

const PORTAL_WAITING_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="refresh" content="3" />
  <title>PrintBit Portal</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0e0d1f;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:20px}
    .card{max-width:460px;background:#181730;border:1px solid rgba(167,170,225,.25);border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
    h1{margin:0 0 12px;font-size:1.25rem}
    p{margin:0 0 12px;color:#c7c9ef;line-height:1.5}
    a{display:inline-block;margin-top:8px;color:#fff;background:#696fc7;padding:10px 14px;border-radius:10px;text-decoration:none;font-weight:600}
  </style>
</head>
<body>
  <article class="card">
    <h1>PrintBit upload portal</h1>
    <p>No active print upload session was found yet.</p>
    <p>Go to the kiosk, tap <strong>Print</strong>, then scan the QR code again.</p>
    <a href="/portal">Retry</a>
  </article>
</body>
</html>`;

export class PageController {
  public readonly router: Router;
  private readonly deps: PageControllerDeps;

  constructor(deps: PageControllerDeps) {
    this.deps = deps;
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    // Favicon - return no content
    this.router.get('/favicon.ico', this.handleFavicon.bind(this));

    // Upload redirect - creates new session and redirects
    this.router.get('/upload', this.handleUploadRedirect.bind(this));

    // Portal - redirects to active session or shows waiting page
    this.router.get('/portal', this.handlePortal.bind(this));

    // Public endpoint to get idle timeout configuration (for client-side idle detection)
    this.router.get(
      '/api/settings/idle-timeout',
      this.handleIdleTimeout.bind(this),
    );

    // Redirect /admin to /admin/dashboard
    this.router.get(
      '/admin',
      requireAdminLocalAccess,
      this.handleAdminRedirect.bind(this),
    );
    this.router.get(
      ['/admin/coins', '/admin/coins/', '/admin/coin-stats', '/admin/coin-stats/'],
      requireAdminLocalAccess,
      this.handleCoinStatsRedirect.bind(this),
    );

    // Register public page routes (static HTML files)
    for (const page of this.deps.publicPageRoutes) {
      const routeHandlers = page.route.startsWith('/admin/')
        ? [requireAdminLocalAccess]
        : [];

      this.router.get(page.route, ...routeHandlers, (_req: Request, res: Response) => {
        res.sendFile(page.filePath);
      });
    }
  }

  private handleFavicon(_req: Request, res: Response): void {
    res.sendStatus(204);
  }

  private handleUploadRedirect(req: Request, res: Response): void {
    const session = this.deps.sessionStore.createSession(
      this.deps.resolvePublicBaseUrl(req),
    );
    res.redirect(`/upload/${encodeURIComponent(session.token)}`);
  }

  private handlePortal(_req: Request, res: Response): void {
    const token = this.deps.sessionStore.getActiveSessionToken();
    if (token) {
      res.redirect(302, `/upload/${encodeURIComponent(token)}`);
      return;
    }
    res.type('html').send(PORTAL_WAITING_HTML);
  }

  private handleIdleTimeout(_req: Request, res: Response): void {
    res.json({ idleTimeoutSeconds: db.data!.settings.idleTimeoutSeconds });
  }

  private handleAdminRedirect(_req: Request, res: Response): void {
    res.redirect('/admin/dashboard');
  }

  private handleCoinStatsRedirect(_req: Request, res: Response): void {
    res.redirect('/admin/dashboard');
  }
}
