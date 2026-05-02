/**
 * Read and validate the watchdog alert threshold from environment.
 *
 * The function attempts to read the environment variable
 * `PRINTBIT_WATCHDOG_FAILURE_ALERT_THRESHOLD` and convert it into a
 * non-zero positive integer which represents how many consecutive
 * watchdog failures should occur before an alert is triggered.
 *
 * Behavior and validation rules:
 * - If the environment variable is missing, empty, or not a string,
 *   the function returns the default value 5.
 * - The value is parsed using Number(...). If the result is not a
 *   finite number or is less than or equal to 0, the default 5 is
 *   returned.
 * - If the value is a positive finite number, it is rounded down
 *   using Math.floor and returned as an integer.
 *
 * Examples:
 * - PRINTBIT_WATCHDOG_FAILURE_ALERT_THRESHOLD=10 -> returns 10
 * - PRINTBIT_WATCHDOG_FAILURE_ALERT_THRESHOLD=3.9 -> returns 3
 * - PRINTBIT_WATCHDOG_FAILURE_ALERT_THRESHOLD=0 -> returns 5 (default)
 * - PRINTBIT_WATCHDOG_FAILURE_ALERT_THRESHOLD=abc -> returns 5 (default)
 *
 * @returns {number} The validated watchdog alert threshold.
 */
function readWatchdogAlertThreshold(): number {
  const raw = process.env.PRINTBIT_WATCHDOG_FAILURE_ALERT_THRESHOLD;
  if (typeof raw !== 'string' || !raw.trim()) return 5;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 5;
  return Math.floor(parsed);
}

export const WATCHDOG_ALERT_THRESHOLD = readWatchdogAlertThreshold();
