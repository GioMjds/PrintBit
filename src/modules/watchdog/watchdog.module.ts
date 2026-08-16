import type { Express } from 'express';
import { WatchdogService } from './watchdog.service';
import { WatchdogController } from './watchdog.controller';

export function registerWatchdogModule(app: Express): void {
  const watchdogService = new WatchdogService();
  const watchdogController = new WatchdogController({ watchdogService });

  app.use('/api/watchdog', watchdogController.router);

  console.log(
    '[WATCHDOG-MODULE] ✓ Watchdog module registered at /api/watchdog',
  );
}
