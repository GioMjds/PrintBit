import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { finiteOr } from '@/utils';

export type PrintMode = 'print' | 'copy' | 'scan';
export type ColorMode = 'colored' | 'grayscale';
export type AdminLockout = {
  failedAttempts: number;
  lockedUntil: string | null;
};

export interface PricingSettings {
  printPerPage: number;
  copyPerPage: number;
  scanDocument: number;
  colorSurcharge: number;
}

export interface AdminSettings {
  pricing: PricingSettings;
  idleTimeoutSeconds: number;
  adminPin: string;
  adminLocalOnly: boolean;
  alerts: AlertSettings;
}

export type AlertChannel = 'dashboard' | 'email';
export type AnomalySeverity = 'warning' | 'critical';
export type AnomalyStatus = 'open' | 'acknowledged' | 'resolved';
export type AnomalyCategory =
  | 'printer'
  | 'spooler'
  | 'serial'
  | 'hopper'
  | 'network';

export interface AlertDashboardSettings {
  enabled: boolean;
}

export interface AlertEmailSettings {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  secure: boolean;
  username: string;
  from: string;
  to: string;
}

export interface AlertDedupeSettings {
  printerMs: number;
  spoolerMs: number;
  serialMs: number;
  hopperMs: number;
  networkMs: number;
}

export interface AlertSettings {
  severityThreshold: AnomalySeverity;
  dashboard: AlertDashboardSettings;
  email: AlertEmailSettings;
  dedupe: AlertDedupeSettings;
}

export interface AnomalyIncidentEntry {
  id: string;
  type: string;
  source: string;
  category: AnomalyCategory;
  severity: AnomalySeverity;
  status: AnomalyStatus;
  fingerprint: string;
  message: string;
  context?: LogMeta;
  occurrenceCount: number;
  firstDetectedAt: string;
  lastDetectedAt: string;
  createdAt: string;
  updatedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  lastNotificationAt: string | null;
  lastNotifiedChannels: AlertChannel[];
}

export interface CoinStats {
  one: number;
  five: number;
  ten: number;
  twenty: number;
}

export interface JobStats {
  total: number;
  print: number;
  copy: number;
  scan: number;
}

export interface HopperSettings {
  enabled: boolean;
  timeoutMs: number;
  retryCount: number;
  dispenseCommandPrefix: string;
  selfTestCommand: string;
}

export interface HopperStats {
  dispenseAttempts: number;
  dispenseSuccess: number;
  dispenseFailures: number;
  totalDispensed: number;
  lastDispensedAt: string | null;
  lastError: string | null;
  selfTestPassed: boolean | null;
  lastSelfTestAt: string | null;
}

export interface OwedChangeEntry {
  id: string;
  timestamp: string;
  amount: number;
  reason: string;
  status: 'open' | 'resolved';
  meta?: LogMeta;
}

export type LogMeta = Record<string, string | number | boolean | null>;

export type TrustedTimestampSource = 'ntp' | 'system';

export interface TrustedTimestampMeta {
  source: TrustedTimestampSource;
  synced: boolean;
  offsetMs: number | null;
  detail: string | null;
}

export type FinancialEventType =
  | 'coin_inserted'
  | 'job_started'
  | 'job_completed'
  | 'refund_issued'
  | 'variance_alert';

export interface FinancialLedgerEntry {
  id: string;
  timestamp: string;
  timestampMeta: TrustedTimestampMeta;
  eventType: FinancialEventType;
  amount: number;
  referenceId: string | null;
  meta: LogMeta;
  previousHash: string | null;
  hash: string;
}

export interface AdminLogEntry {
  id: string;
  timestamp: string;
  type: string;
  message: string;
  meta?: LogMeta;
}

export type FeedbackCategory =
  | 'service'
  | 'hardware'
  | 'software'
  | 'print'
  | 'scan'
  | 'copy'
  | 'payment'
  | 'other';

export type FeedbackStatus = 'open' | 'resolved';

export interface FeedbackEntry {
  id: string;
  sessionId: string;
  timestamp: string;
  comment: string;
  category: FeedbackCategory | null;
  rating: number | null;
  status: FeedbackStatus;
  resolvedAt?: string | null;
  meta?: LogMeta;
}

export interface FeedbackSessionEntry {
  id: string;
  token: string;
  feedbackUrl: string;
  createdAt: string;
  expiresAt: string;
  submittedAt: string | null;
}

