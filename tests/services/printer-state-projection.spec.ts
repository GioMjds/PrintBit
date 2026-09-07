import { printerStateProjection } from '../../src/services/printer-state-projection';
import {
  mapWorkerEventToSocket,
  type WorkerPrintEvent,
} from '../../src/services/worker-return-pipe';

describe('PrinterStateProjection', () => {
  beforeEach(() => {
    printerStateProjection.reset();
  });

  describe('applyEvent', () => {
    it('handles PrinterStatusSnapshot event (online)', () => {
      const event: WorkerPrintEvent = {
        type: 'PrinterStatusSnapshot',
        printerName: 'EPSON L5290 Series',
        message: 'Printer is online',
        timestampUtc: '2026-09-02T12:00:00.000Z',
      };

      printerStateProjection.applyEvent(event);
      const snapshot = printerStateProjection.getSnapshot();

      expect(snapshot.connected).toBe(true);
      expect(snapshot.status).toBe('ready');
      expect(snapshot.name).toBe('EPSON L5290 Series');
      expect(snapshot.error).toBeNull();
      expect(snapshot.lastCheckedAt).toBe('2026-09-02T12:00:00.000Z');
    });

    it('handles PrinterStatusSnapshot event with default name and no message', () => {
      const event: WorkerPrintEvent = {
        type: 'PrinterStatusSnapshot',
        printerName: 'EPSON L5290 Series',
        timestampUtc: '2026-09-02T12:00:00.000Z',
      };

      printerStateProjection.applyEvent(event);
      const snapshot = printerStateProjection.getSnapshot();

      expect(snapshot.connected).toBe(true);
      expect(snapshot.status).toBe('ready');
      expect(snapshot.name).toBe('EPSON L5290 Series');
      expect(snapshot.error).toBeNull();
    });

    it('handles PrinterStatusSnapshot event when offline', () => {
      const event: WorkerPrintEvent = {
        type: 'PrinterStatusSnapshot',
        printerName: 'EPSON L5290 Series',
        message: 'Printer is offline',
        timestampUtc: '2026-09-02T12:00:00.000Z',
      };

      printerStateProjection.applyEvent(event);
      const snapshot = printerStateProjection.getSnapshot();

      expect(snapshot.connected).toBe(false);
      expect(snapshot.status).toBe('offline');
      expect(snapshot.error).toBe('Printer is offline');
      expect(printerStateProjection.isReady()).toBe(false);
    });

    it('handles PrinterOffline event', () => {
      // First make printer online/ready
      printerStateProjection.applyEvent({
        type: 'PrinterStatusSnapshot',
        printerName: 'EPSON L5290 Series',
        timestampUtc: '2026-09-02T12:00:00.000Z',
      });
      expect(printerStateProjection.isReady()).toBe(true);

      const event: WorkerPrintEvent = {
        type: 'PrinterOffline',
        printerName: 'EPSON L5290 Series',
        errorMessage: 'USB connection disconnected',
        timestampUtc: '2026-09-02T12:01:00.000Z',
      };

      printerStateProjection.applyEvent(event);
      const snapshot = printerStateProjection.getSnapshot();

      expect(snapshot.connected).toBe(false);
      expect(snapshot.status).toBe('offline');
      expect(snapshot.error).toBe('USB connection disconnected');
      expect(snapshot.name).toBe('EPSON L5290 Series');
      expect(printerStateProjection.isReady()).toBe(false);
    });

    it('handles PrinterError event', () => {
      // Set to online first
      printerStateProjection.applyEvent({
        type: 'PrinterStatusSnapshot',
        printerName: 'EPSON L5290 Series',
        timestampUtc: '2026-09-02T12:00:00.000Z',
      });

      const event: WorkerPrintEvent = {
        type: 'PrinterError',
        printerName: 'EPSON L5290 Series',
        errorMessage: 'Paper jam in tray 1',
        timestampUtc: '2026-09-02T12:02:00.000Z',
      };

      printerStateProjection.applyEvent(event);
      const snapshot = printerStateProjection.getSnapshot();

      expect(snapshot.status).toBe('error');
      expect(snapshot.error).toBe('Paper jam in tray 1');
      expect(printerStateProjection.isReady()).toBe(false);
    });

    it('returns to ready when the worker reports that a hardware error cleared', () => {
      printerStateProjection.applyEvent({
        type: 'PrinterStatusSnapshot',
        printerName: 'EPSON L5290 Series',
        timestampUtc: '2026-09-02T12:00:00.000Z',
      });
      printerStateProjection.applyEvent({
        type: 'PrinterError',
        printerName: 'EPSON L5290 Series',
        errorMessage: 'Transient WMI hardware error',
        timestampUtc: '2026-09-02T12:01:00.000Z',
      });
      expect(printerStateProjection.isReady()).toBe(false);

      printerStateProjection.applyEvent({
        type: 'PrinterOnline',
        printerName: 'EPSON L5290 Series',
        message: 'Printer is online',
        timestampUtc: '2026-09-02T12:01:02.000Z',
      });

      expect(printerStateProjection.isReady()).toBe(true);
      expect(printerStateProjection.getSnapshot().status).toBe('ready');
      expect(printerStateProjection.getSnapshot().error).toBeNull();
    });

    it('handles PrintStarted and PrintProgress events', () => {
      printerStateProjection.applyEvent({
        type: 'PrinterStatusSnapshot',
        printerName: 'EPSON L5290 Series',
        timestampUtc: '2026-09-02T12:00:00.000Z',
      });

      printerStateProjection.applyEvent({
        type: 'PrintStarted',
        timestampUtc: '2026-09-02T12:03:00.000Z',
      });
      expect(printerStateProjection.getSnapshot().status).toBe('printing');
      expect(printerStateProjection.isReady()).toBe(false);

      printerStateProjection.applyEvent({
        type: 'PrintProgress',
        pagesPrinted: 1,
        totalPages: 3,
        timestampUtc: '2026-09-02T12:03:10.000Z',
      });
      expect(printerStateProjection.getSnapshot().status).toBe('printing');
      expect(printerStateProjection.isReady()).toBe(false);
    });

    it('handles PrintSucceeded event', () => {
      printerStateProjection.applyEvent({
        type: 'PrinterStatusSnapshot',
        printerName: 'EPSON L5290 Series',
        timestampUtc: '2026-09-02T12:00:00.000Z',
      });
      printerStateProjection.applyEvent({
        type: 'PrintStarted',
        timestampUtc: '2026-09-02T12:03:00.000Z',
      });
      expect(printerStateProjection.getSnapshot().status).toBe('printing');

      printerStateProjection.applyEvent({
        type: 'PrintSucceeded',
        timestampUtc: '2026-09-02T12:03:20.000Z',
      });

      const snapshot = printerStateProjection.getSnapshot();
      expect(snapshot.status).toBe('ready');
      expect(printerStateProjection.isReady()).toBe(true);
    });

    it('preserves error and offline status when receiving PrintFailed', () => {
      // 1. Error state followed by PrintFailed
      printerStateProjection.applyEvent({
        type: 'PrinterStatusSnapshot',
        printerName: 'EPSON L5290 Series',
        timestampUtc: '2026-09-02T12:00:00.000Z',
      });
      printerStateProjection.applyEvent({
        type: 'PrinterError',
        errorMessage: 'Paper jam',
        timestampUtc: '2026-09-02T12:01:00.000Z',
      });
      expect(printerStateProjection.getSnapshot().status).toBe('error');

      printerStateProjection.applyEvent({
        type: 'PrintFailed',
        timestampUtc: '2026-09-02T12:01:05.000Z',
      });
      expect(printerStateProjection.getSnapshot().status).toBe('error');
      expect(printerStateProjection.isReady()).toBe(false);

      // 2. Offline state followed by PrintFailed
      printerStateProjection.applyEvent({
        type: 'PrinterOffline',
        errorMessage: 'Printer disconnected',
        timestampUtc: '2026-09-02T12:02:00.000Z',
      });
      expect(printerStateProjection.getSnapshot().status).toBe('offline');

      printerStateProjection.applyEvent({
        type: 'PrintFailed',
        timestampUtc: '2026-09-02T12:02:05.000Z',
      });
      expect(printerStateProjection.getSnapshot().status).toBe('offline');
      expect(printerStateProjection.isReady()).toBe(false);
    });

    it('handles JobCompleted transitioning printing status to ready when not in error', () => {
      printerStateProjection.applyEvent({
        type: 'PrinterStatusSnapshot',
        printerName: 'EPSON L5290 Series',
        timestampUtc: '2026-09-02T12:00:00.000Z',
      });
      printerStateProjection.applyEvent({
        type: 'PrintStarted',
        timestampUtc: '2026-09-02T12:03:00.000Z',
      });
      expect(printerStateProjection.getSnapshot().status).toBe('printing');

      printerStateProjection.applyEvent({
        type: 'JobCompleted',
        timestampUtc: '2026-09-02T12:03:30.000Z',
      });

      const snapshot = printerStateProjection.getSnapshot();
      expect(snapshot.status).toBe('ready');
      expect(printerStateProjection.isReady()).toBe(true);
    });
  });

  describe('isReady', () => {
    it('returns true only when connected is true and status is ready', () => {
      expect(printerStateProjection.isReady()).toBe(false);

      // Online snapshot -> connected: true, status: 'ready'
      printerStateProjection.applyEvent({
        type: 'PrinterStatusSnapshot',
        printerName: 'EPSON L5290 Series',
        timestampUtc: '2026-09-02T12:00:00.000Z',
      });
      expect(printerStateProjection.isReady()).toBe(true);

      // Printing -> not ready
      printerStateProjection.applyEvent({
        type: 'PrintStarted',
        timestampUtc: '2026-09-02T12:01:00.000Z',
      });
      expect(printerStateProjection.isReady()).toBe(false);

      // Error -> not ready
      printerStateProjection.applyEvent({
        type: 'PrinterError',
        errorMessage: 'Paper out',
        timestampUtc: '2026-09-02T12:02:00.000Z',
      });
      expect(printerStateProjection.isReady()).toBe(false);

      // Offline -> not ready
      printerStateProjection.applyEvent({
        type: 'PrinterOffline',
        errorMessage: 'Offline',
        timestampUtc: '2026-09-02T12:03:00.000Z',
      });
      expect(printerStateProjection.isReady()).toBe(false);
    });
  });

  describe('reset', () => {
    it('restores default state', () => {
      printerStateProjection.applyEvent({
        type: 'PrinterStatusSnapshot',
        printerName: 'EPSON L5290 Series',
        timestampUtc: '2026-09-02T12:00:00.000Z',
      });
      expect(printerStateProjection.isReady()).toBe(true);

      printerStateProjection.reset();

      const snapshot = printerStateProjection.getSnapshot();
      expect(snapshot.connected).toBe(false);
      expect(snapshot.name).toBeNull();
      expect(snapshot.status).toBe('offline');
      expect(snapshot.error).toBeNull();
      expect(printerStateProjection.isReady()).toBe(false);
    });
  });

  describe('mapWorkerEventToSocket integration', () => {
    it('maps online PrinterStatusSnapshot to workerPrinterOnline', () => {
      const evt: WorkerPrintEvent = {
        type: 'PrinterStatusSnapshot',
        printerName: 'EPSON L5290 Series',
        message: 'Printer is online',
        timestampUtc: '2026-09-02T12:00:00.000Z',
      };

      const mapped = mapWorkerEventToSocket(evt);
      expect(mapped.event).toBe('workerPrinterOnline');
      expect(mapped.payload).toBe(evt);
    });

    it('maps offline PrinterStatusSnapshot to workerPrinterOffline', () => {
      const evt: WorkerPrintEvent = {
        type: 'PrinterStatusSnapshot',
        printerName: 'EPSON L5290 Series',
        message: 'Printer is offline',
        timestampUtc: '2026-09-02T12:00:00.000Z',
      };

      const mapped = mapWorkerEventToSocket(evt);
      expect(mapped.event).toBe('workerPrinterOffline');
      expect(mapped.payload).toBe(evt);
    });
  });
});
