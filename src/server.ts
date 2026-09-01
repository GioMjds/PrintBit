import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'node:path';
import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import {
  PORT,
  PUBLIC_DIR,
  UPLOAD_DIR,
  CAPTIVE_PORTAL_ENABLED,
  SESSION_EXPIRY_ENABLED,
  WORKER_RETURN_PIPE_NAME,
  WORKER_RETURN_MAX_BYTES,
} from '@/config';
import {
  createCaptivePortalMiddleware,
  createCsrfProtectionMiddleware,
} from '@/middleware';
import { kioskAccessService } from '@/middleware/kiosk-access';
import {
  canControlCoinSlot,
  canJoinSessionRoom,
  installSocketAccessMiddleware,
  type SocketPrincipal,
} from '@/middleware/socket-access';
import { registerAppModules } from '@/app.module';
import { getJobProcessor } from '@/modules/print-queue';
import {
  initDB,
  assertPrintDispatcherReady,
  detectDefaultPrinter,
  detectScanner,
  startScanStorageCleanup,
  cleanupTransientFilesOnStartup,
  convertToPdfPreview,
  getHopperStatus,
  getSerialStatus,
  initSerial,
  isHotspotRunning,
  startHotspot,
  SessionStore,
  resolvePublicBaseUrl,
  runHopperSelfTest,
  startPrinterMonitor,
  anomalyService,
  adminService,
  startTrustedTimeMonitor,
  stopTrustedTimeMonitor,
  verifyTrustedClockSync,
  getPrinterTelemetry,
  startWatchdogHealthMonitor,
  stopWatchdogHealthMonitor,
  warmPrintDispatcherProfile,
  warmPrinterEdgeRunspace,
  isCoinSlotLocked,
  getCoinSlotLockOwnerId,
  getCoinSlotLockedAt,
  lockCoinSlot,
  unlockOwnedCoinSlot,
  markRecoveryShutdown,
  markRecoveryStartup,
  reconcileRecoverySessionsOnStartup,
  getRecoveryStatusSnapshot,
} from '@/services';
import { buildAnomalyFingerprint } from '@/services/anomaly';
import {
  startWorkerReturnPipeServer,
  mapWorkerEventToSocket,
} from '@/services/worker-return-pipe';
import { handleWorkerReturnPrintEvent } from '@/services/worker-print-lifecycle';
import {
  powerSafetyService,
  type WorkerPowerEvent,
} from '@/services/power-safety';
import { getLocalIPv4 } from '@/utils/network';
import { validateAdminSession } from '@/utils/admin-session';

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const sessionIo = io.of('/session');

type StartupPhase = 'booting' | 'ready' | 'failed';

interface StartupReadinessState {
  phase: StartupPhase;
  startedAt: string;
  readyAt: string | null;
  failedAt: string | null;
  message: string | null;
}

const STARTUP_POLL_INTERVAL_MS = 1_500;

const startupReadinessState: StartupReadinessState = {
  phase: 'booting',
  startedAt: new Date().toISOString(),
  readyAt: null,
  failedAt: null,
  message: 'Starting PrintBit services…',
};

function markStartupReady(): void {
  startupReadinessState.phase = 'ready';
  startupReadinessState.readyAt = new Date().toISOString();
  startupReadinessState.failedAt = null;
  startupReadinessState.message = null;
}

/**
 * Translates the worker's generic `PrinterError` message into a specific
 * `PrintError` payload that the confirm page can act on. The worker emits a
 * `DetectedErrorState` from WMI (1–11) inside a parenthesised segment of the
 * message, e.g. "(No Paper, code 4)". Without this translation the modal
 * would always render as `PRINTER_HARDWARE_ERROR` (fatal) and never expose
 * the Pause/Resume controls — even when the underlying condition is
 * recoverable (paper-out, paper-jam). Returns a fatal-staff-help payload
 * when the message can't be classified.
 */