export type ReportIssueCategory =
  | 'hardware'
  | 'software'
  | 'print'
  | 'copy'
  | 'scan'
  | 'payment'
  | 'network'
  | 'other';

export type ReportIssueStatus = 'open' | 'acknowledged' | 'resolved';

export interface ReportIssueSessionEntry {
  id: string;
  token: string;
  reportUrl: string;
  createdAt: string;
  expiresAt: string;
  submittedAt: string | null;
}

export interface ReportIssueAttachmentEntry {
  id: string;
  sessionId: string;
  reportIssueId: string | null;
  timestamp: string;
  originalName: string;
  storedName: string;
  contentType: string;
  sizeBytes: number;
  filePath: string;
}

export interface ReportIssueEntry {
  id: string;
  sessionId: string;
  timestamp: string;
  title: string;
  description: string;
  category: ReportIssueCategory;
  status: ReportIssueStatus;
  attachmentIds: string[];
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  meta?: LogMeta;
}

export interface PendingRefundEntry {
  id: string;
  timestamp: string;
  chargedAmount: number;
  reason: string;
  status: 'open' | 'refunded' | 'dismissed';
  closedAt: string | null;
  jobContext: Record<string, string | number | boolean | null>;
}

export type Schema = {
  adminLockout: AdminLockout;
  balance: number;
  earnings: number;
  settings: AdminSettings;
  coinStats: CoinStats;
  jobStats: JobStats;
  hopperSettings: HopperSettings;
  hopperStats: HopperStats;
  owedChanges: OwedChangeEntry[];
  logs: AdminLogEntry[];
  feedback: FeedbackEntry[];
  feedbackSessions: FeedbackSessionEntry[];
  reportIssues: ReportIssueEntry[];
  reportIssueSessions: ReportIssueSessionEntry[];
  reportIssueAttachments: ReportIssueAttachmentEntry[];
  pendingRefunds: PendingRefundEntry[];
  anomalyIncidents: AnomalyIncidentEntry[];
  financialLedger: FinancialLedgerEntry[];
};

const DEFAULT_DATA: Schema = {
  adminLockout: {
    failedAttempts: 0,
    lockedUntil: null,
  },
  balance: 0,
  earnings: 0,
  settings: {
    pricing: {
      printPerPage: 5,
      copyPerPage: 3,
      scanDocument: 5,
      colorSurcharge: 2,
    },
    idleTimeoutSeconds: 120,
    adminPin:
      '$argon2id$v=19$m=65536,t=3,p=4$gqSpsbLttLcalBC6SYKG0A$T34vxa4BxPcJ++fLZ+19qp9FGaQufJCCCqWu1fb35TQ',
    adminLocalOnly: true,
    alerts: {
      severityThreshold: 'warning',
      dashboard: {
        enabled: true,
      },
      email: {
        enabled: false,
        smtpHost: '',
        smtpPort: 587,
        secure: false,
        username: '',
        from: '',
        to: '',
      },
      dedupe: {
        printerMs: 5 * 60 * 1_000,
        spoolerMs: 5 * 60 * 1_000,
        serialMs: 2 * 60 * 1_000,
        hopperMs: 2 * 60 * 1_000,
        networkMs: 5 * 60 * 1_000,
      },
    },
  },
  coinStats: {
    one: 0,
    five: 0,
    ten: 0,
    twenty: 0,
  },
  jobStats: {
    total: 0,
    print: 0,
    copy: 0,
    scan: 0,
  },
  hopperSettings: {
    enabled: true,
    timeoutMs: 8000,
    retryCount: 1,
    dispenseCommandPrefix: 'HOPPER DISPENSE',
    selfTestCommand: 'HOPPER SELFTEST',
  },
  hopperStats: {
    dispenseAttempts: 0,
    dispenseSuccess: 0,
    dispenseFailures: 0,
    totalDispensed: 0,
    lastDispensedAt: null,
    lastError: null,
    selfTestPassed: null,
    lastSelfTestAt: null,
  },
  owedChanges: [],
  logs: [],
  feedback: [],
  feedbackSessions: [],
  reportIssues: [],
  reportIssueSessions: [],
  reportIssueAttachments: [],
  pendingRefunds: [],
  anomalyIncidents: [],
  financialLedger: [],
};

/**
 * Round a pricing value to a whole peso. The hopper only dispenses 1-peso
 * coins so all prices must be integers. Legacy fractional values in db.json
 * are silently rounded up on startup so the operator never under-charges.
 */
