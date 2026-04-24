/**
 * Print Queue Consumption Standardization
 *
 * Standardizes per-job consumption event generation for Phase 3:
 * - One canonical consumption event per print job outcome
 * - Linked to transactionId with per-page color/BW breakdown
 * - Integrates with existing consumables service
 * - Prevents double-counting during retries via idempotency key
 * - Supports per-printer/per-supply threshold overrides
 *
 * Phase 3: Per-page consumption hardening and threshold model
 */

/**
 * Standard print consumption event
 * Emitted once per terminal job outcome (success or non-retryable failure)
 */
export interface PrintConsumptionEvent {
  /**
   * Unique transaction identifier (links to financial ledger, receipt)
   */
  transactionId: string;

  /**
   * Idempotency fingerprint to prevent double-counting on retries
   * Computed from transactionId + spoolerCorrelationKey
   */
  idempotencyFingerprint: string;

  /**
   * Mode: print or copy
   */
  mode: 'print' | 'copy';

  /**
   * Printer name where job executed (or attempted)
   */
  printerName: string | null;

  /**
   * Job outcome: success (completed), retryable_failure (transient), non_retryable_failure (permanent)
   */
  outcome: 'success' | 'retryable_failure' | 'non_retryable_failure';

  /**
   * Number of copies (1, 2, 3, etc)
   */
  copies: number;

  /**
   * Billable color pages consumed in this job
   */
  colorPages: number;

  /**
   * Billable B&W pages consumed in this job
   */
  bwPages: number;

  /**
   * Total pages billable (colorPages + bwPages * bw_surcharge_fraction)
   * Normalized to equivalent standard pages for consumption tracking
   */
  equivalentBwPages: number;

  /**
   * Timestamp when consumption event recorded (ISO8601)
   */
  recordedAt: string;
}

/**
 * Per-printer threshold override configuration
 * Global default: 30% (managed by existing consumables service)
 * Per-printer/per-supply overrides set here
 */
export interface PerPrinterThresholdConfig {
  /**
   * Printer name (e.g., "Default", "HP LaserJet")
   */
  printerName: string;

  /**
   * Threshold percentage (0-100) at which to trigger alert
   * null uses global default (30%)
   */
  thresholdPercentage: number | null;

  /**
   * Per-supply overrides (if null printer override doesn't apply to this supply)
   */
  supplyOverrides?: {
    [supplyName: string]: number; // percentage
  };

  /**
   * When this config was last updated
   */
  updatedAt: string;
}

/**
 * Threshold incident record
 * Immutable audit log of when thresholds trigger/recover
 */
export interface ThresholdIncident {
  /**
   * Unique incident identifier
   */
  id: string;

  /**
   * Printer name
   */
  printerName: string;

  /**
   * Supply name (if ink/toner, e.g., "Black", "Cyan")
   */
  supplyName: string | null;

  /**
   * Incident type
   */
  type: 'threshold_triggered' | 'threshold_recovered';

  /**
   * Current level percentage when incident occurred
   */
  levelPercentage: number;

  /**
   * Threshold that triggered incident
   */
  thresholdPercentage: number;

  /**
   * Idempotency fingerprint to prevent duplicate incidents on retries
   * Combines (printerName, supplyName, levelPercentage, type) for fingerprinting
   */
  fingerprint: string;

  /**
   * When incident recorded
   */
  recordedAt: string;

  /**
   * Optional notes (e.g., "Triggered by job XYZ")
   */
  notes?: string;
}

/**
 * Build idempotency fingerprint for consumption event
 * Prevents double-counting during job retries
 */
export function buildConsumptionFingerprint(
  transactionId: string,
  spoolerCorrelationKey: string,
): string {
  const combined = `${transactionId}:${spoolerCorrelationKey}`;
  // Use combination as fingerprint; in production would use hash
  return combined;
}

/**
 * Build idempotency fingerprint for threshold incident
 * Prevents duplicate threshold alerts on retries
 */
export function buildThresholdFingerprint(
  printerName: string,
  supplyName: string | null,
  levelPercentage: number,
  incidentType: 'threshold_triggered' | 'threshold_recovered',
): string {
  // Round to nearest 1% to avoid noise from tiny fluctuations
  const roundedLevel = Math.round(levelPercentage);
  const supply = supplyName ?? 'paper';
  return `${printerName}:${supply}:${roundedLevel}:${incidentType}`;
}

/**
 * Determine if consumption event is a terminal outcome (should record)
 * Only records on success or non-retryable failure
 * Skips retryable failures (will be retried)
 */
export function isTerminalConsumptionOutcome(
  outcome: 'success' | 'retryable_failure' | 'non_retryable_failure',
): boolean {
  return outcome === 'success' || outcome === 'non_retryable_failure';
}