function translateHardwarePrinterError(message: string | null): {
  code: string;
  severity: 'warning' | 'recoverable' | 'fatal';
  userMessage: string;
  canRetry: boolean;
  canDismiss: boolean;
} {
  const lower = (message ?? '').toLowerCase();
  if (
    lower.includes('no paper') ||
    lower.includes('low paper') ||
    lower.includes('paper_out') ||
    lower.includes('paper out')
  ) {
    return {
      code: 'PAPER_TRAY_EMPTY',
      severity: 'recoverable',
      userMessage:
        'Printer Out of Paper. Please load paper and click Resume.',
      canRetry: true,
      canDismiss: false,
    };
  }
  if (
    lower.includes('jammed') ||
    lower.includes('paper_jam') ||
    lower.includes('paper jam')
  ) {
    return {
      code: 'PAPER_JAM_PRINT',
      severity: 'recoverable',
      userMessage:
        'Paper jam detected. Clear the jam and click Resume to continue.',
      canRetry: true,
      canDismiss: false,
    };
  }
  if (
    lower.includes('door open') ||
    lower.includes('door_open') ||
    lower.includes('cover open')
  ) {
    return {
      code: 'PRINTER_DOOR_OPEN',
      severity: 'recoverable',
      userMessage:
        'Printer door or cover is open. Please close the cover and click Resume.',
      canRetry: true,
      canDismiss: false,
    };
  }
  if (
    lower.includes('paper_problem') ||
    lower.includes('paper problem')
  ) {
    return {
      code: 'PAPER_INSUFFICIENT_PRE_DISPATCH',
      severity: 'recoverable',
      userMessage:
        'Paper feed problem detected. Please check the paper tray and click Resume.',
      canRetry: true,
      canDismiss: false,
    };
  }
  if (
    lower.includes('output_bin_full') ||
    lower.includes('output bin full')
  ) {
    return {
      code: 'OUTPUT_BIN_FULL',
      severity: 'recoverable',
      userMessage:
        'The printer output tray is full. Please remove printed pages and click Resume.',
      canRetry: true,
      canDismiss: false,
    };
  }
  if (
    lower.includes('no toner') ||
    lower.includes('low toner') ||
    lower.includes('no_toner')
  ) {
    return {
      code: 'PRINTER_OUT_OF_TONER',
      severity: 'fatal',
      userMessage:
        'The printer is out of toner. Please ask staff to replace the cartridge.',
      canRetry: false,
      canDismiss: false,
    };
  }
  if (
    lower.includes('offline') ||
    lower.includes('not available') ||
    lower.includes('stopped printing') ||
    lower.includes('not found')
  ) {
    return {
      code: 'PRINTER_OFFLINE',
      severity: 'fatal',
      userMessage:
        'The printer is offline or not found. Please check printer power and USB connection.',
      canRetry: false,
      canDismiss: false,
    };
  }
  return {
    code: 'PRINTER_HARDWARE_ERROR',
    severity: 'fatal',
    userMessage:
      'The printer reported a hardware error. Please ask staff for help.',
    canRetry: false,
    canDismiss: false,
  };
}

function markStartupFailed(message: string): void {
  startupReadinessState.phase = 'failed';
  startupReadinessState.failedAt = new Date().toISOString();
  startupReadinessState.message = message;
}

function getStartupReadinessSnapshot() {
  return {
    ready: startupReadinessState.phase === 'ready',
    phase: startupReadinessState.phase,
    startedAt: startupReadinessState.startedAt,
    readyAt: startupReadinessState.readyAt,
    failedAt: startupReadinessState.failedAt,
    message: startupReadinessState.message,
    retryAfterMs:
      startupReadinessState.phase === 'failed'
        ? Math.max(STARTUP_POLL_INTERVAL_MS, 5_000)
        : STARTUP_POLL_INTERVAL_MS,
  };
}

app.get('/loading', (_req, res) => {
  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate',
  );
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.resolve(PUBLIC_DIR, 'loading', 'index.html'));
});

app.get('/api/startup/ready', (_req, res) => {
  const snapshot = getStartupReadinessSnapshot();
  const statusCode = snapshot.ready ? 200 : 503;
  res.status(statusCode).json(snapshot);
});

app.get('/api/power-safety/status', (_req, res) => {
  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate',
  );
  res.json(powerSafetyService.getEffectiveEvent());
});

app.use(cookieParser());

const sessionStore = new SessionStore(UPLOAD_DIR, {
  expiryEnabled: SESSION_EXPIRY_ENABLED,
});

