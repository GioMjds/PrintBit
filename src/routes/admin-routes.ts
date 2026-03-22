import fs from 'node:fs';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import {
  requireAdminLocalAccess,
  requireAdminPin,
} from '@/middleware/admin-auth';
import { adminService } from '@/services/admin';
import { db } from '@/services/db';
import {
  PendingRefundServiceError,
  dismissPendingRefund,
  processPendingRefund,
} from '@/services/pending-refund';
import { anomalyService } from '@/services/anomaly';
import { generateTestPagePdf } from '@/services/test-page';
import {
  getPrinterTelemetry,
  refreshPrinterTelemetry,
  listInstalledPrinters,
  runInkTelemetryDiagnostics,
} from '@/services/printer-status';
import { getExternalWatchdogState } from '@/services/watchdog-health';
import { detectDefaultPrinter, printFile } from '@/services/printer';
import { getScannerStatus } from '@/services/scanner';
import { getTrustedTimeStatus, verifyTrustedClockSync } from '@/services/time-source';
import {
  checkLockout,
  clearLockout,
  formatRemainingTime,
  recordFailedAttempt,
  MAX_ATTEMPTS,
} from '@/utils/lockout';
import { hashPassword, verifyPassword } from '@/utils/hash';
import { createAdminSession, destroyAdminSession } from '@/utils/admin-session';

interface RegisterAdminRoutesDeps {
  io: SocketIOServer;
  uploadDir: string;
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
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isWholePeso(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function normalizeTargetPrinterName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const sanitized = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return sanitized ? sanitized : null;
}

function isAnomalySeverity(value: unknown): value is 'warning' | 'critical' {
  return value === 'warning' || value === 'critical';
}

function isAnomalyStatus(
  value: unknown,
): value is 'open' | 'acknowledged' | 'resolved' {
  return value === 'open' || value === 'acknowledged' || value === 'resolved';
}

function isAnomalyCategory(
  value: unknown,
): value is
  | 'printer'
  | 'spooler'
  | 'serial'
  | 'hopper'
  | 'network'
  | 'security' {
  return (
    value === 'printer' ||
    value === 'spooler' ||
    value === 'serial' ||
    value === 'hopper' ||
    value === 'network' ||
    value === 'security'
  );
}

function parseAlertSettingsPayload(
  body: unknown,
  current: typeof db.data.settings.alerts,
): { next?: typeof db.data.settings.alerts; error?: string } {
  const payload = body as {
    severityThreshold?: unknown;
    dashboard?: { enabled?: unknown };
    email?: {
      enabled?: unknown;
      smtpHost?: unknown;
      smtpPort?: unknown;
      secure?: unknown;
      username?: unknown;
      from?: unknown;
      to?: unknown;
    };
    dedupe?: {
      printerMs?: unknown;
      spoolerMs?: unknown;
      serialMs?: unknown;
      hopperMs?: unknown;
      networkMs?: unknown;
      securityMs?: unknown;
    };
  };

  const next = {
    severityThreshold: current.severityThreshold,
    dashboard: { ...current.dashboard },
    email: { ...current.email },
    dedupe: { ...current.dedupe },
  };

  if (payload.severityThreshold !== undefined) {
    if (!isAnomalySeverity(payload.severityThreshold)) {
      return { error: 'severityThreshold must be "warning" or "critical".' };
    }
    next.severityThreshold = payload.severityThreshold;
  }

  if (payload.dashboard?.enabled !== undefined) {
    if (typeof payload.dashboard.enabled !== 'boolean') {
      return { error: 'dashboard.enabled must be boolean.' };
    }
    next.dashboard.enabled = payload.dashboard.enabled;
  }

  if (payload.email) {
    if (payload.email.enabled !== undefined) {
      if (typeof payload.email.enabled !== 'boolean') {
        return { error: 'email.enabled must be boolean.' };
      }
      next.email.enabled = payload.email.enabled;
    }
    if (payload.email.smtpHost !== undefined) {
      if (typeof payload.email.smtpHost !== 'string') {
        return { error: 'Invalid smtpHost.' };
      }
      next.email.smtpHost = payload.email.smtpHost.trim();
    }
    if (payload.email.smtpPort !== undefined) {
      const smtpPort = Number(payload.email.smtpPort);
      if (!Number.isFinite(smtpPort) || smtpPort <= 0) {
        return { error: 'Invalid smtpPort.' };
      }
      next.email.smtpPort = Math.floor(smtpPort);
    }
    if (payload.email.secure !== undefined) {
      if (typeof payload.email.secure !== 'boolean') {
        return { error: 'email.secure must be boolean.' };
      }
      next.email.secure = payload.email.secure;
    }
    if (payload.email.username !== undefined) {
      if (typeof payload.email.username !== 'string') {
        return { error: 'Invalid email username.' };
      }
      next.email.username = payload.email.username.trim();
    }
    if (
      Object.prototype.hasOwnProperty.call(
        payload.email as Record<string, unknown>,
        'password',
      )
    ) {
      return {
        error:
          'SMTP password is not accepted in settings payload. Set PRINTBIT_ALERT_SMTP_PASSWORD in the environment.',
      };
    }
    if (payload.email.from !== undefined) {
      if (typeof payload.email.from !== 'string') {
        return { error: 'Invalid email from.' };
      }
      next.email.from = payload.email.from.trim();
    }
    if (payload.email.to !== undefined) {
      if (typeof payload.email.to !== 'string') {
        return { error: 'Invalid email to.' };
      }
      next.email.to = payload.email.to.trim();
    }
  }

  if (payload.dedupe) {
    const dedupeEntries: Array<
      [
        | 'printerMs'
        | 'spoolerMs'
        | 'serialMs'
        | 'hopperMs'
        | 'networkMs'
        | 'securityMs',
        unknown,
      ]
    > = [
      ['printerMs', payload.dedupe.printerMs],
      ['spoolerMs', payload.dedupe.spoolerMs],
      ['serialMs', payload.dedupe.serialMs],
      ['hopperMs', payload.dedupe.hopperMs],
      ['networkMs', payload.dedupe.networkMs],
      ['securityMs', payload.dedupe.securityMs],
    ];
    for (const [key, raw] of dedupeEntries) {
      if (raw === undefined) continue;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return { error: `Invalid ${key} value.` };
      }
      next.dedupe[key] = Math.floor(parsed);
    }
  }

