import { Router, Request, Response } from 'express';
import { requireAdminLocalAccess } from '@/middleware/admin-auth';
import type { SessionStore } from '@/services/session';
import { db } from '@/services/db';

export type PageRoute = { route: string; filePath: string };

const SHORT_LINK_EXPIRED_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Upload Link Expired · PrintBit</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f0f2f5;margin:0;color:#333}
.c{background:#fff;border-radius:16px;padding:2rem;max-width:400px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.icon{font-size:2.3rem;margin-bottom:.75rem}h2{margin-bottom:.5rem;font-size:1.2rem}
p{color:#666;font-size:.95rem;line-height:1.45;margin-bottom:.25rem}
a{display:inline-block;margin-top:.85rem;color:#4f46e5;text-decoration:none;font-weight:600}</style></head>
<body><div class="c">
<div class="icon">!</div>
<h2>This short upload link has expired</h2>
<p>Please return to the PrintBit kiosk and create a new session.</p>
<a href="/print">Open Print page</a>
</div></body></html>`;

export interface PageControllerDeps {
  sessionStore: SessionStore;
  publicPageRoutes: PageRoute[];
  resolvePublicBaseUrl: (req: Request) => URL;
}

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
    this.router.get('/u/:shortCode', this.handleShortUploadRedirect.bind(this));

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
      [
        '/admin/coins',
        '/admin/coins/',
        '/admin/coin-stats',
        '/admin/coin-stats/',
      ],
      requireAdminLocalAccess,
      this.handleCoinStatsRedirect.bind(this),
    );

    // Register public page routes (static HTML files)
    for (const page of this.deps.publicPageRoutes) {
      const routeHandlers = page.route.startsWith('/admin/')
        ? [requireAdminLocalAccess]
        : [];

      this.router.get(
        page.route,
        ...routeHandlers,
        (_req: Request, res: Response) => {
          res.sendFile(page.filePath);
        },
      );
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

  private handleShortUploadRedirect(req: Request, res: Response): void {
    const { shortCode } = req.params as { shortCode: string };
    const session = this.deps.sessionStore.tryGetSessionByShortCode(
      shortCode,
      this.deps.resolvePublicBaseUrl(req),
    );
    if (!session) {
      res.status(410).type('html').send(SHORT_LINK_EXPIRED_HTML);
      return;
    }
    res.redirect(`/upload/${encodeURIComponent(session.token)}`);
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
