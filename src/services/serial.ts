import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { db } from './db';
import { Server } from 'socket.io';
import { adminService } from './admin';
import { financialLedgerService } from './financial-ledger';
import {
  anomalyService,
  buildAnomalyFingerprint,
  mapHopperErrorSeverity,
} from './anomaly';
import {
  clearPrinterFaultLock,
  getPrinterFaultLock,
} from './printer-fault-lock';
import {
  parseHopperResponse,
  parseLegacyHopperResponse,
  type HopperResponse,
  type HopperErrorCodeValue,
  HopperErrorCode,
} from './hopper-protocol';
import { getPrinterTelemetry } from './printer-status';
import { BLOCKED_STATUSES } from '@/utils';
import { getTrustedTimeStatus } from './time-source';
import {
  markWatchdogHeartbeat,
  setWatchdogComponentState,
} from './watchdog-health';

const ACCEPTED_COINS = new Set([1, 5, 10, 20]);
const FRAGMENT_WINDOW_MS = 140;
const TELEMETRY_MAX_AGE_MS = 45_000;
const RETRY_INTERVAL_MS = 5_000;
const MAX_RETRIES = 12; // 60 seconds of retrying
const LEGACY_START_TIMEOUT_EXTENSION_MS = 20_000;
const SERIAL_RECONNECT_BASE_MS = readPositiveIntEnv(
  'PRINTBIT_SERIAL_RECONNECT_BASE_MS',
  2_000,
);
const SERIAL_RECONNECT_MAX_MS = readPositiveIntEnv(
  'PRINTBIT_SERIAL_RECONNECT_MAX_MS',
  30_000,
);
const SERIAL_RECONNECT_MAX_ATTEMPTS = readNonNegativeIntEnv(
  'PRINTBIT_SERIAL_RECONNECT_MAX_ATTEMPTS',
  0,
);
const SERIAL_PORT_HINT = process.env.PRINTBIT_SERIAL_PORT?.trim() || '';

let serialConnected = false;
let serialPortPath: string | null = null;
let serialLastError: string | null = null;
let activeSerialPort: SerialPort | null = null;
let socketIo: Server | null = null;
let coinSlotLocked: boolean = false;
let coinSlotLockOwnerId: string | null = null;

let hopperCommandPending = false;
let hopperLastError: string | null = null;
let hopperLastSuccessAt: string | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttemptCount = 0;
let reconnectReason: string | null = null;

export interface HopperCommandResult {
  ok: boolean;
  message: string;
  dispensedCoins?: number;
  errorCode?: HopperErrorCodeValue;
}

interface PendingHopperCommand {
  requestId: string;
  resolve: (result: HopperCommandResult) => void;
  timer: NodeJS.Timeout | null;
  sawLegacyStart: boolean;
}

let pendingHopperCommand: PendingHopperCommand | null = null;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function readNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function clearSerialReconnectTimer(): void {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function computeSerialReconnectDelayMs(attempt: number): number {
  const exponential = SERIAL_RECONNECT_BASE_MS * Math.pow(2, attempt - 1);
  return Math.min(SERIAL_RECONNECT_MAX_MS, Math.max(1_000, exponential));
}

function scheduleSerialReconnect(io: Server, reason: string): void {
  if (reconnectTimer) return;

  if (
    SERIAL_RECONNECT_MAX_ATTEMPTS > 0 &&
    reconnectAttemptCount >= SERIAL_RECONNECT_MAX_ATTEMPTS
  ) {
    const detail = `Serial reconnect limit reached (${SERIAL_RECONNECT_MAX_ATTEMPTS} attempts).`;
    setWatchdogComponentState('serial', 'unhealthy', detail, {
      connected: false,
      reason,
      attempts: reconnectAttemptCount,
    });
    console.error(`[SERIAL] ✗ ${detail}`);
    void anomalyService.report({
      type: 'serial_reconnect_exhausted',
      source: 'serial',
      category: 'serial',
      severity: 'critical',
      message: detail,
      fingerprint: buildAnomalyFingerprint([
        'serial',
        'reconnect-exhausted',
        String(SERIAL_RECONNECT_MAX_ATTEMPTS),
      ]),
      context: {
        attempts: reconnectAttemptCount,
        reason,
      },
    });
    return;
  }

  reconnectAttemptCount += 1;
  reconnectReason = reason;
  const delayMs = computeSerialReconnectDelayMs(reconnectAttemptCount);

  setWatchdogComponentState(
    'serial',
    'degraded',
    `Serial reconnect scheduled in ${delayMs}ms (attempt ${reconnectAttemptCount}).`,
    {
      connected: false,
      reason,
      attempts: reconnectAttemptCount,
      delayMs,
    },
  );
  console.warn(
    `[SERIAL] ⚠ Scheduling reconnect in ${delayMs}ms (attempt ${reconnectAttemptCount}, reason: ${reason})`,
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void attemptSerialConnection(io, 0, 'reconnect');
  }, delayMs);
}

