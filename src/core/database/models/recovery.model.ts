import { LogMeta } from '../shared.schema';

export type RecoverySessionPhase =
  | 'initiated'
  | 'preflight_passed'
  | 'job_dispatched'
  | 'settled'
  | 'spooler_confirmed'
  | 'spooler_failed'
  | 'spooler_timeout'
  | 'reconciled';

export type RecoveryReconciliationAction =
  | 'none'
  | 'void'
  | 'auto_refund'
  | 'pending_admin_review';

export interface RecoverySessionEntry {
  id: string;
  mode: 'print' | 'copy';
  createdAt: string;
  updatedAt: string;
  phase: RecoverySessionPhase;
  requiredAmount: number;
  chargedAmount: number;
  sessionId: string | null;
  documentId: string | null;
  spoolerCorrelationKey: string | null;
  spoolerJobId: number | null;
  jobDispatchedAt: string | null;
  settledAt: string | null;
  spoolerTerminalAt: string | null;
  reconciledAt: string | null;
  startupReconciled: boolean;
  reconciliationAction: RecoveryReconciliationAction;
  reconciliationReason: string | null;
  lastError: string | null;
  wasPresentAtStartup?: boolean;
  context: LogMeta;
}

export interface RecoveryLifecycleState {
  bootCount: number;
  unexpectedRestartCount: number;
  lastStartupAt: string | null;
  lastStartupPid: number | null;
  lastStartupReason: string | null;
  lastShutdownAt: string | null;
  lastShutdownPid: number | null;
  lastShutdownSignal: string | null;
  lastUnexpectedRestartAt: string | null;
}

export interface RecoveryState {
  lifecycle: RecoveryLifecycleState;
  sessions: RecoverySessionEntry[];
}
