import type { Express } from 'express';
import type { ModuleContext } from '../module.types';
import type { Request } from 'express';
import { ReportService } from './report.service';
import { ReportController } from './report.controller';

export interface ReportModuleDeps extends ModuleContext {
  resolvePublicBaseUrl: (req: Request) => URL;
}

export function registerReportModule(
  app: Express,
  deps: ReportModuleDeps,
): void {
  const reportService = new ReportService();
  const reportController = new ReportController(reportService, {
    resolvePublicBaseUrl: deps.resolvePublicBaseUrl,
  });

  app.use(reportController.router);
}

