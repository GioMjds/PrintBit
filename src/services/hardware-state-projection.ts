import type { Server, Socket } from 'socket.io';
import { db } from './db';
import { adminService } from './admin';
import { financialLedgerService } from './financial-ledger';
import type { WorkerPrintEvent } from './worker-return-pipe';
import { sendWorkerCommand } from './worker-command-pipe';

export interface SerialStatus {
  connected: boolean;
  portPath: string | null;
  lastError: string | null;
  apIp: string | null;
  staIp: string | null;
  kioskIp: string | null;
  coinTarget: string | null;
  portalTarget: string | null;
}

export interface HopperStatus {
  connected: boolean;
  pending: boolean;
  portPath: string | null;
  lastError: string | null;
  lastSuccessAt: string | null;
}

export class HardwareStateProjection {
  private serialStatus: SerialStatus = {
    connected: false,
    portPath: null,
    lastError: null,
    apIp: null,
    staIp: null,
    kioskIp: null,
    coinTarget: null,
    portalTarget: null,
  };

  private hopperStatus: HopperStatus = {
    connected: false,
    pending: false,
    portPath: null,
    lastError: null,
    lastSuccessAt: null,
  };

  private coinSlotLocks = new Map<string, string>();
  private io: Server | Socket | { emit: (event: string, ...args: unknown[]) => void } | null = null;

  public setSocketIo(
    io: Server | Socket | { emit: (event: string, ...args: unknown[]) => void } | null,
  ): void {
    this.io = io;
  }

  public getSerialStatus(): SerialStatus {
    return { ...this.serialStatus };
  }

  public getHopperStatus(): HopperStatus {
    return { ...this.hopperStatus };
  }

  public isCoinSlotLocked(): boolean {
    return this.coinSlotLocks.size > 0;
  }

  public isCoinSlotLockedBy(ownerId: string): boolean {
    return this.coinSlotLocks.has(ownerId);
  }

  public getCoinSlotLockOwners(): string[] {
    return Array.from(this.coinSlotLocks.keys());
  }

  public getCoinSlotLockOwnerId(): string | null {
    const owners = this.getCoinSlotLockOwners();
    if (owners.length === 0) return null;
    const nonPowerSafety = owners.find((o) => o !== 'power-safety');
    return nonPowerSafety ?? owners[0];
  }

  public getCoinSlotLockedAt(): string | null {
    const first = this.coinSlotLocks.values().next();
    return first.done ? null : first.value;
  }

  public resetCoinSlotLocks(): void {
    this.coinSlotLocks.clear();
  }

  public lockCoinSlot(ownerId: string, reason?: string): void {
    this.coinSlotLocks.set(ownerId, new Date().toISOString());
    try {
      void sendWorkerCommand({
        type: 'LockCoinSlot' as any,
        requestId: `lock-${Date.now()}`,
        ownerId,
        reason,
        timestampUtc: new Date().toISOString(),
      } as any);
    } catch {
      // Best-effort dispatch
    }
  }

  public unlockOwnedCoinSlot(ownerId: string): boolean {
    if (!this.coinSlotLocks.has(ownerId)) {
      return false;
    }
    this.coinSlotLocks.delete(ownerId);
    try {
      void sendWorkerCommand({
        type: 'UnlockCoinSlot' as any,
        requestId: `unlock-${Date.now()}`,
        ownerId,
        timestampUtc: new Date().toISOString(),
      } as any);
    } catch {
      // Best-effort dispatch
    }
    return true;
  }

  public async sendKioskIpAnnouncement(
    ip: string,
    port: number,
    path: string,
  ): Promise<boolean> {
    try {
      const success = await sendWorkerCommand({
        type: 'AnnounceKioskIp' as any,
        requestId: `ann-${Date.now()}`,
        ip,
        port,
        path,
        timestampUtc: new Date().toISOString(),
      } as any);
      return success;
    } catch {
      return false;
    }
  }

