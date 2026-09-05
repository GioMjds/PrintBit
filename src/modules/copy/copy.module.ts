import type { Express, Request } from 'express';
import type { ModuleContext } from '../module.types';
import type { PowerSafetyService } from '@/services/power-safety';
import type { StudentSessionTransactionAuthority } from '@/middleware/student-session';
import { CopyService } from './copy.service';
import { CopyController } from './copy.controller';

export interface CopyModuleDeps extends ModuleContext {
  resolvePublicBaseUrl: (req: Request) => URL;
  powerSafetyService?: PowerSafetyService;
  studentSessionService: StudentSessionTransactionAuthority;
}

export function registerCopyModule(
  app: Express,
  deps: CopyModuleDeps,
): void {
  const copyService = new CopyService({
    io: deps.io,
    resolvePublicBaseUrl: deps.resolvePublicBaseUrl,
    studentSessionService: deps.studentSessionService,
  });
  const copyController = new CopyController(
    copyService,
    deps.powerSafetyService,
  );
  app.use('/api/copy', copyController.router);
}

