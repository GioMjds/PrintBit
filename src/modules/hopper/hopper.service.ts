import { db } from '@/services/db';
import {
  hopperService as legacyHopperService,
  type HopperDispenseResult,
} from '@/services/hopper';
import type { HopperSettings, HopperStats } from './hopper.schema';

export type { HopperDispenseResult };

/**
 * HopperService wraps the legacy hopper service and exposes a clean interface
 * for use within the modular architecture.
 *
 * The hopper is primarily accessed through admin routes, so this module
 * is mainly for organizing the service logic.
 */
export class HopperService {
  /**
   * Retrieves the current hopper settings from the database.
   */
  getSettings(): HopperSettings {
    return db.data!.hopperSettings;
  }

  /**
   * Retrieves the current hopper statistics from the database.
   */
  getStats(): HopperStats {
    return db.data!.hopperStats;
  }

  /**
   * Dispenses coins for the given change amount.
   * Records owed change on failure.
   */
  dispenseChange(amount: number): Promise<HopperDispenseResult> {
    return legacyHopperService.dispenseChange(amount);
  }

  /**
   * Runs a self-test on the hopper hardware.
   * Updates stats and logs anomalies on failure.
   */
  runSelfTest(): Promise<HopperDispenseResult> {
    return legacyHopperService.runSelfTest();
  }
}