function wholePeso(value: number): number {
  const nonNegative = Math.max(0, value);
  const rounded = Math.ceil(nonNegative);
  if (rounded !== value) {
    console.warn(
      `[DB] ⚠ Pricing value ${value} is not a whole peso — rounded to ${rounded}. Update admin settings to remove this warning.`,
    );
  }
  return rounded;
}

function normalizeSchema(data: Partial<Schema> | undefined): Schema {
  const pricing = data?.settings?.pricing;
  const alertSettings = data?.settings?.alerts;
  const hopperSettings = data?.hopperSettings;
  const hopperStats = data?.hopperStats;
  const normalizeAnomalyIncidents = (
    raw: unknown,
  ): AnomalyIncidentEntry[] => {
    if (!Array.isArray(raw)) return DEFAULT_DATA.anomalyIncidents;
    const incidents: AnomalyIncidentEntry[] = [];
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) {
        console.warn(
          '[DB] Skipping malformed anomaly incident row (not an object).',
        );
        continue;
      }
      const candidate = entry as Partial<AnomalyIncidentEntry>;
      if (
        typeof candidate.id !== 'string' ||
        typeof candidate.type !== 'string' ||
        typeof candidate.source !== 'string' ||
        typeof candidate.fingerprint !== 'string'
      ) {
        console.warn(
          '[DB] Skipping malformed anomaly incident row (missing required keys).',
        );
        continue;
      }
      incidents.push({
        id: candidate.id,
        type: candidate.type,
        source: candidate.source,
        category:
          candidate.category === 'printer' ||
          candidate.category === 'spooler' ||
          candidate.category === 'serial' ||
          candidate.category === 'hopper' ||
          candidate.category === 'network'
            ? candidate.category
            : 'printer',
        severity: candidate.severity === 'critical' ? 'critical' : 'warning',
        status:
          candidate.status === 'acknowledged' || candidate.status === 'resolved'
            ? candidate.status
            : 'open',
        fingerprint: candidate.fingerprint,
        message: typeof candidate.message === 'string' ? candidate.message : '',
        context:
          typeof candidate.context === 'object' && candidate.context !== null
            ? candidate.context
            : undefined,
        occurrenceCount: finiteOr(candidate.occurrenceCount, 1),
        firstDetectedAt:
          typeof candidate.firstDetectedAt === 'string'
            ? candidate.firstDetectedAt
            : new Date(0).toISOString(),
        lastDetectedAt:
          typeof candidate.lastDetectedAt === 'string'
            ? candidate.lastDetectedAt
            : new Date(0).toISOString(),
        createdAt:
          typeof candidate.createdAt === 'string'
            ? candidate.createdAt
            : new Date(0).toISOString(),
        updatedAt:
          typeof candidate.updatedAt === 'string'
            ? candidate.updatedAt
            : new Date(0).toISOString(),
        acknowledgedAt:
          typeof candidate.acknowledgedAt === 'string'
            ? candidate.acknowledgedAt
            : null,
        resolvedAt: typeof candidate.resolvedAt === 'string' ? candidate.resolvedAt : null,
        lastNotificationAt:
          typeof candidate.lastNotificationAt === 'string'
            ? candidate.lastNotificationAt
            : null,
        lastNotifiedChannels: Array.isArray(candidate.lastNotifiedChannels)
          ? candidate.lastNotifiedChannels.filter(
              (channel): channel is AlertChannel =>
                channel === 'dashboard' || channel === 'email',
            )
          : [],
      });
    }
    return incidents;
  };

  return {
    adminLockout: {
      failedAttempts: finiteOr(data?.adminLockout?.failedAttempts, 0),
      lockedUntil:
        typeof data?.adminLockout?.lockedUntil === 'string'
          ? data.adminLockout.lockedUntil
          : DEFAULT_DATA.adminLockout.lockedUntil,
    },
    balance: finiteOr(data?.balance, DEFAULT_DATA.balance),
    earnings: finiteOr(data?.earnings, DEFAULT_DATA.earnings),
    settings: {
      pricing: {
        printPerPage: wholePeso(
          finiteOr(
            pricing?.printPerPage,
            DEFAULT_DATA.settings.pricing.printPerPage,
          ),
        ),
        copyPerPage: wholePeso(
          finiteOr(
            pricing?.copyPerPage,
            DEFAULT_DATA.settings.pricing.copyPerPage,
          ),
        ),
        scanDocument: wholePeso(
          finiteOr(
            pricing?.scanDocument,
            DEFAULT_DATA.settings.pricing.scanDocument,
          ),
        ),
        colorSurcharge: wholePeso(
          finiteOr(
            pricing?.colorSurcharge,
            DEFAULT_DATA.settings.pricing.colorSurcharge,
          ),
        ),
      },
      idleTimeoutSeconds: finiteOr(
        data?.settings?.idleTimeoutSeconds,
        DEFAULT_DATA.settings.idleTimeoutSeconds,
      ),
      adminPin:
        typeof data?.settings?.adminPin === 'string' &&
        data.settings.adminPin.trim()
          ? data.settings.adminPin
          : DEFAULT_DATA.settings.adminPin,
      adminLocalOnly:
        typeof data?.settings?.adminLocalOnly === 'boolean'
          ? data.settings.adminLocalOnly
          : DEFAULT_DATA.settings.adminLocalOnly,
      alerts: {
        severityThreshold:
          alertSettings?.severityThreshold === 'critical'
            ? 'critical'
            : DEFAULT_DATA.settings.alerts.severityThreshold,
        dashboard: {
          enabled:
            typeof alertSettings?.dashboard?.enabled === 'boolean'
              ? alertSettings.dashboard.enabled
              : DEFAULT_DATA.settings.alerts.dashboard.enabled,
        },
        email: {
          enabled:
            typeof alertSettings?.email?.enabled === 'boolean'
              ? alertSettings.email.enabled
              : DEFAULT_DATA.settings.alerts.email.enabled,
          smtpHost:
            typeof alertSettings?.email?.smtpHost === 'string'
              ? alertSettings.email.smtpHost
              : DEFAULT_DATA.settings.alerts.email.smtpHost,
          smtpPort: finiteOr(
            alertSettings?.email?.smtpPort,
            DEFAULT_DATA.settings.alerts.email.smtpPort,
          ),
          secure:
            typeof alertSettings?.email?.secure === 'boolean'
              ? alertSettings.email.secure
              : DEFAULT_DATA.settings.alerts.email.secure,
          username:
            typeof alertSettings?.email?.username === 'string'
              ? alertSettings.email.username
              : DEFAULT_DATA.settings.alerts.email.username,
          from:
            typeof alertSettings?.email?.from === 'string'
              ? alertSettings.email.from
              : DEFAULT_DATA.settings.alerts.email.from,
          to:
            typeof alertSettings?.email?.to === 'string'
              ? alertSettings.email.to
              : DEFAULT_DATA.settings.alerts.email.to,
        },
        dedupe: {
          printerMs: finiteOr(
            alertSettings?.dedupe?.printerMs,
            DEFAULT_DATA.settings.alerts.dedupe.printerMs,
          ),
          spoolerMs: finiteOr(
            alertSettings?.dedupe?.spoolerMs,
            DEFAULT_DATA.settings.alerts.dedupe.spoolerMs,
          ),
          serialMs: finiteOr(
            alertSettings?.dedupe?.serialMs,
            DEFAULT_DATA.settings.alerts.dedupe.serialMs,
          ),
          hopperMs: finiteOr(
            alertSettings?.dedupe?.hopperMs,
            DEFAULT_DATA.settings.alerts.dedupe.hopperMs,
          ),
          networkMs: finiteOr(
            alertSettings?.dedupe?.networkMs,
            DEFAULT_DATA.settings.alerts.dedupe.networkMs,
          ),
        },
      },
    },
    coinStats: {
      one: finiteOr(data?.coinStats?.one, DEFAULT_DATA.coinStats.one),
      five: finiteOr(data?.coinStats?.five, DEFAULT_DATA.coinStats.five),
      ten: finiteOr(data?.coinStats?.ten, DEFAULT_DATA.coinStats.ten),
      twenty: finiteOr(data?.coinStats?.twenty, DEFAULT_DATA.coinStats.twenty),
    },
    jobStats: {
      total: finiteOr(data?.jobStats?.total, DEFAULT_DATA.jobStats.total),
      print: finiteOr(data?.jobStats?.print, DEFAULT_DATA.jobStats.print),
      copy: finiteOr(data?.jobStats?.copy, DEFAULT_DATA.jobStats.copy),
      scan: finiteOr(data?.jobStats?.scan, DEFAULT_DATA.jobStats.scan),
    },
    hopperSettings: {
      enabled:
        typeof hopperSettings?.enabled === 'boolean'
          ? hopperSettings.enabled
          : DEFAULT_DATA.hopperSettings.enabled,
      timeoutMs: finiteOr(
        hopperSettings?.timeoutMs,
        DEFAULT_DATA.hopperSettings.timeoutMs,
      ),
      retryCount: finiteOr(
        hopperSettings?.retryCount,
        DEFAULT_DATA.hopperSettings.retryCount,
      ),
      dispenseCommandPrefix:
        typeof hopperSettings?.dispenseCommandPrefix === 'string' &&
        hopperSettings.dispenseCommandPrefix.trim()
          ? hopperSettings.dispenseCommandPrefix
          : DEFAULT_DATA.hopperSettings.dispenseCommandPrefix,
      selfTestCommand:
        typeof hopperSettings?.selfTestCommand === 'string' &&
        hopperSettings.selfTestCommand.trim()
          ? hopperSettings.selfTestCommand
          : DEFAULT_DATA.hopperSettings.selfTestCommand,
    },
    hopperStats: {
      dispenseAttempts: finiteOr(
        hopperStats?.dispenseAttempts,
        DEFAULT_DATA.hopperStats.dispenseAttempts,
      ),
      dispenseSuccess: finiteOr(
        hopperStats?.dispenseSuccess,
        DEFAULT_DATA.hopperStats.dispenseSuccess,
      ),
      dispenseFailures: finiteOr(
        hopperStats?.dispenseFailures,
        DEFAULT_DATA.hopperStats.dispenseFailures,
      ),
      totalDispensed: finiteOr(
        hopperStats?.totalDispensed,
        DEFAULT_DATA.hopperStats.totalDispensed,
      ),
      lastDispensedAt:
        typeof hopperStats?.lastDispensedAt === 'string'
          ? hopperStats.lastDispensedAt
          : DEFAULT_DATA.hopperStats.lastDispensedAt,
      lastError:
        typeof hopperStats?.lastError === 'string'
          ? hopperStats.lastError
          : DEFAULT_DATA.hopperStats.lastError,
      selfTestPassed:
        typeof hopperStats?.selfTestPassed === 'boolean'
          ? hopperStats.selfTestPassed
          : DEFAULT_DATA.hopperStats.selfTestPassed,
      lastSelfTestAt:
        typeof hopperStats?.lastSelfTestAt === 'string'
          ? hopperStats.lastSelfTestAt
          : DEFAULT_DATA.hopperStats.lastSelfTestAt,
    },
    owedChanges: Array.isArray(data?.owedChanges)
      ? data.owedChanges
      : DEFAULT_DATA.owedChanges,
    logs: Array.isArray(data?.logs) ? data.logs : DEFAULT_DATA.logs,
    feedback: Array.isArray(data?.feedback)
      ? data.feedback
      : DEFAULT_DATA.feedback,
    feedbackSessions: Array.isArray(data?.feedbackSessions)
      ? data.feedbackSessions
      : DEFAULT_DATA.feedbackSessions,
    reportIssues: Array.isArray(data?.reportIssues)
      ? data.reportIssues
      : DEFAULT_DATA.reportIssues,
    reportIssueSessions: Array.isArray(data?.reportIssueSessions)
      ? data.reportIssueSessions
      : DEFAULT_DATA.reportIssueSessions,
    reportIssueAttachments: Array.isArray(data?.reportIssueAttachments)
      ? data.reportIssueAttachments
      : DEFAULT_DATA.reportIssueAttachments,
    pendingRefunds: Array.isArray(data?.pendingRefunds)
      ? data.pendingRefunds
      : DEFAULT_DATA.pendingRefunds,
    anomalyIncidents: normalizeAnomalyIncidents(data?.anomalyIncidents),
    financialLedger: Array.isArray(data?.financialLedger)
      ? data.financialLedger
      : DEFAULT_DATA.financialLedger,
  };
}

