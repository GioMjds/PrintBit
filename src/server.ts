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
  verifyTrustedClockSync,
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
  await adminService.appendAdminLog(
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
  );
  if (startupBlocked) {
    await anomalyService.report({
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
    });
  }
  await detectDefaultPrinter();
  await detectScanner();
  startScanStorageCleanup();
  await initSerial(io);
  await runHopperSelfTest();

  startPrinterMonitor(io);
  anomalyService.setSocketIo(io);
  let trustedTimeBlocked = startupBlocked;
  startTrustedTimeMonitor(async (status) => {
    const blocked =
      status.enforceForFinancial &&
      (!status.synced || status.offsetMs === null || status.driftExceeded);
    if (blocked === trustedTimeBlocked) return;
    trustedTimeBlocked = blocked;

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
      fingerprint: buildAnomalyFingerprint(['time-sync', 'trusted-time-restored']),
      context: {
        offsetMs: status.offsetMs,
        driftExceeded: status.driftExceeded,
        maxDriftMs: status.maxDriftMs,
        detail: status.detail,
      },
    });
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

start();
