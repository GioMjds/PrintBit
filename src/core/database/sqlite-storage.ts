import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AdminLogEntry,
  FeedbackEntry,
  FeedbackSessionEntry,
  LogMeta,
  ReportIssueAttachmentEntry,
  ReportIssueCategory,
  ReportIssueEntry,
  ReportIssueSessionEntry,
  ReportIssueStatus,
  TrustedTimestampMeta,
} from './db';
import { db as runtimeDb } from './db';

const SQLITE_FILE_PATH = path.resolve('printbit.sqlite');
const LOWDB_IMPORT_META_KEY = 'lowdb_import_v1';
const SCHEMA_SNAPSHOT_META_KEY = 'schema_snapshot_v1';
const RUNTIME_STATE_ROW_ID = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const CONSUMABLE_TELEMETRY_RETENTION_DAYS = parsePositiveIntEnv(
  process.env.PRINTBIT_CONSUMABLE_TELEMETRY_RETENTION_DAYS,
  90,
);
const CONSUMABLE_TELEMETRY_CLEANUP_INTERVAL_MS = parsePositiveIntEnv(
  process.env.PRINTBIT_CONSUMABLE_TELEMETRY_CLEANUP_INTERVAL_MS,
  60 * 60 * 1000,
);

let sqliteDb: DatabaseSync | null = null;
let lastConsumableTelemetryCleanupAtMs = 0;

type ListFeedbackOptions = {
  status?: FeedbackEntry['status'];
  limit: number;
  offset: number;
};

type ListReportIssueOptions = {
  status?: ReportIssueStatus;
  category?: ReportIssueCategory;
  limit: number;
  offset: number;
};

export interface LowDbImportSnapshot {
  logs: AdminLogEntry[];
  feedback: FeedbackEntry[];
  feedbackSessions: FeedbackSessionEntry[];
  reportIssues: ReportIssueEntry[];
  reportIssueSessions: ReportIssueSessionEntry[];
  reportIssueAttachments: ReportIssueAttachmentEntry[];
}

export interface LowDbImportOptions {
  force?: boolean;
}

export interface LowDbImportResult {
  skipped: boolean;
  attempted: {
    feedbackSessions: number;
    feedback: number;
    reportIssueSessions: number;
    reportIssues: number;
    reportIssueAttachments: number;
    logs: number;
  };
  inserted: {
    feedbackSessions: number;
    feedback: number;
    reportIssueSessions: number;
    reportIssues: number;
    reportIssueAttachments: number;
    logs: number;
  };
  skippedOrphans: {
    feedback: number;
    reportIssues: number;
    reportIssueAttachments: number;
  };
}

export interface ConsumableUsageEventEntry {
  id: string;
  timestamp: string;
  transactionId: string;
  mode: 'print' | 'copy';
  copies: number;
  duplex: boolean;
  selectedPages: number;
  billableColorPages: number;
  billableBwPages: number;
  estimatedSheetsUsed: number;
  source: string;
}

export interface ConsumableInkSnapshotSupply {
  name: string;
  level: number | null;
  status: 'ok' | 'low' | 'empty' | 'unknown';
}

export interface ConsumableInkSnapshotEntry {
  id: string;
  timestamp: string;
  printerName: string | null;
  inkDetectionMethod:
    | 'snmp'
    | 'vendor-wmi'
    | 'printer-property'
    | 'error-state'
    | 'none';
  inkTelemetryAvailable: boolean;
  inkTelemetryReason: string | null;
  supplies: ConsumableInkSnapshotSupply[];
}

type ReportSessionCleanupResult = {
  changed: boolean;
  orphanedAttachments: ReportIssueAttachmentEntry[];
};

function toIsoDate(value: Date): string {
  return value.toISOString();
}

function parseJsonValue<T>(value: unknown): T | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function parsePositiveIntEnv(
  value: string | undefined,
  fallback: number,
): number {
  if (typeof value !== 'string') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeTrustedTimestampMeta(
  value: unknown,
): TrustedTimestampMeta | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const source = candidate.source === 'ntp' ? 'ntp' : 'system';
  const synced =
    typeof candidate.synced === 'boolean' ? candidate.synced : false;
  const offsetMs =
    typeof candidate.offsetMs === 'number' &&
    Number.isFinite(candidate.offsetMs)
      ? candidate.offsetMs
      : null;
  const detail = typeof candidate.detail === 'string' ? candidate.detail : null;

  return {
    source,
    synced,
    offsetMs,
    detail,
  };
}

function normalizeLogMeta(value: unknown): LogMeta | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const out: LogMeta = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (
      typeof entry === 'string' ||
      typeof entry === 'number' ||
      typeof entry === 'boolean' ||
      entry === null
    ) {
      out[key] = entry;
    }
  }
  return out;
}

function withTransaction<T>(handler: () => T): T {
  const db = getSqliteDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = handler();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch (rollbackError) {
      console.error('[SQLITE] Failed to rollback transaction.', {
        error:
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError),
      });
    }
    throw error;
  }
}

function jsonOrNull(value: unknown): string | null {
  if (value === undefined) return null;
  return JSON.stringify(value);
}

function changesFromRun(result: unknown): number {
  if (typeof result !== 'object' || result === null) return 0;
  const candidate = result as { changes?: unknown };
  return typeof candidate.changes === 'number' ? candidate.changes : 0;
}

function dateMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function openSqliteDatabase(): DatabaseSync {
  const db = new DatabaseSync(SQLITE_FILE_PATH);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runtime_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      timestamp_meta_json TEXT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      meta_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_admin_logs_timestamp
      ON admin_logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_logs_type
      ON admin_logs(type);

    CREATE TABLE IF NOT EXISTS feedback_sessions (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      feedback_url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      submitted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_sessions_token
      ON feedback_sessions(token);
    CREATE INDEX IF NOT EXISTS idx_feedback_sessions_expires_at
      ON feedback_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS feedback_entries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      comment TEXT NOT NULL,
      category TEXT,
      rating INTEGER,
      status TEXT NOT NULL,
      resolved_at TEXT,
      meta_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_entries_timestamp
      ON feedback_entries(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_feedback_entries_status
      ON feedback_entries(status);
    CREATE INDEX IF NOT EXISTS idx_feedback_entries_session_id
      ON feedback_entries(session_id);

    CREATE TABLE IF NOT EXISTS report_issue_sessions (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      report_url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      submitted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_report_issue_sessions_token
      ON report_issue_sessions(token);
    CREATE INDEX IF NOT EXISTS idx_report_issue_sessions_expires_at
      ON report_issue_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS report_issue_entries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL,
      attachment_ids_json TEXT NOT NULL,
      acknowledged_at TEXT,
      resolved_at TEXT,
      meta_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_report_issue_entries_timestamp
      ON report_issue_entries(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_report_issue_entries_status
      ON report_issue_entries(status);
    CREATE INDEX IF NOT EXISTS idx_report_issue_entries_category
      ON report_issue_entries(category);
    CREATE INDEX IF NOT EXISTS idx_report_issue_entries_session_id
      ON report_issue_entries(session_id);

    CREATE TABLE IF NOT EXISTS report_issue_attachments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      report_issue_id TEXT,
      timestamp TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      FOREIGN KEY(report_issue_id) REFERENCES report_issue_entries(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_report_issue_attachments_session_id
      ON report_issue_attachments(session_id);
    CREATE INDEX IF NOT EXISTS idx_report_issue_attachments_report_issue_id
      ON report_issue_attachments(report_issue_id);
    CREATE INDEX IF NOT EXISTS idx_report_issue_attachments_timestamp
      ON report_issue_attachments(timestamp DESC);

    CREATE TABLE IF NOT EXISTS consumable_usage_events (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      copies INTEGER NOT NULL,
      duplex INTEGER NOT NULL,
      selected_pages INTEGER NOT NULL,
      billable_color_pages INTEGER NOT NULL,
      billable_bw_pages INTEGER NOT NULL,
      estimated_sheets_used INTEGER NOT NULL,
      source TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_consumable_usage_events_timestamp
      ON consumable_usage_events(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_consumable_usage_events_transaction_id
      ON consumable_usage_events(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_consumable_usage_events_mode
      ON consumable_usage_events(mode);

    CREATE TABLE IF NOT EXISTS consumable_ink_snapshots (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      printer_name TEXT,
      ink_detection_method TEXT NOT NULL,
      ink_telemetry_available INTEGER NOT NULL,
      ink_telemetry_reason TEXT,
      supplies_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_consumable_ink_snapshots_timestamp
      ON consumable_ink_snapshots(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_consumable_ink_snapshots_printer_name
      ON consumable_ink_snapshots(printer_name);
  `);
}

function getMetaValue(key: string): string | null {
  const db = getSqliteDb();
  const row = db
    .prepare('SELECT value FROM storage_meta WHERE key = ? LIMIT 1')
    .get(key) as { value?: unknown } | undefined;
  return typeof row?.value === 'string' ? row.value : null;
}

function setMetaValue(key: string, value: string): void {
  const db = getSqliteDb();
  db.prepare(
    `INSERT INTO storage_meta (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
  ).run(key, value, toIsoDate(new Date()));
}

export function getSqliteFilePath(): string {
  return SQLITE_FILE_PATH;
}

export function initSqliteStorage(): void {
  if (sqliteDb) return;
  sqliteDb = openSqliteDatabase();
  ensureSchema(sqliteDb);
}

export function readSchemaSnapshot<T>(): T | null {
  const raw = getMetaValue(SCHEMA_SNAPSHOT_META_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeSchemaSnapshot(snapshot: unknown): void {
  setMetaValue(SCHEMA_SNAPSHOT_META_KEY, JSON.stringify(snapshot));
}

export function readRuntimeState<T>(): T | null {
  const row = getSqliteDb()
    .prepare(
      `SELECT payload_json
       FROM runtime_state
       WHERE id = ?`,
    )
    .get(RUNTIME_STATE_ROW_ID) as { payload_json?: unknown } | undefined;

  if (typeof row?.payload_json !== 'string' || row.payload_json.length === 0) {
    return null;
  }

  try {
    return JSON.parse(row.payload_json) as T;
  } catch {
    return null;
  }
}

export function writeRuntimeState(state: unknown): void {
  getSqliteDb()
    .prepare(
      `INSERT INTO runtime_state (id, payload_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
    )
    .run(RUNTIME_STATE_ROW_ID, JSON.stringify(state), toIsoDate(new Date()));
}

export function migrateSchemaSnapshotToRuntimeState(): boolean {
  const existingRuntimeState = readRuntimeState<unknown>();
  if (existingRuntimeState !== null) return false;

  const legacySnapshot = readSchemaSnapshot<unknown>();
  if (legacySnapshot === null) return false;

  writeRuntimeState(legacySnapshot);
  return true;
}

export function clearLowDbImportMarker(): void {
  getSqliteDb()
    .prepare('DELETE FROM storage_meta WHERE key = ?')
    .run(LOWDB_IMPORT_META_KEY);
}

export function getSqliteDb(): DatabaseSync {
  if (!sqliteDb) initSqliteStorage();
  if (!sqliteDb) {
    throw new Error('SQLite database is not initialized.');
  }
  return sqliteDb;
}

export class AdminLogSqliteStore {
  append(entry: AdminLogEntry, maxRows: number): void {
    withTransaction(() => {
      const db = getSqliteDb();
      db.prepare(
        `INSERT INTO admin_logs (
          id,
          timestamp,
          timestamp_meta_json,
          type,
          message,
          meta_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        entry.id,
        entry.timestamp,
        jsonOrNull(entry.timestampMeta),
        entry.type,
        entry.message,
        jsonOrNull(entry.meta),
      );

      db.prepare(
        `DELETE FROM admin_logs
         WHERE rowid NOT IN (
           SELECT rowid
           FROM admin_logs
           ORDER BY timestamp DESC, rowid DESC
           LIMIT ?
         )`,
      ).run(Math.max(1, Math.floor(maxRows)));
    });
  }

  list(limit: number): AdminLogEntry[] {
    const db = getSqliteDb();
    const rows = db
      .prepare(
        `SELECT
          id,
          timestamp,
          timestamp_meta_json,
          type,
          message,
          meta_json
         FROM admin_logs
         ORDER BY timestamp DESC, rowid DESC
         LIMIT ?`,
      )
      .all(Math.max(1, Math.floor(limit))) as Array<Record<string, unknown>>;

    return rows.map((row) => this.toLogEntry(row));
  }

  listAll(): AdminLogEntry[] {
    const db = getSqliteDb();
    const rows = db
      .prepare(
        `SELECT
          id,
          timestamp,
          timestamp_meta_json,
          type,
          message,
          meta_json
         FROM admin_logs
         ORDER BY timestamp DESC, rowid DESC`,
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((row) => this.toLogEntry(row));
  }

  listByTypes(types: ReadonlyArray<string>): AdminLogEntry[] {
    if (types.length === 0) return [];
    const db = getSqliteDb();
    const placeholders = types.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT
          id,
          timestamp,
          timestamp_meta_json,
          type,
          message,
          meta_json
         FROM admin_logs
         WHERE type IN (${placeholders})
         ORDER BY timestamp DESC, rowid DESC`,
      )
      .all(...types) as Array<Record<string, unknown>>;

    return rows.map((row) => this.toLogEntry(row));
  }

  listByTypesSince(
    types: ReadonlyArray<string>,
    sinceTimestamp: string,
  ): AdminLogEntry[] {
    if (types.length === 0) return [];
    const db = getSqliteDb();
    const placeholders = types.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT
          id,
          timestamp,
          timestamp_meta_json,
          type,
          message,
          meta_json
         FROM admin_logs
         WHERE type IN (${placeholders})
           AND timestamp >= ?
         ORDER BY timestamp DESC, rowid DESC`,
      )
      .all(...types, sinceTimestamp) as Array<Record<string, unknown>>;

    return rows.map((row) => this.toLogEntry(row));
  }

  clear(): void {
    getSqliteDb().exec('DELETE FROM admin_logs');
  }

  deleteByIds(ids: ReadonlyArray<string>): number {
    const normalizedIds = Array.from(
      new Set(
        ids.map((value) => value.trim()).filter((value) => value.length > 0),
      ),
    );
    if (normalizedIds.length === 0) return 0;

    return withTransaction(() => {
      const db = getSqliteDb();
      let deleted = 0;
      const chunkSize = 400;
      for (let index = 0; index < normalizedIds.length; index += chunkSize) {
        const chunk = normalizedIds.slice(index, index + chunkSize);
        const placeholders = chunk.map(() => '?').join(', ');
        const result = db
          .prepare(`DELETE FROM admin_logs WHERE id IN (${placeholders})`)
          .run(...chunk);
        deleted += changesFromRun(result);
      }
      return deleted;
    });
  }

  private toLogEntry(row: Record<string, unknown>): AdminLogEntry {
    const timestampMeta = normalizeTrustedTimestampMeta(
      parseJsonValue<unknown>(row.timestamp_meta_json),
    );
    const meta = normalizeLogMeta(parseJsonValue<unknown>(row.meta_json));
    return {
      id: String(row.id ?? ''),
      timestamp: String(row.timestamp ?? ''),
      timestampMeta,
      type: String(row.type ?? ''),
      message: String(row.message ?? ''),
      meta,
    };
  }
}

export class FeedbackSqliteStore {
  createSession(entry: FeedbackSessionEntry): void {
    getSqliteDb()
      .prepare(
        `INSERT INTO feedback_sessions (
          id,
          token,
          feedback_url,
          created_at,
          expires_at,
          submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.token,
        entry.feedbackUrl,
        entry.createdAt,
        entry.expiresAt,
        entry.submittedAt,
      );
  }

  getSessionByToken(token: string): FeedbackSessionEntry | null {
    const row = getSqliteDb()
      .prepare(
        `SELECT
          id,
          token,
          feedback_url,
          created_at,
          expires_at,
          submitted_at
         FROM feedback_sessions
         WHERE token = ?
         LIMIT 1`,
      )
      .get(token) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.toSessionEntry(row);
  }

  findSessionByIdAndToken(
    sessionId: string,
    token: string,
  ): FeedbackSessionEntry | null {
    const row = getSqliteDb()
      .prepare(
        `SELECT
          id,
          token,
          feedback_url,
          created_at,
          expires_at,
          submitted_at
         FROM feedback_sessions
         WHERE id = ? AND token = ?
         LIMIT 1`,
      )
      .get(sessionId, token) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.toSessionEntry(row);
  }

  insertFeedback(entry: FeedbackEntry): void {
    getSqliteDb()
      .prepare(
        `INSERT INTO feedback_entries (
          id,
          session_id,
          timestamp,
          comment,
          category,
          rating,
          status,
          resolved_at,
          meta_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.sessionId,
        entry.timestamp,
        entry.comment,
        entry.category,
        entry.rating,
        entry.status,
        entry.resolvedAt ?? null,
        jsonOrNull(entry.meta),
      );
  }

  createFeedbackSubmission(entry: FeedbackEntry): void {
    withTransaction(() => {
      this.insertFeedback(entry);
      this.markSessionSubmitted(entry.sessionId, entry.timestamp);
    });
  }

  markSessionSubmitted(sessionId: string, submittedAt: string): void {
    getSqliteDb()
      .prepare('UPDATE feedback_sessions SET submitted_at = ? WHERE id = ?')
      .run(submittedAt, sessionId);
  }

  listFeedback(options: ListFeedbackOptions): {
    total: number;
    items: FeedbackEntry[];
  } {
    const db = getSqliteDb();
    const status = options.status;
    const limit = Math.max(1, Math.floor(options.limit));
    const offset = Math.max(0, Math.floor(options.offset));

    if (!status) {
      const totalRow = db
        .prepare('SELECT COUNT(*) AS total FROM feedback_entries')
        .get() as { total?: unknown };
      const rows = db
        .prepare(
          `SELECT
            id,
            session_id,
            timestamp,
            comment,
            category,
            rating,
            status,
            resolved_at,
            meta_json
           FROM feedback_entries
           ORDER BY timestamp DESC
           LIMIT ? OFFSET ?`,
        )
        .all(limit, offset) as Array<Record<string, unknown>>;
      return {
        total: Number(totalRow.total ?? 0),
        items: rows.map((row) => this.toFeedbackEntry(row)),
      };
    }

    const totalRow = db
      .prepare(
        'SELECT COUNT(*) AS total FROM feedback_entries WHERE status = ?',
      )
      .get(status) as { total?: unknown };
    const rows = db
      .prepare(
        `SELECT
          id,
          session_id,
          timestamp,
          comment,
          category,
          rating,
          status,
          resolved_at,
          meta_json
         FROM feedback_entries
         WHERE status = ?
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`,
      )
      .all(status, limit, offset) as Array<Record<string, unknown>>;

    return {
      total: Number(totalRow.total ?? 0),
      items: rows.map((row) => this.toFeedbackEntry(row)),
    };
  }

  findFeedbackById(feedbackId: string): FeedbackEntry | null {
    const row = getSqliteDb()
      .prepare(
        `SELECT
          id,
          session_id,
          timestamp,
          comment,
          category,
          rating,
          status,
          resolved_at,
          meta_json
         FROM feedback_entries
         WHERE id = ?
         LIMIT 1`,
      )
      .get(feedbackId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.toFeedbackEntry(row);
  }

  updateFeedbackResolved(
    feedbackId: string,
    resolved: boolean,
  ): FeedbackEntry | null {
    const resolvedAt = resolved ? toIsoDate(new Date()) : null;
    const status: FeedbackEntry['status'] = resolved ? 'resolved' : 'open';

    const result = getSqliteDb()
      .prepare(
        'UPDATE feedback_entries SET status = ?, resolved_at = ? WHERE id = ?',
      )
      .run(status, resolvedAt, feedbackId) as { changes?: unknown };
    if (Number(result.changes ?? 0) === 0) return null;
    return this.findFeedbackById(feedbackId);
  }

  deleteFeedback(feedbackId: string): boolean {
    const result = getSqliteDb()
      .prepare('DELETE FROM feedback_entries WHERE id = ?')
      .run(feedbackId) as { changes?: unknown };
    return Number(result.changes ?? 0) > 0;
  }

  clearFeedback(): number {
    const result = getSqliteDb()
      .prepare('DELETE FROM feedback_entries')
      .run() as { changes?: unknown };
    return Number(result.changes ?? 0);
  }

  listAllFeedback(): FeedbackEntry[] {
    const rows = getSqliteDb()
      .prepare(
        `SELECT
          id,
          session_id,
          timestamp,
          comment,
          category,
          rating,
          status,
          resolved_at,
          meta_json
         FROM feedback_entries
         ORDER BY timestamp DESC`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.toFeedbackEntry(row));
  }

  cleanupExpiredSessions(now: Date, retentionMs: number): boolean {
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const retentionCutoff = nowMs - retentionMs;

    // Delete sessions with invalid or missing expires_at
    const invalidExpiresStmt = getSqliteDb().prepare(
      `DELETE FROM feedback_sessions 
       WHERE expires_at IS NULL OR expires_at = ''`,
    );
    const invalidExpiresResult = invalidExpiresStmt.run();

    // Delete expired sessions that are past retention
    const expiredStmt = getSqliteDb().prepare(
      `DELETE FROM feedback_sessions 
       WHERE expires_at < ?
         AND (created_at IS NULL OR created_at = '' OR created_at < ?)`,
    );
    const expiredResult = expiredStmt.run(
      nowIso,
      new Date(retentionCutoff).toISOString(),
    );

    const totalChanges =
      Number(invalidExpiresResult.changes) + Number(expiredResult.changes);
    return totalChanges > 0;
  }

  private toSessionEntry(row: Record<string, unknown>): FeedbackSessionEntry {
    return {
      id: String(row.id ?? ''),
      token: String(row.token ?? ''),
      feedbackUrl: String(row.feedback_url ?? ''),
      createdAt: String(row.created_at ?? ''),
      expiresAt: String(row.expires_at ?? ''),
      submittedAt:
        typeof row.submitted_at === 'string' ? row.submitted_at : null,
    };
  }

  private toFeedbackEntry(row: Record<string, unknown>): FeedbackEntry {
    const parsedMeta = normalizeLogMeta(parseJsonValue<unknown>(row.meta_json));
    const categoryValue =
      typeof row.category === 'string' && row.category.length > 0
        ? row.category
        : null;
    const ratingValue =
      typeof row.rating === 'number' && Number.isFinite(row.rating)
        ? row.rating
        : null;
    const statusValue = row.status === 'resolved' ? 'resolved' : 'open';

    return {
      id: String(row.id ?? ''),
      sessionId: String(row.session_id ?? ''),
      timestamp: String(row.timestamp ?? ''),
      comment: String(row.comment ?? ''),
      category: categoryValue as FeedbackEntry['category'],
      rating: ratingValue,
      status: statusValue,
      resolvedAt: typeof row.resolved_at === 'string' ? row.resolved_at : null,
      meta: parsedMeta,
    };
  }
}

export class ReportIssueSqliteStore {
  createSession(entry: ReportIssueSessionEntry): void {
    getSqliteDb()
      .prepare(
        `INSERT INTO report_issue_sessions (
          id,
          token,
          report_url,
          created_at,
          expires_at,
          submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.token,
        entry.reportUrl,
        entry.createdAt,
        entry.expiresAt,
        entry.submittedAt,
      );
  }

  getSessionByToken(token: string): ReportIssueSessionEntry | null {
    const row = getSqliteDb()
      .prepare(
        `SELECT
          id,
          token,
          report_url,
          created_at,
          expires_at,
          submitted_at
         FROM report_issue_sessions
         WHERE token = ?
         LIMIT 1`,
      )
      .get(token) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.toSessionEntry(row);
  }

  findSessionByIdAndToken(
    sessionId: string,
    token: string,
  ): ReportIssueSessionEntry | null {
    const row = getSqliteDb()
      .prepare(
        `SELECT
          id,
          token,
          report_url,
          created_at,
          expires_at,
          submitted_at
         FROM report_issue_sessions
         WHERE id = ? AND token = ?
         LIMIT 1`,
      )
      .get(sessionId, token) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.toSessionEntry(row);
  }

  countSessionAttachments(sessionId: string): number {
    const row = getSqliteDb()
      .prepare(
        'SELECT COUNT(*) AS total FROM report_issue_attachments WHERE session_id = ?',
      )
      .get(sessionId) as { total?: unknown };
    return Number(row.total ?? 0);
  }

  registerAttachment(entry: ReportIssueAttachmentEntry): void {
    getSqliteDb()
      .prepare(
        `INSERT INTO report_issue_attachments (
          id,
          session_id,
          report_issue_id,
          timestamp,
          original_name,
          stored_name,
          content_type,
          size_bytes,
          file_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.sessionId,
        entry.reportIssueId,
        entry.timestamp,
        entry.originalName,
        entry.storedName,
        entry.contentType,
        entry.sizeBytes,
        entry.filePath,
      );
  }

  listUnlinkedSessionAttachments(
    sessionId: string,
  ): ReportIssueAttachmentEntry[] {
    const rows = getSqliteDb()
      .prepare(
        `SELECT
          id,
          session_id,
          report_issue_id,
          timestamp,
          original_name,
          stored_name,
          content_type,
          size_bytes,
          file_path
         FROM report_issue_attachments
         WHERE session_id = ? AND report_issue_id IS NULL`,
      )
      .all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.toAttachmentEntry(row));
  }

  createReportIssue(entry: ReportIssueEntry): void {
    getSqliteDb()
      .prepare(
        `INSERT INTO report_issue_entries (
          id,
          session_id,
          timestamp,
          title,
          description,
          category,
          status,
          attachment_ids_json,
          acknowledged_at,
          resolved_at,
          meta_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.sessionId,
        entry.timestamp,
        entry.title,
        entry.description,
        entry.category,
        entry.status,
        JSON.stringify(entry.attachmentIds),
        entry.acknowledgedAt,
        entry.resolvedAt,
        jsonOrNull(entry.meta),
      );
  }

  assignAttachmentsToIssue(
    attachmentIds: string[],
    reportIssueId: string,
    sessionId: string,
  ): void {
    if (attachmentIds.length === 0) return;
    const db = getSqliteDb();
    const stmt = db.prepare(
      `UPDATE report_issue_attachments
       SET report_issue_id = ?
       WHERE id = ? AND session_id = ? AND report_issue_id IS NULL`,
    );
    for (const attachmentId of attachmentIds) {
      stmt.run(reportIssueId, attachmentId, sessionId);
    }
  }

  markSessionSubmitted(sessionId: string, submittedAt: string): void {
    getSqliteDb()
      .prepare('UPDATE report_issue_sessions SET submitted_at = ? WHERE id = ?')
      .run(submittedAt, sessionId);
  }

  createSessionIssueWithAttachments(entry: ReportIssueEntry): void {
    withTransaction(() => {
      this.createReportIssue(entry);
      this.assignAttachmentsToIssue(
        entry.attachmentIds,
        entry.id,
        entry.sessionId,
      );
      this.markSessionSubmitted(entry.sessionId, entry.timestamp);
    });
  }

  listReportIssues(options: ListReportIssueOptions): {
    total: number;
    items: ReportIssueEntry[];
  } {
    const db = getSqliteDb();
    const limit = Math.max(1, Math.floor(options.limit));
    const offset = Math.max(0, Math.floor(options.offset));

    const where: string[] = [];
    const params: Array<string | number> = [];
    if (options.status) {
      where.push('status = ?');
      params.push(options.status);
    }
    if (options.category) {
      where.push('category = ?');
      params.push(options.category);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS total FROM report_issue_entries ${whereSql}`)
      .get(...params) as { total?: unknown };

    const rows = db
      .prepare(
        `SELECT
          id,
          session_id,
          timestamp,
          title,
          description,
          category,
          status,
          attachment_ids_json,
          acknowledged_at,
          resolved_at,
          meta_json
         FROM report_issue_entries
         ${whereSql}
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Array<Record<string, unknown>>;

    return {
      total: Number(totalRow.total ?? 0),
      items: rows.map((row) => this.toIssueEntry(row)),
    };
  }

  getReportIssueById(id: string): ReportIssueEntry | null {
    const row = getSqliteDb()
      .prepare(
        `SELECT
          id,
          session_id,
          timestamp,
          title,
          description,
          category,
          status,
          attachment_ids_json,
          acknowledged_at,
          resolved_at,
          meta_json
         FROM report_issue_entries
         WHERE id = ?
         LIMIT 1`,
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.toIssueEntry(row);
  }

  listAttachmentsForReport(
    reportIssueId: string,
  ): ReportIssueAttachmentEntry[] {
    const rows = getSqliteDb()
      .prepare(
        `SELECT
          id,
          session_id,
          report_issue_id,
          timestamp,
          original_name,
          stored_name,
          content_type,
          size_bytes,
          file_path
         FROM report_issue_attachments
         WHERE report_issue_id = ?
         ORDER BY timestamp DESC`,
      )
      .all(reportIssueId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.toAttachmentEntry(row));
  }

  findAttachmentById(attachmentId: string): ReportIssueAttachmentEntry | null {
    const row = getSqliteDb()
      .prepare(
        `SELECT
          id,
          session_id,
          report_issue_id,
          timestamp,
          original_name,
          stored_name,
          content_type,
          size_bytes,
          file_path
         FROM report_issue_attachments
         WHERE id = ?
         LIMIT 1`,
      )
      .get(attachmentId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.toAttachmentEntry(row);
  }

  updateIssueStatus(
    issueId: string,
    status: ReportIssueStatus,
    acknowledgedAt: string | null,
    resolvedAt: string | null,
  ): ReportIssueEntry | null {
    const result = getSqliteDb()
      .prepare(
        `UPDATE report_issue_entries
         SET status = ?, acknowledged_at = ?, resolved_at = ?
         WHERE id = ?`,
      )
      .run(status, acknowledgedAt, resolvedAt, issueId) as {
      changes?: unknown;
    };
    if (Number(result.changes ?? 0) === 0) return null;
    return this.getReportIssueById(issueId);
  }

  cleanupExpiredSessions(
    now: Date,
    retentionMs: number,
  ): ReportSessionCleanupResult {
    const nowMs = now.getTime();
    const retentionCutoff = nowMs - retentionMs;
    const sessionRows = getSqliteDb()
      .prepare('SELECT id, created_at, expires_at FROM report_issue_sessions')
      .all() as Array<Record<string, unknown>>;

    const removedSessionIds: string[] = [];
    for (const row of sessionRows) {
      const id = typeof row.id === 'string' ? row.id : '';
      if (!id) continue;
      const expiresAt =
        typeof row.expires_at === 'string' ? row.expires_at : '';
      const createdAt =
        typeof row.created_at === 'string' ? row.created_at : '';
      const expiresAtMs = dateMs(expiresAt);
      const createdAtMs = dateMs(createdAt);

      if (!Number.isFinite(expiresAtMs)) {
        removedSessionIds.push(id);
        continue;
      }
      if (expiresAtMs >= nowMs) continue;
      if (!Number.isFinite(createdAtMs) || createdAtMs < retentionCutoff) {
        removedSessionIds.push(id);
      }
    }

    if (removedSessionIds.length === 0) {
      return { changed: false, orphanedAttachments: [] };
    }

    const placeholders = removedSessionIds.map(() => '?').join(', ');
    const orphanedRows = getSqliteDb()
      .prepare(
        `SELECT
          id,
          session_id,
          report_issue_id,
          timestamp,
          original_name,
          stored_name,
          content_type,
          size_bytes,
          file_path
         FROM report_issue_attachments
         WHERE session_id IN (${placeholders}) AND report_issue_id IS NULL`,
      )
      .all(...removedSessionIds) as Array<Record<string, unknown>>;

    withTransaction(() => {
      getSqliteDb()
        .prepare(
          `DELETE FROM report_issue_attachments
           WHERE session_id IN (${placeholders}) AND report_issue_id IS NULL`,
        )
        .run(...removedSessionIds);

      getSqliteDb()
        .prepare(
          `DELETE FROM report_issue_sessions WHERE id IN (${placeholders})`,
        )
        .run(...removedSessionIds);
    });

    return {
      changed: true,
      orphanedAttachments: orphanedRows.map((row) =>
        this.toAttachmentEntry(row),
      ),
    };
  }

  private toSessionEntry(
    row: Record<string, unknown>,
  ): ReportIssueSessionEntry {
    return {
      id: String(row.id ?? ''),
      token: String(row.token ?? ''),
      reportUrl: String(row.report_url ?? ''),
      createdAt: String(row.created_at ?? ''),
      expiresAt: String(row.expires_at ?? ''),
      submittedAt:
        typeof row.submitted_at === 'string' ? row.submitted_at : null,
    };
  }

  private toIssueEntry(row: Record<string, unknown>): ReportIssueEntry {
    const parsedMeta = normalizeLogMeta(parseJsonValue<unknown>(row.meta_json));
    const parsedAttachmentIds =
      parseJsonValue<unknown>(row.attachment_ids_json) ?? [];
    const attachmentIds = Array.isArray(parsedAttachmentIds)
      ? parsedAttachmentIds.filter(
          (item): item is string => typeof item === 'string',
        )
      : [];

    return {
      id: String(row.id ?? ''),
      sessionId: String(row.session_id ?? ''),
      timestamp: String(row.timestamp ?? ''),
      title: String(row.title ?? ''),
      description: String(row.description ?? ''),
      category: String(row.category ?? 'other') as ReportIssueCategory,
      status: String(row.status ?? 'open') as ReportIssueStatus,
      attachmentIds,
      acknowledgedAt:
        typeof row.acknowledged_at === 'string' ? row.acknowledged_at : null,
      resolvedAt: typeof row.resolved_at === 'string' ? row.resolved_at : null,
      meta: parsedMeta,
    };
  }

  private toAttachmentEntry(
    row: Record<string, unknown>,
  ): ReportIssueAttachmentEntry {
    return {
      id: String(row.id ?? ''),
      sessionId: String(row.session_id ?? ''),
      reportIssueId:
        typeof row.report_issue_id === 'string' ? row.report_issue_id : null,
      timestamp: String(row.timestamp ?? ''),
      originalName: String(row.original_name ?? ''),
      storedName: String(row.stored_name ?? ''),
      contentType: String(row.content_type ?? ''),
      sizeBytes: Number(row.size_bytes ?? 0),
      filePath: String(row.file_path ?? ''),
    };
  }
}

export class ConsumablesSqliteStore {
  appendUsageEvent(entry: ConsumableUsageEventEntry): void {
    getSqliteDb()
      .prepare(
        `INSERT OR REPLACE INTO consumable_usage_events (
          id,
          timestamp,
          transaction_id,
          mode,
          copies,
          duplex,
          selected_pages,
          billable_color_pages,
          billable_bw_pages,
          estimated_sheets_used,
          source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.timestamp,
        entry.transactionId,
        entry.mode,
        entry.copies,
        entry.duplex ? 1 : 0,
        entry.selectedPages,
        entry.billableColorPages,
        entry.billableBwPages,
        entry.estimatedSheetsUsed,
        entry.source,
      );
    this.maybePruneOldTelemetryRows();
  }

  listUsageEventsSince(sinceTimestamp: string): ConsumableUsageEventEntry[] {
    const rows = getSqliteDb()
      .prepare(
        `SELECT
          id,
          timestamp,
          transaction_id,
          mode,
          copies,
          duplex,
          selected_pages,
          billable_color_pages,
          billable_bw_pages,
          estimated_sheets_used,
          source
         FROM consumable_usage_events
         WHERE timestamp >= ?
         ORDER BY timestamp DESC, rowid DESC`,
      )
      .all(sinceTimestamp) as Array<Record<string, unknown>>;

    return rows.map((row) => this.toUsageEventEntry(row));
  }

  appendInkSnapshot(entry: ConsumableInkSnapshotEntry): void {
    getSqliteDb()
      .prepare(
        `INSERT OR REPLACE INTO consumable_ink_snapshots (
          id,
          timestamp,
          printer_name,
          ink_detection_method,
          ink_telemetry_available,
          ink_telemetry_reason,
          supplies_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.timestamp,
        entry.printerName,
        entry.inkDetectionMethod,
        entry.inkTelemetryAvailable ? 1 : 0,
        entry.inkTelemetryReason,
        JSON.stringify(entry.supplies),
      );
    this.maybePruneOldTelemetryRows();
  }

  listInkSnapshotsSince(sinceTimestamp: string): ConsumableInkSnapshotEntry[] {
    const rows = getSqliteDb()
      .prepare(
        `SELECT
          id,
          timestamp,
          printer_name,
          ink_detection_method,
          ink_telemetry_available,
          ink_telemetry_reason,
          supplies_json
         FROM consumable_ink_snapshots
         WHERE timestamp >= ?
         ORDER BY timestamp DESC, rowid DESC`,
      )
      .all(sinceTimestamp) as Array<Record<string, unknown>>;

    return rows.map((row) => this.toInkSnapshotEntry(row));
  }

  async updatePaperRefill(
    nextCapacity: number,
    nextCurrentSheets: number,
    updatedAt: string,
  ): Promise<void> {
    const normalizedCapacity = Math.max(1, Math.floor(nextCapacity));
    const normalizedCurrentSheets = Math.max(
      0,
      Math.min(Math.floor(nextCurrentSheets), normalizedCapacity),
    );
    getSqliteDb();
    runtimeDb.data!.settings.consumablesForecasting.paperTrayCapacitySheets =
      normalizedCapacity;
    runtimeDb.data!.settings.consumablesForecasting.paperCurrentSheets =
      normalizedCurrentSheets;
    runtimeDb.data!.settings.consumablesForecasting.paperRefillUpdatedAt =
      updatedAt;
    await runtimeDb.write();
  }

  private maybePruneOldTelemetryRows(): void {
    const nowMs = Date.now();
    if (
      nowMs - lastConsumableTelemetryCleanupAtMs <
      CONSUMABLE_TELEMETRY_CLEANUP_INTERVAL_MS
    ) {
      return;
    }
    lastConsumableTelemetryCleanupAtMs = nowMs;
    const cutoffIso = new Date(
      nowMs - CONSUMABLE_TELEMETRY_RETENTION_DAYS * DAY_MS,
    ).toISOString();
    try {
      const db = getSqliteDb();
      db.prepare('DELETE FROM consumable_usage_events WHERE timestamp < ?').run(
        cutoffIso,
      );
      db.prepare(
        'DELETE FROM consumable_ink_snapshots WHERE timestamp < ?',
      ).run(cutoffIso);
    } catch (error) {
      console.warn(
        '[SQLITE-STORAGE] Failed to prune old consumables telemetry rows.',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private toUsageEventEntry(
    row: Record<string, unknown>,
  ): ConsumableUsageEventEntry {
    const mode = row.mode === 'copy' ? 'copy' : 'print';
    return {
      id: String(row.id ?? ''),
      timestamp: String(row.timestamp ?? ''),
      transactionId: String(row.transaction_id ?? ''),
      mode,
      copies: Number(row.copies ?? 0),
      duplex: Number(row.duplex ?? 0) === 1,
      selectedPages: Number(row.selected_pages ?? 0),
      billableColorPages: Number(row.billable_color_pages ?? 0),
      billableBwPages: Number(row.billable_bw_pages ?? 0),
      estimatedSheetsUsed: Number(row.estimated_sheets_used ?? 0),
      source: String(row.source ?? ''),
    };
  }

  private toInkSnapshotEntry(
    row: Record<string, unknown>,
  ): ConsumableInkSnapshotEntry {
    const parsedSupplies =
      parseJsonValue<unknown>(row.supplies_json) ?? ([] as unknown[]);
    const supplies = Array.isArray(parsedSupplies)
      ? parsedSupplies
          .map((item) => {
            if (typeof item !== 'object' || item === null) return null;
            const candidate = item as Record<string, unknown>;
            const status =
              candidate.status === 'ok' ||
              candidate.status === 'low' ||
              candidate.status === 'empty'
                ? candidate.status
                : 'unknown';
            return {
              name: String(candidate.name ?? 'Supply'),
              level:
                typeof candidate.level === 'number' &&
                Number.isFinite(candidate.level)
                  ? candidate.level
                  : null,
              status,
            } as ConsumableInkSnapshotSupply;
          })
          .filter(
            (value): value is ConsumableInkSnapshotSupply => value !== null,
          )
      : [];
    const detectionMethod =
      row.ink_detection_method === 'snmp' ||
      row.ink_detection_method === 'vendor-wmi' ||
      row.ink_detection_method === 'printer-property' ||
      row.ink_detection_method === 'error-state'
        ? row.ink_detection_method
        : 'none';

    return {
      id: String(row.id ?? ''),
      timestamp: String(row.timestamp ?? ''),
      printerName:
        typeof row.printer_name === 'string' ? row.printer_name : null,
      inkDetectionMethod: detectionMethod,
      inkTelemetryAvailable: Number(row.ink_telemetry_available ?? 0) === 1,
      inkTelemetryReason:
        typeof row.ink_telemetry_reason === 'string'
          ? row.ink_telemetry_reason
          : null,
      supplies,
    };
  }
}

export const adminLogStore = new AdminLogSqliteStore();
export const feedbackStore = new FeedbackSqliteStore();
export const reportIssueStore = new ReportIssueSqliteStore();
export const consumablesStore = new ConsumablesSqliteStore();

export function importLowDbSnapshotIfNeeded(
  snapshot: LowDbImportSnapshot,
  options: LowDbImportOptions = {},
): LowDbImportResult {
  initSqliteStorage();
  const hasCandidates =
    snapshot.feedbackSessions.length > 0 ||
    snapshot.feedback.length > 0 ||
    snapshot.reportIssueSessions.length > 0 ||
    snapshot.reportIssues.length > 0 ||
    snapshot.reportIssueAttachments.length > 0 ||
    snapshot.logs.length > 0;
  if (!hasCandidates) {
    return {
      skipped: true,
      attempted: {
        feedbackSessions: 0,
        feedback: 0,
        reportIssueSessions: 0,
        reportIssues: 0,
        reportIssueAttachments: 0,
        logs: 0,
      },
      inserted: {
        feedbackSessions: 0,
        feedback: 0,
        reportIssueSessions: 0,
        reportIssues: 0,
        reportIssueAttachments: 0,
        logs: 0,
      },
      skippedOrphans: {
        feedback: 0,
        reportIssues: 0,
        reportIssueAttachments: 0,
      },
    };
  }

  const existing = getMetaValue(LOWDB_IMPORT_META_KEY);
  if (existing === 'done' && !options.force) {
    return {
      skipped: true,
      attempted: {
        feedbackSessions: 0,
        feedback: 0,
        reportIssueSessions: 0,
        reportIssues: 0,
        reportIssueAttachments: 0,
        logs: 0,
      },
      inserted: {
        feedbackSessions: 0,
        feedback: 0,
        reportIssueSessions: 0,
        reportIssues: 0,
        reportIssueAttachments: 0,
        logs: 0,
      },
      skippedOrphans: {
        feedback: 0,
        reportIssues: 0,
        reportIssueAttachments: 0,
      },
    };
  }

  const attempted: LowDbImportResult['attempted'] = {
    feedbackSessions: 0,
    feedback: 0,
    reportIssueSessions: 0,
    reportIssues: 0,
    reportIssueAttachments: 0,
    logs: 0,
  };
  const inserted: LowDbImportResult['inserted'] = {
    feedbackSessions: 0,
    feedback: 0,
    reportIssueSessions: 0,
    reportIssues: 0,
    reportIssueAttachments: 0,
    logs: 0,
  };
  const skippedOrphans: LowDbImportResult['skippedOrphans'] = {
    feedback: 0,
    reportIssues: 0,
    reportIssueAttachments: 0,
  };

  withTransaction(() => {
    const db = getSqliteDb();

    const feedbackSessionIds = new Set<string>();
    for (const session of snapshot.feedbackSessions) {
      attempted.feedbackSessions += 1;
      const result = db
        .prepare(
          `INSERT OR IGNORE INTO feedback_sessions (
          id,
          token,
          feedback_url,
          created_at,
          expires_at,
          submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          session.id,
          session.token,
          session.feedbackUrl,
          session.createdAt,
          session.expiresAt,
          session.submittedAt,
        );
      inserted.feedbackSessions += changesFromRun(result);
      feedbackSessionIds.add(session.id);
    }

    for (const entry of snapshot.feedback) {
      attempted.feedback += 1;
      if (!feedbackSessionIds.has(entry.sessionId)) {
        skippedOrphans.feedback += 1;
        continue;
      }
      const result = db
        .prepare(
          `INSERT OR IGNORE INTO feedback_entries (
          id,
          session_id,
          timestamp,
          comment,
          category,
          rating,
          status,
          resolved_at,
          meta_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.id,
          entry.sessionId,
          entry.timestamp,
          entry.comment,
          entry.category,
          entry.rating,
          entry.status,
          entry.resolvedAt ?? null,
          jsonOrNull(entry.meta),
        );
      inserted.feedback += changesFromRun(result);
    }

    const reportSessionIds = new Set<string>();
    for (const session of snapshot.reportIssueSessions) {
      attempted.reportIssueSessions += 1;
      const result = db
        .prepare(
          `INSERT OR IGNORE INTO report_issue_sessions (
          id,
          token,
          report_url,
          created_at,
          expires_at,
          submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          session.id,
          session.token,
          session.reportUrl,
          session.createdAt,
          session.expiresAt,
          session.submittedAt,
        );
      inserted.reportIssueSessions += changesFromRun(result);
      reportSessionIds.add(session.id);
    }

    const reportIssueIds = new Set<string>();
    for (const issue of snapshot.reportIssues) {
      attempted.reportIssues += 1;
      if (!reportSessionIds.has(issue.sessionId)) {
        skippedOrphans.reportIssues += 1;
        continue;
      }
      const result = db
        .prepare(
          `INSERT OR IGNORE INTO report_issue_entries (
          id,
          session_id,
          timestamp,
          title,
          description,
          category,
          status,
          attachment_ids_json,
          acknowledged_at,
          resolved_at,
          meta_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          issue.id,
          issue.sessionId,
          issue.timestamp,
          issue.title,
          issue.description,
          issue.category,
          issue.status,
          JSON.stringify(issue.attachmentIds),
          issue.acknowledgedAt,
          issue.resolvedAt,
          jsonOrNull(issue.meta),
        );
      inserted.reportIssues += changesFromRun(result);
      reportIssueIds.add(issue.id);
    }

    for (const attachment of snapshot.reportIssueAttachments) {
      attempted.reportIssueAttachments += 1;
      if (!reportSessionIds.has(attachment.sessionId)) {
        skippedOrphans.reportIssueAttachments += 1;
        continue;
      }
      const reportIssueId =
        attachment.reportIssueId && reportIssueIds.has(attachment.reportIssueId)
          ? attachment.reportIssueId
          : null;
      const result = db
        .prepare(
          `INSERT OR IGNORE INTO report_issue_attachments (
          id,
          session_id,
          report_issue_id,
          timestamp,
          original_name,
          stored_name,
          content_type,
          size_bytes,
          file_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          attachment.id,
          attachment.sessionId,
          reportIssueId,
          attachment.timestamp,
          attachment.originalName,
          attachment.storedName,
          attachment.contentType,
          attachment.sizeBytes,
          attachment.filePath,
        );
      inserted.reportIssueAttachments += changesFromRun(result);
    }

    for (const log of snapshot.logs) {
      attempted.logs += 1;
      const result = db
        .prepare(
          `INSERT OR IGNORE INTO admin_logs (
          id,
          timestamp,
          timestamp_meta_json,
          type,
          message,
          meta_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          log.id,
          log.timestamp,
          jsonOrNull(log.timestampMeta),
          log.type,
          log.message,
          jsonOrNull(log.meta),
        );
      inserted.logs += changesFromRun(result);
    }

    setMetaValue(LOWDB_IMPORT_META_KEY, 'done');
  });

  return {
    skipped: false,
    attempted,
    inserted,
    skippedOrphans,
  };
}