  public async applyEvent(evt: WorkerPrintEvent): Promise<void> {
    switch (evt.type) {
      case 'CoinInserted': {
        const value = evt.coinValue ?? 0;
        if (value > 0 && db.data) {
          db.data.balance += value;
          await db.write?.();

          await adminService.incrementCoinStats(value);
          await adminService.appendAdminLog(
            'coin_accepted',
            `Accepted coin: ${value}`,
            {
              coinValue: value,
              balance: db.data.balance,
            },
          );

          await financialLedgerService.append({
            eventType: 'coin_inserted',
            amount: value,
            meta: {
              source: 'worker',
              balance: db.data.balance,
            },
          });

          this.io?.emit('balance', db.data.balance);
          this.io?.emit('coinAccepted', {
            value,
            balance: db.data.balance,
          });
        }
        break;
      }

      case 'CoinRejected': {
        this.io?.emit('coinRejected', {
          value: evt.coinValue,
          reason: evt.rejectReason,
        });

        await adminService.appendAdminLog(
          'coin_rejected',
          `Coin rejected: ${evt.rejectReason ?? 'unknown'}`,
          {
            coinValue: evt.coinValue ?? null,
            reason: evt.rejectReason ?? null,
          },
        );
        break;
      }

      case 'HopperProgress': {
        this.hopperStatus.pending = true;
        this.io?.emit('hopperProgress', {
          requestId: evt.requestId ?? evt.hardwareRequestId,
          dispensed: evt.dispensedCoins,
          total: evt.totalCoins,
        });
        break;
      }

      case 'HopperDispensed': {
        this.hopperStatus.pending = false;
        if (!evt.errorCode) {
          this.hopperStatus.lastSuccessAt = evt.timestampUtc;
          this.hopperStatus.lastError = null;
        } else {
          this.hopperStatus.lastError = evt.message ?? evt.errorCode;
        }
        break;
      }

      case 'HardwareStatus': {
        this.serialStatus.connected = true;
        this.io?.emit('serialStatus', this.getSerialStatus());
        break;
      }
    }
  }
}

export const hardwareStateProjection = new HardwareStateProjection();

// Top-level exported convenience functions matching legacy serial.ts
export function getSerialStatus(): SerialStatus {
  return hardwareStateProjection.getSerialStatus();
}

export function getHopperStatus(): HopperStatus {
  return hardwareStateProjection.getHopperStatus();
}

export function lockCoinSlot(ownerId: string, reason?: string): void {
  hardwareStateProjection.lockCoinSlot(ownerId, reason);
}

export function unlockOwnedCoinSlot(ownerId: string): boolean {
  return hardwareStateProjection.unlockOwnedCoinSlot(ownerId);
}

export function isCoinSlotLocked(): boolean {
  return hardwareStateProjection.isCoinSlotLocked();
}

export function isCoinSlotLockedBy(ownerId: string): boolean {
  return hardwareStateProjection.isCoinSlotLockedBy(ownerId);
}

export function getCoinSlotLockOwners(): string[] {
  return hardwareStateProjection.getCoinSlotLockOwners();
}

export function getCoinSlotLockOwnerId(): string | null {
  return hardwareStateProjection.getCoinSlotLockOwnerId();
}

export function getCoinSlotLockedAt(): string | null {
  return hardwareStateProjection.getCoinSlotLockedAt();
}

export function resetCoinSlotLocks(): void {
  hardwareStateProjection.resetCoinSlotLocks();
}

export async function initSerial(
  io?: Server | Socket | { emit: (event: string, ...args: unknown[]) => void } | null,
): Promise<void> {
  if (io) {
    hardwareStateProjection.setSocketIo(io);
  }
}

export function sendKioskIpAnnouncement(
  kioskIp?: string,
  port = 3000,
  portalPath = '/api/portal',
): Promise<boolean> {
  return hardwareStateProjection.sendKioskIpAnnouncement(
    kioskIp ?? '127.0.0.1',
    port,
    portalPath,
  );
}

export const serialService = {
  lockCoinSlot: (ownerId: string, reason?: string) =>
    hardwareStateProjection.lockCoinSlot(ownerId, reason),
  unlockOwnedCoinSlot: (ownerId: string) =>
    hardwareStateProjection.unlockOwnedCoinSlot(ownerId),
  isCoinSlotLocked: () => hardwareStateProjection.isCoinSlotLocked(),
  isCoinSlotLockedBy: (ownerId: string) =>
    hardwareStateProjection.isCoinSlotLockedBy(ownerId),
  getCoinSlotLockOwners: () => hardwareStateProjection.getCoinSlotLockOwners(),
  getCoinSlotLockOwnerId: () => hardwareStateProjection.getCoinSlotLockOwnerId(),
  getCoinSlotLockedAt: () => hardwareStateProjection.getCoinSlotLockedAt(),
  sendKioskIpAnnouncement: (
    kioskIp?: string,
    port = 3000,
    portalPath = '/api/portal',
  ) =>
    hardwareStateProjection.sendKioskIpAnnouncement(
      kioskIp ?? '127.0.0.1',
      port,
      portalPath,
    ),
  getSerialStatus: () => hardwareStateProjection.getSerialStatus(),
  getHopperStatus: () => hardwareStateProjection.getHopperStatus(),
};

