import type { Express } from 'express';
import type { ModuleContext } from '../module.types';
import { WatchdogService } from './watchdog.service';
import { WatchdogController } from './watchdog.controller';
import { ESP32_AP_BASE_URL, ESP32_HEALTH_TOKEN } from '@/config/http.config';
import { isCoinSlotLocked } from '@/services/serial';
import { normalizeRemoteIp } from '@/utils/network';

export type WatchdogModuleDeps = ModuleContext;

export function registerWatchdogModule(app: Express): void {
  const watchdogService = new WatchdogService();
  const watchdogController = new WatchdogController({ watchdogService });

  app.use('/api/watchdog', watchdogController.router);

  // This intentionally has a smaller contract than /api/watchdog/health.
  // The latter remains loopback-only for the Windows watchdog; this endpoint
  // is the ESP32 liveness lease used by firmware to fail closed on coin input.
  app.get('/api/health', (req, res) => {
    const expectedPeer = new URL(ESP32_AP_BASE_URL).hostname;
    const peer = normalizeRemoteIp(req.ip || req.socket.remoteAddress || '');
    const token = req.get('x-esp32-health-token')?.trim() || '';
    if (peer !== expectedPeer || (ESP32_HEALTH_TOKEN && token !== ESP32_HEALTH_TOKEN)) {
      res.status(403).json({ ok: false });
      return;
    }

    res.json({
      ok: true,
      service: 'printbit',
      timestamp: new Date().toISOString(),
      coinAccepting: !isCoinSlotLocked(),
    });
  });

  console.log(
    '[WATCHDOG] ✓ Watchdog module registered at /api/watchdog',
  );
}
