import type { Express, Request } from 'express';
import type { ModuleContext } from '../module.types';
import type { PowerSafetyService } from '@/services/power-safety';
import { CopyService } from './copy.service';
import { CopyController } from './copy.controller';

export interface CopyModuleDeps extends ModuleContext {
  resolvePublicBaseUrl: (req: Request) => URL;
  powerSafetyService?: PowerSafetyService;
}

export function registerCopyModule(
  app: Express,
  deps: CopyModuleDeps,
): void {
  const copyService = new CopyService({
    io: deps.io,
    resolvePublicBaseUrl: deps.resolvePublicBaseUrl,
  });
  const copyController = new CopyController(
    copyService,
    deps.powerSafetyService,
  );
  app.use('/api/copy', copyController.router);
}

