import type { Request } from 'express';
import type { ModuleContext } from '../module.types';
import { CopyService } from './copy.service';
import { CopyController } from './copy.controller';

export interface CopyModuleDeps extends ModuleContext {
  resolvePublicBaseUrl: (req: Request) => URL;
}

export function registerCopyModule(
  app: Express,
  deps: CopyModuleDeps,
): void {
  const copyService = new CopyService({
    io: deps.io,
    resolvePublicBaseUrl: deps.resolvePublicBaseUrl,
  });
  const copyController = new CopyController(copyService);
  app.use('/api/copy', copyController.router);
}

