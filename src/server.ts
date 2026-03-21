import path from 'node:path';
import os from 'os';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import {
  PORT,
  PORTAL_ASSETS,
  PORTAL_DIR,
  PUBLIC_PAGE_ROUTES,
  UPLOAD_DIR,
  CAPTIVE_PORTAL_ENABLED,
} from '@/config';
import {
  registerStaticAssets,
  createCaptivePortalMiddleware,
} from '@/middleware';
import {
  registerFinancialRoutes,
  registerPageRoutes,
  registerAdminRoutes,
  registerFeedbackRoutes,
  registerReportRoutes,
  registerUploadPortalRoutes,
  registerWirelessSessionRoutes,
  registerScanRoutes,
  registerCopyRoutes,
  registerPrinterRoutes,
  registerLanguageRoutes,
} from '@/routes';
import {
  initDB,
  detectDefaultPrinter,
  detectScanner,
  startScanStorageCleanup,
  convertToPdfPreview,
  getHopperStatus,
  getSerialStatus,
  initSerial,
  getHotspotConfig,
  startHotspot,
  stopHotspot,
  isHotspotRunning,
  SessionStore,
  renderUploadPortal,
  resolvePublicBaseUrl,
  runHopperSelfTest,
  startPrinterMonitor,
  startClamd,
  anomalyService,
  adminService,
  getTrustedTimeStatus,
  startTrustedTimeMonitor,
  stopTrustedTimeMonitor,
  verifyTrustedClockSync,
  isClamdReachable,
  getPrinterTelemetry,
  startWatchdogHealthMonitor,
  stopWatchdogHealthMonitor,
  getWatchdogHealthSnapshot,
  updateExternalWatchdogState,
  getExternalWatchdogState,
} from '@/services';
import { buildAnomalyFingerprint } from '@/services/anomaly';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cookieParser());

function getLocalIPv4(): string | null {
  const interfaces = os.networkInterfaces();
  let fallback: string | null = null;

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family !== 'IPv4' || iface.internal) continue;

      // Prefer hotspot adapter: MyPublicWiFi (192.168.5.x) or Windows Mobile Hotspot (192.168.137.x)
      const isHotspot =
        /Wi-Fi Direct|Local Area Connection\*/i.test(name) ||
        iface.address.startsWith('192.168.5.') ||
        iface.address.startsWith('192.168.137.');
      if (isHotspot) return iface.address;

      if (!fallback) fallback = iface.address;
    }
  }

  return fallback;
}

function normalizeRemoteIp(rawIp: string): string {
  const normalized = rawIp.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    return normalized.slice('::ffff:'.length);
  }
  return normalized;
}

function isLoopbackRequest(remoteIp: string): boolean {
  const ip = normalizeRemoteIp(remoteIp);
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function readWatchdogAlertThreshold(): number {
  const raw = process.env.PRINTBIT_WATCHDOG_FAILURE_ALERT_THRESHOLD;
  if (typeof raw !== 'string' || !raw.trim()) return 5;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 5;
  return Math.floor(parsed);
}

const WATCHDOG_ALERT_THRESHOLD = readWatchdogAlertThreshold();
let watchdogFailureEscalated = false;

const upload = multer({ dest: UPLOAD_DIR });

const ALLOWED_REPORT_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const reportIssueUpload = multer({
  dest: path.join(UPLOAD_DIR, 'report-issues'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_REPORT_IMAGE_TYPES.has(file.mimetype));
  },
});

const sessionStore = new SessionStore(UPLOAD_DIR);

app.use(express.json());

// Captive-portal middleware — fallback for direct captive probes on port 3000
if (CAPTIVE_PORTAL_ENABLED) {
  app.use(createCaptivePortalMiddleware(sessionStore));
}

// Hotspot config API (used by print page to generate Wi-Fi QR)
app.get('/api/config/hotspot', (_req, res) => {
  res.json(getHotspotConfig());
});

