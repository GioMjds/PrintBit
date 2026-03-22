/**
 * Validation utility functions.
 */

/**
 * Check if a value is a finite number.
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Check if a value is a whole peso (non-negative integer).
 */
export function isWholePeso(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Normalize a printer name by removing control characters.
 */
export function normalizeTargetPrinterName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const sanitized = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return sanitized ? sanitized : null;
}

/**
 * Type guard for anomaly severity values.
 */
export function isAnomalySeverity(value: unknown): value is 'warning' | 'critical' {
  return value === 'warning' || value === 'critical';
}

/**
 * Type guard for anomaly status values.
 */
export function isAnomalyStatus(
  value: unknown,
): value is 'open' | 'acknowledged' | 'resolved' {
  return value === 'open' || value === 'acknowledged' || value === 'resolved';
}

/**
 * Type guard for anomaly category values.
 */
export function isAnomalyCategory(
  value: unknown,
): value is
  | 'printer'
  | 'spooler'
  | 'serial'
  | 'hopper'
  | 'network'
  | 'security' {
  return (
    value === 'printer' ||
    value === 'spooler' ||
    value === 'serial' ||
    value === 'hopper' ||
    value === 'network' ||
    value === 'security'
  );
}
