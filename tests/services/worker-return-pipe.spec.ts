import {
  parseWorkerEventLine,
  mapWorkerEventToSocket,
  handleWorkerPowerEvent,
  type WorkerPrintEvent,
} from '../../src/services/worker-return-pipe';
import { powerSafetyService } from '../../src/services/power-safety';

describe('worker-return-pipe power safety event handling', () => {
  describe('parseWorkerEventLine', () => {
    it('parses PowerStatusChanged event payload', () => {
      const line = JSON.stringify({
        type: 'PowerStatusChanged',
        powerStatus: {
          acLineStatus: 'Offline',
          isCharging: false,
          batteryPercentage: 85,
        },
        operationalState: 'PowerEmergency',
        acceptingTransactions: false,
        powerSourceInstanceId: 'inst-123',
        powerSequence: 42,
        timestampUtc: '2026-09-01T12:34:56.789Z',
      });

      const parsed = parseWorkerEventLine(line, 8192);
      expect(parsed.type).toBe('PowerStatusChanged');
      expect(parsed.powerStatus?.acLineStatus).toBe('Offline');
      expect(parsed.operationalState).toBe('PowerEmergency');
      expect(parsed.acceptingTransactions).toBe(false);
      expect(parsed.powerSourceInstanceId).toBe('inst-123');
      expect(parsed.powerSequence).toBe(42);
      expect(parsed.timestampUtc).toBe('2026-09-01T12:34:56.789Z');
    });

    it('parses PowerStatusSnapshot event payload', () => {
      const line = JSON.stringify({
        type: 'PowerStatusSnapshot',
        powerStatus: {
          acLineStatus: 'Online',
          isCharging: true,
          batteryPercentage: 99,
        },
        operationalState: 'Operational',
        acceptingTransactions: true,
        powerSourceInstanceId: 'inst-123',
        powerSequence: 43,
        timestampUtc: '2026-09-01T12:35:06.789Z',
      });

      const parsed = parseWorkerEventLine(line, 8192);
      expect(parsed.type).toBe('PowerStatusSnapshot');
      expect(parsed.powerStatus?.acLineStatus).toBe('Online');
      expect(parsed.operationalState).toBe('Operational');
      expect(parsed.acceptingTransactions).toBe(true);
    });
  });

  describe('mapWorkerEventToSocket', () => {
    it('maps PowerStatusChanged to workerPowerStatusChanged socket event', () => {
      const evt: WorkerPrintEvent = {
        type: 'PowerStatusChanged',
        powerStatus: { acLineStatus: 'Offline' },
        operationalState: 'PowerEmergency',
        acceptingTransactions: false,
        powerSourceInstanceId: 'inst-1',
        powerSequence: 1,
        timestampUtc: '2026-09-01T12:00:00.000Z',
      };

      const mapped = mapWorkerEventToSocket(evt);
      expect(mapped.event).toBe('workerPowerStatusChanged');
      expect(mapped.payload).toBe(evt);
    });

    it('maps PowerStatusSnapshot to workerPowerStatusChanged socket event', () => {
      const evt: WorkerPrintEvent = {
        type: 'PowerStatusSnapshot',
        powerStatus: { acLineStatus: 'Online' },
        operationalState: 'Operational',
        acceptingTransactions: true,
        powerSourceInstanceId: 'inst-1',
        powerSequence: 2,
        timestampUtc: '2026-09-01T12:00:10.000Z',
      };

      const mapped = mapWorkerEventToSocket(evt);
      expect(mapped.event).toBe('workerPowerStatusChanged');
      expect(mapped.payload).toBe(evt);
    });
  });

  describe('handleWorkerPowerEvent', () => {
    it('applies power event to powerSafetyService and emits to Socket.IO', () => {
      const applySpy = jest.spyOn(powerSafetyService, 'applyWorkerPowerEvent');
      const mockIo = { emit: jest.fn() };

      const evt: WorkerPrintEvent = {
        type: 'PowerStatusChanged',
        powerStatus: { acLineStatus: 'Offline' },
        operationalState: 'PowerEmergency',
        acceptingTransactions: false,
        powerSourceInstanceId: 'test-inst',
        powerSequence: 99,
        timestampUtc: '2026-09-01T12:00:00.000Z',
      };

      const state = handleWorkerPowerEvent(evt, mockIo as never);

      expect(applySpy).toHaveBeenCalledWith(evt);
      expect(mockIo.emit).toHaveBeenCalledWith('workerPowerStatusChanged', evt);
      expect(state).not.toBeNull();

      applySpy.mockRestore();
    });

    it('ignores non-power events and returns null', () => {
      const applySpy = jest.spyOn(powerSafetyService, 'applyWorkerPowerEvent');
      const mockIo = { emit: jest.fn() };

      const evt: WorkerPrintEvent = {
        type: 'PrintStarted',
        timestampUtc: '2026-09-01T12:00:00.000Z',
      };

      const state = handleWorkerPowerEvent(evt, mockIo as never);

      expect(applySpy).not.toHaveBeenCalled();
      expect(mockIo.emit).not.toHaveBeenCalled();
      expect(state).toBeNull();

      applySpy.mockRestore();
    });
  });
});