// On-demand hotspot control (called by print page when session starts)
app.post('/api/hotspot/start', async (_req, res) => {
  try {
    await startHotspot();
    res.json({ ok: true, running: isHotspotRunning() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post('/api/hotspot/stop', (_req, res) => {
  stopHotspot();
  res.json({ ok: true });
});

app.get('/api/watchdog/health', (_req, res) => {
  const remoteIp =
    _req.ip || _req.socket.remoteAddress || _req.connection?.remoteAddress || '';
  if (!isLoopbackRequest(remoteIp)) {
    return res.status(403).json({ error: 'Watchdog health is loopback-only.' });
  }
  const snapshot = getWatchdogHealthSnapshot();
  const statusCode = snapshot.status === 'unhealthy' ? 503 : 200;
  res.status(statusCode).json(snapshot);
});

app.post('/api/watchdog/report', (req, res) => {
  const remoteIp = req.ip || req.socket.remoteAddress || '';
  if (!isLoopbackRequest(remoteIp)) {
    return res.status(403).json({ error: 'Watchdog report is loopback-only.' });
  }

  const raw = req.body as Record<string, unknown>;
  const toFiniteInt = (value: unknown): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.floor(value);
  };
  const toOptionalString = (value: unknown): string | null => {
    if (value === null) return null;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const payload = {
    running:
      typeof raw.running === 'boolean'
        ? raw.running
        : getExternalWatchdogState().running,
    watchdogPid:
      raw.watchdogPid === null
        ? null
        : (toFiniteInt(raw.watchdogPid) ??
          getExternalWatchdogState().watchdogPid),
    consecutiveFailures:
      toFiniteInt(raw.consecutiveFailures) ??
      getExternalWatchdogState().consecutiveFailures,
    recoveryAttempts:
      toFiniteInt(raw.recoveryAttempts) ??
      getExternalWatchdogState().recoveryAttempts,
    backoffDelayMs:
      toFiniteInt(raw.backoffDelayMs) ??
      getExternalWatchdogState().backoffDelayMs,
    nextRecoveryAt:
      raw.nextRecoveryAt === null
        ? null
        : (toOptionalString(raw.nextRecoveryAt) ??
          getExternalWatchdogState().nextRecoveryAt),
    lastAction:
      toOptionalString(raw.lastAction) ?? getExternalWatchdogState().lastAction,
    lastError:
      raw.lastError === null
        ? null
        : (toOptionalString(raw.lastError) ??
          getExternalWatchdogState().lastError),
  };

  const state = updateExternalWatchdogState(payload);
  if (
    state.consecutiveFailures >= WATCHDOG_ALERT_THRESHOLD &&
    !watchdogFailureEscalated
  ) {
    watchdogFailureEscalated = true;
    void adminService
      .appendAdminLog(
        'watchdog_recovery_escalated',
        `Watchdog reached ${state.consecutiveFailures} consecutive failures.`,
        {
          threshold: WATCHDOG_ALERT_THRESHOLD,
          recoveryAttempts: state.recoveryAttempts,
          backoffDelayMs: state.backoffDelayMs,
          lastAction: state.lastAction,
          lastError: state.lastError,
        },
      )
      .catch((error) => {
        console.error('[WATCHDOG] Failed to append escalation admin log.', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    void anomalyService
      .report({
        type: 'watchdog_recovery_escalated',
        source: 'external-watchdog',
        category: 'network',
        severity: 'critical',
        message: `Watchdog failed to recover the kiosk after ${state.consecutiveFailures} consecutive attempts.`,
        fingerprint: buildAnomalyFingerprint([
          'watchdog',
          'external',
          'escalated',
        ]),
        context: {
          threshold: WATCHDOG_ALERT_THRESHOLD,
          consecutiveFailures: state.consecutiveFailures,
          recoveryAttempts: state.recoveryAttempts,
          backoffDelayMs: state.backoffDelayMs,
        },
      })
      .catch((error) => {
        console.error('[WATCHDOG] Failed to report escalation anomaly.', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  if (state.consecutiveFailures === 0 && watchdogFailureEscalated) {
    watchdogFailureEscalated = false;
    void adminService
      .appendAdminLog(
        'watchdog_recovery_restored',
        'Watchdog recovery failure streak cleared.',
        {
          recoveryAttempts: state.recoveryAttempts,
          lastAction: state.lastAction,
        },
      )
      .catch((error) => {
        console.error('[WATCHDOG] Failed to append restore admin log.', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    void anomalyService
      .report({
        type: 'watchdog_recovery_restored',
        source: 'external-watchdog',
        category: 'network',
        severity: 'warning',
        message:
          'Watchdog recovery failures have cleared and the kiosk is stable again.',
        fingerprint: buildAnomalyFingerprint([
          'watchdog',
          'external',
          'restored',
        ]),
        context: {
          recoveryAttempts: state.recoveryAttempts,
        },
      })
      .catch((error) => {
        console.error('[WATCHDOG] Failed to report restore anomaly.', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  res.json(state);
});

app.get('/api/watchdog/report', (_req, res) => {
  const remoteIp =
    _req.ip || _req.socket.remoteAddress || _req.connection?.remoteAddress || '';
  if (!isLoopbackRequest(remoteIp)) {
    return res.status(403).json({ error: 'Watchdog report is loopback-only.' });
  }
  res.json(getExternalWatchdogState());
});

// Active session API
app.get('/api/session/active', (req, res) => {
  const token = sessionStore.getActiveSessionToken();
  if (token) {
    const uploadUrl = new URL(
      `/upload/${encodeURIComponent(token)}`,
      resolvePublicBaseUrl(req),
    ).toString();
    res.json({ token, uploadUrl });
  } else {
    res.status(404).json({ error: 'No active session' });
  }
});

registerPageRoutes(app, {
  sessionStore,
  publicPageRoutes: PUBLIC_PAGE_ROUTES,
  resolvePublicBaseUrl,
});
registerStaticAssets(app);
registerAdminRoutes(app, {
  io,
  uploadDir: UPLOAD_DIR,
  getSerialStatus,
  getHopperStatus,
  runHopperSelfTest,
});
registerFeedbackRoutes(app, { resolvePublicBaseUrl });
registerReportRoutes(app, {
  resolvePublicBaseUrl,
  reportIssueUploadSingle: reportIssueUpload.single('file'),
});
registerFinancialRoutes(app, {
  io,
  sessionStore,
  uploadSingle: upload.single('file'),
  resolvePublicBaseUrl,
});
registerUploadPortalRoutes(app, {
  portalDir: PORTAL_DIR,
  portalAssets: PORTAL_ASSETS,
  renderUploadPortal,
  sessionStore,
});
registerWirelessSessionRoutes(app, {
  io,
  sessionStore,
  resolvePublicBaseUrl,
  convertToPdfPreview,
});
registerScanRoutes(app, { io, resolvePublicBaseUrl });
registerCopyRoutes(app, { io });
registerPrinterRoutes(app);
registerLanguageRoutes(app);

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
    isClamdReachable,
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

  await startClamd();
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
