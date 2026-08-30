import {
  evaluateHardwareState,
  PrinterService,
  type HardwareStateEvaluation,
} from './printer.service';
import {
  initPrinterGuard,
  destroyPrinterGuard,
  isPrinterBlocked,
} from '@/guards/printer-guard';
import * as printerStatusService from '@/services/printer-status';
import * as edgeService from '@/services/windows-printer-edge';

jest.mock('@/services/printer-status', () => ({
  getPrinterTelemetry: jest.fn(),
  refreshPrinterTelemetry: jest.fn(),
}));

jest.mock('@/services/windows-printer-edge', () => ({
  getPrinterStatusViaEdge: jest.fn(),
  pausePrintJobViaEdge: jest.fn(),
  resumePrintJobViaEdge: jest.fn(),
  cancelPrintJobViaEdge: jest.fn(),
}));

describe('evaluateHardwareState & PrinterService.evaluateHardwareState', () => {
  let printerService: PrinterService;

  beforeEach(() => {
    printerService = new PrinterService();
  });

  describe('Out of Paper hardware state evaluation', () => {
    it('evaluates status "Paper Out" as isBlocked: true and reason: "Paper Out"', () => {
      const evaluation: HardwareStateEvaluation = evaluateHardwareState({
        status: 'Paper Out',
        connected: true,
      });

      expect(evaluation.isBlocked).toBe(true);
      expect(evaluation.reason).toBe('Paper Out');
      expect(evaluation.status).toBe('Paper Out');
      expect(evaluation.connected).toBe(true);

      // Verify PrinterService instance method behaves identically
      const serviceResult = printerService.evaluateHardwareState({
        status: 'Paper Out',
        connected: true,
      });
      expect(serviceResult).toEqual(evaluation);
    });

    it('evaluates isOutOfPaper: true flag as isBlocked: true and reason: "Paper Out" even if status is generic', () => {
      const evaluation = evaluateHardwareState({
        isOutOfPaper: true,
        status: 'Error',
        connected: true,
      });

      expect(evaluation.isBlocked).toBe(true);
      expect(evaluation.reason).toBe('Paper Out');
      expect(evaluation.connected).toBe(true);
    });

    it('evaluates statusFlags containing "Paper Out" as isBlocked: true and reason: "Paper Out"', () => {
      const evaluation = evaluateHardwareState({
        statusFlags: ['User Intervention Required', 'Paper Out'],
        status: 'Warning',
        connected: true,
      });

      expect(evaluation.isBlocked).toBe(true);
      expect(evaluation.reason).toBe('Paper Out');
      expect(evaluation.connected).toBe(true);
    });

    it('detects paper-out with case-insensitivity in status string', () => {
      const evaluation = evaluateHardwareState({
        status: 'printer state: paperout detected',
        connected: true,
      });

      expect(evaluation.isBlocked).toBe(true);
      expect(evaluation.reason).toBe('Paper Out');
      expect(evaluation.connected).toBe(true);
    });
  });

  describe('Paper Restored & Healthy hardware state evaluation', () => {
    it('evaluates status "Idle" with paper restored as isBlocked: false and reason: null', () => {
      const evaluation: HardwareStateEvaluation = evaluateHardwareState({
        status: 'Idle',
        isOutOfPaper: false,
        connected: true,
      });

      expect(evaluation.isBlocked).toBe(false);
      expect(evaluation.reason).toBeNull();
      expect(evaluation.status).toBe('Idle');
      expect(evaluation.connected).toBe(true);

      const serviceResult = printerService.evaluateHardwareState({
        status: 'Idle',
        isOutOfPaper: false,
        connected: true,
      });
      expect(serviceResult).toEqual(evaluation);
    });

    it('evaluates status "Ready" as isBlocked: false', () => {
      const evaluation = evaluateHardwareState({
        status: 'Ready',
        connected: true,
      });

      expect(evaluation.isBlocked).toBe(false);
      expect(evaluation.reason).toBeNull();
    });

    it('evaluates active "Printing" status as isBlocked: false', () => {
      const evaluation = evaluateHardwareState({
        status: 'Printing',
        connected: true,
      });

      expect(evaluation.isBlocked).toBe(false);
      expect(evaluation.reason).toBeNull();
    });

    it('defaults undefined status to "Idle" and isBlocked: false when connected', () => {
      const evaluation = evaluateHardwareState({
        connected: true,
      });

      expect(evaluation.isBlocked).toBe(false);
      expect(evaluation.reason).toBeNull();
      expect(evaluation.status).toBe('Idle');
    });
  });

  describe('Disconnected / Offline evaluation', () => {
    it('evaluates connected: false as isBlocked: true and reason: "Offline"', () => {
      const evaluation = evaluateHardwareState({
        connected: false,
        status: 'Offline',
      });

      expect(evaluation.isBlocked).toBe(true);
      expect(evaluation.reason).toBe('Offline');
      expect(evaluation.connected).toBe(false);
    });

    it('evaluates custom disconnected status message', () => {
      const evaluation = evaluateHardwareState({
        connected: false,
        status: 'Device Not Connected',
      });

      expect(evaluation.isBlocked).toBe(true);
      expect(evaluation.reason).toBe('Device Not Connected');
      expect(evaluation.connected).toBe(false);
    });
  });

  describe('Other hardware fault states', () => {
    it('evaluates "Paper Jam" as isBlocked: true', () => {
      const evaluation = evaluateHardwareState({
        status: 'Paper Jam',
        connected: true,
      });

      expect(evaluation.isBlocked).toBe(true);
      expect(evaluation.reason).toBe('Paper Jam');
    });

    it('evaluates "Door Open" as isBlocked: true', () => {
      const evaluation = evaluateHardwareState({
        status: 'Door Open',
        connected: true,
      });

      expect(evaluation.isBlocked).toBe(true);
      expect(evaluation.reason).toBe('Door Open');
    });

    it('evaluates "User Intervention Required" as isBlocked: true', () => {
      const evaluation = evaluateHardwareState({
        status: 'User Intervention Required',
        connected: true,
      });

      expect(evaluation.isBlocked).toBe(true);
      expect(evaluation.reason).toBe('User Intervention Required');
    });

    it('evaluates "Paused" as isBlocked: true', () => {
      const evaluation = evaluateHardwareState({
        status: 'Paused',
        connected: true,
      });

      expect(evaluation.isBlocked).toBe(true);
      expect(evaluation.reason).toBe('Paused');
    });
  });
});