const adapter = new JSONFile<Schema>('db.json');
export const db = new Low(adapter, DEFAULT_DATA);

export async function initDB() {
  try {
    await db.read();
  } catch (err) {
    // If the file is empty or malformed, initialize with defaults
    db.data = { ...DEFAULT_DATA };
    await db.write();
    return;
  }

  try {
    db.data = normalizeSchema(db.data);
  } catch (error) {
    console.error('[DB] Failed to normalize database after db.read().', {
      error: error instanceof Error ? error.message : String(error),
    });
    db.data = { ...DEFAULT_DATA };
  }
  await db.write();
}

// ── Balance mutex ─────────────────────────────────────────────────────────────
// Serialises concurrent balance/earnings mutations for the payment endpoints
// (/api/confirm-payment and the /api/copy/jobs charge path).
// Other paths (serial coin events, admin/test balance routes) do not hold this
// lock; they are low-frequency and safe to interleave with coin acceptance.

let balanceLockPromise = Promise.resolve();

export async function withBalanceLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = balanceLockPromise;
  let release: () => void;
  balanceLockPromise = new Promise<void>((r) => {
    release = r;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release!();
  }
}

// ── Idempotency key store ────────────────────────────────────────────────────
// Prevents double-charge from retry/double-click on payment endpoints.
// Keys are namespaced by route (e.g. "POST:/api/confirm-payment") to avoid
// cross-endpoint collisions. An in-flight Promise is stored synchronously as
// soon as a key is claimed, so concurrent duplicate requests wait for the
// first to complete rather than both proceeding independently.

