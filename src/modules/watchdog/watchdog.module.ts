import type { Express } from 'express';
import type { ModuleContext } from '../module.types';
import { WatchdogService } from './watchdog.service';
import { WatchdogController } from './watchdog.controller';

export interface WatchdogModuleDeps extends ModuleContext {
  // No additional dependencies needed - uses shared services
}

export function registerWatchdogModule(app: Express): void {
  const watchdogService = new WatchdogService();
  const watchdogController = new WatchdogController({ watchdogService });

  app.use('/api/watchdog', watchdogController.router);

  console.log(
    '[WATCHDOG-MODULE] ✓ Watchdog module registered at /api/watchdog',
  );
}
