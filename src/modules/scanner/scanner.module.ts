import type { Express } from 'express';
import type { ModuleContext } from '../module.types';
import type { Request } from 'express';
import { ScannerController } from './scanner.controller';
import { ScannerService } from './scanner.service';

export interface ScannerModuleDeps extends ModuleContext {
  resolvePublicBaseUrl: (req: Request) => URL;
}

export function registerScannerModule(
  app: Express,
  deps: ScannerModuleDeps,
): void {
  const scannerService = new ScannerService();
  const scannerController = new ScannerController(scannerService, {
    io: deps.io,
    resolvePublicBaseUrl: deps.resolvePublicBaseUrl,
  });
  app.use(scannerController.router);
}