const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface IdempotencyEntry {
  response: unknown;
  statusCode: number;
  expiresAt: number;
}

interface InFlightEntry {
  promise: Promise<IdempotencyEntry | null>;
  resolve: (entry: IdempotencyEntry | null) => void;
}

const idempotencyStore = new Map<string, IdempotencyEntry>();
const idempotencyInFlight = new Map<string, InFlightEntry>();

function namespacedKey(key: string, namespace: string): string {
  return `${namespace}\x00${key}`;
}

/** Creates a Promise together with its resolve function. */
function makeDeferred(): {
  promise: Promise<IdempotencyEntry | null>;
  resolve: (entry: IdempotencyEntry | null) => void;
} {
  let resolve!: (entry: IdempotencyEntry | null) => void;
  const promise = new Promise<IdempotencyEntry | null>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Try to claim an idempotency key for the given namespace.
 *
 * Returns:
 *  - `{ type: "hit", entry }` — a completed response is cached; replay it.
 *  - `{ type: "inflight", promise }` — another request is processing this key;
 *    await the promise and replay (or 503 if it resolves to null).
 *  - `{ type: "claimed" }` — this call has reserved the key; proceed with the
 *    request and then call `storeIdempotencyKey` or `releaseIdempotencyKey`.
 */
export function acquireIdempotencyKey(
  key: string,
  namespace: string,
):
  | { type: 'hit'; entry: IdempotencyEntry }
  | { type: 'inflight'; promise: Promise<IdempotencyEntry | null> }
  | { type: 'claimed' } {
  const nk = namespacedKey(key, namespace);

  const completed = idempotencyStore.get(nk);
  if (completed) {
    if (Date.now() <= completed.expiresAt)
      return { type: 'hit', entry: completed };
    idempotencyStore.delete(nk);
  }

  const inFlight = idempotencyInFlight.get(nk);
  if (inFlight) return { type: 'inflight', promise: inFlight.promise };

  // Reserve the slot with a deferred promise so concurrent duplicates wait.
  const deferred = makeDeferred();
  idempotencyInFlight.set(nk, deferred);
  return { type: 'claimed' };
}

/** Finalise a claimed slot with the actual response. */
export function storeIdempotencyKey(
  key: string,
  namespace: string,
  statusCode: number,
  response: unknown,
): void {
  const nk = namespacedKey(key, namespace);
  const entry: IdempotencyEntry = {
    response,
    statusCode,
    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
  };
  idempotencyStore.set(nk, entry);
  const inFlight = idempotencyInFlight.get(nk);
  if (inFlight) {
    inFlight.resolve(entry);
    idempotencyInFlight.delete(nk);
  }
}

/**
 * Release a claimed slot without caching a response (e.g. on server error).
 * Waiting duplicates will receive `null` and should return 503.
 */
export function releaseIdempotencyKey(key: string, namespace: string): void {
  const nk = namespacedKey(key, namespace);
  const inFlight = idempotencyInFlight.get(nk);
  if (inFlight) {
    inFlight.resolve(null);
    idempotencyInFlight.delete(nk);
  }
}

// Periodic cleanup of expired idempotency keys
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of idempotencyStore) {
    if (now > entry.expiresAt) idempotencyStore.delete(key);
  }
}, IDEMPOTENCY_TTL_MS);
