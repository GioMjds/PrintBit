import { LogMeta } from '../shared.schema';

export type SpoolerLifecycleState =
  | 'queued'
  | 'processing'
  | 'printed'
  | 'failed';

export interface SpoolerLifecycleTransitionEntry {
  state: SpoolerLifecycleState;
  timestamp: string;
  reason: string | null;
  printerName: string | null;
  spoolerCorrelationKey: string | null;
  spoolerJobId: number | null;
  jobStatus: string | null;
  pagesPrinted: number | null;
  totalPages: number | null;
  meta: LogMeta;
}

export interface SpoolerLifecycleRecord {
  transactionId: string;
  mode: 'print' | 'copy';
  createdAt: string;
  updatedAt: string;
  currentState: SpoolerLifecycleState | null;
  queuedAt: string | null;
  processingAt: string | null;
  printedAt: string | null;
  failedAt: string | null;
  sessionId: string | null;
  documentId: string | null;
  requiredAmount: number;
  spoolerCorrelationKey: string | null;
  spoolerJobId: number | null;
  printerName: string | null;
  reason: string | null;
  jobStatus: string | null;
  pagesPrinted: number | null;
  totalPages: number | null;
  transitions: SpoolerLifecycleTransitionEntry[];
}
