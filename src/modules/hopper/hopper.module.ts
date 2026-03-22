import type { Express } from 'express';
import type { ModuleContext } from '../module.types';
import { HopperService } from './hopper.service';

export interface HopperModuleDeps extends ModuleContext {
  // No additional dependencies required - hopper is controlled via admin routes
}

// Singleton service instance for use by other modules (e.g., admin routes)
let hopperServiceInstance: HopperService | null = null;

/**
 * Returns the HopperService singleton instance.
 * Must be called after registerHopperModule.
 */
export function getHopperService(): HopperService {
  if (!hopperServiceInstance) {
    throw new Error(
      'HopperService not initialized. Call registerHopperModule first.',
    );
  }
  return hopperServiceInstance;
}

/**
 * Registers the Hopper module.
 *
 * The hopper is primarily accessed through admin routes, so this module
 * does not mount its own routes. It initializes the service for use by
 * other modules (e.g., admin, financial).
 */
export function registerHopperModule(
  _app: Express,
  _deps: HopperModuleDeps,
): void {
  hopperServiceInstance = new HopperService();

  console.log('[HOPPER MODULE] Hopper module registered.');
}

