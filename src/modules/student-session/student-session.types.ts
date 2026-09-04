import type { Server as SocketIOServer } from 'socket.io';
import type {
  StudentKioskSessionEntry,
  StudentSessionSqliteStore,
} from '@/core/database/models/student-session.model';

export interface StudentSessionAuditLogger {
  appendAdminLog(
    type: string,
    message: string,
    meta?: Record<string, string | number | boolean | null>,
  ): Promise<unknown>;
}

export interface StudentSessionServiceDeps {
  io: Pick<SocketIOServer, 'emit'>;
  store: StudentSessionSqliteStore;
  adminService: StudentSessionAuditLogger;
}

export type StudentIdentificationResult =
  | { ok: true; sessionId: string }
  | { ok: false; code: 'IDENTIFICATION_FAILED' | 'KIOSK_IN_USE' };

export type StudentKioskState =
  | { status: 'idle' }
  | { status: 'active'; sessionId: string }
  | { status: 'ended'; sessionId: string };

export type StudentSessionEndReason =
  | 'user_ended'
  | 'idle_timeout'
  | 'server_restart'
  | 'startup_recovery';

export interface ActiveStudentSession {
  sessionId: string;
}

export interface StudentTransactionAttribution {
  transactionId: string;
  kioskSessionId: string;
  operation: string;
  attributedAt: string;
}

export interface RosterReplacementResult {
  rowCount: number;
  activeCount: number;
  inactiveCount: number;
}

export class StudentSessionServiceError extends Error {
  constructor(
    public readonly code: 'ACTIVE_SESSION_REQUIRED' | 'INVALID_END_REASON',
  ) {
    super(code);
    this.name = 'StudentSessionServiceError';
  }
}

export type InternalStudentSession = StudentKioskSessionEntry;
