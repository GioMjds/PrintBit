export { registerAnomalyModule, type AnomalyModuleDeps } from './anomaly.module';
export { AnomalyController } from './anomaly.controller';
export {
  AnomalyService,
  anomalyService,
  buildAnomalyFingerprint,
  mapHopperErrorSeverity,
  type ReportAnomalyInput,
  type ListAnomalyOptions,
  type ListAnomalyResult,
  type ReportAnomalyResult,
} from './anomaly.service';
export * from './anomaly.schema';
