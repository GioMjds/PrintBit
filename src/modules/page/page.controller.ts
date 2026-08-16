import { Router, Request, Response } from 'express';
import { requireAdminLocalAccess } from '@/middleware/admin-auth';
import type { SessionStore } from '@/services/session';
import { db } from '@/services/db';
import { coinBridgeService } from '@/services/coin-bridge';
import {
  createKioskAccessMiddleware,
  isLoopbackRequest,
  KIOSK_COOKIE_NAME,
  kioskAccessService,
  type KioskAccessService,
} from '@/middleware/kiosk-access';

export type PageRoute = { route: string; filePath: string };

export interface PageControllerDeps {
  sessionStore: SessionStore;
  publicPageRoutes: PageRoute[];
  resolvePublicBaseUrl: (req: Request) => URL;
  kioskAccessService?: KioskAccessService;
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
    <p>Connect to <strong>PrintBit Wi-Fi</strong>, then go to the kiosk, tap <strong>Print</strong>, and scan the latest QR code.</p>
    <a href="/portal">Retry</a>
  </article>
</body>
</html>`;

const KIOSK_ONLY_PAGE_ROUTES = new Set([
  '/',
  '/print',
  '/copy',
  '/config',
  '/confirm',
  '/scan',
]);

export class PageController {
  public readonly router: Router;
  private readonly deps: PageControllerDeps;
  private readonly kioskAccess: KioskAccessService;

  constructor(deps: PageControllerDeps) {
    this.deps = deps;
    this.kioskAccess = deps.kioskAccessService ?? kioskAccessService;
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
    this.router.get('/portal/:token', (req: Request, res: Response) => {
      const token = Array.isArray(req.params.token)
        ? req.params.token[0]
        : String(req.params.token ?? '');
      res.redirect(302, `/upload/${encodeURIComponent(token)}`);
    });

    // The launcher obtains a one-time credential over loopback, then Edge consumes it.
    this.router.post(
      '/api/kiosk/bootstrap-credential',
      this.issueBootstrap.bind(this),
    );
    this.router.get('/kiosk/bootstrap', this.handleBootstrap.bind(this));

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
        : KIOSK_ONLY_PAGE_ROUTES.has(page.route)
          ? [createKioskAccessMiddleware(this.kioskAccess)]
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

  private issueBootstrap(req: Request, res: Response): void {
    if (!isLoopbackRequest(req)) {
      res.status(403).json({ error: 'Kiosk bootstrap is loopback-only.' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ credential: this.kioskAccess.issueBootstrapCredential() });
  }

  private handleBootstrap(req: Request, res: Response): void {
    if (!isLoopbackRequest(req)) {
      res.status(403).type('text').send('Kiosk bootstrap is loopback-only.');
      return;
    }
    const credential =
      typeof req.query.credential === 'string' ? req.query.credential : '';
    if (
      !credential ||
      !this.kioskAccess.consumeBootstrapCredential(credential)
    ) {
      res
        .status(403)
        .type('text')
        .send('Kiosk launch credential is invalid, expired, or already used.');
      return;
    }
    res.cookie(KIOSK_COOKIE_NAME, this.kioskAccess.getCookieCredential(), {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
    });
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, '/loading');
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

  private handlePortal(req: Request, res: Response): void {
    const queryToken =
      typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (queryToken) {
      res.redirect(302, `/upload/${encodeURIComponent(queryToken)}`);
      return;
    }
    const token = this.deps.sessionStore.getActiveSessionToken();
    if (token) {
      res.redirect(302, `/upload/${encodeURIComponent(token)}`);
      return;
    }
    const wirelessService = coinBridgeService.getWirelessSessionService();
    const activeSession = wirelessService?.getActiveCustomerSession();
    if (activeSession?.sessionToken) {
      res.redirect(
        302,
        `/upload/${encodeURIComponent(activeSession.sessionToken)}`,
      );
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