function armPendingHopperTimeout(
  pending: PendingHopperCommand,
  timeoutMs: number,
): void {
  if (pending.timer) clearTimeout(pending.timer);
  pending.timer = setTimeout(() => {
    if (pendingHopperCommand !== pending) return;

    const startedWithoutDone = pending.sawLegacyStart;
    completePendingHopperCommand({
      ok: false,
      message: startedWithoutDone
        ? `Hopper started dispensing but no DONE signal was received within ${timeoutMs}ms.`
        : `Hopper timeout after ${timeoutMs}ms.`,
      errorCode: startedWithoutDone
        ? HopperErrorCode.SENSOR
        : HopperErrorCode.MOTOR_TIMEOUT,
    });
  }, timeoutMs);
}

export function getSerialStatus() {
  return {
    connected: serialConnected,
    portPath: serialPortPath,
    lastError: serialLastError,
  };
}

export function getHopperStatus() {
  return {
    connected: serialConnected,
    pending: hopperCommandPending,
    portPath: serialPortPath,
    lastError: hopperLastError,
    lastSuccessAt: hopperLastSuccessAt,
  };
}

export function lockCoinSlot(ownerId?: string): void {
  coinSlotLocked = true;
  coinSlotLockOwnerId = ownerId ?? null;
  console.log('[SERIAL] Coin slot locked - rejecting incoming coins.');
}

export function unlockCoinSlot(): void {
  coinSlotLocked = false;
  coinSlotLockOwnerId = null;
  console.log('[SERIAL] Coin slot unlocked - accepting incoming coins.');
}

export function isCoinSlotLocked(): boolean {
  return coinSlotLocked;
}

export function getCoinSlotLockOwnerId(): string | null {
  return coinSlotLockOwnerId;
}

export function unlockOwnedCoinSlot(ownerId: string): boolean {
  if (!coinSlotLocked) return false;
  if (!coinSlotLockOwnerId || coinSlotLockOwnerId !== ownerId) return false;
  unlockCoinSlot();
  return true;
}

function completePendingHopperCommand(result: HopperCommandResult): boolean {
  if (!pendingHopperCommand) return false;
  const pending = pendingHopperCommand;
  pendingHopperCommand = null;
  if (pending.timer) clearTimeout(pending.timer);
  hopperCommandPending = false;

  if (result.ok) {
    hopperLastError = null;
    hopperLastSuccessAt = new Date().toISOString();
  } else {
    hopperLastError = result.message;
    void anomalyService.report({
      type: 'hopper_command_failed',
      source: 'serial',
      category: 'hopper',
      severity: mapHopperErrorSeverity(result.errorCode),
      message: `Hopper command failed: ${result.message}`,
      fingerprint: buildAnomalyFingerprint([
        'hopper-command-failed',
        result.errorCode ?? 'unknown',
        result.message,
      ]),
      context: {
        errorCode: result.errorCode ?? null,
        message: result.message,
      },
    });
  }

  pending.resolve(result);
  return true;
}

