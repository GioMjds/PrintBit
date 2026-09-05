import type { Express } from 'express';
import type { ModuleContext } from '../module.types';
import type { Request } from 'express';
import type { SessionStore } from '@/services/session';
import type { PowerSafetyService } from '@/services/power-safety';
import { FinancialService } from './financial.service';
import { FinancialController } from './financial.controller';

export interface FinancialModuleDeps extends ModuleContext {
  sessionStore: SessionStore;
  resolvePublicBaseUrl: (req: Request) => URL;
  powerSafetyService?: PowerSafetyService;
}

export function registerFinancialModule(
  app: Express,
  deps: FinancialModuleDeps,
): void {
  const service = new FinancialService({
    io: deps.io,
    sessionStore: deps.sessionStore,
    resolvePublicBaseUrl: deps.resolvePublicBaseUrl,
    powerSafetyService: deps.powerSafetyService,
  });
  const controller = new FinancialController(service);
  app.use(controller.router);
}