installSocketAccessMiddleware(io, sessionIo, {
  isKioskCredential: (credential) =>
    kioskAccessService.isKioskCredential(credential),
  isLoopbackAddress: (address) => {
    if (!address) return false;
    const ip = address.startsWith('::ffff:') ? address.slice(7) : address;
    return (
      ip === '127.0.0.1' ||
      ip === '::1' ||
      ip === 'localhost'
    );
  },
  isAdminSession: validateAdminSession,
  claimSessionOwner: (sessionId, token, clientId) =>
    sessionStore.claimOwner(sessionId, token, clientId).ok,
});

sessionIo.on('connection', (socket) => {
  const principal = socket.data.principal as SocketPrincipal | undefined;
  if (principal?.kind !== 'session') {
    socket.disconnect(true);
    return;
  }

  socket.join(`session:${principal.sessionId}`);
});

app.use(express.json());
app.use(createCsrfProtectionMiddleware());

// Captive-portal middleware — fallback for direct captive probes on port 3000
if (CAPTIVE_PORTAL_ENABLED) {
  app.use(createCaptivePortalMiddleware());
}

registerAppModules(app, {
  io,
  sessionIo,
  sessionStore,
  uploadDir: UPLOAD_DIR,
  getSerialStatus,
  getHopperStatus,
  runHopperSelfTest: async () => {
    const result = await runHopperSelfTest();
    return {
      ...result,
      amount: result.dispensedCoins,
    };
  },
  resolvePublicBaseUrl,
  convertToPdfPreview,
});

io.on('connection', (socket) => {
  const principal = socket.data.principal as SocketPrincipal | undefined;
  if (!principal) {
    socket.disconnect(true);
    return;
  }

  const locked = isCoinSlotLocked();
  const ownerId = getCoinSlotLockOwnerId();
  if (locked) {
    socket.emit('coinSlotLocked', {
      lockedAt: getCoinSlotLockedAt() ?? new Date().toISOString(),
      ownerId,
    });
  }

  socket.emit(
    'workerPowerStatusChanged',
    powerSafetyService.getEffectiveEvent(),
  );

  socket.on('joinSession', (sessionId: string) => {
    if (
      !canJoinSessionRoom(principal, sessionId) ||
      sessionStore.getSessionState(sessionId) !== 'active'
    ) {
      socket.emit('sessionJoinDenied', { reason: 'unauthorized_session' });
      return;
    }
    socket.join(`session:${sessionId}`);
  });

  socket.on('lockCoinSlot', () => {
    if (!canControlCoinSlot(principal)) {
      socket.emit('coinSlotLockDenied', { reason: 'unauthorized_socket' });
      return;
    }
    const currentOwnerId = getCoinSlotLockOwnerId();
    if (
      isCoinSlotLocked() &&
      currentOwnerId &&
      currentOwnerId !== socket.id &&
      currentOwnerId !== 'power-safety'
    ) {
      socket.emit('coinSlotLockDenied', {
        reason: 'lock_owned_by_another_socket',
      });
      return;
    }

    lockCoinSlot(socket.id);
    io.emit('coinSlotLocked', {
      lockedAt: new Date().toISOString(),
      ownerId: socket.id,
    });
  });

  socket.on('unlockCoinSlot', () => {
    if (!canControlCoinSlot(principal)) {
      socket.emit('coinSlotUnlockDenied', { reason: 'unauthorized_socket' });
      return;
    }
    const unlocked = unlockOwnedCoinSlot(socket.id);
    if (!unlocked) {
      socket.emit('coinSlotUnlockDenied', {
        reason: 'lock_owned_by_another_socket',
      });
      return;
    }
    io.emit('coinSlotUnlocked', { reason: 'client_request' });
  });

  socket.on('disconnect', () => {
    if (!canControlCoinSlot(principal)) return;
    const unlocked = unlockOwnedCoinSlot(socket.id);
    if (!unlocked) return;
    io.emit('coinSlotUnlocked', { reason: 'owner_disconnect' });
  });
});

