import {
  startHotspot,
  stopHotspot,
  isHotspotRunning,
  getHotspotConfig,
  type HotspotConfigPayload,
} from '@/services/hotspot';

export class HotspotService {
  /**
   * Get current hotspot configuration.
   */
  getConfig(): HotspotConfigPayload {
    return getHotspotConfig();
  }

  /**
   * Start the hotspot service.
   */
  async start(): Promise<void> {
    return startHotspot();
  }

  /**
   * Stop the hotspot service.
   */
  stop(): void {
    stopHotspot();
  }

  /**
   * Check if the hotspot is currently running.
   */
  isRunning(): boolean {
    return isHotspotRunning();
  }
}
