import { getSqliteDb, withTransaction } from '../sqlite-storage';

export interface StudentRosterEntry {
  studentIdHmac: string;
  active: boolean;
  importedAt: string;
}

export interface StudentRosterImportEntry {
  studentIdHmac: string;
  importedAt?: string;
}

export interface StudentKioskSessionEntry {
  id: string;
  studentIdHmac: string;
  status: 'active' | 'ended';
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
}

export interface ClaimStudentKioskSessionInput {
  id: string;
  studentIdHmac: string;
  startedAt?: string;
}

export type ClaimStudentKioskSessionResult =
  | { ok: true; session: StudentKioskSessionEntry }
  | { ok: false; reason: 'roster-inactive' | 'session-active' };

export interface StudentTransactionAttributionEntry {
  transactionId: string;
  kioskSessionId: string;
  studentIdHmac: string;
  operation: string;
  attributedAt: string;
}

export interface AttributeStudentTransactionInput {
  transactionId: string;
  kioskSessionId: string;
  studentIdHmac: string;
  operation: string;
  attributedAt?: string;
}

export class StudentSessionSqliteStore {
  replaceRoster(entries: StudentRosterImportEntry[]): void {
    withTransaction(() => {
      const db = getSqliteDb();
      db.prepare('UPDATE student_roster SET active = 0').run();
      const upsert = db.prepare(
        `INSERT INTO student_roster (student_id_hmac, active, imported_at)
         VALUES (?, 1, ?)
         ON CONFLICT(student_id_hmac) DO UPDATE SET
           active = 1,
           imported_at = excluded.imported_at`,
      );
      const importedAt = new Date().toISOString();
      for (const entry of entries) {
        upsert.run(entry.studentIdHmac, entry.importedAt ?? importedAt);
      }
    });
  }

  findActiveRosterEntry(studentIdHmac: string): StudentRosterEntry | null {
    const row = getSqliteDb()
      .prepare(
        `SELECT student_id_hmac, active, imported_at
         FROM student_roster
         WHERE student_id_hmac = ? AND active = 1`,
      )
      .get(studentIdHmac) as Record<string, unknown> | undefined;
    return row ? this.toRosterEntry(row) : null;
  }

  claimSession(
    input: ClaimStudentKioskSessionInput,
  ): ClaimStudentKioskSessionResult {
    return withTransaction(() => {
      if (!this.findActiveRosterEntry(input.studentIdHmac)) {
        return { ok: false, reason: 'roster-inactive' };
      }
      if (this.getActiveSession()) {
        return { ok: false, reason: 'session-active' };
      }

      const startedAt = input.startedAt ?? new Date().toISOString();
      getSqliteDb()
        .prepare(
          `INSERT INTO student_kiosk_sessions (
            id, student_id_hmac, status, started_at, ended_at, end_reason
          ) VALUES (?, ?, 'active', ?, NULL, NULL)`,
        )
        .run(input.id, input.studentIdHmac, startedAt);
      return {
        ok: true,
        session: {
          id: input.id,
          studentIdHmac: input.studentIdHmac,
          status: 'active',
          startedAt,
          endedAt: null,
          endReason: null,
        },
      };
    });
  }

  getActiveSession(): StudentKioskSessionEntry | null {
    const row = getSqliteDb()
      .prepare(
        `SELECT id, student_id_hmac, status, started_at, ended_at, end_reason
         FROM student_kiosk_sessions
         WHERE status = 'active'
         ORDER BY started_at DESC
         LIMIT 1`,
      )
      .get() as Record<string, unknown> | undefined;
    return row ? this.toSessionEntry(row) : null;
  }

  endSession(id: string, reason: string): StudentKioskSessionEntry | null {
    const endedAt = new Date().toISOString();
    const db = getSqliteDb();
    db.prepare(
      `UPDATE student_kiosk_sessions
       SET status = 'ended', ended_at = ?, end_reason = ?
       WHERE id = ? AND status = 'active'`,
    ).run(endedAt, reason, id);
    const row = db
      .prepare(
        `SELECT id, student_id_hmac, status, started_at, ended_at, end_reason
         FROM student_kiosk_sessions
         WHERE id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.toSessionEntry(row) : null;
  }

  endAllActiveSessions(reason: string): number {
    const result = getSqliteDb()
      .prepare(
        `UPDATE student_kiosk_sessions
         SET status = 'ended', ended_at = ?, end_reason = ?
         WHERE status = 'active'`,
      )
      .run(new Date().toISOString(), reason) as { changes?: unknown };
    return Number(result.changes ?? 0);
  }

  attributeTransaction(
    input: AttributeStudentTransactionInput,
  ): StudentTransactionAttributionEntry {
    const db = getSqliteDb();
    db.prepare(
      `INSERT OR IGNORE INTO student_transaction_attributions (
        transaction_id, kiosk_session_id, student_id_hmac, operation, attributed_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      input.transactionId,
      input.kioskSessionId,
      input.studentIdHmac,
      input.operation,
      input.attributedAt ?? new Date().toISOString(),
    );
    const row = db
      .prepare(
        `SELECT transaction_id, kiosk_session_id, student_id_hmac, operation, attributed_at
         FROM student_transaction_attributions
         WHERE transaction_id = ?`,
      )
      .get(input.transactionId) as Record<string, unknown>;
    return this.toAttributionEntry(row);
  }

  private toRosterEntry(row: Record<string, unknown>): StudentRosterEntry {
    return {
      studentIdHmac: String(row.student_id_hmac ?? ''),
      active: Number(row.active) === 1,
      importedAt: String(row.imported_at ?? ''),
    };
  }

  private toSessionEntry(
    row: Record<string, unknown>,
  ): StudentKioskSessionEntry {
    return {
      id: String(row.id ?? ''),
      studentIdHmac: String(row.student_id_hmac ?? ''),
      status: row.status === 'ended' ? 'ended' : 'active',
      startedAt: String(row.started_at ?? ''),
      endedAt: typeof row.ended_at === 'string' ? row.ended_at : null,
      endReason: typeof row.end_reason === 'string' ? row.end_reason : null,
    };
  }

  private toAttributionEntry(
    row: Record<string, unknown>,
  ): StudentTransactionAttributionEntry {
    return {
      transactionId: String(row.transaction_id ?? ''),
      kioskSessionId: String(row.kiosk_session_id ?? ''),
      studentIdHmac: String(row.student_id_hmac ?? ''),
      operation: String(row.operation ?? ''),
      attributedAt: String(row.attributed_at ?? ''),
    };
  }
}

export const studentSessionStore = new StudentSessionSqliteStore();
