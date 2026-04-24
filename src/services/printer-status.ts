import { runPowerShell } from '@/utils';
import { randomUUID } from 'node:crypto';
import { db, type InkMonitoringSettings } from './db';
import { BLOCKED_STATUSES } from '@/utils';
import {
  markWatchdogHeartbeat,
  setWatchdogComponentState,
} from './watchdog-health';
import { consumablesStore } from '@/core/database/sqlite-storage';
import { evaluateConsumablesForecastAlerts } from '@/modules/admin/consumables.service';

// ── Types ────────────────────────────────────────────────────────

export interface InkLevel {
  name: string;
  /** 0–100 when readable, null when driver does not expose levels */
  level: number | null;
  /** "ok" | "low" | "empty" | "unknown" */
  status: 'ok' | 'low' | 'empty' | 'unknown';
  /** Optional color hint for UI rendering, e.g. "cyan", "black" */
  colorHint?: string;
}

export interface PrinterTelemetry {
  connected: boolean;
  name: string | null;
  driverName: string | null;
  portName: string | null;
  /** Connection type derived from port name */
  connectionType: 'usb' | 'network' | 'wsd' | 'virtual' | 'unknown';
  /** Human-readable printer status: "Idle", "Printing", "Error", "Offline", etc. */
  status: string;
  /** Active status flags parsed from the PrinterState bitmask */
  statusFlags: string[];
  ink: InkLevel[];
  /** Which detection method successfully returned ink data */
  inkDetectionMethod:
    | 'snmp'
    | 'vendor-wmi'
    | 'printer-property'
    | 'error-state'
    | 'none';
  targetPrinterName?: string | null;
  targetIsDefault?: boolean;
  inkTelemetryAvailable?: boolean;
  inkTelemetryReason?: string | null;
  lastCheckedAt: string;
  lastError: string | null;
}

export interface InstalledPrinterInfo {
  Name: string;
  DriverName: string;
  PortName: string;
  Default?: boolean;
  PrinterStatus: number;
  PrinterState: number;
  PnpInstanceId?: string | null;
  PnpFriendlyName?: string | null;
  DeviceSerialNumber?: string | null;
}

export interface InkPreflightEvaluation {
  blocked: boolean;
  code:
    | 'ink_monitoring_disabled'
    | 'telemetry_unknown_allowed'
    | 'telemetry_unknown_blocked'
    | 'ink_low_blocked'
    | 'ink_empty_blocked'
    | 'ok';
  reason: string | null;
  telemetryAvailable: boolean;
  lowSupplies: InkLevel[];
  emptySupplies: InkLevel[];
}

interface PnpPrinterDeviceInfo {
  FriendlyName: string | null;
  InstanceId: string | null;
  Status: string | null;
  Present: boolean | null;
  Problem: number | null;
  SerialNumber: string | null;
}

interface Win32PrinterRow {
  Name: string;
  DriverName: string;
  PortName: string;
  Default?: boolean;
  PrinterStatus: number;
  PrinterState: number;
  WorkOffline?: boolean | null;
}

// ── PrinterState bitmask (Win32_Printer) ─────────────────────────
// Ref: https://docs.microsoft.com/en-us/windows/win32/cimwin32prov/win32-printer

const PRINTER_STATE_FLAGS: Record<number, string> = {
  0x00000001: 'Paused',
  0x00000002: 'Error',
  0x00000004: 'Deleting',
  0x00000008: 'Paper Jam',
  0x00000010: 'Paper Out',
  0x00000020: 'Manual Feed Required',
  0x00000040: 'Paper Problem',
  0x00000080: 'Offline',
  0x00000200: 'IO Active',
  0x00000400: 'Busy',
  0x00000800: 'Printing',
  0x00001000: 'Output Bin Full',
  0x00002000: 'Not Available',
  0x00004000: 'Waiting',
  0x00008000: 'Processing',
  0x00010000: 'Initializing',
  0x00020000: 'Warming Up',
  0x00040000: 'Toner Low',
  0x00080000: 'No Toner',
  0x00100000: 'Page Punt',
  0x00200000: 'User Intervention Required',
  0x00400000: 'Out of Memory',
  0x00800000: 'Door Open',
  0x02000000: 'Server Unknown',
  0x04000000: 'Power Save',
};

function parsePrinterStateFlags(state: number | undefined | null): string[] {
  if (!state) return [];
  return Object.entries(PRINTER_STATE_FLAGS)
    .filter(([bit]) => (state & Number(bit)) !== 0)
    .map(([, label]) => label);
}

function humanStatusFromFlags(
  flags: string[],
  printerStatusCode: number,
): string {
  if (flags.includes('Offline')) return 'Offline';
  if (flags.includes('Error')) return 'Error';
  if (flags.includes('Paper Jam')) return 'Paper Jam';
  if (flags.includes('Paper Out')) return 'Paper Out';
  if (flags.includes('Door Open')) return 'Door Open';
  if (flags.includes('User Intervention Required'))
    return 'User Intervention Required';
  if (flags.includes('Printing')) return 'Printing';
  if (flags.includes('Warming Up')) return 'Warming Up';
  if (flags.includes('Paused')) return 'Paused';
  if (flags.length === 0 || printerStatusCode === 3) return 'Idle';
  return flags[0] ?? 'Unknown';
}

function applyConnectionSignals(input: {
  status: string;
  statusFlags: string[];
  connectionType: PrinterTelemetry['connectionType'];
  workOffline: boolean | null | undefined;
  pnpDevice?: PnpPrinterDeviceInfo | null;
}): { connected: boolean; status: string; statusFlags: string[] } {
  const statusFlags = Array.from(new Set(input.statusFlags));
  let connected = true;

  if (input.status === 'Offline' || statusFlags.includes('Offline')) {
    connected = false;
    if (!statusFlags.includes('Offline')) statusFlags.push('Offline');
  }

  if (input.workOffline === true) {
    connected = false;
    if (!statusFlags.includes('Offline')) statusFlags.push('Offline');
  }

  if (input.connectionType === 'usb' && input.pnpDevice) {
    const notPresent = input.pnpDevice.Present === false;
    const deviceNotConnected = input.pnpDevice.Problem === 45;
    if (notPresent || deviceNotConnected) {
      connected = false;
      if (!statusFlags.includes('Offline')) statusFlags.push('Offline');
      if (!statusFlags.includes('Device Not Connected')) {
        statusFlags.push('Device Not Connected');
      }
    }
  }

  return {
    connected,
    status: connected ? input.status : 'Offline',
    statusFlags,
  };
}

// ── Port → connection type ───────────────────────────────────────

