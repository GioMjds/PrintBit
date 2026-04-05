import { Router, Request, Response } from 'express';
import { createRateLimit } from '@/middleware/rate-limit';
import { UploadPortalService } from './upload-portal.service';

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
<p>This upload link is no longer valid.</p>
<p>Please go back to the kiosk and start a new print session to get a fresh QR code.</p>
</div></body></html>`;

const uploadPortalPageRateLimit = createRateLimit({
  keyPrefix: 'upload-portal-page',
  windowMs: 60_000,
  max: 60,
  message: 'Too many requests. Please try again later.',
});

const uploadPortalAssetRateLimit = createRateLimit({
  keyPrefix: 'upload-portal-asset',
  windowMs: 60_000,
  max: 120,
  message: 'Too many requests. Please try again later.',
});

export class UploadPortalController {
  public readonly router: Router;

  constructor(private readonly uploadPortalService: UploadPortalService) {
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    // Portal routes (mounted at /upload)
    this.router.get('/:token', uploadPortalPageRateLimit, this.serveUploadPortal);
    this.router.get('/:token/:asset', uploadPortalAssetRateLimit, this.serveUploadAsset);
  }

  /**
   * Serve the upload portal page for a valid token.
   */
  private serveUploadPortal = async (req: Request, res: Response): Promise<void> => {
    try {
      const { token } = req.params as { token: string };

      if (!this.uploadPortalService.isTokenValid(token)) {
        void this.uploadPortalService.logInvalidTokenAccess(token.slice(0, 8));
        res.status(410).type('html').send(EXPIRED_HTML);
        return;
      }

      const html = this.uploadPortalService.renderPortal(token);
      res.send(html);
    } catch (error) {
      console.error('Error rendering upload portal:', error);
      res.status(500).send('Error loading upload portal');
    }
  };

  /**
   * Serve static assets for the upload portal.
   */
  private serveUploadAsset = (req: Request, res: Response): void => {
    const { asset } = req.params as { asset: string };

    if (!this.uploadPortalService.isAssetAllowed(asset)) {
      res.status(404).send('Not found.');
      return;
    }

    const filePath = this.uploadPortalService.getAssetPath(asset);
    res.sendFile(filePath, (err) => {
      if (err) res.status(404).send('Asset not found.');
    });
  };
}
