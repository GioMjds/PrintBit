import type { Express } from 'express';
import type { ModuleContext } from '../module.types';
import { HotspotService } from './hotspot.service';
import { HotspotController } from './hotspot.controller';

export interface HotspotModuleDeps extends ModuleContext {
  // No additional dependencies required
}

export function registerHotspotModule(
  app: Express,
  _deps: HotspotModuleDeps,
): void {
  const service = new HotspotService();
  const controller = new HotspotController(service);

  app.use('/api/hotspot', controller.router);

  console.log('[MODULE] Hotspot module registered at /api/hotspot');
}

