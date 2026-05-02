import type { Express } from 'express';
import type { ModuleContext } from '../module.types';
import { PrinterService } from './printer.service';
import { PrinterController } from './printer.controller';

export interface PrinterModuleDeps extends ModuleContext {}

export function registerPrinterModule(app: Express): void {
  const printerService = new PrinterService();
  const printerController = new PrinterController(printerService);

  app.use('/api/printer', printerController.router);
}
