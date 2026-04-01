'use strict';

const path = require('node:path');

const args = new Set(process.argv.slice(2));
const showHelp = args.has('--help') || args.has('-h');
const dryRun = args.has('--dry-run');

if (showHelp) {
  console.log(`Usage: node scripts/reset-db.js [--dry-run]

Resets PrintBit SQLite-backed runtime data while preserving configuration.

What it resets:
- Balance and earnings counters
- Coin/job statistics
- Hopper runtime stats
- Owed change, pending refund, anomaly, ledger, ink history, recovery sessions
- Admin logs, feedback entries/sessions, report issue entries/sessions/attachments

What it preserves:
- Admin/settings configuration (pricing, admin PIN hash, alert config, etc.)
- Hopper settings configuration
`);
  process.exit(0);
}

const repoRoot = path.resolve(__dirname, '..');
process.chdir(repoRoot);

require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const { initDB, db } = require('../src/services/db');
const { getSqliteDb, initSqliteStorage } = require('../src/core/database/sqlite-storage');

function buildResetState(current) {
  return {
    ...current,
    adminLockout: {
      failedAttempts: 0,
      lockedUntil: null,
    },
    balance: 0,
    earnings: 0,
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
    inkHistory: [],
    recovery: {
      lifecycle: {
        bootCount: 0,
        unexpectedRestartCount: 0,
        lastStartupAt: null,
        lastStartupPid: null,
        lastStartupReason: null,
        lastShutdownAt: null,
        lastShutdownPid: null,
        lastShutdownSignal: null,
        lastUnexpectedRestartAt: null,
      },
      sessions: [],
    },
  };
}

function countRows(sqliteDb, tableName) {
  const row = sqliteDb
    .prepare(`SELECT COUNT(*) AS total FROM ${tableName}`)
    .get();
  return Number(row?.total ?? 0);
}

function clearSqliteOperationalTables(sqliteDb) {
  sqliteDb.exec('BEGIN IMMEDIATE');
  try {
    sqliteDb.exec(
      `DELETE FROM admin_logs;
       DELETE FROM feedback_entries;
       DELETE FROM feedback_sessions;
       DELETE FROM report_issue_attachments;
       DELETE FROM report_issue_entries;
       DELETE FROM report_issue_sessions;`,
    );
    sqliteDb.exec('COMMIT');
  } catch (error) {
    try {
      sqliteDb.exec('ROLLBACK');
    } catch (_rollbackError) {
      // no-op
    }
    throw error;
  }
}

async function main() {
  await initDB();
  if (!db.data) {
    throw new Error('Database state is not initialized.');
  }

  initSqliteStorage();
  const sqliteDb = getSqliteDb();

  const before = {
    admin_logs: countRows(sqliteDb, 'admin_logs'),
    feedback_entries: countRows(sqliteDb, 'feedback_entries'),
    report_issue_entries: countRows(sqliteDb, 'report_issue_entries'),
    report_issue_attachments: countRows(sqliteDb, 'report_issue_attachments'),
    financialLedger: db.data.financialLedger.length,
    anomalyIncidents: db.data.anomalyIncidents.length,
    pendingRefunds: db.data.pendingRefunds.length,
  };

  console.log('[reset-db] Current data snapshot:', before);

  if (dryRun) {
    console.log('[reset-db] Dry run complete. No data was changed.');
    return;
  }

  clearSqliteOperationalTables(sqliteDb);
  db.data = buildResetState(db.data);
  await db.write();

  const after = {
    admin_logs: countRows(sqliteDb, 'admin_logs'),
    feedback_entries: countRows(sqliteDb, 'feedback_entries'),
    report_issue_entries: countRows(sqliteDb, 'report_issue_entries'),
    report_issue_attachments: countRows(sqliteDb, 'report_issue_attachments'),
    financialLedger: db.data.financialLedger.length,
    anomalyIncidents: db.data.anomalyIncidents.length,
    pendingRefunds: db.data.pendingRefunds.length,
  };

  console.log('[reset-db] Reset complete:', after);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[reset-db] Failed:', message);
  process.exit(1);
});
