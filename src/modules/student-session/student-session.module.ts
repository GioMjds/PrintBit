import type { Express } from 'express';
import type { ModuleContext } from '../module.types';
import { studentSessionStore } from '@/core/database/models/student-session.model';
import { StudentSessionController } from './student-session.controller';
import { StudentSessionService } from './student-session.service';

export interface StudentSessionModuleDeps extends ModuleContext {
  studentSessionService?: StudentSessionService;
}

export function registerStudentSessionModule(
  app: Express,
  deps: StudentSessionModuleDeps,
): void {
  studentSessionStore.endAllActiveSessions('server_restart');
  const service =
    deps.studentSessionService ?? new StudentSessionService({ io: deps.io });
  const controller = new StudentSessionController(service);
  app.use(controller.router);
}
