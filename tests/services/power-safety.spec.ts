import {
  PowerSafetyService,
  type WorkerPowerEvent,
} from '../../src/services/power-safety';
import type { PowerSafetySqliteStore } from '../../src/core/database/power-safety-store';

describe('PowerSafetyService', () => {
  let mockStore: jest.Mocked<PowerSafetySqliteStore>;
  let mockSerialService: {
    lockCoinSlot: jest.Mock;
    unlockOwnedCoinSlot: jest.Mock;
    isCoinSlotLocked: jest.Mock;
  };

  beforeEach(() => {
    mockStore = {
      savePowerSafetyState: jest.fn(),
      getPowerSafetyState: jest.fn(() => null),
      clear: jest.fn(),
    } as unknown as jest.Mocked<PowerSafetySqliteStore>;

    mockSerialService = {
      lockCoinSlot: jest.fn(),
      unlockOwnedCoinSlot: jest.fn(() => true),
      isCoinSlotLocked: jest.fn(() => false),
    };
  });

  describe('startup fail-closed behavior', () => {
    it('is unavailable and fail-closed on startup before receiving any snapshot', () => {
      const service = new PowerSafetyService({
        store: mockStore,
        serialService: mockSerialService,
      });

      expect(service.canAcceptCustomerWork()).toBe(false);
      const state = service.getState();
      expect(state.operationalState).toBe('Unknown');
      expect(state.acceptingTransactions).toBe(false);
      expect(state.canAcceptCustomerWork).toBe(false);
      expect(state.powerStatus).toBeNull();
      expect(state.powerSourceInstanceId).toBeNull();
      expect(state.powerSequence).toBeNull();
      expect(mockSerialService.lockCoinSlot).toHaveBeenCalledWith('power-safety');
    });
  });

  describe('stale sequence rejection and instance ID handling', () => {
    it('accepts initial event and advances sequence', () => {
      const service = new PowerSafetyService({
        store: mockStore,
        serialService: mockSerialService,
      });

      const initialEvent: WorkerPowerEvent = {
        type: 'PowerStatusSnapshot',
        powerStatus: { acLineStatus: 'Online', isCharging: true },
        operationalState: 'Operational',
        acceptingTransactions: true,
        powerSourceInstanceId: 'inst-alpha',
        powerSequence: 10,
        timestampUtc: '2026-09-01T12:00:00.000Z',
      };

      const result = service.applyWorkerPowerEvent(initialEvent);

      expect(service.canAcceptCustomerWork()).toBe(true);
      expect(result.operationalState).toBe('Operational');
      expect(result.powerSequence).toBe(10);
      expect(result.powerSourceInstanceId).toBe('inst-alpha');
      expect(mockStore.savePowerSafetyState).toHaveBeenCalledTimes(1);
    });

    it('rejects older or duplicate sequence numbers from the same instance GUID', () => {
      const service = new PowerSafetyService({
        store: mockStore,
        serialService: mockSerialService,
      });

      const event1: WorkerPowerEvent = {
        type: 'PowerStatusChanged',
        powerStatus: { acLineStatus: 'Online', isCharging: true },
        operationalState: 'Operational',
        acceptingTransactions: true,
        powerSourceInstanceId: 'inst-alpha',
        powerSequence: 20,
        timestampUtc: '2026-09-01T12:00:00.000Z',
      };

      service.applyWorkerPowerEvent(event1);
      expect(service.getState().powerSequence).toBe(20);
      expect(mockStore.savePowerSafetyState).toHaveBeenCalledTimes(1);

      // Stale sequence (lower) from same instance
      const staleEvent: WorkerPowerEvent = {
        type: 'PowerStatusChanged',
        powerStatus: { acLineStatus: 'Offline', isCharging: false },
        operationalState: 'PowerEmergency',
        acceptingTransactions: false,
        powerSourceInstanceId: 'inst-alpha',
        powerSequence: 15,
        timestampUtc: '2026-09-01T12:00:05.000Z',
      };

      const staleResult = service.applyWorkerPowerEvent(staleEvent);

      // Must be rejected: state remains Operational with sequence 20
      expect(service.canAcceptCustomerWork()).toBe(true);
      expect(staleResult.powerSequence).toBe(20);
      expect(staleResult.operationalState).toBe('Operational');
      expect(mockStore.savePowerSafetyState).toHaveBeenCalledTimes(1);

      // Duplicate sequence (equal) from same instance
      const dupEvent: WorkerPowerEvent = {
        ...staleEvent,
        powerSequence: 20,
      };

      const dupResult = service.applyWorkerPowerEvent(dupEvent);
      expect(dupResult.powerSequence).toBe(20);
      expect(dupResult.operationalState).toBe('Operational');
      expect(mockStore.savePowerSafetyState).toHaveBeenCalledTimes(1);
    });

    it('accepts a lower sequence number if the powerSourceInstanceId changes (new worker instance GUID)', () => {
      const service = new PowerSafetyService({
        store: mockStore,
        serialService: mockSerialService,
      });

      const event1: WorkerPowerEvent = {
        type: 'PowerStatusChanged',
        powerStatus: { acLineStatus: 'Online' },
        operationalState: 'Operational',
        acceptingTransactions: true,
        powerSourceInstanceId: 'inst-alpha',
        powerSequence: 100,
        timestampUtc: '2026-09-01T12:00:00.000Z',
      };

      service.applyWorkerPowerEvent(event1);
      expect(service.getState().powerSequence).toBe(100);

      // New instance GUID with sequence 1 (e.g. worker process restarted)
      const eventNewInstance: WorkerPowerEvent = {
        type: 'PowerStatusSnapshot',
        powerStatus: { acLineStatus: 'Online' },
        operationalState: 'Operational',
        acceptingTransactions: true,
        powerSourceInstanceId: 'inst-beta',
        powerSequence: 1,
        timestampUtc: '2026-09-01T12:01:00.000Z',
      };

      const result = service.applyWorkerPowerEvent(eventNewInstance);
      expect(result.powerSourceInstanceId).toBe('inst-beta');
      expect(result.powerSequence).toBe(1);
      expect(service.getState().powerSourceInstanceId).toBe('inst-beta');
      expect(service.getState().powerSequence).toBe(1);
      expect(mockStore.savePowerSafetyState).toHaveBeenCalledTimes(2);
    });
  });

  describe('AC-loss entry and coin slot locking', () => {
    it('immediately sets memory state to unavailable, persists, and locks coin slot on AC-loss emergency', () => {
      const service = new PowerSafetyService({
        store: mockStore,
        serialService: mockSerialService,
      });

      // Establish operational state first
      service.applyWorkerPowerEvent({
        type: 'PowerStatusSnapshot',
        powerStatus: { acLineStatus: 'Online', isCharging: true },
        operationalState: 'Operational',
        acceptingTransactions: true,
        powerSourceInstanceId: 'inst-1',
        powerSequence: 1,
        timestampUtc: '2026-09-01T12:00:00.000Z',
      });
      expect(service.canAcceptCustomerWork()).toBe(true);

      // AC-loss emergency occurs
      const emergencyEvent: WorkerPowerEvent = {
        type: 'PowerStatusChanged',
        powerStatus: { acLineStatus: 'Offline', isCharging: false },
        operationalState: 'PowerEmergency',
        acceptingTransactions: false,
        powerSourceInstanceId: 'inst-1',
        powerSequence: 2,
        timestampUtc: '2026-09-01T12:00:02.000Z',
      };

      const listener = jest.fn();
      service.on('powerStatusChanged', listener);

      const state = service.applyWorkerPowerEvent(emergencyEvent);

      expect(service.canAcceptCustomerWork()).toBe(false);
      expect(state.operationalState).toBe('PowerEmergency');
      expect(state.acceptingTransactions).toBe(false);
      expect(state.canAcceptCustomerWork).toBe(false);

      expect(mockStore.savePowerSafetyState).toHaveBeenCalledWith(
        expect.objectContaining({
          powerSourceInstanceId: 'inst-1',
          powerSequence: 2,
          operationalState: 'PowerEmergency',
          acceptingTransactions: false,
          sourceTimestampUtc: '2026-09-01T12:00:02.000Z',
        }),
      );

      expect(mockSerialService.lockCoinSlot).toHaveBeenCalledWith('power-safety');
      expect(listener).toHaveBeenCalledWith(state);
    });
  });

  describe('healthy Operational reopening and coin slot unlocking', () => {
    it('persists first, then updates memory state to available, and unlocks coin slot', () => {
      const service = new PowerSafetyService({
        store: mockStore,
        serialService: mockSerialService,
      });

      // Start in emergency
      service.applyWorkerPowerEvent({
        type: 'PowerStatusChanged',
        powerStatus: { acLineStatus: 'Offline' },
        operationalState: 'PowerEmergency',
        acceptingTransactions: false,
        powerSourceInstanceId: 'inst-1',
        powerSequence: 1,
        timestampUtc: '2026-09-01T12:00:00.000Z',
      });
      expect(service.canAcceptCustomerWork()).toBe(false);
      expect(mockSerialService.lockCoinSlot).toHaveBeenCalledWith('power-safety');

      // Now recovery finishes and healthy Operational event arrives
      const operationalEvent: WorkerPowerEvent = {
        type: 'PowerStatusChanged',
        powerStatus: { acLineStatus: 'Online', isCharging: true },
        operationalState: 'Operational',
        acceptingTransactions: true,
        powerSourceInstanceId: 'inst-1',
        powerSequence: 2,
        timestampUtc: '2026-09-01T12:00:15.000Z',
      };

      const state = service.applyWorkerPowerEvent(operationalEvent);

      expect(service.canAcceptCustomerWork()).toBe(true);
      expect(state.operationalState).toBe('Operational');
      expect(state.acceptingTransactions).toBe(true);
      expect(state.canAcceptCustomerWork).toBe(true);

      expect(mockStore.savePowerSafetyState).toHaveBeenCalledWith(
        expect.objectContaining({
          powerSourceInstanceId: 'inst-1',
          powerSequence: 2,
          operationalState: 'Operational',
          acceptingTransactions: true,
        }),
      );

      expect(mockSerialService.unlockOwnedCoinSlot).toHaveBeenCalledWith('power-safety');
    });
  });

  describe('persistence failure fail-closed guarantee', () => {
    it('remains closed if DB persistence throws during an operational event', () => {
      mockStore.savePowerSafetyState.mockImplementation(() => {
        throw new Error('SQLite database disk I/O error');
      });

      const service = new PowerSafetyService({
        store: mockStore,
        serialService: mockSerialService,
      });

      const operationalEvent: WorkerPowerEvent = {
        type: 'PowerStatusSnapshot',
        powerStatus: { acLineStatus: 'Online', isCharging: true },
        operationalState: 'Operational',
        acceptingTransactions: true,
        powerSourceInstanceId: 'inst-1',
        powerSequence: 1,
        timestampUtc: '2026-09-01T12:00:00.000Z',
      };

      // When persistence fails on operational event, memory state must not become available
      expect(() => {
        service.applyWorkerPowerEvent(operationalEvent);
      }).not.toThrow(); // Should handle gracefully without crashing

      expect(service.canAcceptCustomerWork()).toBe(false);
      expect(service.getState().operationalState).toBe('Unknown');
      expect(mockSerialService.unlockOwnedCoinSlot).not.toHaveBeenCalled();
    });

    it('remains closed if DB persistence throws during an emergency event', () => {
      const service = new PowerSafetyService({
        store: mockStore,
        serialService: mockSerialService,
      });

      // Operational initially with working store
      service.applyWorkerPowerEvent({
        type: 'PowerStatusSnapshot',
        powerStatus: { acLineStatus: 'Online' },
        operationalState: 'Operational',
        acceptingTransactions: true,
        powerSourceInstanceId: 'inst-1',
        powerSequence: 1,
        timestampUtc: '2026-09-01T12:00:00.000Z',
      });
      expect(service.canAcceptCustomerWork()).toBe(true);

      // Now store fails
      mockStore.savePowerSafetyState.mockImplementation(() => {
        throw new Error('Database locked');
      });

      const emergencyEvent: WorkerPowerEvent = {
        type: 'PowerStatusChanged',
        powerStatus: { acLineStatus: 'Offline' },
        operationalState: 'PowerEmergency',
        acceptingTransactions: false,
        powerSourceInstanceId: 'inst-1',
        powerSequence: 2,
        timestampUtc: '2026-09-01T12:00:02.000Z',
      };

      expect(() => {
        service.applyWorkerPowerEvent(emergencyEvent);
      }).not.toThrow();

      // In-memory state was set to unavailable BEFORE persistence attempt
      expect(service.canAcceptCustomerWork()).toBe(false);
      expect(service.getState().operationalState).toBe('PowerEmergency');
      // Coin slot was still locked
      expect(mockSerialService.lockCoinSlot).toHaveBeenCalledWith('power-safety');
    });
  });
});
