import path from 'node:path';
import http from 'http';
import express from 'express';
import type { Express } from 'express';
import { Server } from 'socket.io';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import {
  API_BASE_PATH,
  PORT,
  PORTAL_ASSETS,
  PORTAL_DIR,
  PUBLIC_PAGE_ROUTES,
  UPLOAD_DIR,
  HOTSPOT_SSID,
  HOTSPOT_PASSWORD,
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
} from '@/routes';
import { registerSystemApiRoutes } from '@/controllers';
import { createApiAwareApp } from '@/runtime';
import {
  convertToPdfPreview,
  getHopperStatus,
  getSerialStatus,
  startHotspot,
  stopHotspot,
  isHotspotRunning,
  SessionStore,
  renderUploadPortal,
  resolvePublicBaseUrl,
  runHopperSelfTest,
} from '@/services';
import { getLocalIPv4 } from './network';

export interface KioskAppRuntime {
  app: Express;
  server: http.Server;
  io: Server;
}

export function createKioskAppRuntime(): KioskAppRuntime {
  const app = express();
  const apiRouter = express.Router();
  const routeApp = createApiAwareApp(app, apiRouter, API_BASE_PATH);
  const server = http.createServer(app);
  const io = new Server(server);

  app.use(cookieParser());

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
  if (CAPTIVE_PORTAL_ENABLED) {
    app.use(createCaptivePortalMiddleware(sessionStore));
  }

  registerSystemApiRoutes(routeApp, {
    port: PORT,
    hotspotSsid: HOTSPOT_SSID,
    hotspotPassword: HOTSPOT_PASSWORD,
    sessionStore,
    getLocalIPv4,
    startHotspot,
    stopHotspot,
    isHotspotRunning,
  });

  registerPageRoutes(routeApp, {
    sessionStore,
    publicPageRoutes: PUBLIC_PAGE_ROUTES,
    resolvePublicBaseUrl,
  });
  app.use(API_BASE_PATH, apiRouter);
  registerStaticAssets(app);
  registerAdminRoutes(routeApp, {
    io,
    uploadDir: UPLOAD_DIR,
    getSerialStatus,
    getHopperStatus,
    runHopperSelfTest,
  });
  registerFeedbackRoutes(routeApp, { resolvePublicBaseUrl });
  registerReportRoutes(routeApp, {
    resolvePublicBaseUrl,
    reportIssueUploadSingle: reportIssueUpload.single('file'),
  });
  registerFinancialRoutes(routeApp, {
    io,
    sessionStore,
    uploadSingle: upload.single('file'),
    resolvePublicBaseUrl,
  });
  registerUploadPortalRoutes(routeApp, {
    portalDir: PORTAL_DIR,
    portalAssets: PORTAL_ASSETS,
    renderUploadPortal,
    sessionStore,
  });
  registerWirelessSessionRoutes(routeApp, {
    io,
    sessionStore,
    resolvePublicBaseUrl,
    convertToPdfPreview,
  });
  registerScanRoutes(routeApp, { io, resolvePublicBaseUrl });
  registerCopyRoutes(routeApp, { io });
  registerPrinterRoutes(routeApp);

  io.on('connection', (socket) => {
    socket.on('joinSession', (sessionId: string) => {
      socket.join(`session:${sessionId}`);
    });
  });

  return { app, server, io };
}