function detectConnectionType(
  portName: string | null,
): PrinterTelemetry['connectionType'] {
  if (!portName) return 'unknown';
  const p = portName.toUpperCase();
  if (p.startsWith('USB') || p.includes('USBPRINT')) return 'usb';
  if (p.startsWith('WSD-') || p.startsWith('WSD:')) return 'wsd';
  if (
    p.startsWith('IP_') ||
    p.startsWith('TCPIP') ||
    p.startsWith('10.') ||
    p.startsWith('192.') ||
    p.startsWith('172.') ||
    p.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)
  )
    return 'network';
  if (
    p.includes('NUL') ||
    p.includes('FILE:') ||
    p.includes('PDF') ||
    p.includes('XPS') ||
    p.includes('ONENOTE') ||
    p.includes('SEND') ||
    p.includes('FAX')
  )
    return 'virtual';
  return 'unknown';
}

/**
 * Extracts a best-guess IP address from Windows port names.
 * Handles formats like "IP_192.168.1.5", "192.168.1.5", "TCPIP_192.168.1.5".
 */
function extractIpFromPortName(portName: string | null): string | null {
  if (!portName) return null;
  // "IP_x.x.x.x" or "TCPIP_x.x.x.x"
  const prefixed = portName.match(
    /^(?:IP|TCPIP)[_:](\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/i,
  );
  if (prefixed) return prefixed[1];
  // bare IP
  const bare = portName.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (bare) return bare[1];
  return null;
}

// ── Color hints for common supply names ─────────────────────────

const COLOR_HINT_MAP: [RegExp, string][] = [
  [/black|bk|k\b|pgbk/i, 'black'],
  [/cyan|c\b/i, 'cyan'],
  [/magenta|m\b/i, 'magenta'],
  [/yellow|y\b/i, 'yellow'],
  [/photo|gray|grey/i, 'gray'],
  [/toner/i, 'black'],
];

function colorHintFromName(name: string): string | undefined {
  for (const [re, hint] of COLOR_HINT_MAP) {
    if (re.test(name)) return hint;
  }
  return undefined;
}

// ── Refresh-callback registry ────────────────────────────────────
//
// printer-monitor.ts (and any other subscriber) can register a callback here
// instead of running a second independent timer. Callbacks are invoked
// synchronously inside the refresh() try/catch so errors are isolated per
// subscriber via a try/catch wrapper.

type RefreshCallback = (telemetry: PrinterTelemetry) => void;
const refreshCallbacks: RefreshCallback[] = [];

/**
 * Register a function to be called after every telemetry refresh cycle.
 * The callback receives the latest PrinterTelemetry snapshot.
 * Call this once during application startup (before the first interval fires).
 */
export function onPrinterRefresh(cb: RefreshCallback): void {
  refreshCallbacks.push(cb);
}

const REFRESH_INTERVAL_MS = 30_000;

const INK_HISTORY_RETENTION = 2000;
let cached: PrinterTelemetry = {
  connected: false,
  name: null,
  driverName: null,
  portName: null,
  connectionType: 'unknown',
  status: 'Checking…',
  statusFlags: [],
  ink: [],
  inkDetectionMethod: 'none',
  targetPrinterName: null,
  targetIsDefault: false,
  inkTelemetryAvailable: false,
  inkTelemetryReason: 'No telemetry yet',
  lastCheckedAt: new Date().toISOString(),
  lastError: null,
};
let refreshing = false;
let pendingRefresh: Promise<PrinterTelemetry> | null = null;

function normalizeTargetPrinterName(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null;
  const sanitized = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return sanitized ? sanitized : null;
}

function getInkMonitoringSettings(): InkMonitoringSettings {
  const defaults: InkMonitoringSettings = {
    enabled: true,
    targetPrinterName: null,
    lowThresholdPercent: 20,
    criticalThresholdPercent: 5,
    blockOnLow: false,
    blockOnEmpty: true,
    telemetryUnknownPolicy: 'warn_allow',
  };
  const loaded = db.data?.settings?.inkMonitoring ?? defaults;
  return ensureCriticalNotAboveLow({
    enabled: loaded.enabled,
    targetPrinterName: normalizeTargetPrinterName(loaded.targetPrinterName),
    lowThresholdPercent: loaded.lowThresholdPercent,
    criticalThresholdPercent: loaded.criticalThresholdPercent,
    blockOnLow: loaded.blockOnLow,
    blockOnEmpty: loaded.blockOnEmpty,
    telemetryUnknownPolicy:
      loaded.telemetryUnknownPolicy === 'block' ? 'block' : 'warn_allow',
  });
}

function normalizeTelemetryAvailability(
  telemetry: PrinterTelemetry,
): PrinterTelemetry {
  const meaningfulSupply = telemetry.ink.some(
    (entry) =>
      entry.level !== null ||
      entry.status === 'low' ||
      entry.status === 'empty',
  );
  const available =
    telemetry.inkDetectionMethod !== 'none' &&
    telemetry.inkDetectionMethod !== 'error-state' &&
    meaningfulSupply;
  const reason = available
    ? null
    : (telemetry.inkTelemetryReason ??
      (telemetry.inkDetectionMethod === 'none'
        ? 'Driver did not expose ink telemetry fields'
        : telemetry.inkDetectionMethod === 'error-state'
          ? 'Only error-state inference available (no direct ink levels)'
          : 'Ink telemetry unavailable'));
  return {
    ...telemetry,
    inkTelemetryAvailable: available,
    inkTelemetryReason: reason,
  };
}

function persistInkHistoryEntry(telemetry: PrinterTelemetry): void {
  if (!db.data) return;
  const nextEntry = {
    id: randomUUID(),
    timestamp: telemetry.lastCheckedAt,
    printerName: telemetry.name ?? null,
    printerStatus: telemetry.status,
    inkDetectionMethod: telemetry.inkDetectionMethod,
    inkTelemetryAvailable: telemetry.inkTelemetryAvailable ?? false,
    inkTelemetryReason: telemetry.inkTelemetryReason ?? null,
    supplies: telemetry.ink.map((entry) => ({
      name: entry.name,
      level: entry.level,
      status: entry.status,
    })),
  };
  db.data.inkHistory.unshift(nextEntry);
  if (db.data.inkHistory.length > INK_HISTORY_RETENTION) {
    db.data.inkHistory.length = INK_HISTORY_RETENTION;
  }
}

function ensureCriticalNotAboveLow(
  settings: InkMonitoringSettings,
): InkMonitoringSettings {
  if (settings.criticalThresholdPercent <= settings.lowThresholdPercent) {
    return settings;
  }
  return {
    ...settings,
    criticalThresholdPercent: settings.lowThresholdPercent,
  };
}

function updatePrinterWatchdogState(telemetry: PrinterTelemetry): void {
  markWatchdogHeartbeat('printer', {
    connected: telemetry.connected,
    status: telemetry.status,
    telemetryLastCheckedAt: telemetry.lastCheckedAt,
  });
  if (!telemetry.connected) {
    setWatchdogComponentState('printer', 'unhealthy', 'Printer disconnected.', {
      connected: false,
      status: telemetry.status,
      telemetryLastCheckedAt: telemetry.lastCheckedAt,
    });
    return;
  }
  if (BLOCKED_STATUSES.has(telemetry.status)) {
    setWatchdogComponentState(
      'printer',
      'unhealthy',
      `Printer blocked: ${telemetry.status}.`,
      {
        connected: true,
        status: telemetry.status,
        telemetryLastCheckedAt: telemetry.lastCheckedAt,
      },
    );
    return;
  }
  setWatchdogComponentState(
    'printer',
    'healthy',
    `Printer healthy (${telemetry.status}).`,
    {
      connected: true,
      status: telemetry.status,
      telemetryLastCheckedAt: telemetry.lastCheckedAt,
    },
  );
}

async function refresh(): Promise<void> {
  if (pendingRefresh) {
    await pendingRefresh;
    return;
  }

  pendingRefresh = runRefreshCycle();
  try {
    await pendingRefresh;
  } finally {
    pendingRefresh = null;
  }
}

void refresh();
setInterval(() => void refresh(), REFRESH_INTERVAL_MS);

/** Returns the latest cached printer telemetry (never blocks). */
export function getPrinterTelemetry(): PrinterTelemetry {
  return cached;
}

/**
 * Performs a fast, ink-free status query directly against Win32_Printer.
 * Completes in < 1 s on most systems — intentionally skips all ink-detection
 * strategies so the mid-job watchdog can poll tightly without blocking.
 *
 * Unlike getPrinterTelemetry() this always issues a live PowerShell call
 * instead of returning the 30 s cached value.
 */
export async function queryLivePrinterStatus(): Promise<{
  connected: boolean;
  status: string;
  statusFlags: string[];
  pnpDevice: PnpPrinterDeviceInfo | null;
}> {
  try {
    const settings = getInkMonitoringSettings();
    const targetName = normalizeTargetPrinterName(settings.targetPrinterName);
    const printers = await listWin32Printers(5_000);
    if (printers.length === 0) {
      return {
        connected: false,
        status: targetName
          ? 'Configured printer not found'
          : 'No default printer',
        statusFlags: [],
        pnpDevice: null,
      };
    }

    const printerRecord = targetName
      ? findConfiguredPrinter(printers, targetName)
      : findDefaultOrSinglePhysicalPrinter(printers);

    if (!printerRecord) {
      return {
        connected: false,
        status: targetName
          ? 'Configured printer not found'
          : 'No default printer',
        statusFlags: [],
        pnpDevice: null,
      };
    }

    const statusFlags = parsePrinterStateFlags(printerRecord.PrinterState);
    const status = humanStatusFromFlags(
      statusFlags,
      printerRecord.PrinterStatus,
    );
    const connectionType = detectConnectionType(printerRecord.PortName ?? null);
    let matchedPnpDevice: PnpPrinterDeviceInfo | null = null;
    if (connectionType === 'usb') {
      const pnpDevices = await listPnpPrinterDevices(1_000);
      matchedPnpDevice = matchPnpDeviceToPrinter(
        {
          Name: printerRecord.Name,
          DriverName: printerRecord.DriverName,
          PortName: printerRecord.PortName,
          Default: true,
          PrinterStatus: printerRecord.PrinterStatus,
          PrinterState: printerRecord.PrinterState,
        },
        pnpDevices,
      );
    }
    const printerWithPnp = { ...printerRecord, pnpDevice: matchedPnpDevice };
    const normalized = applyConnectionSignals({
      status,
      statusFlags,
      connectionType,
      workOffline: printerWithPnp.WorkOffline,
      pnpDevice: printerWithPnp.pnpDevice,
    });
    return {
      ...normalized,
      pnpDevice: printerWithPnp.pnpDevice,
    };
  } catch {
    return {
      connected: false,
      status: 'Error',
      statusFlags: [],
      pnpDevice: null,
    };
  }
}

// ── Main telemetry query ─────────────────────────────────────────

async function queryPrinterTelemetry(): Promise<PrinterTelemetry> {
  const lastCheckedAt = new Date().toISOString();
  const settings = getInkMonitoringSettings();
  const targetPrinterName = normalizeTargetPrinterName(
    settings.targetPrinterName,
  );
  let printerInfo: (Win32PrinterRow & { pnpDevice?: PnpPrinterDeviceInfo | null }) | null = null;

  try {
    const printers = await listWin32Printers();
    if (printers.length === 0) {
      return noDefaultPrinter(lastCheckedAt, targetPrinterName);
    }

    printerInfo = targetPrinterName
      ? findConfiguredPrinter(printers, targetPrinterName)
      : findDefaultOrSinglePhysicalPrinter(printers);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[PRINTER-STATUS] ⚠ Could not query printer: ${msg}`);
    return {
      connected: false,
      name: null,
      driverName: null,
      portName: null,
      connectionType: 'unknown',
      status: 'Error',
      statusFlags: [],
      ink: [],
      inkDetectionMethod: 'none',
      targetPrinterName,
      targetIsDefault: false,
      inkTelemetryAvailable: false,
      inkTelemetryReason: 'Printer query failed',
      lastCheckedAt,
      lastError: msg,
    };
  }

  if (!printerInfo) return noDefaultPrinter(lastCheckedAt, targetPrinterName);

  const statusFlags = parsePrinterStateFlags(printerInfo.PrinterState);
  const status = humanStatusFromFlags(statusFlags, printerInfo.PrinterStatus);
  const connectionType = detectConnectionType(printerInfo.PortName);
  let matchedPnpDevice: PnpPrinterDeviceInfo | null = null;
  if (connectionType === 'usb') {
    const pnpDevices = await listPnpPrinterDevices();
    matchedPnpDevice = matchPnpDeviceToPrinter(printerInfo, pnpDevices);
  }
  printerInfo.pnpDevice = matchedPnpDevice;
  const connectivity = applyConnectionSignals({
    status,
    statusFlags,
    connectionType,
    workOffline: printerInfo.WorkOffline,
    pnpDevice: printerInfo.pnpDevice,
  });

  // 2) Attempt ink detection with a prioritized strategy chain only when
  // connectivity indicates the printer is actually reachable.
  const isBlocked =
    !connectivity.connected || BLOCKED_STATUSES.has(connectivity.status);
  const { ink, method } = isBlocked
    ? {
        ink: [
          { name: 'Ink / Toner', level: null, status: 'unknown' },
        ] as InkLevel[],
        method: 'none' as const,
      }
    : await detectInkLevels(
        printerInfo.Name,
        printerInfo.DriverName,
        printerInfo.PortName,
        printerInfo.PrinterState,
        printerInfo.PrinterStatus,
        connectionType,
      );

  return {
    connected: connectivity.connected,
    name: printerInfo.Name,
    driverName: printerInfo.DriverName,
    portName: printerInfo.PortName,
    connectionType,
    status: connectivity.status,
    statusFlags: connectivity.statusFlags,
    ink,
    inkDetectionMethod: method,
    targetPrinterName,
    targetIsDefault: printerInfo.Default === true,
    lastCheckedAt,
    lastError: null,
  };
}

async function runRefreshCycle(): Promise<PrinterTelemetry> {
  if (refreshing) return cached;
  refreshing = true;
  try {
    const next = normalizeTelemetryAvailability(await queryPrinterTelemetry());
    cached = next;

    try {
      persistInkHistoryEntry(next);
      if (next.connected) {
        consumablesStore.appendInkSnapshot({
          id: randomUUID(),
          timestamp: next.lastCheckedAt,
          printerName: next.name ?? null,
          inkDetectionMethod: next.inkDetectionMethod,
          inkTelemetryAvailable: next.inkTelemetryAvailable ?? false,
          inkTelemetryReason: next.inkTelemetryReason ?? null,
          supplies: next.ink.map((entry) => ({
            name: entry.name,
            level: entry.level,
            status: entry.status,
          })),
        });
      }
      await db.write();
      if (next.connected) {
        await evaluateConsumablesForecastAlerts();
      }
    } catch (err) {
      console.warn(
        '[PRINTER-STATUS] Failed to persist telemetry history:',
        err instanceof Error ? err.message : err,
      );
    }

    try {
      updatePrinterWatchdogState(next);
    } catch (err) {
      console.warn(
        '[PRINTER-STATUS] Failed to update printer watchdog:',
        err instanceof Error ? err.message : err,
      );
    }
  } catch (err: unknown) {
    cached = {
      connected: false,
      name: null,
      driverName: null,
      portName: null,
      connectionType: 'unknown',
      status: 'Error',
      statusFlags: [],
      ink: [],
      inkDetectionMethod: 'none',
      targetPrinterName: null,
      targetIsDefault: false,
      inkTelemetryAvailable: false,
      inkTelemetryReason: 'Telemetry refresh failed',
      lastCheckedAt: new Date().toISOString(),
      lastError: err instanceof Error ? err.message : String(err),
    };
    markWatchdogHeartbeat('printer', {
      connected: false,
      status: cached.status,
      telemetryLastCheckedAt: cached.lastCheckedAt,
    });
    setWatchdogComponentState(
      'printer',
      'degraded',
      `Printer telemetry refresh failed: ${cached.lastError}`,
      {
        connected: false,
        status: 'Error',
        telemetryLastCheckedAt: cached.lastCheckedAt,
        lastError: cached.lastError,
      },
    );
  } finally {
    refreshing = false;
  }

  for (const cb of refreshCallbacks) {
    try {
      cb(cached);
    } catch (err) {
      console.warn(
        '[PRINTER-STATUS] refresh callback threw:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  return cached;
}

function noDefaultPrinter(
  lastCheckedAt: string,
  targetPrinterName: string | null,
): PrinterTelemetry {
  return {
    connected: false,
    name: null,
    driverName: null,
    portName: null,
    connectionType: 'unknown',
    status: targetPrinterName
      ? 'Configured printer not found'
      : 'No default printer',
    statusFlags: [],
    ink: [],
    inkDetectionMethod: 'none',
    targetPrinterName,
    targetIsDefault: false,
    inkTelemetryAvailable: false,
    inkTelemetryReason: targetPrinterName
      ? `Configured printer "${targetPrinterName}" was not found`
      : 'No default printer configured',
    lastCheckedAt,
    lastError: null,
  };
}

// ── Ink detection strategy chain ────────────────────────────────

interface InkResult {
  ink: InkLevel[];
  method: PrinterTelemetry['inkDetectionMethod'];
}

async function detectInkLevels(
  printerName: string,
  driverName: string,
  portName: string,
  printerState: number,
  printerStatus: number,
  connectionType: PrinterTelemetry['connectionType'],
): Promise<InkResult> {
  // Strategy 1 – SNMP Printer MIB (most accurate for network/WSD printers)
  if (connectionType === 'network' || connectionType === 'wsd') {
    const ip =
      extractIpFromPortName(portName) ??
      (await resolveWsdPrinterIp(printerName));

    if (ip) {
      const snmp = await querySnmpPrinterMib(ip);
      if (snmp.length > 0) return { ink: snmp, method: 'snmp' };
    }
  }

  // Strategy 2 – Vendor-specific WMI namespaces (USB + some network)
  const vendorWmi = await queryVendorWmiInk(printerName, driverName);
  if (vendorWmi.length > 0) return { ink: vendorWmi, method: 'vendor-wmi' };

  // Strategy 3 – Get-PrinterProperty (works for some USB + network drivers)
  const prop = await queryPrinterPropertyInk(printerName);
  if (prop.length > 0) return { ink: prop, method: 'printer-property' };

  // Strategy 4 – DetectedErrorState / PrinterState bitmask flags
  const errorState = inferInkFromErrorState(printerState, printerStatus);
  if (errorState.length > 0) return { ink: errorState, method: 'error-state' };

  // Nothing worked — return unknown
  return {
    ink: [{ name: 'Ink / Toner', level: null, status: 'unknown' }],
    method: 'none',
  };
}

// ── Strategy 1: SNMP Printer MIB v1 ────────────────────────────
//
// Queries prtMarkerSupplies table (RFC 3805 / Printer MIB v2).
// OID prefix: 1.3.6.1.2.1.43.11.1.1
//   .6.1.x  – prtMarkerSuppliesDescription (string)
//   .8.1.x  – prtMarkerSuppliesMaxCapacity  (-1 = unlimited/unknown)
//   .9.1.x  – prtMarkerSuppliesLevel        (-1 = unknown, -2 = ≥ some)
//   .10.1.x – prtMarkerSuppliesClass        (1 = consumed, 3 = waste)
//
// Uses a self-contained PowerShell UDP SNMP GET-NEXT walk so no extra
// npm packages are required.  Times out to avoid blocking the chain.

const SNMP_PS_SCRIPT = (ip: string) =>
  `
$ErrorActionPreference = 'Stop'
$timeout = 3000
$community = [System.Text.Encoding]::ASCII.GetBytes('public')
$oidBase = @(1,3,6,1,2,1,43,11,1,1)

function Encode-OID([int[]]$oid) {
  $body = @(0x2b) # 1.3 encoded
  $rest = $oid[2..($oid.Length-1)]
  foreach ($v in $rest) {
    if ($v -lt 128) { $body += [byte]$v }
    else {
      $bytes = [System.Collections.Generic.List[byte]]::new()
      $tmp = $v
      $bytes.Insert(0, [byte]($tmp -band 0x7f))
      $tmp = $tmp -shr 7
      while ($tmp -gt 0) { $bytes.Insert(0, [byte](0x80 -bor ($tmp -band 0x7f))); $tmp = $tmp -shr 7 }
      $body += $bytes.ToArray()
    }
  }
  return ,$body
}

function Build-GetRequest([int[]]$oid) {
  $oidBytes = Encode-OID $oid
  $oidTlv   = @(0x06, $oidBytes.Count) + $oidBytes
  $nullTlv  = @(0x05, 0x00)
  $varBind  = @(0x30, ($oidTlv.Count + $nullTlv.Count)) + $oidTlv + $nullTlv
  $varList  = @(0x30, $varBind.Count) + $varBind
  $reqId    = @(0x02, 0x01, 0x01)   # integer 1
  $errStat  = @(0x02, 0x01, 0x00)
  $errIdx   = @(0x02, 0x01, 0x00)
  $pduBody  = $reqId + $errStat + $errIdx + $varList
  $pdu      = @(0xa0, $pduBody.Count) + $pduBody  # GetRequest PDU
  $commTlv  = @(0x04, $community.Count) + $community
  $version  = @(0x02, 0x01, 0x00)  # version 1
  $msgBody  = $version + $commTlv + $pdu
  return [byte[]](@(0x30, $msgBody.Count) + $msgBody)
}

$results = [System.Collections.Generic.List[hashtable]]::new()
$udp = [System.Net.Sockets.UdpClient]::new()
try {
  $udp.Client.ReceiveTimeout = $timeout
  $ep = [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Parse('${ip}'), 161)

  # Probe columns: description=6, maxCapacity=8, level=9, class=10
  foreach ($col in @(6, 8, 9, 10)) {
    for ($idx = 1; $idx -le 8; $idx++) {
      $oid = $oidBase + @($col, 1, $idx)
      $pkt = Build-GetRequest $oid
      try {
        [void]$udp.Send($pkt, $pkt.Length, $ep)
        $resp = $udp.Receive([ref]$ep)
        # Extract value from response (very simplified; works for integer + octet-string)
        # Walk to end of PDU to find value TLV
        $i = 0
        # Skip outer SEQUENCE, version, community, PDU header to reach varBindList
        # For our purposes parse last TLV in the packet
        $i = $resp.Length - 1
        # Find last value: scan backwards for the value TLV after the OID
        # Simpler: search for our OID echo, then the NULL, then the value
        $valType = $resp[$resp.Length - ($resp[$resp.Length-1] + 2 + 1 )]
        $valLen  = $resp[$resp.Length - ($resp[$resp.Length-1] + 2)]
        $valBytes = $resp[($resp.Length - $resp[$resp.Length-1])..($resp.Length-1)]
        
        if ($valType -eq 0x02 -or $valType -eq 0x41 -or $valType -eq 0x42) {
          # INTEGER or Gauge32 or Counter32
          $num = 0
          foreach ($b in $valBytes) { $num = ($num -shl 8) -bor $b }
          [void]$results.Add(@{ col=$col; idx=$idx; type='int'; value=$num })
        } elseif ($valType -eq 0x04) {
          # OCTET STRING
          $str = [System.Text.Encoding]::UTF8.GetString($valBytes).Trim([char]0)
          [void]$results.Add(@{ col=$col; idx=$idx; type='str'; value=$str })
        }
      } catch { <# timeout / no response for this index — stop column scan #>; break }
    }
  }
} finally { $udp.Close() }

$results | ConvertTo-Json -Depth 3
`.trim();

async function querySnmpPrinterMib(ip: string): Promise<InkLevel[]> {
  try {
    const json = await runPowerShell(SNMP_PS_SCRIPT(ip), 20_000);
    if (!json || json === 'null') return [];

    const raw = JSON.parse(json);
    const rows: { col: number; idx: number; type: string; value: unknown }[] =
      Array.isArray(raw) ? raw : [raw];

    // Index by [col][idx]
    const table: Record<number, Record<number, unknown>> = {};
    for (const row of rows) {
      table[row.col] ??= {};
      table[row.col][row.idx] = row.value;
    }

    const result: InkLevel[] = [];
    const indices = Object.keys(table[9] ?? {}).map(Number);

    for (const idx of indices) {
      const supplyClass = Number(table[10]?.[idx] ?? 1);
      if (supplyClass === 3) continue; // skip waste tanks

      const raw_max = Number(table[8]?.[idx] ?? -1);
      const raw_level = Number(table[9]?.[idx] ?? -1);
      const desc = String(table[6]?.[idx] ?? `Supply ${idx}`);

      let level: number | null = null;
      if (raw_level >= 0 && raw_max > 0) {
        level = Math.round((raw_level / raw_max) * 100);
      } else if (raw_level === -2) {
        // at-least-some — treat as low-confidence ok
        level = null;
      }

      result.push({
        name: desc,
        level,
        status: inkStatusFromLevel(level),
        colorHint: colorHintFromName(desc),
      });
    }

    return result;
  } catch (err) {
    console.warn(
      '[PRINTER-STATUS] SNMP query failed:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/** For WSD printers, resolve the underlying IP from the WSD port definition. */
async function resolveWsdPrinterIp(
  printerName: string,
): Promise<string | null> {
  try {
    const escapedName = printerName.replace(/'/g, "''");
    const out = await runPowerShell(
      `$port = (Get-CimInstance -ClassName Win32_Printer -Filter "Name='${escapedName}'").PortName; ` +
        `$wsd  = Get-PnpDevice | Where-Object { $_.FriendlyName -match [regex]::Escape('${escapedName}') } ` +
        `        | Get-PnpDeviceProperty -KeyName 'DEVPKEY_Device_LocationInfo' ` +
        `        | Select-Object -ExpandProperty Data -ErrorAction SilentlyContinue; ` +
        `$ip   = ([regex]::Match($wsd, '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b')).Value; ` +
        `if ($ip) { $ip } else { '' }`,
      10_000,
    );
    const trimmed = out.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

// ── Strategy 2: Vendor-specific WMI namespaces ──────────────────
//
// HP:     root\HP  (HPStatus, HPInkLevel)
// Epson:  WMI via Epson BIDI service → Get-PrinterProperty
// Canon:  root\Canon (not universally available)
// Brother: Get-PrinterProperty with vendor keys

async function queryVendorWmiInk(
  printerName: string,
  driverName: string,
): Promise<InkLevel[]> {
  const driver = driverName.toLowerCase();

  if (driver.includes('hp') || driver.includes('hewlett')) {
    const hp = await queryHpWmi(printerName);
    if (hp.length > 0) return hp;
  }

  if (driver.includes('epson')) {
    const epson = await queryEpsonBidi(printerName);
    if (epson.length > 0) return epson;
  }

  if (driver.includes('canon')) {
    const canon = await queryCanonWmi(printerName);
    if (canon.length > 0) return canon;
  }

  if (driver.includes('brother')) {
    const brother = await queryBrotherProperty(printerName);
    if (brother.length > 0) return brother;
  }

  return [];
}

async function queryHpWmi(printerName: string): Promise<InkLevel[]> {
  try {
    const escapedName = printerName.replace(/'/g, "''");
    // HP exposes ink via root\HP namespace on some models
    const json = await runPowerShell(
      `$ns = 'root\\HP'; ` +
        `if (-not (Get-WmiObject -Namespace $ns -List 2>$null)) { return '[]' }; ` +
        `$ink = Get-WmiObject -Namespace $ns -Query ` +
        `  "SELECT * FROM HP_InkLevel WHERE PrinterName='${escapedName}'" ` +
        `  -ErrorAction SilentlyContinue; ` +
        `if (-not $ink) { ` +
        `  $ink = Get-WmiObject -Namespace $ns -Class HP_PrinterStatus ` +
        `    -ErrorAction SilentlyContinue; ` +
        `}; ` +
        `if ($ink) { $ink | Select-Object Name,Level,MaxLevel,Color | ConvertTo-Json -Depth 2 } else { '[]' }`,
      10_000,
    );

    return parseVendorInkJson(json);
  } catch {
    return [];
  }
}

async function queryEpsonBidi(printerName: string): Promise<InkLevel[]> {
  try {
    const escapedName = printerName.replace(/'/g, "''");
    // Epson bidirectional driver exposes ink via Get-PrinterProperty or
    // a local COM object.  Try the broader property list first.
    const json = await runPowerShell(
      `Get-PrinterProperty -PrinterName '${escapedName}' 2>$null ` +
        `| Where-Object { $_.PropertyName -match 'Ink|Supply|Level|Cartridge|Color|Cyan|Magenta|Yellow|Black|Gray|Photo' } ` +
        `| Select-Object PropertyName,Value | ConvertTo-Json -Depth 2`,
      10_000,
    );

    return parsePrinterPropertyJson(json);
  } catch {
    return [];
  }
}

async function queryCanonWmi(printerName: string): Promise<InkLevel[]> {
  try {
    const escapedName = printerName.replace(/'/g, "''");
    const json = await runPowerShell(
      `$ns = 'root\\Canon'; ` +
        `if (-not (Get-WmiObject -Namespace $ns -List 2>$null)) { return '[]' }; ` +
        `$ink = Get-WmiObject -Namespace $ns -Class Canon_InkLevel ` +
        `  -ErrorAction SilentlyContinue ` +
        `  | Where-Object { $_.PrinterName -eq '${escapedName}' }; ` +
        `if ($ink) { $ink | Select-Object InkName,InkLevel,MaxInkLevel | ConvertTo-Json -Depth 2 } else { '[]' }`,
      10_000,
    );

    // Remap Canon's property names
    if (!json || json === '[]') return [];
    const raw = JSON.parse(json);
    const items = Array.isArray(raw) ? raw : [raw];
    return items.map((i) => {
      const lvl = parsePercentLevel(i.InkLevel, i.MaxInkLevel);
      const name = String(i.InkName ?? 'Ink');
      return {
        name,
        level: lvl,
        status: inkStatusFromLevel(lvl),
        colorHint: colorHintFromName(name),
      };
    });
  } catch {
    return [];
  }
}

async function queryBrotherProperty(printerName: string): Promise<InkLevel[]> {
  try {
    const escapedName = printerName.replace(/'/g, "''");
    const json = await runPowerShell(
      `Get-PrinterProperty -PrinterName '${escapedName}' 2>$null ` +
        `| Where-Object { $_.PropertyName -match 'Ink|Toner|Supply|Level|BK|CY|MG|YL' } ` +
        `| Select-Object PropertyName,Value | ConvertTo-Json -Depth 2`,
      10_000,
    );

    return parsePrinterPropertyJson(json);
  } catch {
    return [];
  }
}

// ── Strategy 3: Get-PrinterProperty (generic) ───────────────────

async function queryPrinterPropertyInk(
  printerName: string,
): Promise<InkLevel[]> {
  try {
    const escapedName = printerName.replace(/'/g, "''");
    const json = await runPowerShell(
      `Get-PrinterProperty -PrinterName '${escapedName}' 2>$null ` +
        `| Where-Object { $_.PropertyName -match 'InkLevel|TonerLevel|Supply|Cartridge|Ink|Toner' } ` +
        `| Select-Object PropertyName,Value | ConvertTo-Json -Depth 2`,
      8_000,
    );

    return parsePrinterPropertyJson(json);
  } catch {
    return [];
  }
}

// ── Strategy 4: Infer from error state bits ─────────────────────

function inferInkFromErrorState(
  printerState: number,
  _printerStatus: number,
): InkLevel[] {
  const tonerLow = (printerState & 0x00040000) !== 0;
  const noToner = (printerState & 0x00080000) !== 0;
  if (noToner) return [{ name: 'Toner / Ink', level: 0, status: 'empty' }];
  if (tonerLow) return [{ name: 'Toner / Ink', level: null, status: 'low' }];
  return [];
}

// ── Shared parsers ───────────────────────────────────────────────

function parseVendorInkJson(json: string): InkLevel[] {
  if (!json || json === '[]' || json === 'null') return [];
  try {
    const raw = JSON.parse(json);
    const items = Array.isArray(raw) ? raw : [raw];
    const result: InkLevel[] = [];
    for (const item of items) {
      const name = String(
        item.Name ?? item.Color ?? item.InkName ?? 'Supply',
      ).trim();
      const lvl = parsePercentLevel(
        item.Level ?? item.InkLevel,
        item.MaxLevel ?? item.MaxInkLevel ?? 100,
      );
      result.push({
        name: name || 'Supply',
        level: lvl,
        status: inkStatusFromLevel(lvl),
        colorHint: colorHintFromName(name),
      });
    }
    return result;
  } catch {
    return [];
  }
}

function parsePrinterPropertyJson(json: string): InkLevel[] {
  if (!json || json === '[]' || json === 'null') return [];
  try {
    const raw = JSON.parse(json);
    const items = Array.isArray(raw) ? raw : [raw];
    const result: InkLevel[] = [];

    for (const item of items) {
      const rawName = String(item.PropertyName ?? 'Supply');
      const name = rawName
        .replace(/Level$/i, '')
        .replace(/^Config:/i, '')
        .replace(/InkLevel/i, 'Ink')
        .trim();

      const numVal = Number(item.Value);
      const level =
        Number.isFinite(numVal) && numVal >= 0 && numVal <= 100 ? numVal : null;

      result.push({
        name: name || 'Supply',
        level,
        status: inkStatusFromLevel(level),
        colorHint: colorHintFromName(name),
      });
    }
    return result;
  } catch {
    return [];
  }
}

// ── Utilities ────────────────────────────────────────────────────

function parsePercentLevel(level: unknown, max: unknown = 100): number | null {
  const l = Number(level);
  const m = Number(max);
  if (!Number.isFinite(l) || l < 0) return null;
  if (m > 0 && m !== 100) return Math.round((l / m) * 100);
  if (l >= 0 && l <= 100) return l;
  return null;
}

function inkStatusFromLevel(level: number | null): InkLevel['status'] {
  if (level === null) return 'unknown';
  if (level <= 0) return 'empty';
  if (level <= 15) return 'low';
  return 'ok';
}

/**
 * Forces an immediate re-query of the default Windows printer, bypassing the
 * 30-second background poll interval.
 *
 * Use this after a printer swap, driver re-registration, or USB reconnect so
 * the admin panel reflects the new hardware state without waiting for the next
 * automatic refresh cycle.
 *
 * Safe to call concurrently — callers are coalesced onto one shared in-flight
 * refresh Promise so only one telemetry query + callback dispatch runs at once.
 *
 * @returns The freshly-queried PrinterTelemetry object (also updates the cache
 *          so subsequent `getPrinterTelemetry()` calls see the same value).
 */
export async function refreshPrinterTelemetry(): Promise<PrinterTelemetry> {
  if (pendingRefresh) {
    return pendingRefresh;
  }
  pendingRefresh = runRefreshCycle();

  try {
    return await pendingRefresh;
  } finally {
    pendingRefresh = null;
  }
}

export async function listInstalledPrinters(): Promise<InstalledPrinterInfo[]> {
  try {
    const json = await runPowerShell(
      `Get-CimInstance -ClassName Win32_Printer ` +
        `| Select-Object Name, DriverName, PortName, Default, PrinterStatus, PrinterState ` +
        `| ConvertTo-Json -Depth 2`,
      10_000,
    );
    if (!json || json === 'null') return [];
    const parsed = JSON.parse(json) as
      | InstalledPrinterInfo
      | InstalledPrinterInfo[];
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const printers = rows.filter((row) => row && typeof row.Name === 'string');
    const pnpDevices = await listPnpPrinterDevices();
    return printers.map((printer) => {
      const matchedDevice = matchPnpDeviceToPrinter(printer, pnpDevices);
      return {
        ...printer,
        PnpInstanceId: matchedDevice?.InstanceId ?? null,
        PnpFriendlyName: matchedDevice?.FriendlyName ?? null,
        DeviceSerialNumber: matchedDevice?.SerialNumber ?? null,
      };
    });
  } catch {
    return [];
  }
}

export async function runInkTelemetryDiagnostics(): Promise<{
  targetPrinterName: string | null;
  targetResolved: boolean;
  telemetry: PrinterTelemetry;
  installedPrinters: InstalledPrinterInfo[];
  targetPrinterIdentity: {
    pnpInstanceId: string | null;
    pnpFriendlyName: string | null;
    deviceSerialNumber: string | null;
  } | null;
  matchingProperties: Array<{ propertyName: string; value: unknown }>;
}> {
  const telemetry = await refreshPrinterTelemetry();
  const installedPrinters = await listInstalledPrinters();
  const settings = getInkMonitoringSettings();
  const targetPrinterName =
    normalizeTargetPrinterName(settings.targetPrinterName) ??
    normalizeTargetPrinterName(telemetry.name);
  const resolvedTargetPrinter = targetPrinterName
    ? findMatchingInstalledPrinterByName(installedPrinters, targetPrinterName)
    : null;
  const resolvedTargetPrinterName =
    resolvedTargetPrinter?.Name ?? targetPrinterName;
  const escaped = resolvedTargetPrinterName?.replace(/'/g, "''") ?? null;
  let matchingProperties: Array<{ propertyName: string; value: unknown }> = [];

  if (escaped) {
    try {
      const raw = await runPowerShell(
        `Get-PrinterProperty -PrinterName '${escaped}' 2>$null ` +
          `| Where-Object { $_.PropertyName -match 'Ink|Supply|Level|Cartridge|Color|Cyan|Magenta|Yellow|Black|Gray|Photo|Toner' } ` +
          `| Select-Object PropertyName,Value | ConvertTo-Json -Depth 4`,
        10_000,
      );
      if (raw && raw !== 'null') {
        const parsed = JSON.parse(raw) as
          | { PropertyName?: unknown; Value?: unknown }
          | Array<{ PropertyName?: unknown; Value?: unknown }>;
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        matchingProperties = rows
          .filter((row) => typeof row?.PropertyName === 'string')
          .map((row) => ({
            propertyName: String(row.PropertyName),
            value: row.Value ?? null,
          }));
      }
    } catch {
      matchingProperties = [];
    }
  }

  const targetPrinterIdentity = resolvedTargetPrinterName
    ? (() => {
        const matched = findMatchingInstalledPrinterByName(
          installedPrinters,
          resolvedTargetPrinterName,
        );
        if (!matched) return null;
        return {
          pnpInstanceId: matched.PnpInstanceId ?? null,
          pnpFriendlyName: matched.PnpFriendlyName ?? null,
          deviceSerialNumber: matched.DeviceSerialNumber ?? null,
        };
      })()
    : null;

  return {
    targetPrinterName: resolvedTargetPrinterName ?? null,
    targetResolved: Boolean(
      resolvedTargetPrinterName &&
      installedPrinters.some(
        (entry) =>
          namesLikelyMatch(entry.Name, resolvedTargetPrinterName),
      ),
    ),
    telemetry,
    installedPrinters,
    targetPrinterIdentity,
    matchingProperties,
  };
}

function normalizeComparableName(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizePrinterMatchKey(value: string | null | undefined): string {
  return normalizeComparableName(value).replace(/[^a-z0-9]+/g, '');
}

function namesLikelyMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const normalizedLeft = normalizeComparableName(left);
  const normalizedRight = normalizeComparableName(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  const keyLeft = normalizePrinterMatchKey(normalizedLeft);
  const keyRight = normalizePrinterMatchKey(normalizedRight);
  if (!keyLeft || !keyRight) return false;
  if (keyLeft === keyRight) return true;

  const minLength = Math.min(keyLeft.length, keyRight.length);
  if (minLength < 8) return false;
  return keyLeft.includes(keyRight) || keyRight.includes(keyLeft);
}

function findConfiguredPrinter(
  printers: Win32PrinterRow[],
  targetPrinterName: string,
): Win32PrinterRow | null {
  const exact = printers.find(
    (printer) =>
      normalizeComparableName(printer.Name) ===
      normalizeComparableName(targetPrinterName),
  );
  if (exact) return exact;

  const fuzzy = printers.find((printer) =>
    namesLikelyMatch(printer.Name, targetPrinterName),
  );
  return fuzzy ?? null;
}

function findDefaultOrSinglePhysicalPrinter(
  printers: Win32PrinterRow[],
): Win32PrinterRow | null {
  const defaultPrinter = printers.find((printer) => printer.Default === true);
  if (defaultPrinter) return defaultPrinter;

  const physicalPrinters = printers.filter(
    (printer) => detectConnectionType(printer.PortName ?? null) !== 'virtual',
  );

  if (physicalPrinters.length === 1) {
    return physicalPrinters[0];
  }

  return null;
}

function findMatchingInstalledPrinterByName(
  printers: InstalledPrinterInfo[],
  name: string,
): InstalledPrinterInfo | null {
  const exact = printers.find(
    (printer) =>
      normalizeComparableName(printer.Name) === normalizeComparableName(name),
  );
  if (exact) return exact;

  const fuzzy = printers.find((printer) => namesLikelyMatch(printer.Name, name));
  return fuzzy ?? null;
}

async function listWin32Printers(timeoutMs = 10_000): Promise<Win32PrinterRow[]> {
  const json = await runPowerShell(
    `Get-CimInstance -ClassName Win32_Printer ` +
      `| Select-Object Name, DriverName, PortName, Default, PrinterStatus, PrinterState, WorkOffline ` +
      `| ConvertTo-Json -Depth 2`,
    timeoutMs,
  );

  if (!json || json === 'null') return [];

  const parsed = JSON.parse(json) as Win32PrinterRow | Win32PrinterRow[];
  const rows = Array.isArray(parsed) ? parsed : [parsed];

  return rows
    .filter(
      (row) =>
        row && typeof row.Name === 'string' && typeof row.DriverName === 'string',
    )
    .map((row) => ({
      ...row,
      PortName: typeof row.PortName === 'string' ? row.PortName : '',
    }));
}

function extractPortTokenFromInstanceId(
  instanceId: string | null | undefined,
): string | null {
  if (!instanceId) return null;
  const match = instanceId.match(/&(USB\d{3})$/i);
  return match ? match[1].toUpperCase() : null;
}

function matchPnpDeviceToPrinter(
  printer: InstalledPrinterInfo,
  devices: PnpPrinterDeviceInfo[],
): PnpPrinterDeviceInfo | null {
  const normalizedName = normalizeComparableName(printer.Name);
  const normalizedDriver = normalizeComparableName(printer.DriverName);
  const portName = (printer.PortName ?? '').trim().toUpperCase();

  if (portName) {
    const byPort = devices.find((device) => {
      const token = extractPortTokenFromInstanceId(device.InstanceId);
      return token === portName;
    });
    if (byPort) return byPort;
  }

  const byExactName = devices.find(
    (device) => normalizeComparableName(device.FriendlyName) === normalizedName,
  );
  if (byExactName) return byExactName;

  const byDriverName = devices.find((device) => {
    const friendly = normalizeComparableName(device.FriendlyName);
    if (!friendly || !normalizedDriver) return false;
    return (
      friendly.includes(normalizedDriver) || normalizedDriver.includes(friendly)
    );
  });
  if (byDriverName) return byDriverName;

  return null;
}

async function listPnpPrinterDevices(
  timeoutMs = 10_000,
): Promise<PnpPrinterDeviceInfo[]> {
  try {
    const json = await runPowerShell(
      `$devices = Get-PnpDevice -Class Printer -ErrorAction SilentlyContinue | ForEach-Object { ` +
        `$serial = ($_ | Get-PnpDeviceProperty -KeyName 'DEVPKEY_Device_SerialNumber' -ErrorAction SilentlyContinue).Data; ` +
        `[PSCustomObject]@{ FriendlyName = $_.FriendlyName; InstanceId = $_.InstanceId; Status = $_.Status; Present = $_.Present; Problem = $_.Problem; SerialNumber = if ($null -eq $serial -or $serial -eq '') { $null } else { [string]$serial } } ` +
        `}; ` +
        `if ($devices) { $devices | ConvertTo-Json -Depth 4 } else { '[]' }`,
      timeoutMs,
    );
    if (!json || json === 'null') return [];
    const parsed = JSON.parse(json) as
      | PnpPrinterDeviceInfo
      | PnpPrinterDeviceInfo[];
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.filter(
      (row) =>
        row &&
        (typeof row.InstanceId === 'string' ||
          typeof row.FriendlyName === 'string'),
    );
  } catch {
    return [];
  }
}

export function evaluateInkPreflight(
  telemetry: PrinterTelemetry,
): InkPreflightEvaluation {
  const settings = getInkMonitoringSettings();
  if (!settings.enabled) {
    return {
      blocked: false,
      code: 'ink_monitoring_disabled',
      reason: null,
      telemetryAvailable: Boolean(telemetry.inkTelemetryAvailable),
      lowSupplies: [],
      emptySupplies: [],
    };
  }

  const meaningfulSupplies = telemetry.ink.filter(
    (entry) =>
      entry.level !== null ||
      entry.status === 'low' ||
      entry.status === 'empty',
  );
  const telemetryAvailable = Boolean(
    telemetry.inkTelemetryAvailable || meaningfulSupplies.length > 0,
  );

  const emptySupplies = meaningfulSupplies.filter(
    (entry) =>
      entry.status === 'empty' ||
      (typeof entry.level === 'number' && entry.level <= 0),
  );
  const lowSupplies = meaningfulSupplies.filter((entry) => {
    if (emptySupplies.includes(entry)) return false;
    if (entry.status === 'low') return true;
    return (
      typeof entry.level === 'number' &&
      entry.level <= settings.lowThresholdPercent
    );
  });

  const criticalSupplies = lowSupplies.filter(
    (entry) =>
      typeof entry.level === 'number' &&
      entry.level <= settings.criticalThresholdPercent,
  );

  if (!telemetryAvailable) {
    if (settings.telemetryUnknownPolicy === 'block') {
      return {
        blocked: true,
        code: 'telemetry_unknown_blocked',
        reason: telemetry.inkTelemetryReason ?? 'Ink telemetry is unavailable',
        telemetryAvailable: false,
        lowSupplies: [],
        emptySupplies: [],
      };
    }
    return {
      blocked: false,
      code: 'telemetry_unknown_allowed',
      reason: telemetry.inkTelemetryReason ?? 'Ink telemetry is unavailable',
      telemetryAvailable: false,
      lowSupplies: [],
      emptySupplies: [],
    };
  }

  if (settings.blockOnEmpty && emptySupplies.length > 0) {
    return {
      blocked: true,
      code: 'ink_empty_blocked',
      reason: `Ink empty: ${emptySupplies.map((s) => s.name).join(', ')}`,
      telemetryAvailable,
      lowSupplies,
      emptySupplies,
    };
  }

  if (settings.blockOnLow && lowSupplies.length > 0) {
    return {
      blocked: true,
      code: 'ink_low_blocked',
      reason:
        criticalSupplies.length > 0
          ? `Ink critically low: ${criticalSupplies.map((s) => s.name).join(', ')}`
          : `Ink low: ${lowSupplies.map((s) => s.name).join(', ')}`,
      telemetryAvailable,
      lowSupplies,
      emptySupplies,
    };
  }

  return {
    blocked: false,
    code: 'ok',
    reason: null,
    telemetryAvailable,
    lowSupplies,
    emptySupplies,
  };
}
