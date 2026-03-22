import type { Express } from 'express';
import type { ModuleContext } from '../module.types';
import type { SessionStore } from '@/services/session';
import { UploadPortalService } from './upload-portal.service';
import { UploadPortalController } from './upload-portal.controller';

export interface UploadPortalModuleDeps extends ModuleContext {
  portalDir: string;
  portalAssets: Set<string>;
  sessionStore: SessionStore;
}

export function registerUploadPortalModule(
  app: Express,
  deps: UploadPortalModuleDeps,
): void {
  const uploadPortalService = new UploadPortalService({
    portalDir: deps.portalDir,
    portalAssets: deps.portalAssets,
    sessionStore: deps.sessionStore,
  });

  const uploadPortalController = new UploadPortalController(uploadPortalService);

  // Mount portal routes at /upload (not under /api - these serve HTML pages)
  app.use('/upload', uploadPortalController.router);
}

