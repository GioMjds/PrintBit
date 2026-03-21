import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { isClamdReachable } from './clamd';
import {
  markWatchdogHeartbeat,
  setWatchdogComponentState,
} from './watchdog-health';

const CLAMD_EXE =
  process.env.CLAMD_EXE_PATH ?? 'C:\\Program Files\\ClamAV\\clamd.exe';

const STARTUP_POLL_INTERVAL_MS = 500;
const STARTUP_TIMEOUT_MS = 15_000;
const CLAMD_RESTART_BASE_MS = readPositiveIntEnv(
  'PRINTBIT_CLAMD_RESTART_BASE_MS',
  3_000,
);
const CLAMD_RESTART_MAX_MS = readPositiveIntEnv(
  'PRINTBIT_CLAMD_RESTART_MAX_MS',
  60_000,
);
const CLAMD_RESTART_MAX_ATTEMPTS = readNonNegativeIntEnv(
  'PRINTBIT_CLAMD_RESTART_MAX_ATTEMPTS',
  0,
);

let clamdProcess: ChildProcess | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;

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

function clearClamdReconnectTimer(): void {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function computeClamdReconnectDelay(attempt: number): number {
  const exponential = CLAMD_RESTART_BASE_MS * Math.pow(2, attempt - 1);
  return Math.min(CLAMD_RESTART_MAX_MS, Math.max(1_000, exponential));
}

function scheduleClamdRestart(reason: string): void {
  if (reconnectTimer) return;
  if (
    CLAMD_RESTART_MAX_ATTEMPTS > 0 &&
    reconnectAttempts >= CLAMD_RESTART_MAX_ATTEMPTS
  ) {
    const detail = `ClamAV restart limit reached (${CLAMD_RESTART_MAX_ATTEMPTS} attempts).`;
    console.error(`[CLAMD] ✗ ${detail}`);
    setWatchdogComponentState('clamd', 'unhealthy', detail, {
      reason,
      attempts: reconnectAttempts,
    });
    return;
  }

  reconnectAttempts += 1;
  const delayMs = computeClamdReconnectDelay(reconnectAttempts);
  setWatchdogComponentState(
    'clamd',
    'degraded',
    `ClamAV restart scheduled in ${delayMs}ms (attempt ${reconnectAttempts}).`,
    {
      reason,
      attempts: reconnectAttempts,
      delayMs,
    },
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startClamd().catch((error) => {
      console.error('[CLAMD] Failed during scheduled restart.', {
        error: error instanceof Error ? error.message : String(error),
      });
      scheduleClamdRestart('restart_failed');
    });
  }, delayMs);
}

function cleanupClamdProcess(reason: string): void {
  if (!clamdProcess) return;
  try {
    clamdProcess.removeAllListeners('error');
    clamdProcess.removeAllListeners('exit');
  } catch {
    // ignore listener cleanup failures
  }
  try {
    if (!clamdProcess.killed) {
      clamdProcess.kill();
    }
  } catch (error) {
    console.warn('[CLAMD] Failed to terminate stale process.', {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  clamdProcess = null;
}

export async function startClamd(): Promise<void> {
  // If already reachable (user started it manually), skip
  const reachable = await isClamdReachable();
  if (reachable) {
    console.log('[CLAMD] ✓ Already running — skipping auto-start');
    clearClamdReconnectTimer();
    reconnectAttempts = 0;
    markWatchdogHeartbeat('clamd', { reachable: true });
    setWatchdogComponentState('clamd', 'healthy', 'ClamAV daemon reachable.', {
      reachable: true,
    });
    return;
  }

  if (clamdProcess && !clamdProcess.killed) {
    console.warn(
      '[CLAMD] Existing clamd process is unreachable; replacing stale process.',
    );
    setWatchdogComponentState(
      'clamd',
      'degraded',
      'ClamAV process exists but is unreachable; restarting.',
      {
        reachable: false,
      },
    );
    cleanupClamdProcess('unreachable_existing_process');
  }

  if (!fs.existsSync(CLAMD_EXE)) {
    console.warn(`[CLAMD] ⚠ clamd.exe not found at: ${CLAMD_EXE}`);
    console.warn(
      '[CLAMD]   Set CLAMD_EXE_PATH in .env or start ClamAV manually',
    );
    setWatchdogComponentState(
      'clamd',
      'degraded',
      `clamd.exe not found at configured path: ${CLAMD_EXE}`,
      {
        reachable: false,
      },
    );
    return;
  }

  console.log(`[CLAMD] Starting clamd.exe from ${path.dirname(CLAMD_EXE)}...`);

  clamdProcess = spawn(CLAMD_EXE, [], {
    cwd: path.dirname(CLAMD_EXE),
    detached: false,
    windowsHide: true,
    stdio: 'ignore',
  });

  clamdProcess.on('error', (err) => {
    console.error(`[CLAMD] ✗ Failed to start: ${err.message}`);
    clamdProcess = null;
    setWatchdogComponentState('clamd', 'unhealthy', `Failed to start: ${err.message}`, {
      reachable: false,
    });
    scheduleClamdRestart('process_error');
  });

  clamdProcess.on('exit', (code) => {
    console.warn(`[CLAMD] Process exited with code ${code}`);
    clamdProcess = null;
    setWatchdogComponentState(
      'clamd',
      'degraded',
      `ClamAV process exited with code ${code ?? -1}.`,
      {
        reachable: false,
      },
    );
    scheduleClamdRestart('process_exit');
  });

  // Poll until reachable or timeout
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, STARTUP_POLL_INTERVAL_MS));
    if (await isClamdReachable()) {
      console.log('[CLAMD] ✓ Daemon is ready');
      clearClamdReconnectTimer();
      reconnectAttempts = 0;
      markWatchdogHeartbeat('clamd', { reachable: true });
      setWatchdogComponentState('clamd', 'healthy', 'ClamAV daemon ready.', {
        reachable: true,
      });
      return;
    }
  }

  console.warn(
    '[CLAMD] ⚠ Timed out waiting for daemon — uploads will be blocked until it responds',
  );
  setWatchdogComponentState(
    'clamd',
    'degraded',
    'Timed out waiting for ClamAV daemon readiness.',
    {
      reachable: false,
    },
  );
  scheduleClamdRestart('startup_timeout');
}

export function stopClamd(): void {
  clearClamdReconnectTimer();
  reconnectAttempts = 0;
  if (!clamdProcess) return;
  cleanupClamdProcess('stop_requested');
  console.log('[CLAMD] ✗ Stopped');
  setWatchdogComponentState('clamd', 'degraded', 'ClamAV daemon stopped.', {
    reachable: false,
  });
}