describe('PrinterService status responses with hardware states', () => {
  let printerService: PrinterService;

  beforeEach(() => {
    jest.clearAllMocks();
    printerService = new PrinterService();
  });

  it('getStatusResponse returns blocked: true when telemetry is Paper Out', async () => {
    (printerStatusService.getPrinterTelemetry as jest.Mock).mockReturnValue({
      connected: true,
      name: 'EPSON_L3210',
      status: 'Paper Out',
      statusFlags: ['Paper Out'],
      inkDetectionMethod: 'none',
      inkTelemetryAvailable: false,
      inkTelemetryReason: null,
      lastCheckedAt: new Date().toISOString(),
    });

    const res = await printerService.getStatusResponse();
    expect(res.ready).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.status).toBe('Paper Out');
  });

  it('getStatusResponse returns ready: true and blocked: false when telemetry is restored to Idle', async () => {
    (printerStatusService.getPrinterTelemetry as jest.Mock).mockReturnValue({
      connected: true,
      name: 'EPSON_L3210',
      status: 'Idle',
      statusFlags: [],
      inkDetectionMethod: 'none',
      inkTelemetryAvailable: false,
      inkTelemetryReason: null,
      lastCheckedAt: new Date().toISOString(),
    });

    const res = await printerService.getStatusResponse();
    expect(res.ready).toBe(true);
    expect(res.blocked).toBe(false);
    expect(res.status).toBe('Idle');
  });

  it('preDispatchCheck detects paper-out condition from edge-js', async () => {
    (edgeService.getPrinterStatusViaEdge as jest.Mock).mockResolvedValue({
      isOutOfPaper: true,
      isPaperJam: false,
      isOffline: false,
      isPaperProblem: false,
      isNoToner: false,
      isLowOnToner: false,
      isDoorOpened: false,
      isOutputBinFull: false,
      isManualFeedRequired: false,
      statusString: 'PaperOut',
    });

    const printError = await printerService.preDispatchCheck('EPSON_L3210');
    expect(printError).not.toBeNull();
    expect(printError?.code).toBe('PAPER_TRAY_EMPTY');
    expect(printError?.severity).toBe('recoverable');
    expect(printError?.userMessage).toBe('The printer is out of paper.');
  });
});

