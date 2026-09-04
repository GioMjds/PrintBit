import {
  HardwareStateProjection,
  getSerialStatus,
  getHopperStatus,
  lockCoinSlot,
  unlockOwnedCoinSlot,
  isCoinSlotLocked,
  isCoinSlotLockedBy,
} from '../hardware-state-projection';
import { db } from '../db';
import { adminService } from '../admin';
import { financialLedgerService } from '../financial-ledger';
import type { WorkerPrintEvent } from '../worker-return-pipe';

jest.mock('../db', () => ({
  db: {
    data: {
      balance: 10,
    },
    write: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../admin', () => ({
  adminService: {
    incrementCoinStats: jest.fn().mockResolvedValue(undefined),
    appendAdminLog: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../financial-ledger', () => ({
  financialLedgerService: {
    append: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('HardwareStateProjection', () => {
  let projection: HardwareStateProjection;
  let mockIo: { emit: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    db.data!.balance = 10;
    mockIo = { emit: jest.fn() };
    projection = new HardwareStateProjection();
    projection.setSocketIo(mockIo as any);
  });

  describe('CoinInserted event', () => {
    it('increments balance, records ledger, updates stats, and emits balance & coinAccepted', async () => {
      const event: WorkerPrintEvent = {
        type: 'CoinInserted',
        coinValue: 5,
        timestampUtc: new Date().toISOString(),
      };

      await projection.applyEvent(event);

      expect(db.data!.balance).toBe(15);
      expect(adminService.incrementCoinStats).toHaveBeenCalledWith(5);
      expect(adminService.appendAdminLog).toHaveBeenCalledWith(
        'coin_accepted',
        expect.stringContaining('5'),
        expect.objectContaining({ coinValue: 5, balance: 15 }),
      );
      expect(financialLedgerService.append).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'coin_inserted',
          amount: 5,
          meta: expect.objectContaining({ source: 'worker', balance: 15 }),
        }),
      );
      expect(mockIo.emit).toHaveBeenCalledWith('balance', 15);
      expect(mockIo.emit).toHaveBeenCalledWith('coinAccepted', {
        value: 5,
        balance: 15,
      });
    });
  });

  describe('CoinRejected event', () => {
    it('emits coinRejected and logs to admin', async () => {
      const event: WorkerPrintEvent = {
        type: 'CoinRejected',
        coinValue: 10,
        rejectReason: 'power_emergency',
        timestampUtc: new Date().toISOString(),
      };

      await projection.applyEvent(event);

      expect(mockIo.emit).toHaveBeenCalledWith('coinRejected', {
        value: 10,
        reason: 'power_emergency',
      });
      expect(adminService.appendAdminLog).toHaveBeenCalledWith(
        'coin_rejected',
        expect.stringContaining('power_emergency'),
        expect.objectContaining({ coinValue: 10, reason: 'power_emergency' }),
      );
    });
  });

  describe('HopperProgress event', () => {
    it('emits hopperProgress with requestId, dispensed and total', async () => {
      const event: WorkerPrintEvent = {
        type: 'HopperProgress',
        requestId: 'a1b2',
        dispensedCoins: 3,
        totalCoins: 5,
        timestampUtc: new Date().toISOString(),
      };

      await projection.applyEvent(event);

      expect(mockIo.emit).toHaveBeenCalledWith('hopperProgress', {
        requestId: 'a1b2',
        dispensed: 3,
        total: 5,
      });
    });
  });

  describe('HopperDispensed event', () => {
    it('updates hopper status on successful dispense', async () => {
      const event: WorkerPrintEvent = {
        type: 'HopperDispensed',
        requestId: 'a1b2',
        dispensedCoins: 5,
        totalCoins: 5,
        timestampUtc: '2026-09-04T12:00:00.000Z',
      };

      await projection.applyEvent(event);

      const status = projection.getHopperStatus();
      expect(status.pending).toBe(false);
      expect(status.lastSuccessAt).toBe('2026-09-04T12:00:00.000Z');
      expect(status.lastError).toBeNull();
    });

    it('updates hopper status with error on failure', async () => {
      const event: WorkerPrintEvent = {
        type: 'HopperDispensed',
        requestId: 'a1b2',
        dispensedCoins: 2,
        totalCoins: 5,
        errorCode: 'TIMEOUT',
        message: 'Hopper timed out',
        timestampUtc: '2026-09-04T12:05:00.000Z',
      };

      await projection.applyEvent(event);

      const status = projection.getHopperStatus();
      expect(status.pending).toBe(false);
      expect(status.lastError).toBe('Hopper timed out');
    });
  });

  describe('HardwareStatus event', () => {
    it('updates serial connected status and emits serialStatus', async () => {
      const event: WorkerPrintEvent = {
        type: 'HardwareStatus',
        message: 'Heartbeat',
        timestampUtc: new Date().toISOString(),
      };

      await projection.applyEvent(event);

      const status = projection.getSerialStatus();
      expect(status.connected).toBe(true);
      expect(mockIo.emit).toHaveBeenCalledWith('serialStatus', status);
    });
  });

  describe('Coin slot locks', () => {
    it('locks, checks, and unlocks coin slot correctly', async () => {
      expect(isCoinSlotLocked()).toBe(false);
      expect(isCoinSlotLockedBy('session-1')).toBe(false);

      await lockCoinSlot('session-1', 'printing');
      expect(isCoinSlotLocked()).toBe(true);
      expect(isCoinSlotLockedBy('session-1')).toBe(true);
      expect(isCoinSlotLockedBy('session-2')).toBe(false);

      await lockCoinSlot('session-2', 'power-safety');
      expect(isCoinSlotLocked()).toBe(true);

      const unlockedSession1 = await unlockOwnedCoinSlot('session-1');
      expect(unlockedSession1).toBe(true);
      expect(isCoinSlotLocked()).toBe(true);
      expect(isCoinSlotLockedBy('session-1')).toBe(false);
      expect(isCoinSlotLockedBy('session-2')).toBe(true);

      const unlockedNonExistent = await unlockOwnedCoinSlot('non-existent');
      expect(unlockedNonExistent).toBe(false);

      const unlockedSession2 = await unlockOwnedCoinSlot('session-2');
      expect(unlockedSession2).toBe(true);
      expect(isCoinSlotLocked()).toBe(false);
    });
  });

  describe('Status getters export', () => {
    it('returns default serial and hopper status', () => {
      const serial = getSerialStatus();
      expect(serial).toBeDefined();
      expect(typeof serial.connected).toBe('boolean');

      const hopper = getHopperStatus();
      expect(hopper).toBeDefined();
      expect(typeof hopper.connected).toBe('boolean');
    });
  });
});
