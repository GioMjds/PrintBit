import {
  getWatchdogHealthSnapshot,
  getExternalWatchdogState,
  updateExternalWatchdogState,
  type WatchdogHealthSnapshot,
  type ExternalWatchdogState,
} from '@/services/watchdog-health';

export class WatchdogService {
  /**
   * Returns a snapshot of the watchdog health status.
   */
  getHealthSnapshot(): WatchdogHealthSnapshot {
    return getWatchdogHealthSnapshot();
  }

  /**
   * Returns the current external watchdog state.
   */
  getExternalState(): ExternalWatchdogState {
    return getExternalWatchdogState();
  }

  /**
   * Updates the external watchdog state with the provided payload.
   */
  updateExternalState(
    payload: Partial<
      Omit<ExternalWatchdogState, 'lastUpdatedAt' | 'watchdogPid'> & {
        watchdogPid: number | null;
      }
    >,
  ): ExternalWatchdogState {
    return updateExternalWatchdogState(payload);
  }
}
