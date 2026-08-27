import type { PrintQuality } from '@/core/database/shared.schema';
import type { PrintJobOptions } from './printer';

/**
 * Retains the customer-selected driver quality while building options for a
 * dispatch backend. Callers must supply the quality explicitly so it cannot
 * silently fall back to the worker's standard-quality default.
 */
export function withPrintQuality(
  options: Omit<PrintJobOptions, 'quality'>,
  quality: PrintQuality,
): PrintJobOptions {
  return { ...options, quality };
}
