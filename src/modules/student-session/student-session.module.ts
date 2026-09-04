import type { Express } from 'express';
import type { ModuleContext } from '../module.types';
import { StudentSessionController } from './student-session.controller';
import { StudentSessionService } from './student-session.service';

export function registerStudentSessionModule(
  app: Express,
  deps: ModuleContext,
): void {
  const service = new StudentSessionService({ io: deps.io });
  const controller = new StudentSessionController(service);
  app.use(controller.router);
}
