import { randomUUID } from 'node:crypto';
import { adminService } from './admin';
import { db, type LogMeta, type OwedChangeEntry } from './db';
import {
  anomalyService,
  buildAnomalyFingerprint,
  mapHopperErrorSeverity,
} from './anomaly';
import { getTrustedTimestamp } from './time-source';
import { ESP32_AP_BASE_URL, ESP32_COIN_BRIDGE_API_KEY, NETWORK_PROVIDER } from '@/config';
import { safeAmount } from '@/utils';
import { getHopperStatus } from './serial';
import { HopperErrorCode, type HopperErrorCodeValue } from './hopper-protocol';

export interface HopperDispenseResult {
  ok: boolean;
  requestedCoins: number;
  dispensedCoins: number;
  message: string;
  attempts: number;
  owedChangeId?: string;
  errorCode?: HopperErrorCodeValue;
}

type Esp32HopperStatus = {
  dispensing: boolean;
  targetCoins: number;
  dispensedCoins: number;
  activeRequestId: string;
  lastRequestId: string;
  lastOutcome: string;
  lastError: string;
};

type Esp32DispenseAttemptResult = {
  ok: boolean;
  dispensedCoins: number;
  message: string;
  errorCode?: HopperErrorCodeValue;
};

class HopperService {
  private normalizeDispensedCoins(
    dispensed: number | undefined,
    remainingCoins: number,
  ): number {
    if (typeof dispensed !== 'number' || !Number.isFinite(dispensed)) return 0;
    return Math.max(0, Math.min(Math.floor(dispensed), remainingCoins));
  }

  private async recordOwedChange(
    amount: number,
    reason: string,
    meta?: LogMeta,
  ): Promise<OwedChangeEntry> {
    const trusted = getTrustedTimestamp();
    const entry: OwedChangeEntry = {
      id: randomUUID(),
      timestamp: trusted.timestamp,
      timestampMeta: trusted.meta,
      amount: safeAmount(amount),
      reason,
      status: 'open',
      meta,
    };

    db.data!.owedChanges.unshift(entry);
    await db.write();
    return entry;
  }

  private isEsp32Mode(): boolean {
    return NETWORK_PROVIDER === 'esp32';
  }

  private mapEsp32ErrorCode(rawMessage: string): HopperErrorCodeValue {
    const upper = rawMessage.toUpperCase();
    if (upper.includes('JAM')) return HopperErrorCode.JAM;
    if (upper.includes('EMPTY')) return HopperErrorCode.EMPTY;
    if (upper.includes('TIMEOUT') || upper.includes('ABORT')) {
      return HopperErrorCode.MOTOR_TIMEOUT;
    }
    if (upper.includes('PARTIAL')) return HopperErrorCode.PARTIAL;
    if (upper.includes('SENSOR')) return HopperErrorCode.SENSOR;
    return HopperErrorCode.UNKNOWN;
  }

  private async fetchEsp32(
    routePath: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const requestUrl = new URL(routePath, `${ESP32_AP_BASE_URL}/`);
    const normalizedTimeout = Number.isFinite(timeoutMs)
      ? Math.max(1_000, Math.floor(timeoutMs))
      : 8_000;
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      normalizedTimeout,
    );

