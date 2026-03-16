import type { Express, Request, Response } from 'express';
import { toApiPath } from '@/runtime';
import type { SessionStore } from '@/services/session';

interface RegisterSystemApiRoutesDeps {
  port: number;
  hotspotSsid: string;
  hotspotPassword: string;
  sessionStore: SessionStore;
  getLocalIPv4: () => string | null;
  startHotspot: () => Promise<void>;
  stopHotspot: () => void;
  isHotspotRunning: () => boolean;
}

export function registerSystemApiRoutes(
  app: Express,
  deps: RegisterSystemApiRoutesDeps,
) {
  app.get(toApiPath('/config/hotspot'), (_req: Request, res: Response) => {
    res.json({ ssid: deps.hotspotSsid, password: deps.hotspotPassword });
  });

  app.post(
    toApiPath('/hotspot/start'),
    async (_req: Request, res: Response) => {
      try {
        await deps.startHotspot();
        res.json({ ok: true, running: deps.isHotspotRunning() });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ ok: false, error: msg });
      }
    },
  );

  app.post(toApiPath('/hotspot/stop'), (_req: Request, res: Response) => {
    deps.stopHotspot();
    res.json({ ok: true });
  });

  app.get(toApiPath('/session/active'), (_req: Request, res: Response) => {
    const token = deps.sessionStore.getActiveSessionToken();
    if (token) {
      const localIP = deps.getLocalIPv4() ?? '192.168.5.1';
      const uploadUrl = `http://${localIP}:${deps.port}/upload/${encodeURIComponent(token)}`;
      res.json({ token, uploadUrl });
      return;
    }
    res.status(404).json({ error: 'No active session' });
  });
}
