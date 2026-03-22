import type { Express } from 'express';
import type { ModuleContext } from '../module.types';
import { CopyService } from './copy.service';
import { CopyController } from './copy.controller';

export interface CopyModuleDeps extends ModuleContext {
}

export function registerCopyModule(
  app: Express,
  deps: CopyModuleDeps,
): void {
  const copyService = new CopyService({ io: deps.io });
  const copyController = new CopyController(copyService);
  app.use('/api/copy', copyController.router);
}

