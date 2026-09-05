import type { Express } from 'express';
import type { ModuleContext } from '../module.types';
import type { Request } from 'express';
import type { PowerSafetyService } from '@/services/power-safety';
import type { StudentSessionTransactionAuthority } from '@/middleware/student-session';
import { ScannerController } from './scanner.controller';
import { ScannerService } from './scanner.service';

export interface ScannerModuleDeps extends ModuleContext {
  resolvePublicBaseUrl: (req: Request) => URL;
  powerSafetyService?: PowerSafetyService;
  studentSessionService: StudentSessionTransactionAuthority;
}

export function registerScannerModule(
  app: Express,
  deps: ScannerModuleDeps,
): void {
  const scannerService = new ScannerService({
    studentSessionService: deps.studentSessionService,
  });
  const scannerController = new ScannerController(scannerService, {
    io: deps.io,
    resolvePublicBaseUrl: deps.resolvePublicBaseUrl,
    powerSafetyService: deps.powerSafetyService,
  });
  app.use(scannerController.router);
}

