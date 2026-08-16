import type { WirelessSessionService } from '@/modules/wireless-session/wireless-session.service';
import type { CoinCreditResult } from '@/modules/wireless-session/wireless-session.types';

export interface CoinBridgeEventResult extends CoinCreditResult {
  source?: string;
  reason?: string;
}

export class CoinBridgeService {
  private wirelessSessionService: WirelessSessionService | null = null;
  private processedCoinEventIds = new Set<string>();

  setWirelessSessionService(service: WirelessSessionService | null): void {
    this.wirelessSessionService = service;
  }

  getWirelessSessionService(): WirelessSessionService | null {
    return this.wirelessSessionService;
  }

  isSessionActive(): boolean {
    return this.wirelessSessionService?.getKioskState() === 'ACTIVE';
  }

  handleIncomingCoin(
    amount: number,
    eventId: string,
    source: string = 'esp32-http',
  ): CoinBridgeEventResult {
    const normalizedEventId = (eventId ?? '').trim();

    if (!this.wirelessSessionService) {
      return {
        accepted: false,
        newBalance: 0,
        reason: 'NO_ACTIVE_SERVICE',
        source,
      };
    }

    if (this.wirelessSessionService.getKioskState() !== 'ACTIVE') {
      return {
        accepted: false,
        newBalance: this.wirelessSessionService.getActiveSessionBalance(),
        reason: 'SESSION_NOT_ACTIVE',
        source,
      };
    }

    if (normalizedEventId && this.processedCoinEventIds.has(normalizedEventId)) {
      return {
        accepted: false,
        newBalance: this.wirelessSessionService.getActiveSessionBalance(),
        reason: 'DUPLICATE_EVENT_ID',
        source,
      };
    }

    const result = this.wirelessSessionService.handleIncomingCoin(amount, eventId);
    if (result.accepted && normalizedEventId) {
      this.processedCoinEventIds.add(normalizedEventId);
    }

    return {
      accepted: result.accepted,
      newBalance: result.newBalance,
      source,
    };
  }

  clearProcessedEventIds(): void {
    this.processedCoinEventIds.clear();
  }
}

export const coinBridgeService = new CoinBridgeService();
