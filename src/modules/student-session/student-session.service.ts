import { randomUUID } from 'node:crypto';
import {
  createStudentIdLookupHmac,
  normalizeStudentId,
} from '@/config';
import { adminService } from '@/services/admin';
import { studentSessionStore } from '@/core/database/models/student-session.model';
import type {
  ActiveStudentSession,
  InternalStudentSession,
  RosterReplacementResult,
  StudentIdentificationResult,
  StudentKioskState,
  StudentSessionEndReason,
  StudentSessionServiceDeps,
  StudentTransactionAttribution,
} from './student-session.types';
import { StudentSessionServiceError } from './student-session.types';

const ROSTER_CSV_HEADER = 'student_id,active';
const STUDENT_SESSION_END_REASONS = new Set<StudentSessionEndReason>([
  'user_ended',
  'idle_timeout',
  'server_restart',
  'startup_recovery',
]);

export class StudentSessionService {
  private readonly deps: StudentSessionServiceDeps;

  constructor(deps?: Partial<StudentSessionServiceDeps>) {
    if (!deps?.io) {
      throw new Error('StudentSessionService requires Socket.IO.');
    }
    this.deps = {
      io: deps.io,
      store: deps.store ?? studentSessionStore,
      adminService: deps.adminService ?? adminService,
    };
  }

  identify(rawId: string): StudentIdentificationResult {
    const studentIdHmac = createStudentIdLookupHmac(rawId);
    if (!studentIdHmac) {
      return { ok: false, code: 'IDENTIFICATION_FAILED' };
    }

    const claimed = this.deps.store.claimSession({
      id: randomUUID(),
      studentIdHmac,
    });
    if (!claimed.ok) {
      return {
        ok: false,
        code:
          claimed.reason === 'session-active'
            ? 'KIOSK_IN_USE'
            : 'IDENTIFICATION_FAILED',
      };
    }

    this.deps.io.emit('kiosk.session.started', {
      sessionId: claimed.session.id,
      status: 'active',
    });
    return { ok: true, sessionId: claimed.session.id };
  }

  getKioskState(): StudentKioskState {
    const active = this.deps.store.getActiveSession();
    return active
      ? { status: 'active', sessionId: active.id }
      : { status: 'idle' };
  }

  endActiveSession(reason: StudentSessionEndReason): StudentKioskState {
    if (!STUDENT_SESSION_END_REASONS.has(reason)) {
      throw new StudentSessionServiceError('INVALID_END_REASON');
    }
    const active = this.deps.store.getActiveSession();
    if (!active) return { status: 'idle' };

    const ended = this.deps.store.endSession(active.id, reason);
    if (!ended || ended.status !== 'ended') return this.getKioskState();

    const state: StudentKioskState = {
      status: 'ended',
      sessionId: ended.id,
    };
    this.deps.io.emit('kiosk.session.ended', state);
    return state;
  }

  requireActiveSession(): ActiveStudentSession {
    const active = this.getInternalActiveSession();
    return { sessionId: active.id };
  }

  attributeTransaction(
    transactionId: string,
    operation: string,
  ): StudentTransactionAttribution {
    const active = this.getInternalActiveSession();
    const attribution = this.deps.store.attributeTransaction({
      transactionId,
      kioskSessionId: active.id,
      studentIdHmac: active.studentIdHmac,
      operation,
    });
    return {
      transactionId: attribution.transactionId,
      kioskSessionId: attribution.kioskSessionId,
      operation: attribution.operation,
      attributedAt: attribution.attributedAt,
    };
  }

  replaceRosterCsv(csvText: string): RosterReplacementResult {
    const activeStudentHmacs = this.parseRosterCsv(csvText);
    this.deps.store.replaceRoster(activeStudentHmacs.entries);

    const result: RosterReplacementResult = {
      rowCount: activeStudentHmacs.rowCount,
      activeCount: activeStudentHmacs.entries.length,
      inactiveCount: activeStudentHmacs.rowCount - activeStudentHmacs.entries.length,
    };
    void this.deps.adminService
      .appendAdminLog('student_roster_replaced', 'Student roster replaced.', {
        rowCount: result.rowCount,
        activeCount: result.activeCount,
        inactiveCount: result.inactiveCount,
      })
      .catch(() => undefined);
    return result;
  }

  private getInternalActiveSession(): InternalStudentSession {
    const active = this.deps.store.getActiveSession();
    if (!active) throw new StudentSessionServiceError('ACTIVE_SESSION_REQUIRED');
    return active;
  }

  private parseRosterCsv(csvText: string): {
    entries: Array<{ studentIdHmac: string }>;
    rowCount: number;
  } {
    const lines = csvText.replace(/^\uFEFF/, '').split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    if (lines[0] !== ROSTER_CSV_HEADER) {
      throw new Error('Roster CSV header is invalid.');
    }

    const hmacs = new Set<string>();
    const entries: Array<{ studentIdHmac: string }> = [];
    for (let index = 1; index < lines.length; index += 1) {
      const cells = lines[index].split(',');
      if (cells.length !== 2) throw new Error('Roster CSV row is invalid.');

      const normalizedId = normalizeStudentId(cells[0].trim());
      const active = cells[1].trim().toLowerCase();
      if (!normalizedId || (active !== 'true' && active !== 'false')) {
        throw new Error('Roster CSV row is invalid.');
      }

      const studentIdHmac = createStudentIdLookupHmac(normalizedId);
      if (!studentIdHmac || hmacs.has(studentIdHmac)) {
        throw new Error('Roster CSV contains duplicate or invalid rows.');
      }
      hmacs.add(studentIdHmac);
      if (active === 'true') entries.push({ studentIdHmac });
    }
    return { entries, rowCount: lines.length - 1 };
  }
}