  return { next };
}

function toSafeAlertSettings(alerts: typeof db.data.settings.alerts): {
  severityThreshold: 'warning' | 'critical';
  dashboard: { enabled: boolean };
  email: {
    enabled: boolean;
    smtpHost: string;
    smtpPort: number;
    secure: boolean;
    username: string;
    from: string;
    to: string;
  };
  dedupe: {
    printerMs: number;
    spoolerMs: number;
    serialMs: number;
    hopperMs: number;
    networkMs: number;
    securityMs: number;
  };
} {
  return {
    severityThreshold: alerts.severityThreshold,
    dashboard: { ...alerts.dashboard },
    email: {
      ...alerts.email,
    },
    dedupe: { ...alerts.dedupe },
  };
}

export function registerAdminRoutes(
  app: Express,
  deps: RegisterAdminRoutesDeps,
) {
  app.post(
    '/api/admin/auth',
    requireAdminLocalAccess,
    async (req: Request, res: Response) => {
      const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';

      const lockStatus = checkLockout();
      if (lockStatus.locked) {
        await adminService.appendAdminLog(
          'admin_auth_blocked',
          `Admin login blocked - account is locked.`,
        );
        return res.status(423).json({
          ok: false,
          error: `Too many failed attempts. Try again in ${formatRemainingTime(lockStatus.remainingMs!)}.`,
        });
      }

      if (!pin) {
        return res.status(400).json({ ok: false, error: 'PIN is required.' });
      }

      const storedPin = db.data!.settings.adminPin;
      let valid = false;

      try {
        valid = await verifyPassword(storedPin, pin);
      } catch {
        valid = storedPin === pin;
      }

      if (!valid) {
        const attempts = await recordFailedAttempt();
        const attemptsLeft = Math.max(0, MAX_ATTEMPTS - attempts);

        await adminService.appendAdminLog(
          'admin_auth_failed',
          `Admin login failed (attempt ${attempts}/${MAX_ATTEMPTS}).`,
        );

        const message =
          attemptsLeft > 0
            ? `Incorrect PIN. ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining.`
            : 'Too many failed attempts. Kiosk locked for 10 minutes.';

        return res.status(401).json({ ok: false, error: message });
      }

      await clearLockout();
      const sessionToken = createAdminSession();

      res.cookie('adminToken', sessionToken, {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000,
      });

      return res.json({ ok: true });
    },
  );

  app.post(
    '/api/admin/logout',
    requireAdminLocalAccess,
    requireAdminPin,
    async (_req: Request, res: Response) => {
      destroyAdminSession();
      await adminService.appendAdminLog('admin_logout', 'Admin logged out.');
      res.clearCookie('adminToken');
      return res.json({ ok: true });
    },
  );

  app.post(
    '/api/admin/verify',
    requireAdminLocalAccess,
    requireAdminPin,
    (_req: Request, res: Response) => {
      res.json({ ok: true });
    },
  );

  app.get(
    '/api/admin/summary',
    requireAdminLocalAccess,
    requireAdminPin,
    (req: Request, res: Response) => {
      const storage = adminService.getStorageUsage(deps.uploadDir);
      const host = req.get('host') ?? 'unknown';
      const wifiActive =
        !host.startsWith('localhost') && !host.startsWith('127.0.0.1');
      const printer = getPrinterTelemetry();
      const scanner = getScannerStatus();
      const anomalyOpenCount = db.data!.anomalyIncidents.filter(
        (entry) => entry.status === 'open',
      ).length;
      const pendingRefunds = db.data!.pendingRefunds ?? [];
      const openRefunds = pendingRefunds.filter(
        (entry) => entry.status === 'open',
      );
      const refundedEntries = pendingRefunds.filter(
        (entry) => entry.status === 'refunded',
      );
      const dismissedEntries = pendingRefunds.filter(
        (entry) => entry.status === 'dismissed',
      );
      const autoRefundedEntries = refundedEntries.filter(
        (entry) => entry.jobContext.refundDisposition === 'auto_refunded',
      );
      const jamLogTypes = new Set([
        'print_spooler_job_failed',
        'print_spooler_auto_refund',
        'printer_malfunction_detected',
        'printer_midjob_malfunction',
      ]);
      const jamEvents = db.data!.logs.filter((entry) =>
        jamLogTypes.has(entry.type),
      );
      const nowMs = Date.now();
      const recentJamEvents = jamEvents.filter((entry) => {
        const tsMs = Date.parse(entry.timestamp);
        return Number.isFinite(tsMs) && nowMs - tsMs <= 24 * 60 * 60 * 1000;
      });
      res.json({
        balance: db.data!.balance,
        earnings: adminService.computeEarningsBuckets(),
        coinStats: db.data!.coinStats,
        jobStats: db.data!.jobStats,
        hopperStats: db.data!.hopperStats,
        owedChangeOpenCount: db.data!.owedChanges.filter(
          (entry) => entry.status === 'open',
        ).length,
        pendingRefundOpenCount: openRefunds.length,
        refundStats: {
          totalCount: pendingRefunds.length,
          openCount: openRefunds.length,
          refundedCount: refundedEntries.length,
          dismissedCount: dismissedEntries.length,
          autoRefundedCount: autoRefundedEntries.length,
        },
        anomalyStats: {
          totalCount: db.data!.anomalyIncidents.length,
          openCount: anomalyOpenCount,
        },
        jamStats: {
          totalEvents: jamEvents.length,
          recent24h: recentJamEvents.length,
          lastJamAt: jamEvents[0]?.timestamp ?? null,
        },
        storage,
        status: {
          serverRunning: true,
          uptimeSeconds: Math.floor(process.uptime()),
          serial: deps.getSerialStatus(),
          hopper: deps.getHopperStatus(),
          printer,
          scanner,
          watchdog: getExternalWatchdogState(),
          trustedTime: getTrustedTimeStatus(),
          host,
          wifiActive,
        },
      });
    },
  );

  app.get(
    '/api/admin/status',
    requireAdminLocalAccess,
    requireAdminPin,
    (req: Request, res: Response) => {
      const storage = adminService.getStorageUsage(deps.uploadDir);
      const host = req.get('host') ?? 'unknown';
      const wifiActive =
        !host.startsWith('localhost') && !host.startsWith('127.0.0.1');
      const printer = getPrinterTelemetry();
      const scanner = getScannerStatus();
      res.json({
        serverRunning: true,
        uptimeSeconds: Math.floor(process.uptime()),
        serial: deps.getSerialStatus(),
        hopper: deps.getHopperStatus(),
        printer,
        scanner,
        watchdog: getExternalWatchdogState(),
        trustedTime: getTrustedTimeStatus(),
        storage,
        host,
        wifiActive,
      });
    },
  );

  app.get(
    '/api/admin/system/time-sync',
    requireAdminLocalAccess,
    requireAdminPin,
    async (_req: Request, res: Response) => {
      const trustedTime = await verifyTrustedClockSync();
      const ok =
        trustedTime.synced &&
        !trustedTime.driftExceeded &&
        (trustedTime.offsetMs !== null || !trustedTime.enforceForFinancial);
      res.status(ok ? 200 : 503).json({
        ok,
        trustedTime,
      });
    },
  );

  app.post(
    '/api/admin/hopper/self-test',
    requireAdminLocalAccess,
    requireAdminPin,
    async (_req: Request, res: Response) => {
      const result = await deps.runHopperSelfTest();
      res.status(result.ok ? 200 : 503).json(result);
    },
  );

  app.get(
    '/api/admin/settings',
    requireAdminLocalAccess,
    requireAdminPin,
    (_req: Request, res: Response) => {
      res.json(db.data!.settings);
    },
  );

  app.put(
    '/api/admin/settings',
    requireAdminLocalAccess,
    requireAdminPin,
    async (req: Request, res: Response) => {
      const body = req.body as {
        pricing?: {
          printPerPage?: number;
          copyPerPage?: number;
          scanDocument?: number;
          colorSurcharge?: number;
        };
        idleTimeoutSeconds?: number;
        adminPin?: string;
        adminLocalOnly?: boolean;
        inkMonitoring?: {
          enabled?: boolean;
          targetPrinterName?: string | null;
          lowThresholdPercent?: number;
          criticalThresholdPercent?: number;
          blockOnLow?: boolean;
          blockOnEmpty?: boolean;
          telemetryUnknownPolicy?: 'warn_allow' | 'block';
        };
      };

      const printPerPage = body.pricing?.printPerPage;
      const copyPerPage = body.pricing?.copyPerPage;
      const scanDocument = body.pricing?.scanDocument;
      const colorSurcharge = body.pricing?.colorSurcharge;

      if (
        printPerPage !== undefined &&
        (!isFiniteNumber(printPerPage) || !isWholePeso(printPerPage))
      ) {
        return res.status(400).json({
          error: 'printPerPage must be a whole peso value (no decimals).',
        });
      }
      if (
        copyPerPage !== undefined &&
        (!isFiniteNumber(copyPerPage) || !isWholePeso(copyPerPage))
      ) {
        return res.status(400).json({
          error: 'copyPerPage must be a whole peso value (no decimals).',
        });
      }
      if (
        scanDocument !== undefined &&
        (!isFiniteNumber(scanDocument) || !isWholePeso(scanDocument))
      ) {
        return res.status(400).json({
          error: 'scanDocument must be a whole peso value (no decimals).',
        });
      }
      if (
        colorSurcharge !== undefined &&
        (!isFiniteNumber(colorSurcharge) || !isWholePeso(colorSurcharge))
      ) {
        return res.status(400).json({
          error: 'colorSurcharge must be a whole peso value (no decimals).',
        });
      }

      if (
        body.idleTimeoutSeconds !== undefined &&
        (!isFiniteNumber(body.idleTimeoutSeconds) ||
          body.idleTimeoutSeconds < 60)
      ) {
        return res
          .status(400)
          .json({ error: 'Invalid idleTimeoutSeconds value.' });
      }

      if (
        body.adminPin !== undefined &&
        (typeof body.adminPin !== 'string' || body.adminPin.trim().length < 4)
      ) {
        return res
          .status(400)
          .json({ error: 'Admin PIN must be at least 4 characters.' });
      }

      if (body.pricing) {
        if (printPerPage !== undefined)
          db.data!.settings.pricing.printPerPage = printPerPage;
        if (copyPerPage !== undefined)
          db.data!.settings.pricing.copyPerPage = copyPerPage;
        if (scanDocument !== undefined)
          db.data!.settings.pricing.scanDocument = scanDocument;
        if (colorSurcharge !== undefined)
          db.data!.settings.pricing.colorSurcharge = colorSurcharge;
      }

      if (body.idleTimeoutSeconds !== undefined) {
        db.data!.settings.idleTimeoutSeconds = Math.floor(
          body.idleTimeoutSeconds,
        );
      }

      if (body.adminPin && body.adminPin.trim()) {
        db.data!.settings.adminPin = await hashPassword(body.adminPin.trim());
      }

      if (body.adminLocalOnly !== undefined) {
        db.data!.settings.adminLocalOnly = Boolean(body.adminLocalOnly);
      }

      let refreshInkTelemetry = false;
      if (body.inkMonitoring) {
        const incoming = body.inkMonitoring;
        const current = db.data!.settings.inkMonitoring;
        const next = { ...current };
        const previousTargetPrinterName = current.targetPrinterName;
        if (incoming.enabled !== undefined) {
          if (typeof incoming.enabled !== 'boolean') {
            return res.status(400).json({ error: 'inkMonitoring.enabled must be boolean.' });
          }
          next.enabled = incoming.enabled;
        }
        if (incoming.targetPrinterName !== undefined) {
          if (
            incoming.targetPrinterName !== null &&
            typeof incoming.targetPrinterName !== 'string'
          ) {
            return res
              .status(400)
              .json({ error: 'inkMonitoring.targetPrinterName must be string or null.' });
          }
          next.targetPrinterName = normalizeTargetPrinterName(
            incoming.targetPrinterName,
          );
          refreshInkTelemetry = previousTargetPrinterName !== next.targetPrinterName;
        }
        if (incoming.lowThresholdPercent !== undefined) {
          if (
            !isFiniteNumber(incoming.lowThresholdPercent) ||
            incoming.lowThresholdPercent < 0 ||
            incoming.lowThresholdPercent > 100
          ) {
            return res
              .status(400)
              .json({ error: 'inkMonitoring.lowThresholdPercent must be 0..100.' });
          }
          next.lowThresholdPercent = Math.floor(incoming.lowThresholdPercent);
        }
        if (incoming.criticalThresholdPercent !== undefined) {
          if (
            !isFiniteNumber(incoming.criticalThresholdPercent) ||
            incoming.criticalThresholdPercent < 0 ||
            incoming.criticalThresholdPercent > 100
          ) {
            return res.status(400).json({
              error: 'inkMonitoring.criticalThresholdPercent must be 0..100.',
            });
          }
          next.criticalThresholdPercent = Math.floor(
            incoming.criticalThresholdPercent,
          );
        }
        if (next.criticalThresholdPercent > next.lowThresholdPercent) {
          return res.status(400).json({
            error:
              'inkMonitoring.criticalThresholdPercent cannot be greater than lowThresholdPercent.',
          });
        }
        if (incoming.blockOnLow !== undefined) {
          if (typeof incoming.blockOnLow !== 'boolean') {
            return res.status(400).json({ error: 'inkMonitoring.blockOnLow must be boolean.' });
          }
          next.blockOnLow = incoming.blockOnLow;
        }
        if (incoming.blockOnEmpty !== undefined) {
          if (typeof incoming.blockOnEmpty !== 'boolean') {
            return res
              .status(400)
              .json({ error: 'inkMonitoring.blockOnEmpty must be boolean.' });
          }
          next.blockOnEmpty = incoming.blockOnEmpty;
        }
        if (incoming.telemetryUnknownPolicy !== undefined) {
          if (
            incoming.telemetryUnknownPolicy !== 'warn_allow' &&
            incoming.telemetryUnknownPolicy !== 'block'
          ) {
            return res.status(400).json({
              error:
                'inkMonitoring.telemetryUnknownPolicy must be "warn_allow" or "block".',
            });
          }
          next.telemetryUnknownPolicy = incoming.telemetryUnknownPolicy;
        }

        db.data!.settings.inkMonitoring = next;
      }

      await db.write();
      if (refreshInkTelemetry) {
        try {
          await refreshPrinterTelemetry();
        } catch (error) {
          console.warn(
            '[ADMIN] Failed to refresh printer telemetry after target printer update.',
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      await adminService.appendAdminLog(
        'admin_settings_updated',
        'Admin settings updated.',
      );

      res.json(db.data!.settings);
    },
  );

  app.get(
    '/api/admin/alert-settings',
    requireAdminLocalAccess,
    requireAdminPin,
    (_req: Request, res: Response) => {
      res.json(toSafeAlertSettings(db.data!.settings.alerts));
    },
  );

  app.put(
    '/api/admin/alert-settings',
    requireAdminLocalAccess,
    requireAdminPin,
    async (req: Request, res: Response) => {
      const current = db.data!.settings.alerts;
      const parsed = parseAlertSettingsPayload(req.body, current);
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }

      await anomalyService.updateAlertSettings(parsed.next!);
      await adminService.appendAdminLog(
        'admin_alert_settings_updated',
        'Admin alert settings updated.',
      );
      res.json(toSafeAlertSettings(db.data!.settings.alerts));
    },
  );

  app.get(
    '/api/admin/printer/list',
    requireAdminLocalAccess,
    requireAdminPin,
    async (_req: Request, res: Response) => {
      const printers = (await listInstalledPrinters()).map((printer) => ({
        name: printer.Name,
        driverName: printer.DriverName,
        portName: printer.PortName,
        isDefault: Boolean(printer.Default),
        printerStatus: printer.PrinterStatus,
        printerState: printer.PrinterState,
      }));
      res.json({
        printers,
        targetPrinterName: db.data!.settings.inkMonitoring.targetPrinterName,
      });
    },
  );

  app.get(
    '/api/admin/printer/ink-diagnostics',
    requireAdminLocalAccess,
    requireAdminPin,
    async (_req: Request, res: Response) => {
      const diagnostics = await runInkTelemetryDiagnostics();
      res.json(diagnostics);
    },
  );

  app.get(
    '/api/admin/printer/ink-history',
    requireAdminLocalAccess,
    requireAdminPin,
    (req: Request, res: Response) => {
      const requestedLimit = Number(req.query.limit ?? 100);
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(500, Math.floor(requestedLimit)))
        : 100;
      res.json({
        total: db.data!.inkHistory.length,
        items: db.data!.inkHistory.slice(0, limit),
      });
    },
  );

  app.post(
    '/api/admin/alert-settings/test',
    requireAdminLocalAccess,
    requireAdminPin,
    async (req: Request, res: Response) => {
      const parsed = parseAlertSettingsPayload(
        req.body,
        db.data!.settings.alerts,
      );
      if (parsed.error) {
        return res.status(400).json({ ok: false, error: parsed.error });
      }

      const result = await anomalyService.sendEmailTestAlert(parsed.next!);
      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.error });
      }
      res.json({ ok: true });
    },
  );

  app.get(
    '/api/admin/anomaly-incidents',
    requireAdminLocalAccess,
    requireAdminPin,
    (req: Request, res: Response) => {
      const statusRaw = req.query.status;
      const severityRaw = req.query.severity;
      const categoryRaw = req.query.category;
      const limitRaw = req.query.limit;
      const offsetRaw = req.query.offset;

      const status = isAnomalyStatus(statusRaw) ? statusRaw : undefined;
      const severity = isAnomalySeverity(severityRaw) ? severityRaw : undefined;
      const category = isAnomalyCategory(categoryRaw) ? categoryRaw : undefined;
      const limit = Number.isFinite(Number(limitRaw))
        ? Number(limitRaw)
        : undefined;
      const offset = Number.isFinite(Number(offsetRaw))
        ? Number(offsetRaw)
        : undefined;

      res.json(
        anomalyService.listIncidents({
          status,
          severity,
          category,
          limit,
          offset,
        }),
      );
    },
  );

  app.get(
    '/api/admin/anomaly-incidents/:id',
    requireAdminLocalAccess,
    requireAdminPin,
    (req: Request, res: Response) => {
      const incident = anomalyService.getIncidentById(req.params.id as string);
      if (!incident) {
        return res.status(404).json({ error: 'Anomaly incident not found.' });
      }
      res.json({ incident });
    },
  );

  app.patch(
    '/api/admin/anomaly-incidents/:id/status',
    requireAdminLocalAccess,
    requireAdminPin,
    async (req: Request, res: Response) => {
      const status = req.body?.status;
      if (!isAnomalyStatus(status)) {
        return res.status(400).json({
          error: 'Valid status required: open | acknowledged | resolved',
        });
      }

      const incident = await anomalyService.updateIncidentStatus(
        req.params.id as string,
        status,
      );
      if (!incident) {
        return res.status(404).json({ error: 'Anomaly incident not found.' });
      }

      res.json({ ok: true, incident });
    },
  );

  app.get(
    '/api/admin/logs',
    requireAdminLocalAccess,
    requireAdminPin,
    (req: Request, res: Response) => {
      const rawLimit = Number(req.query.limit ?? 200);
      const limit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(1000, Math.floor(rawLimit)))
        : 200;
      res.json({ logs: db.data!.logs.slice(0, limit) });
    },
  );

  app.get(
    '/api/admin/logs/export.csv',
    requireAdminLocalAccess,
    requireAdminPin,
    (_req: Request, res: Response) => {
      const csv = adminService.logsToCsv(db.data!.logs);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="printbit-admin-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      res.send(csv);
    },
  );

  app.delete(
    '/api/admin/logs',
    requireAdminLocalAccess,
    requireAdminPin,
    async (_req: Request, res: Response) => {
      db.data!.logs = [];
      await db.write();
      res.json({ ok: true });
    },
  );

  app.post(
    '/api/admin/balance/reset',
    requireAdminLocalAccess,
    requireAdminPin,
    async (_req: Request, res: Response) => {
      const previousBalance = db.data!.balance;
      db.data!.balance = 0;
      await db.write();
      await adminService.appendAdminLog(
        'admin_balance_reset',
        'Admin reset machine balance.',
        {
          previousBalance,
          newBalance: 0,
        },
      );

      res.json({
        ok: true,
        balance: db.data!.balance,
        earnings: db.data!.earnings,
      });
    },
  );

  app.post(
    '/api/admin/storage/clear',
    requireAdminLocalAccess,
    requireAdminPin,
    async (_req: Request, res: Response) => {
      const uploadDir = path.resolve(deps.uploadDir);
      if (!fs.existsSync(uploadDir)) {
        return res.json({ ok: true, removedFiles: 0 });
      }

      let removedFiles = 0;
      const entries = fs.readdirSync(uploadDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const fullPath = path.join(uploadDir, entry.name);
        fs.unlinkSync(fullPath);
        removedFiles += 1;
      }

      await adminService.appendAdminLog(
        'admin_storage_cleared',
        'Admin cleared upload storage.',
        {
          removedFiles,
        },
      );
      res.json({ ok: true, removedFiles });
    },
  );

  // ── Admin printer re-detect ────────────────────────────────────────────────
  //
  // Re-runs detectDefaultPrinter() (logs new hardware info to console) then
  // forces an immediate refresh of the telemetry cache and returns the result.
  // Use this after a printer swap, driver re-registration, or USB reconnect
  // so the admin panel reflects the new hardware without waiting for the next
  // 30-second automatic poll cycle.

  app.post(
    '/api/admin/printer/re-detect',
    requireAdminLocalAccess,
    requireAdminPin,
    async (_req: Request, res: Response) => {
      // Re-run the startup printer detection so updated driver/port info is
      // written to the server console (useful for operator diagnostics).
      await detectDefaultPrinter();

      // Force-refresh the telemetry cache and return the fresh snapshot.
      const telemetry = await refreshPrinterTelemetry();

      await adminService.appendAdminLog(
        'admin_printer_redetected',
        `Admin triggered printer re-detection. Result: "${telemetry.name ?? 'none'}" — ${telemetry.status}.`,
        {
          printerName: telemetry.name ?? null,
          printerStatus: telemetry.status,
          connected: telemetry.connected,
          driverName: telemetry.driverName ?? null,
          portName: telemetry.portName ?? null,
          connectionType: telemetry.connectionType,
        },
      );

      res.json({
        ok: true,
        printer: telemetry,
      });
    },
  );

  // ── Admin test-print ───────────────────────────────────────────────────────
  //
  // Generates a built-in test page PDF and sends it to the default Windows
  // printer via SumatraPDF. No balance is checked or charged. Use this after
  // a printer swap or driver re-registration to confirm the hardware is ready.

  app.post(
    '/api/admin/printer/test-print',
    requireAdminLocalAccess,
    requireAdminPin,
    async (_req: Request, res: Response) => {
      const telemetry = getPrinterTelemetry();

      if (!telemetry.connected || !telemetry.name) {
        await adminService.appendAdminLog(
          'admin_test_print_failed',
          'Admin test print skipped: no printer connected.',
          { printerStatus: telemetry.status },
        );
        return res.status(503).json({
          ok: false,
          error: 'No printer is currently connected or detected.',
          printerStatus: telemetry.status,
        });
      }

      // Write a temp PDF into the uploads dir so printFile() can resolve it
      const tmpFilename = `test-print-${Date.now()}.pdf`;
      const tmpAbsPath = path.resolve(deps.uploadDir, tmpFilename);

      try {
        const pdfBuffer = generateTestPagePdf(new Date());
        fs.writeFileSync(tmpAbsPath, pdfBuffer);

        await printFile(tmpFilename, {
          copies: 1,
          colorMode: 'grayscale',
          orientation: 'portrait',
          paperSize: 'A4',
        });

        await adminService.appendAdminLog(
          'admin_test_print',
          `Admin triggered test print on "${telemetry.name}".`,
          {
            printerName: telemetry.name,
            printerStatus: telemetry.status,
            driverName: telemetry.driverName ?? null,
            portName: telemetry.portName ?? null,
          },
        );

        res.json({
          ok: true,
          printerName: telemetry.name,
          printerStatus: telemetry.status,
          message: `Test page sent to "${telemetry.name}". Check the printer output tray.`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        await adminService.appendAdminLog(
          'admin_test_print_failed',
          `Admin test print failed on "${telemetry.name}".`,
          {
            printerName: telemetry.name,
            error: message,
          },
        );
        res.status(500).json({
          ok: false,
          error: message,
          printerName: telemetry.name,
        });
      } finally {
        // Always remove the temp file regardless of success/failure
        try {
          fs.unlinkSync(tmpAbsPath);
        } catch {
          /* ignore — file may not exist if writeFileSync itself failed */
        }
      }
    },
  );

  // ── Owed change management ─────────────────────────────────────────────────

  app.get(
    '/api/admin/owed-changes',
    requireAdminLocalAccess,
    requireAdminPin,
    (_req: Request, res: Response) => {
      const entries = db.data!.owedChanges ?? [];
      const open = entries.filter((e) => e.status === 'open');
      const resolved = entries.filter((e) => e.status === 'resolved');
      res.json({
        total: entries.length,
        openCount: open.length,
        resolvedCount: resolved.length,
        entries,
      });
    },
  );

  app.post(
    '/api/admin/owed-changes/:id/resolve',
    requireAdminLocalAccess,
    requireAdminPin,
    async (req: Request, res: Response) => {
      const entryId = req.params.id as string;
      const entry = db.data!.owedChanges.find((e) => e.id === entryId);
      if (!entry) {
        return res.status(404).json({ error: 'Owed change entry not found.' });
      }
      if (entry.status === 'resolved') {
        return res.status(409).json({ error: 'Already resolved.' });
      }

      entry.status = 'resolved';
      await db.write();

      await adminService.appendAdminLog(
        'owed_change_resolved',
        `Owed change ₱${entry.amount} resolved by admin.`,
        { entryId, amount: entry.amount, reason: entry.reason },
      );

      res.json({ ok: true, entry });
    },
  );

  app.post(
    '/api/admin/owed-changes/resolve-all',
    requireAdminLocalAccess,
    requireAdminPin,
    async (_req: Request, res: Response) => {
      let count = 0;
      for (const entry of db.data!.owedChanges) {
        if (entry.status === 'open') {
          entry.status = 'resolved';
          count += 1;
        }
        }
      await db.write();

      if (count > 0) {
        await adminService.appendAdminLog(
          'owed_changes_bulk_resolved',
          `Admin resolved ${count} owed change entries.`,
          { count },
        );
      }

      res.json({ ok: true, resolvedCount: count });
    },
  );

  // ── Pending refund management ──────────────────────────────────────────────
  //
  // Pending refunds are created automatically when the Windows print spooler
  // reports a job failure AFTER the user's balance has already been settled.
  // The admin can either:
  //   - Restore the amount to the current machine balance (user still present)
  //   - Dismiss the entry (no action — e.g. partial print was acceptable)

  app.get(
    '/api/admin/pending-refunds',
    requireAdminLocalAccess,
    requireAdminPin,
    (req: Request, res: Response) => {
      const entries = db.data!.pendingRefunds ?? [];
      const statusFilter = req.query.status as string | undefined;

      const filtered =
        statusFilter === 'open' ||
        statusFilter === 'refunded' ||
        statusFilter === 'dismissed'
          ? entries.filter((e) => e.status === statusFilter)
          : entries;

      const open = entries.filter((e) => e.status === 'open');
      const refunded = entries.filter((e) => e.status === 'refunded');
      const dismissed = entries.filter((e) => e.status === 'dismissed');

      res.json({
        total: entries.length,
        openCount: open.length,
        refundedCount: refunded.length,
        dismissedCount: dismissed.length,
        entries: filtered,
      });
    },
  );

  /**
   * POST /api/admin/pending-refunds/:id/refund
   *
   * Marks the entry as refunded and optionally restores the charged amount
   * to the machine balance so the user (if still present) can retry.
   *
   * Body: { restoreBalance?: boolean }  — defaults to true
   */
  app.post(
    '/api/admin/pending-refunds/:id/refund',
    requireAdminLocalAccess,
    requireAdminPin,
    async (req: Request, res: Response) => {
      const entryId = req.params.id as string;
      const restoreBalance =
        typeof req.body?.restoreBalance === 'boolean'
          ? req.body.restoreBalance
          : true;

      try {
        const result = await processPendingRefund({ entryId, restoreBalance });
        deps.io.emit('balance', result.balance);

        try {
          await adminService.appendAdminLog(
            'pending_refund_processed',
            `Pending refund ₱${result.entry.chargedAmount} processed by admin.`,
            {
              refundId: result.entry.id,
              chargedAmount: result.entry.chargedAmount,
              restoreBalance,
              newBalance: result.balance,
              reason: result.entry.reason,
            },
          );
        } catch (error) {
          console.error(
            '[ADMIN] Failed to log pending refund processing',
            error,
          );
        }

        res.json({
          ok: true,
          entry: result.entry,
          balance: result.balance,
          restoreBalance,
        });
      } catch (error) {
        if (error instanceof PendingRefundServiceError) {
          if (error.code === 'TRUSTED_TIME_UNAVAILABLE') {
            return res.status(error.statusCode).json({
              code: error.code,
              error: error.message,
              ...(error.context ?? {}),
            });
          }
          return res.status(error.statusCode).json({ error: error.message });
        }
        console.error('[ADMIN] Failed to process pending refund', error);
        return res.status(500).json({ error: 'Failed to process refund.' });
      }
    },
  );

  /**
   * POST /api/admin/pending-refunds/:id/dismiss
   *
   * Closes the entry without restoring balance (e.g. the partial printout
   * was acceptable or the user has already left).
   */
  app.post(
    '/api/admin/pending-refunds/:id/dismiss',
    requireAdminLocalAccess,
    requireAdminPin,
    async (req: Request, res: Response) => {
      const entryId = req.params.id as string;
      try {
        const entry = await dismissPendingRefund(entryId);
        try {
          await adminService.appendAdminLog(
            'pending_refund_dismissed',
            `Pending refund ₱${entry.chargedAmount} dismissed by admin (no balance restored).`,
            {
              refundId: entry.id,
              chargedAmount: entry.chargedAmount,
              reason: entry.reason,
            },
          );
        } catch (error) {
          console.error(
            '[ADMIN] Failed to log pending refund dismissal',
            error,
          );
        }

        res.json({ ok: true, entry });
      } catch (error) {
        if (error instanceof PendingRefundServiceError) {
          if (error.code === 'TRUSTED_TIME_UNAVAILABLE') {
            return res.status(error.statusCode).json({
              code: error.code,
              error: error.message,
              ...(error.context ?? {}),
            });
          }
          return res.status(error.statusCode).json({ error: error.message });
        }
        console.error('[ADMIN] Failed to dismiss pending refund', error);
        return res.status(500).json({ error: 'Failed to dismiss refund.' });
      }
    },
  );
}