function tryHandleHopperResponse(rawLine: string): boolean {
  const line = rawLine.trim();

  // ── Try structured protocol first ──────────────────────────────────────────
  const parsed = parseHopperResponse(line);
  if (parsed) {
    if (!pendingHopperCommand) {
      hopperLastError = `Unsolicited hopper response: ${line}`;
      console.warn(`[SERIAL] ⚠ ${hopperLastError}`);
      return true;
    }

    // Ignore responses for a different request ID
    if (parsed.requestId !== pendingHopperCommand.requestId) {
      console.warn(
        `[SERIAL] ⚠ Hopper response requestId mismatch: expected ${pendingHopperCommand.requestId}, got ${parsed.requestId}`,
      );
      return true;
    }

    return handleParsedResponse(parsed, line);
  }

  // ── Fall back to legacy format ("HOPPER OK" / "HOPPER ERROR …") ───────────
  const legacy = parseLegacyHopperResponse(line);
  if (legacy) {
    if (!pendingHopperCommand) {
      hopperLastError = `Unsolicited hopper response: ${line}`;
      console.warn(`[SERIAL] ⚠ ${hopperLastError}`);
      return true;
    }

    console.warn(
      `[SERIAL] ⚠ Legacy hopper response detected — consider upgrading Arduino firmware: "${line}"`,
    );
    completePendingHopperCommand(
      legacy.ok
        ? { ok: true, message: legacy.message }
        : { ok: false, message: legacy.message },
    );
    return true;
  }

  // ── Plain legacy firmware fallback ("START <n>" / "DONE" / "ERROR ...") ──
  // Some Arduino sketches don't include the "HOPPER" prefix. Treat these lines
  // as hopper traffic so they don't leak into the coin-token parser.
  const upper = line.toUpperCase();
  const looksLikePlainLegacy =
    upper === 'DONE' ||
    upper.startsWith('DONE ') ||
    upper === 'START' ||
    upper.startsWith('START ') ||
    upper.includes('ERROR') ||
    upper.includes('FAIL');
  if (looksLikePlainLegacy) {
    if (!pendingHopperCommand) {
      hopperLastError = `Unsolicited hopper response: ${line}`;
      console.warn(`[SERIAL] ⚠ ${hopperLastError}`);
      return true;
    }

    if (upper === 'DONE' || upper.startsWith('DONE ')) {
      completePendingHopperCommand({
        ok: true,
        message: line,
      });
      return true;
    }

    if (upper.includes('ERROR') || upper.includes('FAIL')) {
      completePendingHopperCommand({
        ok: false,
        message: line,
      });
      return true;
    }

    if (upper === 'START' || upper.startsWith('START ')) {
      const match = line.match(/(\d+)/);
      const total = match ? parseInt(match[1], 10) : 0;
      if (Number.isFinite(total) && total > 0) {
        socketIo?.emit('changeDispenseProgress', {
          dispensed: 0,
          total,
        });
      }
      pendingHopperCommand.sawLegacyStart = true;
      armPendingHopperTimeout(
        pendingHopperCommand,
        LEGACY_START_TIMEOUT_EXTENSION_MS,
      );
      console.log(`[SERIAL] Hopper legacy START received: ${line}`);
      return true;
    }
  }

  // Not a hopper message
  return false;
}

function handleParsedResponse(
  response: HopperResponse,
  rawLine: string,
): boolean {
  switch (response.kind) {
    case 'ACK':
      // Arduino acknowledged the command — keep waiting for DONE/ERR
      console.log(
        `[SERIAL] Hopper ACK received for request ${response.requestId}`,
      );
      return true;

    case 'PROGRESS':
      console.log(
        `[SERIAL] Hopper progress: ${response.dispensed}/${response.total} coins`,
      );
      socketIo?.emit('changeDispenseProgress', {
        dispensed: response.dispensed,
        total: response.total,
      });
      return true;

    case 'DONE':
      completePendingHopperCommand({
        ok: true,
        message: rawLine,
        dispensedCoins: response.dispensedCount,
      });
      return true;

    case 'ERR':
      completePendingHopperCommand({
        ok: false,
        message: `${response.code}: ${response.detail}`,
        errorCode: response.code,
      });
      return true;
  }
}

export async function sendHopperCommand(
  command: string,
  timeoutMs: number,
  requestId?: string,
): Promise<HopperCommandResult> {
  if (!serialConnected || !activeSerialPort) {
    return { ok: false, message: 'Serial port not connected.' };
  }

  if (pendingHopperCommand) {
    return { ok: false, message: 'Hopper command already in progress.' };
  }

  const normalizedTimeout = Number.isFinite(timeoutMs)
    ? Math.max(1000, Math.floor(timeoutMs))
    : 8000;

  return await new Promise<HopperCommandResult>((resolve) => {
    const pending: PendingHopperCommand = {
      requestId: requestId ?? '',
      resolve,
      timer: null,
      sawLegacyStart: false,
    };
    pendingHopperCommand = pending;
    armPendingHopperTimeout(pending, normalizedTimeout);
    hopperCommandPending = true;

    activeSerialPort!.write(`${command.trim()}\n`, (error) => {
      if (!error) return;
      completePendingHopperCommand({
        ok: false,
        message: error.message,
      });
    });
  });
}

