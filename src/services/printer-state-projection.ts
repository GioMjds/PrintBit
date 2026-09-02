import type { WorkerPrintEvent } from './worker-return-pipe';

export interface ProjectedPrinterState {
  connected: boolean;
  name: string | null;
  status: 'ready' | 'printing' | 'offline' | 'error';
  lastCheckedAt: string;
  error: string | null;
}

export class PrinterStateProjection {
  private state: ProjectedPrinterState = {
    connected: false,
    name: null,
    status: 'offline',
    lastCheckedAt: new Date().toISOString(),
    error: null,
  };

  public reset(): void {
    this.state = {
      connected: false,
      name: null,
      status: 'offline',
      lastCheckedAt: new Date().toISOString(),
      error: null,
    };
  }

  public applyEvent(evt: WorkerPrintEvent): void {
    const timestamp = evt.timestampUtc || new Date().toISOString();
    switch (evt.type) {
      case 'PrinterStatusSnapshot':
      case 'PrinterOnline':
        if (
          evt.type === 'PrinterStatusSnapshot' &&
          evt.message?.toLowerCase().includes('offline')
        ) {
          this.state = {
            connected: false,
            name: evt.printerName ?? this.state.name,
            status: 'offline',
            lastCheckedAt: timestamp,
            error: evt.errorMessage ?? evt.message ?? 'Printer is offline',
          };
          break;
        }
        this.state = {
          connected: true,
          name: evt.printerName ?? this.state.name,
          status: 'ready',
          lastCheckedAt: timestamp,
          error: null,
        };
        break;

      case 'PrinterOffline':
        this.state = {
          connected: false,
          name: evt.printerName ?? this.state.name,
          status: 'offline',
          lastCheckedAt: timestamp,
          error: evt.errorMessage ?? evt.message ?? 'Printer is offline',
        };
        break;

      case 'PrinterError':
        this.state = {
          connected: true,
          name: evt.printerName ?? this.state.name,
          status: 'error',
          lastCheckedAt: timestamp,
          error: evt.errorMessage ?? evt.message ?? 'Printer hardware error',
        };
        break;

      case 'PrintStarted':
      case 'PrintProgress':
        this.state.status = 'printing';
        this.state.lastCheckedAt = timestamp;
        if (evt.printerName) {
          this.state.name = evt.printerName;
        }
        break;

      case 'PrintSucceeded':
      case 'PrintFailed':
      case 'JobCompleted':
        if (this.state.status !== 'error' && this.state.status !== 'offline') {
          this.state.status = 'ready';
        }
        this.state.lastCheckedAt = timestamp;
        if (evt.printerName) {
          this.state.name = evt.printerName;
        }
        break;
    }
  }

  public getSnapshot(): ProjectedPrinterState {
    return { ...this.state };
  }

  public isReady(): boolean {
    return this.state.connected && this.state.status === 'ready';
  }
}

export const printerStateProjection = new PrinterStateProjection();

export interface PrinterTelemetry {
  connected: boolean;
  name: string | null;
  driverName: string | null;
  portName: string | null;
  connectionType: 'usb' | 'network' | 'wsd' | 'virtual' | 'unknown';
  status: string;
  statusFlags: string[];
  ink: Array<{ name: string; level: number | null; status: 'ok' | 'low' | 'empty' | 'unknown'; colorHint?: string }>;
  inkDetectionMethod: 'snmp' | 'vendor-wmi' | 'printer-property' | 'error-state' | 'none';
  inkTelemetryAvailable: boolean;
  lastCheckedAt: string;
  lastError: string | null;
}

export function getPrinterTelemetry(): PrinterTelemetry {
  const s = printerStateProjection.getSnapshot();
  return {
    connected: s.connected,
    name: s.name,
    driverName: null,
    portName: null,
    connectionType: 'usb',
    status: s.status === 'ready' ? 'Idle' : s.status === 'printing' ? 'Printing' : s.status === 'offline' ? 'Offline' : 'Error',
    statusFlags: [],
    ink: [],
    inkDetectionMethod: 'none',
    inkTelemetryAvailable: false,
    lastCheckedAt: s.lastCheckedAt,
    lastError: s.error,
  };
}

export async function refreshPrinterTelemetry(): Promise<PrinterTelemetry> {
  return getPrinterTelemetry();
}