    try {
      return await fetch(requestUrl, {
        ...init,
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseEsp32HopperStatus(payload: unknown): Esp32HopperStatus | null {
    if (!payload || typeof payload !== 'object') return null;
    const record = payload as Record<string, unknown>;
    return {
      dispensing: record.dispensing === true,
      targetCoins:
        typeof record.targetCoins === 'number' &&
        Number.isFinite(record.targetCoins)
          ? Math.max(0, Math.floor(record.targetCoins))
          : 0,
      dispensedCoins:
        typeof record.dispensedCoins === 'number' &&
        Number.isFinite(record.dispensedCoins)
          ? Math.max(0, Math.floor(record.dispensedCoins))
          : 0,
      activeRequestId:
        typeof record.activeRequestId === 'string' ? record.activeRequestId : '',
      lastRequestId:
        typeof record.lastRequestId === 'string' ? record.lastRequestId : '',
      lastOutcome:
        typeof record.lastOutcome === 'string' ? record.lastOutcome : '',
      lastError: typeof record.lastError === 'string' ? record.lastError : '',
    };
  }

  async dispenseChange(amount: number): Promise<HopperDispenseResult> {
    const stats = db.data!.hopperStats;
    const coins = Math.floor(amount);
    
    // MOCKING: Bypass hardware if not in esp32 mode
    if (!this.isEsp32Mode()) {
        console.log(`[MOCK HOPPER] Dispensing ${coins} coins`);
        return {
            ok: true,
            requestedCoins: coins,
            dispensedCoins: coins,
            message: 'Mock dispensed',
            attempts: 1,
        };
    }

    if (!db.data!.hopperSettings.enabled) {
      const owed = await this.recordOwedChange(
        amount,
        'Hopper is disabled in settings.',
        {
          requestedCoins: coins,
        },
      );
      return {
        ok: false,
        requestedCoins: coins,
        dispensedCoins: 0,
        message: 'Hopper is disabled in settings.',
        attempts: 0,
        owedChangeId: owed.id,
      };
    }

    if (this.isEsp32Mode()) {
      return this.dispenseChangeViaEsp32(amount, coins);
    }

    const serialStatus = getHopperStatus();
    if (!serialStatus.connected) {
      const owed = await this.recordOwedChange(
        amount,
        'Serial port not connected.',
        {
          requestedCoins: coins,
        },
      );
      stats.dispenseFailures += 1;
      stats.lastError = 'Serial port not connected.';
      await db.write();
      return {
        ok: false,
        requestedCoins: coins,
        dispensedCoins: 0,
        message: 'Serial port not connected.',
        attempts: 0,
        owedChangeId: owed.id,
      };
    }

    // TODO: Implement serial hopper dispensing logic
    return {
      ok: false,
      requestedCoins: coins,
      dispensedCoins: 0,
      message: 'Serial hopper not implemented',
      attempts: 0,
    };
  }

  private async dispenseChangeViaEsp32(
    requestedAmount: number,
    coins: number,
  ): Promise<HopperDispenseResult> {
    const stats = db.data!.hopperStats;
    const requestId = randomUUID();
    const token = ESP32_COIN_BRIDGE_API_KEY;

    try {
      const url = `/hopper/dispense?token=${encodeURIComponent(token)}&coins=${coins}&requestId=${encodeURIComponent(requestId)}`;
      const res = await this.fetchEsp32(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-hopper-token': token,
            'x-coin-api-key': token,
          },
          body: JSON.stringify({
            token,
            coins,
            targetCoins: coins,
            requestId,
          }),
        },
        15_000,
      );

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`ESP32 returned ${res.status}${errorText ? `: ${errorText}` : ''}`);
      }

      // ESP32 accepted dispense request (HTTP 202 / 200). Poll status until finished.
      const pollStartTime = Date.now();
      const maxPollMs = Math.max(15_000, coins * 3_000 + 5_000);
      let finalStatus: Esp32HopperStatus | null = null;

      while (Date.now() - pollStartTime < maxPollMs) {
        await new Promise((r) => setTimeout(r, 400));
        finalStatus = await this.readEsp32HopperStatus(10_000);
        if (finalStatus && !finalStatus.dispensing) {
          break;
        }
      }

      const dispensedCoins = finalStatus?.dispensedCoins ?? 0;
      const outcome = finalStatus?.lastOutcome || (dispensedCoins >= coins ? 'done' : 'failed');

      if (outcome === 'done' || dispensedCoins >= coins) {
        stats.totalDispensed += dispensedCoins;
        stats.dispenseSuccess += 1;
        stats.lastDispensedAt = new Date().toISOString();
        stats.lastError = null;
        await db.write();
        return {
          ok: true,
          requestedCoins: coins,
          dispensedCoins,
          message: 'Dispensed successfully via ESP32',
          attempts: 1,
        };
      }

      const failureMessage =
        finalStatus?.lastError ||
        `Dispense unfulfilled: ${dispensedCoins}/${coins} coins dispensed`;
      throw new Error(failureMessage);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorCode = this.mapEsp32ErrorCode(errorMessage);

      const owed = await this.recordOwedChange(requestedAmount, errorMessage, {
        requestedCoins: coins,
        errorCode,
        requestId,
      });

      stats.dispenseFailures += 1;
      stats.lastError = errorMessage;
      await db.write();

      await anomalyService.report({
        type: 'hopper_dispense_failed',
        source: 'hopper',
        category: 'hopper',
        severity: mapHopperErrorSeverity(errorCode),
        message: `Hopper dispense failed: ${errorMessage}`,
        fingerprint: buildAnomalyFingerprint(['hopper', 'dispense', errorCode]),
        context: {
          requestId,
          requestedAmount,
          errorCode,
        },
      });

      return {
        ok: false,
        requestedCoins: coins,
        dispensedCoins: 0,
        message: errorMessage,
        attempts: 1,
        owedChangeId: owed.id,
        errorCode,
      };
    }
  }

  async runSelfTest(): Promise<HopperDispenseResult> {
    const stats = db.data!.hopperStats;
    const timeoutMs = db.data!.hopperSettings.timeoutMs;

    if (!db.data!.hopperSettings.enabled) {
      await anomalyService.report({
        type: 'hopper_self_test_disabled',
        source: 'hopper',
        category: 'hopper',
        severity: 'warning',
        message: 'Hopper self-test requested but hopper is disabled.',
        fingerprint: buildAnomalyFingerprint([
          'hopper',
          'self-test',
          'disabled',
        ]),
      });
      return {
        ok: false,
        requestedCoins: 0,
        dispensedCoins: 0,
        message: 'Hopper is disabled in settings.',
        attempts: 0,
      };
    }

    if (this.isEsp32Mode()) {
      const statusResult = await this.readEsp32Status(timeoutMs);
      db.data!.hopperStats.selfTestPassed = statusResult.ok;
      db.data!.hopperStats.lastSelfTestAt = new Date().toISOString();
      db.data!.hopperStats.lastError = statusResult.ok
        ? null
        : statusResult.message;
      await db.write();

      if (!statusResult.ok) {
        await anomalyService.report({
          type: 'hopper_self_test_esp32_unreachable',
          source: 'hopper',
          category: 'hopper',
          severity: 'critical',
          message: `Hopper self-test failed in ESP32 mode: ${statusResult.message}`,
          fingerprint: buildAnomalyFingerprint([
            'hopper',
            'self-test',
            'esp32-unreachable',
          ]),
        });
      }
      return statusResult;
    }

    return {
      ok: false,
      requestedCoins: 0,
      dispensedCoins: 0,
      message: 'Self-test not implemented for serial hopper.',
      attempts: 0,
    };
  }

  private async readEsp32HopperStatus(
    timeoutMs: number,
  ): Promise<Esp32HopperStatus | null> {
    try {
      const token = ESP32_COIN_BRIDGE_API_KEY;
      const res = await this.fetchEsp32(
        `/hopper/status?token=${encodeURIComponent(token)}`,
        {
          method: 'GET',
          headers: {
            'x-hopper-token': token,
            'x-coin-api-key': token,
          },
        },
        timeoutMs,
      );
      if (!res.ok) return null;
      const payload = await res.json();
      return this.parseEsp32HopperStatus(payload);
    } catch {
      return null;
    }
  }

  private async readEsp32Status(
    timeoutMs: number,
  ): Promise<HopperDispenseResult> {
    const status = await this.readEsp32HopperStatus(timeoutMs);
    if (status) {
      return {
        ok: true,
        requestedCoins: 0,
        dispensedCoins: status.dispensedCoins,
        message: status.lastError ? `Status: ${status.lastError}` : 'Status read',
        attempts: 1,
      };
    }
    return {
      ok: false,
      requestedCoins: 0,
      dispensedCoins: 0,
      message: 'Failed to read ESP32 status',
      attempts: 0,
    };
  }
}

export const hopperService = new HopperService();
export const runHopperSelfTest = hopperService.runSelfTest.bind(hopperService);
