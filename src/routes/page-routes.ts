import type { Express, Request, Response } from 'express';
import { requireAdminLocalAccess } from '@/middleware/admin-auth';
import type { SessionStore } from '@/services/session';
import { db } from '@/services/db';

type PageRoute = { route: string; filePath: string };

interface RegisterPageRoutesDeps {
  sessionStore: SessionStore;
  publicPageRoutes: PageRoute[];
  resolvePublicBaseUrl: (req: Request) => URL;
}

const PORTAL_WAITING_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
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

export function registerPageRoutes(app: Express, deps: RegisterPageRoutesDeps) {
  app.get('/favicon.ico', (_req: Request, res: Response) => {
    res.sendStatus(204);
  });

  app.get('/upload', (req: Request, res: Response) => {
    const session = deps.sessionStore.createSession(
      deps.resolvePublicBaseUrl(req),
    );
    res.redirect(`/upload/${encodeURIComponent(session.token)}`);
  });

  app.get('/portal', (_req: Request, res: Response) => {
    const token = deps.sessionStore.getActiveSessionToken();
    if (token) {
      res.redirect(302, `/upload/${encodeURIComponent(token)}`);
      return;
    }
    res.type('html').send(PORTAL_WAITING_HTML);
  });

  // Public endpoint to get idle timeout configuration (for client-side idle detection)
  app.get('/api/settings/idle-timeout', (_req: Request, res: Response) => {
    res.json({ idleTimeoutSeconds: db.data!.settings.idleTimeoutSeconds });
  });

  // Redirect /admin to /admin/dashboard
  app.get('/admin', requireAdminLocalAccess, (_req: Request, res: Response) => {
    res.redirect('/admin/dashboard');
  });

  for (const page of deps.publicPageRoutes) {
    const routeHandlers = page.route.startsWith('/admin/')
      ? [requireAdminLocalAccess]
      : [];

    app.get(page.route, ...routeHandlers, (_req: Request, res: Response) => {
      res.sendFile(page.filePath);
    });
  }
}
