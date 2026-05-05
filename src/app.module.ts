/**
 * Root application module that registers all feature modules.
 * This is the central point for wiring up all modules with the Express app.
 */
import type { Express } from 'express';
import type { Request } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import type { SessionStore } from '@/services/session';
import {
  PUBLIC_PAGE_ROUTES,
  PORTAL_ASSETS,
  PORTAL_DIR,
  UPLOAD_DIR,
} from '@/config';
import { getHotspotConfig } from '@/services';
import { registerStaticAssets } from '@/middleware';
import { registerAdminModule } from '@/modules/admin';
import { registerFinancialModule } from '@/modules/financial';
import { registerPrinterModule } from '@/modules/printer';
import { registerScannerModule } from '@/modules/scanner';
import { registerCopyModule } from '@/modules/copy';
import { registerWirelessSessionModule } from '@/modules/wireless-session';
import { registerFeedbackModule } from '@/modules/feedback';
import { registerReportModule } from '@/modules/report';
import { registerReceiptModule } from '@/modules/receipt';
import { registerHotspotModule } from '@/modules/hotspot';
import { registerWatchdogModule } from '@/modules/watchdog';
import { registerHopperModule } from '@/modules/hopper';
import { registerAnomalyModule } from '@/modules/anomaly';
import { registerLanguageModule } from '@/modules/language';
import { registerUploadPortalModule } from '@/modules/upload-portal';
import { registerPageModule } from '@/modules/page';

export interface AppModuleDeps {
  io: SocketIOServer;
  sessionStore: SessionStore;
  uploadDir?: string;
  getSerialStatus: () => {
    connected: boolean;
    portPath: string | null;
    lastError: string | null;
  };
  getHopperStatus: () => {
    connected: boolean;
    pending: boolean;
    portPath: string | null;
    lastError: string | null;
    lastSuccessAt: string | null;
  };
  runHopperSelfTest: () => Promise<{
    ok: boolean;
    amount: number;
    message: string;
    attempts: number;
    owedChangeId?: string;
  }>;
  resolvePublicBaseUrl: (req: Request) => URL;
  convertToPdfPreview: (sourcePath: string) => Promise<string>;
}

/**
 * Register all application modules with the Express app.
 * This function is called from server.ts during startup.
 */
export function registerAppModules(app: Express, deps: AppModuleDeps): void {
  registerStaticAssets(app);
  registerPageModule(app, {
    io: deps.io,
    sessionStore: deps.sessionStore,
    publicPageRoutes: PUBLIC_PAGE_ROUTES,
    resolvePublicBaseUrl: deps.resolvePublicBaseUrl,
  });

  registerAdminModule(app, {
    io: deps.io,
    uploadDir: deps.uploadDir ?? UPLOAD_DIR,
    getSerialStatus: deps.getSerialStatus,
    getHopperStatus: deps.getHopperStatus,
    runHopperSelfTest: deps.runHopperSelfTest,
  });
  registerFeedbackModule(app, {
    io: deps.io,
    resolvePublicBaseUrl: deps.resolvePublicBaseUrl,
  });
  registerReportModule(app, {
    io: deps.io,
    resolvePublicBaseUrl: deps.resolvePublicBaseUrl,
  });
  registerFinancialModule(app, {
    io: deps.io,
    sessionStore: deps.sessionStore,
    resolvePublicBaseUrl: deps.resolvePublicBaseUrl,
  });
  registerReceiptModule(app);
  registerUploadPortalModule(app, {
    io: deps.io,
    portalDir: PORTAL_DIR,
    portalAssets: PORTAL_ASSETS,
    sessionStore: deps.sessionStore,
  });
  registerWirelessSessionModule(app, {
    io: deps.io,
    sessionStore: deps.sessionStore,
    resolvePublicBaseUrl: deps.resolvePublicBaseUrl,
    convertToPdfPreview: deps.convertToPdfPreview,
  });
  registerScannerModule(app, {
    io: deps.io,
    resolvePublicBaseUrl: deps.resolvePublicBaseUrl,
  });
  registerCopyModule(app, {
    io: deps.io,
    resolvePublicBaseUrl: deps.resolvePublicBaseUrl,
  });
  registerPrinterModule(app);
  registerLanguageModule(app, { io: deps.io });

  registerHotspotModule(app);
  registerWatchdogModule(app);
  registerHopperModule(app, { io: deps.io });
  registerAnomalyModule(app, { io: deps.io });

  // Keep legacy endpoint contract: /api/config/hotspot
  app.get('/api/config/hotspot', (_req, res) => {
    res.json(getHotspotConfig());
  });

  // Keep legacy endpoint contract: /api/session/active
  app.get('/api/session/active', (req, res) => {
    const token = deps.sessionStore.getActiveSessionToken();
    if (token) {
      const uploadUrl = new URL(
        `/upload/${encodeURIComponent(token)}`,
        deps.resolvePublicBaseUrl(req),
      ).toString();
      res.json({ token, uploadUrl });
      return;
    }
    res.status(404).json({ error: 'No active session' });
  });
}
