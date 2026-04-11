import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import {
  PORT,
  UPLOAD_DIR,
  CAPTIVE_PORTAL_ENABLED,
  SESSION_EXPIRY_ENABLED,
} from '@/config';
import {
  createCaptivePortalMiddleware,
  createCsrfProtectionMiddleware,
} from '@/middleware';
import { registerAppModules } from '@/app.module';
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
import { getLocalIPv4 } from '@/utils/network';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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

const LOADING_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="cache-control" content="no-store" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Starting PrintBit…</title>
  <style>
    :root{color-scheme:dark}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:'Segoe UI',system-ui,sans-serif;background:#0f1020;color:#f7f8ff}
    .card{width:min(560px,92vw);padding:30px;border-radius:20px;background:linear-gradient(180deg,#181a33,#131425);border:1px solid rgba(132,145,255,.25);box-shadow:0 22px 40px rgba(0,0,0,.4)}
    h1{margin:0 0 10px;font-size:1.5rem}
    p{margin:8px 0;color:#d6dafd;line-height:1.45}
    .muted{font-size:.95rem;color:#adb5ef}
    .dot{display:inline-block;width:.75rem;height:.75rem;margin-right:.5rem;border-radius:50%;background:#7f93ff;animation:pulse 1.2s ease-in-out infinite}
    .error{color:#ffd4d4}
    @keyframes pulse{0%,100%{opacity:.35;transform:scale(.9)}50%{opacity:1;transform:scale(1)}}
  </style>
</head>
<body>
  <main class="card" aria-live="polite">
    <h1><span class="dot" aria-hidden="true"></span>Starting PrintBit…</h1>
    <p id="statusText">Preparing kiosk services. This page will continue automatically.</p>
    <p class="muted" id="metaText">Waiting for readiness signal.</p>
  </main>
  <script>
    (function(){
      const statusText = document.getElementById('statusText');
      const metaText = document.getElementById('metaText');
      const setBooting = () => {
        statusText.textContent = 'Preparing kiosk services. This page will continue automatically.';
        statusText.classList.remove('error');
      };
      const setFailed = (message) => {
        statusText.textContent = message || 'Startup failed. Waiting for automatic recovery.';
        statusText.classList.add('error');
      };
      const poll = async () => {
        let retryAfterMs = ${STARTUP_POLL_INTERVAL_MS};
        try {
          const response = await fetch('/api/startup/ready', { cache: 'no-store' });
          const payload = await response.json();
          if (typeof payload.retryAfterMs === 'number' && payload.retryAfterMs > 0) {
            retryAfterMs = payload.retryAfterMs;
          }
          if (payload.ready === true) {
            window.location.replace('/');
            return;
          }
          if (payload.phase === 'failed') {
            setFailed(payload.message);
            metaText.textContent = 'Automatic recovery is running. Retrying…';
          } else {
            setBooting();
            metaText.textContent = 'Waiting for readiness signal.';
          }
        } catch (_error) {
          setBooting();
          metaText.textContent = 'Network unavailable. Retrying…';
          retryAfterMs = Math.max(retryAfterMs, 3000);
        }
        window.setTimeout(poll, retryAfterMs);
      };
      poll();
    })();
  </script>
</body>
</html>`;

app.get('/loading', (_req, res) => {
  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate',
  );
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.type('html').send(LOADING_PAGE_HTML);
});

app.get('/api/startup/ready', (_req, res) => {
  const snapshot = getStartupReadinessSnapshot();
  const statusCode = snapshot.ready ? 200 : 503;
  res.status(statusCode).json(snapshot);
});

app.use(cookieParser());

const sessionStore = new SessionStore(UPLOAD_DIR, {
  expiryEnabled: SESSION_EXPIRY_ENABLED,
});

app.use(express.json());
app.use(createCsrfProtectionMiddleware());

// Captive-portal middleware — fallback for direct captive probes on port 3000
if (CAPTIVE_PORTAL_ENABLED) {
  app.use(createCaptivePortalMiddleware(sessionStore));
}

registerAppModules(app, {
  io,
  sessionStore,
  uploadDir: UPLOAD_DIR,
  getSerialStatus,
  getHopperStatus,
  runHopperSelfTest,
  resolvePublicBaseUrl,
  convertToPdfPreview,
});

io.on('connection', (socket) => {
  const locked = isCoinSlotLocked();
  const ownerId = getCoinSlotLockOwnerId();
  if (locked) {
    socket.emit('coinSlotLocked', {
      lockedAt: getCoinSlotLockedAt() ?? new Date().toISOString(),
      ownerId,
    });
  }

  socket.on('joinSession', (sessionId: string) => {
    socket.join(`session:${sessionId}`);
  });

  socket.on('lockCoinSlot', (_data: unknown) => {
    const currentOwnerId = getCoinSlotLockOwnerId();
    if (isCoinSlotLocked() && currentOwnerId && currentOwnerId !== socket.id) {
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

  socket.on('unlockCoinSlot', (_data: unknown) => {
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
    await detectDefaultPrinter();
    await assertPrintDispatcherReady();
    await warmPrintDispatcherProfile();
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
    await initSerial(io);
    await runHopperSelfTest();

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
          return;
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