async function start() {
  await new Promise<void>((resolve, reject) => {
    server.listen(PORT, '0.0.0.0', () => {
      const localIP = getLocalIPv4();
      if (localIP) {
        console.log(`→ Network: http://${localIP}:${PORT}`);
      } else {
        console.log('→ Network IP not detected');
      }
      resolve();
    });
    server.once('error', reject);
  });

  try {
    await initDB();

    // Capture the handle so we can await readiness before continuing startup.
    // This guarantees the named pipe is open and accepting connections from
    // the C# worker before any downstream service tries to use it.
    const workerReturnPipe = startWorkerReturnPipeServer({
      pipeName: WORKER_RETURN_PIPE_NAME,
      maxBytes: WORKER_RETURN_MAX_BYTES,
      onEvent: (evt) => {
        if (
          evt.type === 'PowerStatusChanged' ||
          evt.type === 'PowerStatusSnapshot'
        ) {
          powerSafetyService.applyWorkerPowerEvent(evt as WorkerPowerEvent);
        }

        const mapped = mapWorkerEventToSocket(evt);
        if (mapped.event === 'workerPowerStatusChanged') {
          io.emit(
            'workerPowerStatusChanged',
            powerSafetyService.getEffectiveEvent(),
          );
        } else {
          io.emit(mapped.event, mapped.payload);
        }

        if (evt.type === 'PrinterOffline') {
          io.emit('printerMalfunction', {
            printError: {
              code: 'PRINTER_OFFLINE',
              severity: 'fatal',
              userMessage:
                'The printer is offline. Please check the connection.',
              hint: evt.message ?? null,
              canRetry: false,
              canDismiss: false,
            },
          });
        }

        if (evt.type === 'PrinterOnline') {
          io.emit('printerStatusRestored', {
            printerName: evt.printerName ?? null,
            timestamp: evt.timestampUtc,
          });
        }

        // Hardware errors are distinct from offline/online transitions: the
        // printer is reachable but WMI reports a non-zero DetectedErrorState
        // (paper jam, ink empty, door open, etc.).  Emit a dedicated
        // printerMalfunction so the UI can surface the right message.
        //
        // We translate the worker's generic `PrinterError` message into a
        // more specific code/severity so the confirm page can offer
        // Pause/Resume for paper-related conditions (the kiosk's primary
        // recovery action) instead of always showing a fatal-staff-help
        // modal. The worker formats the message as:
        //   "Printer hardware error detected (<Description>, code <N>). ..."
        if (evt.type === 'PrinterError') {
          const translated = translateHardwarePrinterError(evt.message ?? null);
          io.emit('printerMalfunction', {
            printError: {
              code: translated.code,
              severity: translated.severity,
              userMessage: translated.userMessage,
              hint: evt.message ?? null,
              canRetry: translated.canRetry,
              canDismiss: translated.canDismiss,
            },
          });
        }

        void handleWorkerReturnPrintEvent({
          evt,
          io,
          sessionStore,
        }).catch((error) => {
          console.error(
            '[WORKER_RETURN_PIPE] Failed to process worker event.',
            {
              error: error instanceof Error ? error.message : String(error),
              eventType: evt.type,
              transactionId: evt.transactionId ?? null,
            },
          );
        });
      },
    });

    // Block until the named pipe is listening.  If the bind fails (e.g. the
    // pipe is already held by a stale process) this throws and startup is
    // marked failed — preventing the kiosk from running without a working IPC
    // channel to the C# hardware service.
    await workerReturnPipe.ready;

    const startupMarker = await markRecoveryStartup('server_start');
    const startupTrustedTime = await verifyTrustedClockSync();
    const recoverySummary = await reconcileRecoverySessionsOnStartup();
    const recoveryStatus = getRecoveryStatusSnapshot();
    if (
      startupMarker.unexpectedRestart ||
      recoverySummary.processedSessions > 0
    ) {
      void adminService
        .appendAdminLog(
          startupMarker.unexpectedRestart
            ? 'unexpected_restart_detected'
            : 'startup_reconciliation_completed',
          startupMarker.unexpectedRestart
            ? 'Unplanned restart detected during startup; recovery reconciliation executed.'
            : 'Startup recovery reconciliation executed.',
          {
            unexpectedRestart: startupMarker.unexpectedRestart,
            processedSessions: recoverySummary.processedSessions,
            resolvedSessions: recoverySummary.resolvedSessions,
            unresolvedSessions: recoverySummary.unresolvedSessions,
            autoRefundedSessions: recoverySummary.autoRefundedSessions,
            pendingAdminReviewSessions:
              recoverySummary.pendingAdminReviewSessions,
            trustedTimeBlockedSessions:
              recoverySummary.trustedTimeBlockedSessions,
            bootCount: recoveryStatus.lifecycle.bootCount,
            unexpectedRestartCount:
              recoveryStatus.lifecycle.unexpectedRestartCount,
          },
        )
        .catch((error) => {
          console.error(
            '[RECOVERY] Failed to append startup recovery admin log.',
            {
              error: error instanceof Error ? error.message : String(error),
            },
          );
        });
    }
    if (startupMarker.unexpectedRestart) {
      void anomalyService
        .report({
          type: 'unexpected_restart_detected',
          source: 'recovery',
          category: 'security',
          severity: 'critical',
          message:
            'Unplanned restart detected. Startup recovery reconciliation has been executed.',
          fingerprint: buildAnomalyFingerprint([
            'recovery',
            'unexpected-restart',
          ]),
          context: {
            processedSessions: recoverySummary.processedSessions,
            unresolvedSessions: recoverySummary.unresolvedSessions,
            autoRefundedSessions: recoverySummary.autoRefundedSessions,
            pendingAdminReviewSessions:
              recoverySummary.pendingAdminReviewSessions,
          },
        })
        .catch((error) => {
          console.error(
            '[RECOVERY] Failed to report unexpected restart anomaly.',
            {
              error: error instanceof Error ? error.message : String(error),
            },
          );
        });
    }
    const startupBlocked =
      startupTrustedTime.enforceForFinancial &&
      (!startupTrustedTime.synced ||
        startupTrustedTime.offsetMs === null ||
        startupTrustedTime.driftExceeded);
    void adminService
      .appendAdminLog(
        startupBlocked ? 'trusted_time_unsynced' : 'trusted_time_synced',
        startupBlocked
          ? 'Trusted time unavailable at startup. Financial operations are blocked until synchronization recovers.'
          : 'Trusted time verified at startup.',
        {
          synced: startupTrustedTime.synced,
          offsetMs: startupTrustedTime.offsetMs,
          driftExceeded: startupTrustedTime.driftExceeded,
          maxDriftMs: startupTrustedTime.maxDriftMs,
          source: startupTrustedTime.source,
          enforceForFinancial: startupTrustedTime.enforceForFinancial,
          detail: startupTrustedTime.detail,
          ntpSource: startupTrustedTime.ntpSource,
        },
      )
      .catch((error) => {
        console.error(
          '[TIME] Failed to append startup trusted-time admin log.',
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
      });
    if (startupBlocked) {
      void anomalyService
        .report({
          type: 'trusted_time_unsynced',
          source: 'time-sync',
          category: 'network',
          severity: 'critical',
          message:
            'Trusted time verification failed. Financial operations are blocked until synchronization recovers.',
          fingerprint: buildAnomalyFingerprint([
            'time-sync',
            'trusted-time-unsynced',
          ]),
          context: {
            offsetMs: startupTrustedTime.offsetMs,
            driftExceeded: startupTrustedTime.driftExceeded,
            maxDriftMs: startupTrustedTime.maxDriftMs,
            detail: startupTrustedTime.detail,
          },
        })
        .catch((error) => {
          console.error(
            '[TIME] Failed to report startup trusted-time anomaly.',
            {
              error: error instanceof Error ? error.message : String(error),
            },
          );
        });
    }
    const jobProcessor = getJobProcessor();
    jobProcessor.setIo(io);
    await jobProcessor.init();

    // Run independent hardware and network subsystem probes concurrently to minimize startup latency
    await Promise.allSettled([
      (async () => {
        await detectDefaultPrinter();
        await assertPrintDispatcherReady();
        await warmPrintDispatcherProfile();
        void warmPrinterEdgeRunspace().catch((error: unknown) => {
          console.error(
            '[SERVER] Failed to warm printer-edge PowerShell runspace.',
            error instanceof Error ? error.message : String(error),
          );
        });
      })(),
      (async () => {
        await detectScanner();
        await cleanupTransientFilesOnStartup(UPLOAD_DIR).catch((error) => {
          console.error(
            '[STARTUP] Failed to clean up transient files on startup.',
            {
              uploadDir: UPLOAD_DIR,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        });
        startScanStorageCleanup();
      })(),
      (async () => {
        await initSerial(io);
        await runHopperSelfTest();
      })(),
      startHotspot(),
    ]);

    startPrinterMonitor(io);
    startWatchdogHealthMonitor({
      getSerialStatus,
      getPrinterTelemetry,
      isHotspotRunning,
    });
    anomalyService.setSocketIo(io);
    let trustedTimeBlocked = startupBlocked;
    startTrustedTimeMonitor(async (status) => {
      const blocked =
        status.enforceForFinancial &&
        (!status.synced || status.offsetMs === null || status.driftExceeded);
      if (blocked === trustedTimeBlocked) return;
      try {
        if (blocked) {
          await adminService.appendAdminLog(
            'trusted_time_unsynced',
            'Trusted time lost during runtime. Financial operations are now blocked.',
            {
              synced: status.synced,
              offsetMs: status.offsetMs,
              driftExceeded: status.driftExceeded,
              maxDriftMs: status.maxDriftMs,
              source: status.source,
              detail: status.detail,
              ntpSource: status.ntpSource,
            },
          );
          await anomalyService.report({
            type: 'trusted_time_unsynced',
            source: 'time-sync',
            category: 'network',
            severity: 'critical',
            message:
              'Trusted time synchronization is unavailable. Financial operations are blocked.',
            fingerprint: buildAnomalyFingerprint([
              'time-sync',
              'trusted-time-unsynced',
            ]),
            context: {
              offsetMs: status.offsetMs,
              driftExceeded: status.driftExceeded,
              maxDriftMs: status.maxDriftMs,
              detail: status.detail,
            },
          });
          trustedTimeBlocked = blocked;
          return;
        }

        await adminService.appendAdminLog(
          'trusted_time_restored',
          'Trusted time synchronization restored. Financial operations are unblocked.',
          {
            synced: status.synced,
            offsetMs: status.offsetMs,
            driftExceeded: status.driftExceeded,
            maxDriftMs: status.maxDriftMs,
            source: status.source,
            detail: status.detail,
            ntpSource: status.ntpSource,
          },
        );
        await anomalyService.report({
          type: 'trusted_time_restored',
          source: 'time-sync',
          category: 'network',
          severity: 'warning',
          message:
            'Trusted time synchronization has been restored. Financial operations are available again.',
          fingerprint: buildAnomalyFingerprint([
            'time-sync',
            'trusted-time-restored',
          ]),
          context: {
            offsetMs: status.offsetMs,
            driftExceeded: status.driftExceeded,
            maxDriftMs: status.maxDriftMs,
            detail: status.detail,
          },
        });
        trustedTimeBlocked = blocked;
      } catch (error) {
        console.error('[TIME] Failed to publish trusted-time transition.', {
          targetState: blocked ? 'blocked' : 'restored',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    await startHotspot();
    markStartupReady();
  } catch (error) {
    const startupErrorMessage =
      error instanceof Error ? error.message : String(error);
    console.error('[SERVER] Startup initialization failed.', {
      error: startupErrorMessage,
    });
    markStartupFailed(
      'Startup initialization failed. Waiting for automatic recovery.',
    );
  }
}

let shuttingDown = false;

function gracefulShutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[SERVER] Received ${signal}. Shutting down gracefully...`);
  stopTrustedTimeMonitor();
  stopWatchdogHealthMonitor();
  void markRecoveryShutdown(signal)
    .catch((error) => {
      console.error('[RECOVERY] Failed to write shutdown marker.', {
        error: error instanceof Error ? error.message : String(error),
        signal,
      });
    })
    .finally(() => {
      server.close((error) => {
        if (error) {
          console.error('[SERVER] Error while closing HTTP server.', {
            error: error.message,
          });
          process.exit(1);
        }
        process.exit(0);
      });
    });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

void start().catch((error) => {
  const startupErrorMessage =
    error instanceof Error ? error.message : String(error);
  console.error('[SERVER] Fatal startup error.', {
    error: startupErrorMessage,
  });
  markStartupFailed('Server failed to bind. Check startup logs.');
  process.exit(1);
});
