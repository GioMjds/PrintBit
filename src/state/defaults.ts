import type { Schema } from './schema';

export const DEFAULT_DATA: Schema = {
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
};
