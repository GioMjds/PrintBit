import type { Express } from 'express';
import type { ModuleContext } from '../module.types';
import { AdminController, type AdminControllerDeps } from './admin.controller';
import { AdminService } from './admin.service';

export interface AdminModuleDeps extends ModuleContext {
  uploadDir: string;
  getSerialStatus: AdminControllerDeps['getSerialStatus'];
  getHopperStatus: AdminControllerDeps['getHopperStatus'];
  runHopperSelfTest: AdminControllerDeps['runHopperSelfTest'];
}

export function registerAdminModule(
  app: Express,
  deps: AdminModuleDeps,
): void {
  const adminService = new AdminService();
  const adminController = new AdminController(adminService, deps);
  app.use('/api/admin', adminController.router);
}