export async function initSerial(io: Server) {
  socketIo = io;
  console.log('[SERIAL] ── Initializing serial connection ──────────────');
  setWatchdogComponentState(
    'serial',
    'degraded',
    'Initializing serial connection.',
    {
      connected: false,
    },
  );
  await attemptSerialConnection(io, 0, 'startup');
}

async function attemptSerialConnection(
  io: Server,
  attempt: number,
  connectionPhase: 'startup' | 'reconnect',
) {
  try {
    const ports = await SerialPort.list();

    if (attempt === 0) {
      console.log(`[SERIAL] Found ${ports.length} serial port(s):`);
      for (const p of ports) {
        console.log(
          `[SERIAL]   → ${p.path} (manufacturer: ${p.manufacturer ?? 'unknown'}, vendorId: ${p.vendorId ?? 'unknown'}, productId: ${p.productId ?? 'unknown'}, serialNumber: ${p.serialNumber ?? 'unknown'})`,
        );
      }
    }

    if (!ports.length) {
      serialConnected = false;
      serialPortPath = null;
      serialLastError = 'No serial ports found.';
      console.warn(
        '[SERIAL] ✗ No serial ports found. Continuing without serial connection.',
      );
      await anomalyService.report({
        type: 'serial_no_ports_found',
        source: 'serial',
        category: 'serial',
        severity: 'critical',
        message: 'No serial ports were found during initialization.',
        fingerprint: buildAnomalyFingerprint(['serial', 'no-ports']),
      });
      setWatchdogComponentState(
        'serial',
        'unhealthy',
        'No serial ports found.',
        {
          connected: false,
          reason: 'no_ports_found',
        },
      );
      scheduleSerialReconnect(io, 'no_ports_found');
      return;
    }

    const selectedPort =
      SERIAL_PORT_HINT.length > 0
        ? (ports.find((portInfo) =>
            portInfo.path
              .toLowerCase()
              .includes(SERIAL_PORT_HINT.toLowerCase()),
          ) ?? ports[0])
        : ports[0];
    const portPath = selectedPort.path;
    serialPortPath = portPath;
    console.log(
      `[SERIAL] Selected port: ${portPath} (baud: 115200)${attempt > 0 ? ` — retry #${attempt}` : ''}`,
    );

    await new Promise<void>((resolve, reject) => {
      const port = new SerialPort(
        {
          path: portPath,
          baudRate: 115200,
        },
        (err) => {
          if (err) return reject(err);
        },
      );
      activeSerialPort = port;

      const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

      port.on('open', () => {
        console.log(
          `[SERIAL] ✓ Port opened — Arduino connected on ${portPath}`,
        );
        serialConnected = true;
        serialLastError = null;
        clearSerialReconnectTimer();
        reconnectAttemptCount = 0;
        reconnectReason = null;
        markWatchdogHeartbeat('serial', {
          connected: true,
          portPath,
        });
        setWatchdogComponentState(
          'serial',
          'healthy',
          `Serial connected on ${portPath}.`,
          {
            connected: true,
            portPath,
          },
        );
        io.emit('serialStatus', getSerialStatus());
        resolve();
      });

      port.on('close', () => {
        console.log('[SERIAL] ✗ Port closed — Arduino disconnected');
        serialConnected = false;
        activeSerialPort = null;
        markWatchdogHeartbeat('serial', {
          connected: false,
          portPath: serialPortPath,
        });
        setWatchdogComponentState(
          'serial',
          'unhealthy',
          'Serial port closed unexpectedly.',
          {
            connected: false,
            portPath: serialPortPath,
          },
        );
        io.emit('serialStatus', getSerialStatus());
        void anomalyService.report({
          type: 'serial_port_closed',
          source: 'serial',
          category: 'serial',
          severity: 'critical',
          message: 'Serial port closed unexpectedly.',
          fingerprint: buildAnomalyFingerprint([
            'serial',
            'port-closed',
            serialPortPath ?? 'unknown',
          ]),
          context: {
            portPath: serialPortPath,
          },
        });
        completePendingHopperCommand({
          ok: false,
          message: 'Serial port closed during hopper command.',
        });
        scheduleSerialReconnect(io, 'port_closed');
      });

      port.on('error', (error) => {
        serialConnected = false;
        serialLastError = error.message;
        activeSerialPort = null;
        markWatchdogHeartbeat('serial', {
          connected: false,
          portPath: serialPortPath,
        });
        setWatchdogComponentState(
          'serial',
          'unhealthy',
          `Serial error: ${error.message}`,
          {
            connected: false,
            portPath: serialPortPath,
            error: error.message,
          },
        );
        io.emit('serialStatus', getSerialStatus());
        console.error('[SERIAL] ✗ Port error:', error.message);
        void anomalyService.report({
          type: 'serial_port_error',
          source: 'serial',
          category: 'serial',
          severity: 'critical',
          message: `Serial port error: ${error.message}`,
          fingerprint: buildAnomalyFingerprint([
            'serial',
            'port-error',
            serialPortPath ?? 'unknown',
            error.message,
          ]),
          context: {
            portPath: serialPortPath,
            error: error.message,
          },
        });
        completePendingHopperCommand({
          ok: false,
          message: `Serial error: ${error.message}`,
        });
        scheduleSerialReconnect(io, 'port_error');
      });

      let pendingPrefix: '1' | '2' | null = null;
      let pendingTimer: NodeJS.Timeout | null = null;

      const clearPending = () => {
        if (pendingTimer) clearTimeout(pendingTimer);
        pendingPrefix = null;
        pendingTimer = null;
      };

      const persistBalance = async (coinValue: number) => {
        db.data!.balance += coinValue;
        await adminService.incrementCoinStats(coinValue);
        await adminService.appendAdminLog(
          'coin_accepted',
          `Accepted coin: ${coinValue}`,
          {
            coinValue,
            balance: db.data!.balance,
          },
        );
        await financialLedgerService.append({
          eventType: 'coin_inserted',
          amount: coinValue,
          meta: {
            source: 'serial',
            balance: db.data!.balance,
          },
        });
        console.log(
          `[SERIAL] ✓ Coin accepted: ₱${coinValue} → new balance: ₱${db.data!.balance}`,
        );
        io.emit('balance', db.data!.balance);
        io.emit('coinAccepted', {
          value: coinValue,
          balance: db.data!.balance,
        });
      };

      const getPrinterAvailability = () => {
        const telemetry = getPrinterTelemetry();
        const checkedAtMs = Date.parse(telemetry.lastCheckedAt);
        const telemetryStale =
          !Number.isFinite(checkedAtMs) ||
          Date.now() - checkedAtMs > TELEMETRY_MAX_AGE_MS;
        const printerStatusBlocked = BLOCKED_STATUSES.has(telemetry.status);
        const faultLock = getPrinterFaultLock();

        if (faultLock.active) {
          const recovered =
            !telemetryStale && telemetry.connected && !printerStatusBlocked;
          if (recovered) {
            clearPrinterFaultLock();
          } else {
            const reason = faultLock.status
              ? `Printer fault lock active: ${faultLock.status}`
              : `Printer fault lock active: ${faultLock.reason ?? 'Unknown fault'}`;
            return {
              telemetry,
              printerBlocked: true,
              reason,
              faultLock,
            };
          }
        }

        const printerBlocked =
          telemetryStale || !telemetry.connected || printerStatusBlocked;

        const reason = telemetryStale
          ? 'Printer telemetry is stale'
          : !telemetry.connected
            ? 'Printer not connected'
            : `Printer status: ${telemetry.status}`;

        return {
          telemetry,
          printerBlocked,
          reason,
          faultLock: null,
        };
      };

      const rejectCoinCredit = (
        token: string,
        value: number,
        reason: string,
        telemetry: ReturnType<typeof getPrinterTelemetry>,
        faultLock: ReturnType<typeof getPrinterFaultLock> | null,
      ) => {
        console.warn(
          `[SERIAL] ⚠ Coin rejected — printer unavailable (${reason}). Token: "${token}"`,
        );

        io.emit('coinRejected', {
          value: value > 0 ? value : null,
          reason,
          printerStatus: telemetry.status,
          telemetryLastCheckedAt: telemetry.lastCheckedAt,
          faultLock: faultLock
            ? {
                source: faultLock.source,
                reason: faultLock.reason,
                status: faultLock.status,
                lockedAt: faultLock.lockedAt,
              }
            : null,
        });

        void adminService.appendAdminLog(
          'coin_rejected_printer_unavailable',
          `Coin rejected: printer unavailable (${reason}).`,
          {
            token,
            coinValue: value > 0 ? value : null,
            printerStatus: telemetry.status,
            printerConnected: telemetry.connected,
            telemetryLastCheckedAt: telemetry.lastCheckedAt,
            faultLockSource: faultLock?.source ?? null,
            faultLockReason: faultLock?.reason ?? null,
            faultLockStatus: faultLock?.status ?? null,
          },
        );

        clearPending();
      };

      const creditResolvedCoin = async (coinValue: number, token: string) => {
        if (coinSlotLocked) {
          console.warn(
            `[SERIAL] ⚠ Coin rejected — slot is locked (balance sufficient). Token: "${token}"`,
          );
          socketIo?.emit('coinRejected', {
            value: coinValue,
            reason: 'slot_locked',
            printerStatus: null,
            telemetryLastCheckedAt: null,
            faultLock: null,
          });
          return;
        }

        const { telemetry, printerBlocked, reason, faultLock } =
          getPrinterAvailability();
        if (printerBlocked) {
          rejectCoinCredit(token, coinValue, reason, telemetry, faultLock);
          return;
        }

        const trustedTime = getTrustedTimeStatus();
        if (
          trustedTime.enforceForFinancial &&
          (!trustedTime.synced ||
            trustedTime.offsetMs === null ||
            trustedTime.driftExceeded)
        ) {
          void adminService.appendAdminLog(
            'coin_accepted_trusted_time_unsynced',
            'Coin accepted while trusted time is unsynchronized.',
            {
              token,
              coinValue,
              detail: trustedTime.detail,
              source: trustedTime.source,
              offsetMs: trustedTime.offsetMs,
              driftExceeded: trustedTime.driftExceeded,
              checkedAt: trustedTime.checkedAt,
            },
          );
        }

        await persistBalance(coinValue);
      };

      const flushPending = async (reason: 'timeout' | 'interrupted') => {
        if (!pendingPrefix) return;
        const prefix = pendingPrefix;
        console.log(
          `[SERIAL] Flushing pending "${prefix}" (reason: ${reason})`,
        );
        clearPending();

        if (prefix === '1') {
          await creditResolvedCoin(1, prefix);
          return;
        }

        io.emit('coinParserWarning', {
          code: 'INVALID_FRAGMENT',
          message: `Ignored fragment '${prefix}' (${reason}).`,
        });
        void adminService.appendAdminLog(
          'coin_parser_warning',
          `Ignored fragment '${prefix}' (${reason}).`,
          { reason },
        );
      };

      const armPending = (prefix: '1' | '2') => {
        console.log(
          `[SERIAL] Pending fragment: "${prefix}" (waiting ${FRAGMENT_WINDOW_MS}ms)`,
        );
        clearPending();
        pendingPrefix = prefix;
        pendingTimer = setTimeout(() => {
          void flushPending('timeout');
        }, FRAGMENT_WINDOW_MS);
      };

      const processToken = async (token: string) => {
        try {
          console.log(`[SERIAL] Token: "${token}"`);
          if (pendingPrefix) {
            if (token === '0') {
              const combined = Number(`${pendingPrefix}${token}`);
              clearPending();
              if (ACCEPTED_COINS.has(combined)) {
                await creditResolvedCoin(combined, `${pendingPrefix}${token}`);
              } else {
                io.emit('coinParserWarning', {
                  code: 'INVALID_COMBINATION',
                  message: `Ignored invalid coin '${combined}'.`,
                });
                void adminService.appendAdminLog(
                  'coin_parser_warning',
                  `Ignored invalid coin '${combined}'.`,
                  { combined },
                );
              }
              return;
            }

            await flushPending('interrupted');
          }

          if (token === '1' || token === '2') {
            armPending(token);
            return;
          }

          const value = Number(token);
          if (!Number.isInteger(value)) {
            io.emit('coinParserWarning', {
              code: 'NON_NUMERIC',
              message: `Ignored serial token '${token}'.`,
            });
            void adminService.appendAdminLog(
              'coin_parser_warning',
              `Ignored non-numeric serial token '${token}'.`,
              { token },
            );
            return;
          }

          if (!ACCEPTED_COINS.has(value)) {
            io.emit('coinParserWarning', {
              code: 'UNSUPPORTED_COIN',
              message: `Ignored unsupported coin '${value}'.`,
            });
            void adminService.appendAdminLog(
              'coin_parser_warning',
              `Ignored unsupported coin '${value}'.`,
              { value },
            );
            return;
          }

          await creditResolvedCoin(value, token);
        } catch (error) {
          clearPending();
          console.error('[SERIAL] Failed to process coin token.', {
            token,
            error: error instanceof Error ? error.message : String(error),
          });
          void adminService.appendAdminLog(
            'coin_parser_warning',
            'Coin token processing failed due to an unexpected error.',
            {
              token,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      };

      parser.on('data', (rawLine: string) => {
        markWatchdogHeartbeat('serial', {
          connected: serialConnected,
          portPath: serialPortPath,
        });
        const token = rawLine.trim();
        if (token.length === 0) return;

        if (token.startsWith('[')) {
          console.log(`[SERIAL] Device message: "${token}"`);
          return;
        }

        if (tryHandleHopperResponse(rawLine)) return;

        console.log(`[SERIAL] Raw data: "${rawLine}"`);
        if (!/^\d+$/.test(token)) return;
        void processToken(token);
      });
    });

    console.log(`[SERIAL] ✓ Serial port initialized on ${portPath}`);
    void adminService.appendAdminLog(
      'serial_connected',
      `Serial port initialized on ${portPath}`,
      {
        portPath,
      },
    );
  } catch (error) {
    serialConnected = false;
    serialLastError =
      error instanceof Error ? error.message : 'Unknown serial error.';

    const isAccessDenied = serialLastError
      .toLowerCase()
      .includes('access denied');

    if (isAccessDenied && attempt < MAX_RETRIES) {
      console.warn(
        `[SERIAL] ⚠ Port access denied — retrying in ${RETRY_INTERVAL_MS / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES}). Close Arduino IDE Serial Monitor if open.`,
      );
      setTimeout(
        () => void attemptSerialConnection(io, attempt + 1, connectionPhase),
        RETRY_INTERVAL_MS,
      );
      return;
    }

    console.error('[SERIAL] ✗ Init error:', serialLastError);
    if (isAccessDenied) {
      console.error(
        '[SERIAL] ✗ Gave up after retries. Close Arduino IDE Serial Monitor or any app using the port, then restart the server.',
      );
    }
    void adminService.appendAdminLog(
      'serial_init_error',
      'Error initializing serial port. Continuing without serial connection.',
      { message: serialLastError },
    );
    await anomalyService.report({
      type: 'serial_init_error',
      source: 'serial',
      category: 'serial',
      severity: 'critical',
      message: `Error initializing serial port: ${serialLastError}`,
      fingerprint: buildAnomalyFingerprint([
        'serial',
        'init-error',
        serialLastError,
      ]),
      context: {
        message: serialLastError,
      },
    });
    setWatchdogComponentState(
      'serial',
      'unhealthy',
      `Serial init error: ${serialLastError}`,
      {
        connected: false,
        error: serialLastError,
        phase: connectionPhase,
        accessDenied: isAccessDenied,
      },
    );
    const reason = isAccessDenied ? 'access_denied' : 'init_error';
    scheduleSerialReconnect(io, reason);
  }
}

class SerialService {
  getStatus() {
    return getSerialStatus();
  }

  getHopperStatus() {
    return getHopperStatus();
  }

  async sendHopperCommand(
    command: string,
    timeoutMs: number,
    requestId?: string,
  ): Promise<HopperCommandResult> {
    return sendHopperCommand(command, timeoutMs, requestId);
  }

  async init(io: Server): Promise<void> {
    return initSerial(io);
  }
}

export const serialService = new SerialService();
