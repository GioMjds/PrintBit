import { Router, Request, Response } from 'express';
import { HotspotService } from './hotspot.service';

export class HotspotController {
  public readonly router: Router;
  private readonly service: HotspotService;

  constructor(service: HotspotService) {
    this.service = service;
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.get('/config', this.getConfig);
    this.router.post('/start', this.start);
    this.router.post('/stop', this.stop);
  }

  /**
   * GET /config - Returns hotspot configuration
   */
  private getConfig = (_req: Request, res: Response): void => {
    res.json(this.service.getConfig());
  };

  /**
   * POST /start - Starts the hotspot
   */
  private start = async (_req: Request, res: Response): Promise<void> => {
    try {
      await this.service.start();
      res.json({ ok: true, running: this.service.isRunning() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  };

  /**
   * POST /stop - Stops the hotspot
   */
  private stop = (_req: Request, res: Response): void => {
    this.service.stop();
    res.json({ ok: true });
  };
}
