import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import { PORT, UPLOAD_DIR, CAPTIVE_PORTAL_ENABLED } from '@/config';
import { createCaptivePortalMiddleware } from '@/middleware';
import { registerAppModules } from '@/app.module';
import {
  initDB,
  detectDefaultPrinter,
  detectScanner,
  startScanStorageCleanup,
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
  getTrustedTimeStatus,
  startTrustedTimeMonitor,
  stopTrustedTimeMonitor,
  verifyTrustedClockSync,
  getPrinterTelemetry,
  startWatchdogHealthMonitor,
  stopWatchdogHealthMonitor,
} from '@/services';
import { buildAnomalyFingerprint } from '@/services/anomaly';
import { getLocalIPv4 } from '@/utils/network';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cookieParser());

const sessionStore = new SessionStore(UPLOAD_DIR);

app.use(express.json());

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
  socket.on('joinSession', (sessionId: string) => {
    socket.join(`session:${sessionId}`);
  });
});

async function start() {
  await initDB();
  const startupTrustedTime = await verifyTrustedClockSync();
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
      console.error('[TIME] Failed to append startup trusted-time admin log.', {
        error: error instanceof Error ? error.message : String(error),
      });
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
        console.error('[TIME] Failed to report startup trusted-time anomaly.', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
  await detectDefaultPrinter();
  await detectScanner();
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

  server.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIPv4();
    if (localIP) {
      console.log(`→ Network: http://${localIP}:${PORT}`);
    } else {
      console.log('→ Network IP not detected');
    }
    const trustedTime = getTrustedTimeStatus();
    console.log(
      `[TIME] Trusted sync=${trustedTime.synced} source=${trustedTime.source} offsetMs=${trustedTime.offsetMs ?? 'n/a'} detail="${trustedTime.detail}"`,
    );
  });
}

let shuttingDown = false;

function gracefulShutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[SERVER] Received ${signal}. Shutting down gracefully...`);
  stopTrustedTimeMonitor();
  stopWatchdogHealthMonitor();
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
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

void start().catch((error) => {
  console.error('[SERVER] Fatal startup error.', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
