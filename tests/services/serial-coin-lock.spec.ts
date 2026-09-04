import {
  lockCoinSlot,
  unlockOwnedCoinSlot,
  isCoinSlotLocked,
  isCoinSlotLockedBy,
  getCoinSlotLockOwnerId,
  resetCoinSlotLocks,
} from '../../src/services/hardware-state-projection';

jest.mock('../../src/services/worker-command-pipe', () => ({
  sendWorkerCommand: jest.fn().mockResolvedValue(true),
  sendWorkerRequest: jest.fn().mockResolvedValue(null),
}));

describe('Serial Coin Slot Multi-Owner Locking', () => {
  beforeEach(() => {
    resetCoinSlotLocks();
  });

  test('starts completely unlocked', () => {
    expect(isCoinSlotLocked()).toBe(false);
    expect(isCoinSlotLockedBy('power-safety')).toBe(false);
    expect(isCoinSlotLockedBy('socket-1')).toBe(false);
    expect(getCoinSlotLockOwnerId()).toBeNull();
  });

  test('allows single owner to lock and unlock', () => {
    lockCoinSlot('socket-1');
    expect(isCoinSlotLocked()).toBe(true);
    expect(isCoinSlotLockedBy('socket-1')).toBe(true);
    expect(isCoinSlotLockedBy('power-safety')).toBe(false);
    expect(getCoinSlotLockOwnerId()).toBe('socket-1');

    const unlocked = unlockOwnedCoinSlot('socket-1');
    expect(unlocked).toBe(true);
    expect(isCoinSlotLocked()).toBe(false);
    expect(isCoinSlotLockedBy('socket-1')).toBe(false);
    expect(getCoinSlotLockOwnerId()).toBeNull();
  });

  test('allows multiple owners to coexist without overwriting each other', () => {
    lockCoinSlot('socket-1');
    lockCoinSlot('power-safety');

    expect(isCoinSlotLocked()).toBe(true);
    expect(isCoinSlotLockedBy('socket-1')).toBe(true);
    expect(isCoinSlotLockedBy('power-safety')).toBe(true);

    // Releasing socket-1 keeps power-safety locked
    const socketUnlocked = unlockOwnedCoinSlot('socket-1');
    expect(socketUnlocked).toBe(true);
    expect(isCoinSlotLocked()).toBe(true);
    expect(isCoinSlotLockedBy('socket-1')).toBe(false);
    expect(isCoinSlotLockedBy('power-safety')).toBe(true);
    expect(getCoinSlotLockOwnerId()).toBe('power-safety');

    // Releasing power-safety unlocks the slot completely
    const powerSafetyUnlocked = unlockOwnedCoinSlot('power-safety');
    expect(powerSafetyUnlocked).toBe(true);
    expect(isCoinSlotLocked()).toBe(false);
    expect(isCoinSlotLockedBy('power-safety')).toBe(false);
    expect(getCoinSlotLockOwnerId()).toBeNull();
  });

  test('prefers returning UI/socket owner over power-safety for getCoinSlotLockOwnerId', () => {
    lockCoinSlot('power-safety');
    expect(getCoinSlotLockOwnerId()).toBe('power-safety');

    // When socket also locks, getCoinSlotLockOwnerId surfaces the UI/socket owner
    lockCoinSlot('socket-abc');
    expect(getCoinSlotLockOwnerId()).toBe('socket-abc');

    unlockOwnedCoinSlot('socket-abc');
    expect(getCoinSlotLockOwnerId()).toBe('power-safety');
  });

  test('cannot unlock with wrong owner id', () => {
    lockCoinSlot('power-safety');
    const unlocked = unlockOwnedCoinSlot('socket-fake');
    expect(unlocked).toBe(false);
    expect(isCoinSlotLocked()).toBe(true);
    expect(isCoinSlotLockedBy('power-safety')).toBe(true);
  });
});
