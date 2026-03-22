/**
 * Watchdog configuration - threshold settings for watchdog monitoring.
 */

function readWatchdogAlertThreshold(): number {
  const raw = process.env.PRINTBIT_WATCHDOG_FAILURE_ALERT_THRESHOLD;
  if (typeof raw !== 'string' || !raw.trim()) return 5;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 5;
  return Math.floor(parsed);
}

export const WATCHDOG_ALERT_THRESHOLD = readWatchdogAlertThreshold();