describe('Client-Side initPrinterGuard DOM & Hardware Event Integration', () => {
  class MockElement {
    style: Record<string, string> = {};
    attributes: Record<string, string> = {};
    textContent: string = '';
    children: Record<string, MockElement> = {};

    setAttribute(name: string, value: string) {
      this.attributes[name] = value;
    }

    getAttribute(name: string) {
      return this.attributes[name] ?? null;
    }

    removeAttribute(name: string) {
      delete this.attributes[name];
    }

    querySelector<T = MockElement>(selector: string): T | null {
      if (selector === '[data-printer-status]') {
        if (!this.children['status']) {
          this.children['status'] = new MockElement();
        }
        return this.children['status'] as unknown as T;
      }
      if (selector === '[data-printer-name]') {
        if (!this.children['name']) {
          this.children['name'] = new MockElement();
        }
        return this.children['name'] as unknown as T;
      }
      return null;
    }
  }

  class MockCustomEvent {
    type: string;
    detail: any;
    constructor(type: string, init?: { detail?: any }) {
      this.type = type;
      this.detail = init?.detail;
    }
  }

  let domElements: Record<string, MockElement>;
  let windowEventSubscribers: ((e: any) => void)[];
  let mockSocket: {
    on: jest.Mock;
    off: jest.Mock;
    handlers: Record<string, ((...args: unknown[]) => void)[]>;
  };

  beforeAll(() => {
    (global as any).CustomEvent = MockCustomEvent;
    (global as any).document = {
      getElementById: (id: string) => {
        if (!domElements[id]) {
          domElements[id] = new MockElement();
        }
        return domElements[id];
      },
    };
    (global as any).window = {
      dispatchEvent: (event: any) => {
        windowEventSubscribers.forEach((fn) => fn(event));
        return true;
      },
      addEventListener: (type: string, fn: any) => {
        if (type === 'printer:block') windowEventSubscribers.push(fn);
      },
      removeEventListener: (type: string, fn: any) => {
        const idx = windowEventSubscribers.indexOf(fn);
        if (idx !== -1) windowEventSubscribers.splice(idx, 1);
      },
    };
  });

  beforeEach(() => {
    domElements = {
      'printer-unavailable': new MockElement(),
      'kiosk-idle': new MockElement(),
    };
    domElements['printer-unavailable'].style.display = 'none';
    domElements['kiosk-idle'].style.display = '';

    windowEventSubscribers = [];
    destroyPrinterGuard();

    mockSocket = {
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!mockSocket.handlers[event]) mockSocket.handlers[event] = [];
        mockSocket.handlers[event].push(handler);
      }),
      off: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (mockSocket.handlers[event]) {
          mockSocket.handlers[event] = mockSocket.handlers[event].filter(
            (h) => h !== handler,
          );
        }
      }),
      handlers: {},
    };
  });

  afterEach(() => {
    destroyPrinterGuard();
    jest.restoreAllMocks();
  });

  it('updates DOM overlay and blocks kiosk when paper-out malfunction event is received', async () => {
    // Mock initial fetch returning Ready
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ready: true,
        blocked: false,
        status: 'Idle',
        printerName: 'EPSON_L3210',
        lastCheckedAt: new Date().toISOString(),
      }),
    });

    const blockEvents: any[] = [];
    (global as any).window.addEventListener('printer:block', (e: any) => {
      blockEvents.push(e);
    });

    await initPrinterGuard(mockSocket);

    // Initial state after fetch: unblocked
    expect(isPrinterBlocked()).toBe(false);

    // Trigger printerMalfunction with Paper Out
    const malfunctionHandler = mockSocket.handlers['printerMalfunction']?.[0];
    expect(malfunctionHandler).toBeDefined();

    malfunctionHandler({
      status: 'Paper Out',
      printerName: 'EPSON_L3210',
    });

    // Verify DOM overlay updated
    expect(isPrinterBlocked()).toBe(true);
    const overlay = (global as any).document.getElementById('printer-unavailable');
    expect(overlay?.style.display).toBe('flex');
    expect(overlay?.querySelector('[data-printer-status]')?.textContent).toBe(
      'Paper Out',
    );
    expect(overlay?.querySelector('[data-printer-name]')?.textContent).toBe(
      'EPSON_L3210',
    );
    const idleScreen = (global as any).document.getElementById('kiosk-idle');
    expect(idleScreen?.style.display).toBe('none');

    // Verify printer:block custom event dispatched
    const lastEvent = blockEvents[blockEvents.length - 1];
    expect(lastEvent.detail.blocked).toBe(true);
    expect(lastEvent.detail.status).toBe('Paper Out');
  });

  it('restores DOM overlay and unblocks kiosk when paper is restored (printerRecovered event)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ready: false,
        blocked: true,
        status: 'Paper Out',
        printerName: 'EPSON_L3210',
        lastCheckedAt: new Date().toISOString(),
      }),
    });

    const blockEvents: any[] = [];
    (global as any).window.addEventListener('printer:block', (e: any) => {
      blockEvents.push(e);
    });

    await initPrinterGuard(mockSocket);

    // Initial state: blocked due to Paper Out
    expect(isPrinterBlocked()).toBe(true);

    // Trigger printerRecovered with Idle
    const recoveredHandler = mockSocket.handlers['printerRecovered']?.[0];
    expect(recoveredHandler).toBeDefined();

    recoveredHandler({
      status: 'Idle',
      printerName: 'EPSON_L3210',
    });

    // Verify DOM overlay hidden
    expect(isPrinterBlocked()).toBe(false);
    const overlay = (global as any).document.getElementById('printer-unavailable');
    expect(overlay?.style.display).toBe('none');
    const idleScreen = (global as any).document.getElementById('kiosk-idle');
    expect(idleScreen?.style.display).toBe('');

    // Verify printer:block custom event dispatched
    const lastEvent = blockEvents[blockEvents.length - 1];
    expect(lastEvent.detail.blocked).toBe(false);
    expect(lastEvent.detail.status).toBe('Idle');
  });

  it('handles fetch error on initial load gracefully with fail-safe block', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

    await initPrinterGuard(mockSocket);

    expect(isPrinterBlocked()).toBe(true);
    const overlay = (global as any).document.getElementById('printer-unavailable');
    expect(overlay?.style.display).toBe('flex');
    expect(overlay?.querySelector('[data-printer-status]')?.textContent).toBe(
      'Unavailable',
    );
  });

  it('unregisters socket handlers on destroyPrinterGuard', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ready: true,
        blocked: false,
        status: 'Idle',
        printerName: 'EPSON_L3210',
      }),
    });

    await initPrinterGuard(mockSocket);
    expect(mockSocket.handlers['printerMalfunction']?.length).toBe(1);
    expect(mockSocket.handlers['printerRecovered']?.length).toBe(1);

    destroyPrinterGuard();
    expect(mockSocket.off).toHaveBeenCalledWith(
      'printerMalfunction',
      expect.any(Function),
    );
    expect(mockSocket.off).toHaveBeenCalledWith(
      'printerRecovered',
      expect.any(Function),
    );
  });
});
