import type { Express } from 'express';
import type { ModuleContext } from '../module.types';
import { anomalyService } from './anomaly.service';

export type AnomalyModuleDeps = ModuleContext;

export function registerAnomalyModule(
  _app: Express,
  deps: AnomalyModuleDeps,
): void {
  anomalyService.setSocketIo(deps.io);
}

