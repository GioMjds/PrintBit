import { finiteOr } from '@/utils';
import { DEFAULT_DATA } from './defaults';
import type { Schema } from './schema';

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

export function normalizeSchema(data: Partial<Schema> | undefined): Schema {
  const pricing = data?.settings?.pricing;
  const hopperSettings = data?.hopperSettings;
  const hopperStats = data?.hopperStats;

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
  };
}
