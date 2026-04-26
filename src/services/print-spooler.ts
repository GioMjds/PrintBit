import { spawn } from 'node:child_process';
import type { Server } from 'socket.io';
import { db, type LogMeta, type ReceiptRecordStatus } from './db';
import { adminService } from './admin';
import {
  PendingRefundServiceError,
  upsertSpoolerFailureRefund,
} from './pending-refund';
import { checkpointRecoverySession } from './recovery';
import { persistAndEmitPrintLifecycleState } from './print-lifecycle-state';
import { setPrinterFaultLock } from './printer-fault-lock';
import { anomalyService, buildAnomalyFingerprint } from './anomaly';
import {
  PRINT_SPOOLER_LOOKBACK_MINUTES,
  PRINT_SPOOLER_MONITOR_WINDOW_MS,
  PRINT_SPOOLER_POLL_INTERVAL_MS,
  PRINT_SPOOLER_QUERY_TIMEOUT_MS,
} from '@/config';
import { ReceiptService } from '@/modules/receipt/receipt.service';

/** Polling interval for checking spooler status */
const POLL_INTERVAL_MS = PRINT_SPOOLER_POLL_INTERVAL_MS;
/** Total window to watch the spooler before giving up */
const MONITOR_WINDOW_MS = PRINT_SPOOLER_MONITOR_WINDOW_MS;
/** How far back (in minutes) to look for print jobs when querying the spooler */
const JOB_LOOKBACK_MINUTES = PRINT_SPOOLER_LOOKBACK_MINUTES;
/** Allowed clock skew between app dispatch time and spooler submitted time */
const JOB_SUBMITTED_TIME_SKEW_MS = 5_000;
/** Timeout per individual PowerShell query */
const SPOOLER_QUERY_TIMEOUT_MS = PRINT_SPOOLER_QUERY_TIMEOUT_MS;
/** Stop monitoring when spooler queries repeatedly fail */
const MAX_CONSECUTIVE_QUERY_FAILURES = 3;
const receiptService = new ReceiptService();

// Windows JobStatus enum values (comma-separated string from PowerShell)

const TERMINAL_SUCCESS_TOKENS = new Set([
  'Printed',
  'Complete',
  'SchedulingComplete',
]);

const TERMINAL_FAILURE_TOKENS = new Set([
  'Error',
  'Deleted',
  'Offline',
  'PaperOut',
  'BlockedDevq',
  'UserIntervention',
]);

export interface SpoolerMonitorOptions {
  printerName: string;
  chargedAmount: number;
  jobDispatchedAt: string;
  spoolerCorrelationKey?: string | null;
  io: Server;
  jobContext: Record<string, string | number | boolean | null | undefined>;
  onConfirmed?: (context: {
    spoolerJobId: number;
    status: string;
    pagesPrinted: number;
    totalPages: number;
  }) => Promise<void>;
  receipt?: any;
}

export interface SpoolerMonitorResult {
  detected: boolean;
  jobStatus: string | null;
  pagesPrinted: number;
  failed: boolean;
  timedOut?: boolean;
  reason?: string;
  /** ID of the created PendingRefundEntry when failed === true */
  refundId?: string;
}

interface SpoolerJobRow {
  id: number;
  status: string;
  totalPages: number;
  pagesPrinted: number;
  submittedTime: string | null;
}

type SpoolerQueryErrorCode =
  | 'powershell_timeout'
  | 'query_failed'
  | 'invalid_response'
  | 'invalid_json';

interface SpoolerQueryResult {
  jobs: SpoolerJobRow[];
  elapsedMs: number;
  errorCode: SpoolerQueryErrorCode | null;
  errorDetail: string | null;
}

function receiptStatusFromRefundDisposition(
  refundDisposition: 'auto_refunded' | 'pending_admin_review',
): ReceiptRecordStatus {
  return refundDisposition === 'auto_refunded'
    ? 'refunded'
    : 'refunded_pending_review';
}

async function safeUpdateReceiptTerminalStatus(input: {
  transactionId: string | null;
  status: ReceiptRecordStatus;
  phase: string;
  spoolerCorrelationKey: string | null;
  spoolerJobId: number | null;
  reason?: string;
  terminalAt?: string;
}): Promise<void> {
  if (!input.transactionId) return;
  try {
    receiptService.updateTerminalStatus({
      transactionId: input.transactionId,
      status: input.status,
      terminalAt: input.terminalAt ?? new Date().toISOString(),
    });
  } catch (error) {
    try {
      await adminService.appendAdminLog(
        'receipt_status_update_failed',
        'Failed to update print receipt terminal status.',
        {
          transactionId: input.transactionId,
          status: input.status,
          phase: input.phase,
          spoolerCorrelationKey: input.spoolerCorrelationKey,
          spoolerJobId: input.spoolerJobId,
          reason: input.reason ?? null,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    } catch (logError) {
      console.error('[SPOOLER-MONITOR] Failed to append receipt update failure log.', {
        transactionId: input.transactionId,
        spoolerCorrelationKey: input.spoolerCorrelationKey,
        spoolerJobId: input.spoolerJobId,
        error: logError instanceof Error ? logError.message : String(logError),
      });
    }
  }
}

// Persistent PowerShell

interface PersistentPS {
  run: (script: string, timeoutMs?: number) => Promise<string>;
  dispose: () => void;
}

function createPersistentPS(): PersistentPS {
  const ps = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );

  // Drain stderr so the process never blocks on a full stderr pipe buffer.
  // We don't need it — non-fatal PS warnings go there and can be ignored.
  ps.stderr.resume();

  let disposed = false;

  function run(script: string, timeoutMs = 10_000): Promise<string> {
    // NOTE: This implementation is NOT safe for concurrent calls.
    // Always await the previous run() before calling again.
    if (disposed) {
      return Promise.reject(
        new Error('[SPOOLER-MONITOR] PS runspace already disposed'),
      );
    }

    return new Promise((resolve, reject) => {
      // A unique sentinel lets us know exactly when this command's output ends,
      // since stdout is a continuous stream shared across all run() calls.
      const sentinel = `__PS_DONE_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
      let output = '';

      const timer = setTimeout(() => {
        ps.stdout.off('data', onData);
        dispose();
        reject(new Error('[SPOOLER-MONITOR] PS runspace query timed out'));
      }, timeoutMs);

      const onData = (chunk: Buffer): void => {
        output += chunk.toString();
        if (output.includes(sentinel)) {
          clearTimeout(timer);
          ps.stdout.off('data', onData);
          // Return everything before the sentinel line, trimmed
          resolve(output.slice(0, output.indexOf(sentinel)).trim());
        }
      };

      ps.stdout.on('data', onData);
      // Append Write-Output of the sentinel so we detect end-of-output
      ps.stdin.write(`${script}\nWrite-Output '${sentinel}'\n`);
    });
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    try {
      ps.stdin.end();
    } catch {
      /* ignore — process may already be gone */
    }
    try {
      ps.kill();
    } catch {
      /* ignore */
    }
  }

  return { run, dispose };
}

// ── PowerShell helper ───────────────────────────────────────────────────────

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function classifyQueryErrorCode(message: string): SpoolerQueryErrorCode {
  if (message.toLowerCase().includes('timed out')) return 'powershell_timeout';
  return 'query_failed';
}

function normalizeSpoolerRows(raw: unknown): SpoolerJobRow[] {
  const items = Array.isArray(raw) ? raw : [];
  return items
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === 'object',
    )
    .map((item) => ({
      id: Number(item.Id ?? 0),
      status: String(item.Status ?? 'Unknown').trim(),
      totalPages: Number(item.TotalPages ?? 0),
      pagesPrinted: Number(item.PagesPrinted ?? 0),
      submittedTime:
        typeof item.SubmittedTime === 'string' ? item.SubmittedTime : null,
    }));
}

async function queryRecentPrintJobs(
  printerName: string,
  ps: PersistentPS,
): Promise<SpoolerQueryResult> {
  const queryStartedAt = Date.now();
  try {
    const escaped = printerName.replace(/'/g, "''").replace(/`/g, '``');
    const script =
      `$cutoff = (Get-Date).AddMinutes(-${JOB_LOOKBACK_MINUTES}); ` +
      `try { ` +
      `  $jobs = @(Get-PrintJob -PrinterName '${escaped}' -ErrorAction Stop | Where-Object { $_.SubmittedTime -ge $cutoff } | Select-Object Id, @{N='Status';E={$_.JobStatus.ToString()}}, TotalPages, PagesPrinted, @{N='SubmittedTime';E={$_.SubmittedTime.ToUniversalTime().ToString('o')}}); ` +
      `  [PSCustomObject]@{ Ok = $true; Jobs = $jobs } | ConvertTo-Json -Depth 4 -Compress ` +
      `} catch { ` +
      `  [PSCustomObject]@{ Ok = $false; Error = $_.Exception.Message; Category = $_.CategoryInfo.Reason } | ConvertTo-Json -Depth 4 -Compress ` +
      `}`;

    const json = await ps.run(script, SPOOLER_QUERY_TIMEOUT_MS);
    const elapsedMs = Date.now() - queryStartedAt;

    if (!json || json === 'null') {
      return {
        jobs: [],
        elapsedMs,
        errorCode: null,
        errorDetail: null,
      };
    }

    let envelope: unknown;
    try {
      envelope = JSON.parse(json);
    } catch (error) {
      return {
        jobs: [],
        elapsedMs,
        errorCode: 'invalid_json',
        errorDetail: error instanceof Error ? error.message : String(error),
      };
    }

    if (!envelope || typeof envelope !== 'object') {
      return {
        jobs: [],
        elapsedMs,
        errorCode: 'invalid_response',
        errorDetail: 'Unexpected non-object response from spooler query.',
      };
    }

    const record = envelope as Record<string, unknown>;
    const ok = record.Ok === true;
    if (!ok) {
      const errorMessage =
        typeof record.Error === 'string' && record.Error.trim().length > 0
          ? record.Error.trim()
          : 'Unknown Get-PrintJob failure';
      const category =
        typeof record.Category === 'string' && record.Category.trim().length > 0
          ? record.Category.trim()
          : null;
      return {
        jobs: [],
        elapsedMs,
        errorCode: 'query_failed',
        errorDetail: category ? `${errorMessage} (${category})` : errorMessage,
      };
    }

    return {
      jobs: normalizeSpoolerRows(record.Jobs),
      elapsedMs,
      errorCode: null,
      errorDetail: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jobs: [],
      elapsedMs: Date.now() - queryStartedAt,
      errorCode: classifyQueryErrorCode(message),
      errorDetail: message,
    };
  }
}

/** Returns true if any token in the comma/space-separated status string matches the set. */
function matchesStatusSet(status: string, set: Set<string>): boolean {
  return status.split(/[,\s]+/).some((token) => token && set.has(token));
}

/**
 * Fire-and-forget: call this AFTER settlement has completed.
 * It polls the Windows print spooler in the background.
 * It emits lifecycle events over Socket.IO for kiosk UI synchronization:
 *   - `printLifecycleState` (`queued` -> `processing` -> `printed|failed`)
 *   - `printJobDispatched` (monitor latched to a concrete spooler job id)
 *   - `printerSpoolerConfirmed` (terminal success)
 *   - `printerSpoolerFailure` (terminal failure)
 *   - `printerSpoolerTimeout` (monitor window expired before terminal status)
 * On spooler-reported failure it:
 *   - creates a PendingRefundEntry in the DB
 *   - writes an admin log entry
 *   - emits `printerSpoolerFailure` over Socket.IO
 */
export async function monitorSpoolerJob(
  options: SpoolerMonitorOptions,
): Promise<SpoolerMonitorResult> {
  const {
    printerName,
    chargedAmount,
    jobDispatchedAt,
    spoolerCorrelationKey,
    io,
    jobContext,
    onConfirmed,
    receipt,
  } = options;

  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();
  const transactionId = normalizeOptionalString(jobContext.transactionId);
  const sessionId = normalizeOptionalString(jobContext.sessionId);
  const documentId = normalizeOptionalString(jobContext.documentId);
  const normalizedPrinterName = normalizeOptionalString(printerName);
  const correlationKey = normalizeOptionalString(spoolerCorrelationKey);
  const dispatchEngine =
    normalizeOptionalString(jobContext.dispatchEngine)?.toLowerCase() ?? null;
  const allowNoJobSuccessFallback = dispatchEngine === 'pdftoprinter';
  const dispatchedAtMs = Date.parse(jobDispatchedAt);
  const submittedTimeCutoffMs = Number.isFinite(dispatchedAtMs)
    ? dispatchedAtMs - JOB_SUBMITTED_TIME_SKEW_MS
    : null;
  let pollCount = 0;
  let queryFailureCount = 0;
  let consecutiveQueryFailures = 0;
  let psRestartCount = 0;
  let lastQueryErrorCode: SpoolerQueryErrorCode | null = null;
  let lastQueryErrorDetail: string | null = null;
  let lastQueryElapsedMs = 0;
  let handoffLatencyMs: number | null = null;

  const buildLifecycleMeta = (extra: LogMeta = {}): LogMeta => {
    const baseMeta: LogMeta = {
      monitorStartedAt: startedAtIso,
      monitorElapsedMs: Date.now() - startedAtMs,
      monitorWindowMs: MONITOR_WINDOW_MS,
      monitorPollCount: pollCount,
      spoolerQueryFailureCount: queryFailureCount,
      spoolerConsecutiveQueryFailures: consecutiveQueryFailures,
      spoolerPsRestartCount: psRestartCount,
      spoolerLastQueryElapsedMs: lastQueryElapsedMs,
    };
    if (handoffLatencyMs !== null) {
      baseMeta.spoolerHandoffLatencyMs = handoffLatencyMs;
    }
    if (lastQueryErrorCode) {
      baseMeta.spoolerLastQueryErrorCode = lastQueryErrorCode;
    }
    if (lastQueryErrorDetail) {
      baseMeta.spoolerLastQueryError = lastQueryErrorDetail;
    }
    return {
      ...baseMeta,
      ...extra,
    };
  };

  console.log('[SPOOLER-MONITOR] Starting spooler monitor.', {
    printerName: normalizedPrinterName,
    chargedAmount,
    transactionId,
    spoolerCorrelationKey: correlationKey,
    jobDispatchedAt,
    monitorStartedAt: startedAtIso,
  });
  await persistAndEmitPrintLifecycleState(
    io,
    {
      mode: 'print',
      state: 'queued',
      printerName: normalizedPrinterName,
      transactionId,
      spoolerCorrelationKey: correlationKey,
      jobDispatchedAt,
      receipt,
    },
    {
      requiredAmount: chargedAmount,
      sessionId,
      documentId,
      meta: buildLifecycleMeta({
        marker: 'queued',
      }),
    },
  );

  if (!normalizedPrinterName) {
    const reason = 'Spooler monitoring unavailable: printer name is missing.';
    await persistAndEmitPrintLifecycleState(
      io,
      {
        mode: 'print',
        state: 'failed',
        printerName: null,
        transactionId,
        spoolerCorrelationKey: correlationKey,
        jobStatus: null,
        pagesPrinted: 0,
        totalPages: 0,
        reason,
        timedOut: true,
        receipt,
      },
      {
        requiredAmount: chargedAmount,
        sessionId,
        documentId,
        meta: buildLifecycleMeta({
          marker: 'monitor_unavailable',
        }),
      },
    );
    io.emit('printerSpoolerTimeout', {
      jobStatus: null,
      pagesPrinted: 0,
      totalPages: 0,
      printerName: null,
      spoolerJobId: null,
      transactionId,
      spoolerCorrelationKey: correlationKey,
      jobDispatchedAt,
      monitorStartedAt: startedAtIso,
      monitorElapsedMs: Date.now() - startedAtMs,
      monitorWindowMs: MONITOR_WINDOW_MS,
      queryFailureCount,
      reason,
      receipt,
    });
    try {
      await adminService.appendAdminLog(
        'print_spooler_monitor_unavailable',
        reason,
        {
          transactionId,
          spoolerCorrelationKey: correlationKey,
          chargedAmount,
        },
      );
    } catch (error) {
      console.error('[SPOOLER-MONITOR] Failed to append monitor-unavailable log.', {
        error: error instanceof Error ? error.message : String(error),
        transactionId,
        spoolerCorrelationKey: correlationKey,
      });
    }
    await safeUpdateReceiptTerminalStatus({
      transactionId,
      status: 'failed',
      phase: 'monitor_unavailable',
      spoolerCorrelationKey: correlationKey,
      spoolerJobId: null,
      reason,
    });
    return {
      detected: false,
      jobStatus: null,
      pagesPrinted: 0,
      failed: true,
      timedOut: true,
      reason,
    };
  }

  const deadline = startedAtMs + MONITOR_WINDOW_MS;
  let lastStatus: string | null = null;
  let lastPagesPrinted = 0;
  let lastTotalPages = 0;
  let trackedJobId: number | null = null;
  let emptyPollCountWithoutTrackedJob = 0;
  let warnedSubmittedTimeFallback = false;

  let ps = createPersistentPS();
  const restartPersistentPs = (
    reason: string,
    errorCode: SpoolerQueryErrorCode,
    errorDetail: string | null,
  ): void => {
    ps.dispose();
    ps = createPersistentPS();
    psRestartCount += 1;
    console.warn('[SPOOLER-MONITOR] Restarted PowerShell runspace.', {
      transactionId,
      spoolerCorrelationKey: correlationKey,
      printerName: normalizedPrinterName,
      reason,
      errorCode,
      errorDetail,
      psRestartCount,
    });
  };

  const settleMonitorAmbiguity = async (
    reason: string,
    marker: string,
  ): Promise<SpoolerMonitorResult> => {
    const monitorElapsedMs = Date.now() - startedAtMs;
    console.warn('[SPOOLER-MONITOR] Monitor ambiguity detected.', {
      reason,
      marker,
      transactionId,
      spoolerCorrelationKey: correlationKey,
      spoolerJobId: trackedJobId,
      monitorElapsedMs,
      monitorWindowMs: MONITOR_WINDOW_MS,
      pollCount,
      queryFailureCount,
      lastQueryErrorCode,
      lastQueryErrorDetail,
    });
    await persistAndEmitPrintLifecycleState(
      io,
      {
        mode: 'print',
        state: 'failed',
        printerName: normalizedPrinterName,
        transactionId,
        spoolerCorrelationKey: correlationKey,
        spoolerJobId: trackedJobId,
        jobStatus: lastStatus,
        pagesPrinted: lastPagesPrinted,
        totalPages: lastTotalPages,
        reason,
        timedOut: true,
        receipt,
      },
      {
        requiredAmount: chargedAmount,
        sessionId,
        documentId,
        meta: buildLifecycleMeta({
          marker,
        }),
      },
    );
    io.emit('printerSpoolerTimeout', {
      jobStatus: lastStatus,
      pagesPrinted: lastPagesPrinted,
      totalPages: lastTotalPages,
      printerName: normalizedPrinterName,
      transactionId,
      spoolerCorrelationKey: correlationKey,
      spoolerJobId: trackedJobId,
      jobDispatchedAt,
      monitorStartedAt: startedAtIso,
      monitorElapsedMs,
      monitorWindowMs: MONITOR_WINDOW_MS,
      pollCount,
      queryFailureCount,
      lastQueryErrorCode,
      lastQueryErrorDetail,
      reason,
      receipt,
    });
    try {
      await adminService.appendAdminLog(
        'print_spooler_monitor_timeout',
        reason,
        {
          transactionId,
          spoolerCorrelationKey: correlationKey,
          spoolerJobId: trackedJobId,
          chargedAmount,
          monitorElapsedMs,
          pollCount,
          queryFailureCount,
          lastQueryErrorCode,
          lastQueryErrorDetail,
        },
      );
    } catch (error) {
      console.error('[SPOOLER-MONITOR] Failed to append timeout admin log.', {
        error: error instanceof Error ? error.message : String(error),
        transactionId,
        spoolerCorrelationKey: correlationKey,
      });
    }
    if (transactionId) {
      try {
        await checkpointRecoverySession({
          transactionId,
          mode: 'print',
          phase: 'spooler_timeout',
          requiredAmount: chargedAmount,
          chargedAmount,
          sessionId,
          documentId,
          spoolerCorrelationKey: correlationKey,
          spoolerJobId: trackedJobId,
          jobDispatchedAt,
          spoolerTerminalAt: new Date().toISOString(),
          context: {
            lastStatus: lastStatus ?? null,
            pagesPrinted: lastPagesPrinted,
            totalPages: lastTotalPages,
            timedOut: true,
            monitorElapsedMs,
            pollCount,
            queryFailureCount,
            lastQueryErrorCode,
            lastQueryErrorDetail,
            reason,
          },
          lastError: reason,
        });
      } catch (checkpointError) {
        console.error(
          '[SPOOLER-MONITOR] Failed to checkpoint recovery session (timeout)',
          checkpointError,
        );
      }
    }
    await safeUpdateReceiptTerminalStatus({
      transactionId,
      status: 'failed',
      phase: marker,
      spoolerCorrelationKey: correlationKey,
      spoolerJobId: trackedJobId,
      reason,
    });
    return {
      detected: trackedJobId !== null || lastStatus !== null,
      jobStatus: lastStatus,
      pagesPrinted: lastPagesPrinted,
      failed: true,
      timedOut: true,
      reason,
    };
  };

  try {
    // Step 1: first query fires immediately — no upfront 4 s sleep
    let queryResult = await queryRecentPrintJobs(normalizedPrinterName, ps);
    pollCount += 1;
    lastQueryElapsedMs = queryResult.elapsedMs;

    while (Date.now() < deadline) {
      if (queryResult.errorCode) {
        queryFailureCount += 1;
        consecutiveQueryFailures += 1;
        lastQueryErrorCode = queryResult.errorCode;
        lastQueryErrorDetail = queryResult.errorDetail;
        console.error('[SPOOLER-MONITOR] Failed to query spooler snapshot.', {
          transactionId,
          spoolerCorrelationKey: correlationKey,
          printerName: normalizedPrinterName,
          pollCount,
          elapsedMs: queryResult.elapsedMs,
          queryFailureCount,
          consecutiveQueryFailures,
          errorCode: queryResult.errorCode,
          errorDetail: queryResult.errorDetail,
        });
        const recoverablePsFailure =
          queryResult.errorCode === 'powershell_timeout' ||
          (queryResult.errorCode === 'query_failed' &&
            (queryResult.errorDetail ?? '').includes(
              'PS runspace already disposed',
            ));
        if (recoverablePsFailure) {
          restartPersistentPs(
            'recoverable_query_failure',
            queryResult.errorCode,
            queryResult.errorDetail,
          );
        }
        if (consecutiveQueryFailures >= MAX_CONSECUTIVE_QUERY_FAILURES) {
          const reason =
            'Spooler monitoring aborted due to repeated spooler query failures.';
          try {
            await adminService.appendAdminLog(
              'print_spooler_monitor_query_failed',
              reason,
              {
                transactionId,
                spoolerCorrelationKey: correlationKey,
                spoolerJobId: trackedJobId,
                chargedAmount,
                pollCount,
                queryFailureCount,
                consecutiveQueryFailures,
                lastQueryErrorCode,
                lastQueryErrorDetail,
              },
            );
          } catch (error) {
            console.error(
              '[SPOOLER-MONITOR] Failed to append query failure admin log.',
              {
                error: error instanceof Error ? error.message : String(error),
                transactionId,
                spoolerCorrelationKey: correlationKey,
              },
            );
          }
          await anomalyService.report({
            type: 'print_spooler_monitor_query_failed',
            source: 'print-spooler',
            category: 'spooler',
            severity: 'warning',
            message: reason,
            fingerprint: buildAnomalyFingerprint([
              'spooler',
              normalizedPrinterName,
              correlationKey ?? transactionId ?? 'uncorrelated',
              'query_failed',
            ]),
            context: {
              transactionId,
              spoolerCorrelationKey: correlationKey,
              spoolerJobId: trackedJobId,
              queryFailureCount,
              consecutiveQueryFailures,
              lastQueryErrorCode,
              lastQueryErrorDetail,
            },
          });
          return settleMonitorAmbiguity(reason, 'query_failure_threshold');
        }
      } else {
        consecutiveQueryFailures = 0;
      }

      const jobs = queryResult.jobs;
      if (jobs.length === 0) {
        if (trackedJobId === null) {
          emptyPollCountWithoutTrackedJob += 1;
          if (
            allowNoJobSuccessFallback &&
            emptyPollCountWithoutTrackedJob >= 3 &&
            correlationKey
          ) {
            const inferredStatus = 'DISPATCH_CONFIRMED_NO_SPOOLER_JOB';
            await persistAndEmitPrintLifecycleState(
              io,
              {
                mode: 'print',
                state: 'printed',
                printerName: normalizedPrinterName,
                transactionId,
                spoolerCorrelationKey: correlationKey,
                spoolerJobId: null,
                jobStatus: inferredStatus,
                pagesPrinted: 0,
                totalPages: 0,
                reason:
                  'No spooler job snapshot detected after dispatch; treating pdftoprinter synchronous dispatch as completed.',
                receipt,
              },
              {
                requiredAmount: chargedAmount,
                sessionId,
                documentId,
                meta: buildLifecycleMeta({
                  marker: 'printed_inferred_pdftoprinter',
                  dispatchEngine,
                  emptyPollCountWithoutTrackedJob,
                }),
              },
            );

            io.emit('printerSpoolerConfirmed', {
              jobStatus: inferredStatus,
              pagesPrinted: 0,
              totalPages: 0,
              printerName: normalizedPrinterName,
              transactionId,
              spoolerCorrelationKey: correlationKey,
              spoolerJobId: null,
              jobDispatchedAt,
              monitorStartedAt: startedAtIso,
              monitorElapsedMs: Date.now() - startedAtMs,
              handoffLatencyMs,
              pollCount,
              queryFailureCount,
              receipt,
            });

            try {
              await adminService.appendAdminLog(
                'print_spooler_inferred_success',
                'No spooler job detected after pdftoprinter dispatch; marked as printed.',
                {
                  transactionId,
                  spoolerCorrelationKey: correlationKey,
                  printerName: normalizedPrinterName,
                  dispatchEngine,
                  emptyPollCountWithoutTrackedJob,
                  monitorElapsedMs: Date.now() - startedAtMs,
                },
              );
            } catch (error) {
              console.error(
                '[SPOOLER-MONITOR] Failed to append inferred-success admin log.',
                error,
              );
            }

            if (onConfirmed) {
              try {
                await onConfirmed({
                  spoolerJobId: 0,
                  status: inferredStatus,
                  pagesPrinted: 0,
                  totalPages: 0,
                });
              } catch (cleanupError) {
                console.error(
                  '[SPOOLER-MONITOR] Post-confirmed cleanup callback failed for inferred success.',
                  cleanupError,
                );
              }
            }
            await safeUpdateReceiptTerminalStatus({
              transactionId,
              status: 'printed',
              phase: 'printed_inferred_pdftoprinter',
              spoolerCorrelationKey: correlationKey,
              spoolerJobId: null,
              reason: inferredStatus,
            });

            return {
              detected: false,
              jobStatus: inferredStatus,
              pagesPrinted: 0,
              failed: false,
            };
          }
        }
        await new Promise<void>((resolve) =>
          setTimeout(resolve, POLL_INTERVAL_MS),
        );
        queryResult = await queryRecentPrintJobs(normalizedPrinterName, ps);
        pollCount += 1;
        lastQueryElapsedMs = queryResult.elapsedMs;
        continue;
      }
      emptyPollCountWithoutTrackedJob = 0;

      const scopedJobs =
        submittedTimeCutoffMs === null
          ? jobs
          : (() => {
              const recentJobs = jobs.filter((candidate) => {
                const submittedAtMs = candidate.submittedTime
                  ? Date.parse(candidate.submittedTime)
                  : Number.NaN;
                return (
                  Number.isFinite(submittedAtMs) &&
                  submittedAtMs >= submittedTimeCutoffMs
                );
              });

              if (recentJobs.length === 0 && !warnedSubmittedTimeFallback) {
                console.warn(
                  '[SPOOLER-MONITOR] No jobs met submitted-time cutoff; using ID fallback.',
                  {
                    transactionId,
                    spoolerCorrelationKey: correlationKey,
                    cutoffMs: submittedTimeCutoffMs,
                  },
                );
                warnedSubmittedTimeFallback = true;
              }

              return recentJobs.length > 0 ? recentJobs : jobs;
            })();

      // Latch to the highest ID only before we have a tracked job.
      // Once tracked, never rebind to a different spooler job.
      const job: SpoolerJobRow | null =
        trackedJobId !== null
          ? (scopedJobs.find((j) => j.id === trackedJobId) ?? null)
          : scopedJobs.reduce((a, b) => (b.id > a.id ? b : a));

      if (job === null) {
        console.warn(
          '[SPOOLER-MONITOR] Tracked job missing in current spooler snapshot.',
          {
            transactionId,
            spoolerCorrelationKey: correlationKey,
            trackedJobId,
          },
        );
        await new Promise<void>((resolve) =>
          setTimeout(resolve, POLL_INTERVAL_MS),
        );
        queryResult = await queryRecentPrintJobs(normalizedPrinterName, ps);
        pollCount += 1;
        lastQueryElapsedMs = queryResult.elapsedMs;
        continue;
      }

      if (trackedJobId === null) {
        trackedJobId = job.id;
        if (Number.isFinite(dispatchedAtMs)) {
          handoffLatencyMs = Math.max(0, Date.now() - dispatchedAtMs);
        }
        console.log(
          `[SPOOLER-MONITOR] Latched onto spooler job #${trackedJobId}`,
          {
            transactionId,
            spoolerCorrelationKey: correlationKey,
            handoffLatencyMs,
            monitorElapsedMs: Date.now() - startedAtMs,
          },
        );
        io.emit('printJobDispatched', {
          printerName: normalizedPrinterName,
          jobDispatchedAt,
          spoolerCorrelationKey: correlationKey,
          transactionId,
          spoolerJobId: trackedJobId,
          monitorStartedAt: startedAtIso,
          monitorElapsedMs: Date.now() - startedAtMs,
          monitorWindowMs: MONITOR_WINDOW_MS,
          handoffLatencyMs,
          pollCount,
        });
        await persistAndEmitPrintLifecycleState(
          io,
          {
            mode: 'print',
            state: 'processing',
            printerName: normalizedPrinterName,
            transactionId,
            spoolerCorrelationKey: correlationKey,
            spoolerJobId: trackedJobId,
            jobStatus: job.status,
            pagesPrinted: job.pagesPrinted,
            totalPages: job.totalPages,
          },
          {
            requiredAmount: chargedAmount,
            sessionId,
            documentId,
            meta: buildLifecycleMeta({
              marker: 'processing',
            }),
          },
        );
      }

      lastStatus = job.status;
      lastPagesPrinted = job.pagesPrinted;
      lastTotalPages = job.totalPages;

      console.log(
        `[SPOOLER-MONITOR] Job #${job.id} status="${job.status}" pages=${job.pagesPrinted}/${job.totalPages}`,
      );

      if (matchesStatusSet(job.status, TERMINAL_SUCCESS_TOKENS)) {
        console.log(
          `[SPOOLER-MONITOR] ✓ Job #${job.id} completed successfully`,
        );
        await persistAndEmitPrintLifecycleState(
          io,
          {
            mode: 'print',
            state: 'printed',
            printerName: normalizedPrinterName,
            transactionId,
            spoolerCorrelationKey: correlationKey,
            spoolerJobId: job.id,
            jobStatus: job.status,
            pagesPrinted: job.pagesPrinted,
            totalPages: job.totalPages,
            receipt,
          },
          {
            requiredAmount: chargedAmount,
            sessionId,
            documentId,
            meta: buildLifecycleMeta({
              marker: 'printed',
            }),
          },
        );
        io.emit('printerSpoolerConfirmed', {
          jobStatus: job.status,
          pagesPrinted: job.pagesPrinted,
          totalPages: job.totalPages,
          printerName: normalizedPrinterName,
          transactionId,
          spoolerCorrelationKey: correlationKey,
          spoolerJobId: job.id,
          jobDispatchedAt,
          monitorStartedAt: startedAtIso,
          monitorElapsedMs: Date.now() - startedAtMs,
          handoffLatencyMs,
          pollCount,
          queryFailureCount,
          receipt,
        });
        if (transactionId) {
          try {
            await checkpointRecoverySession({
              transactionId,
              mode: 'print',
              phase: 'reconciled',
              requiredAmount: chargedAmount,
              chargedAmount,
              sessionId,
              documentId,
              spoolerCorrelationKey: correlationKey,
              spoolerJobId: job.id,
              jobDispatchedAt,
              settledAt: null,
              spoolerTerminalAt: new Date().toISOString(),
              reconciledAt: new Date().toISOString(),
              startupReconciled: false,
              reconciliationAction: 'none',
              reconciliationReason: 'Spooler confirmed successful print.',
              context: {
                spoolerOutcome: 'confirmed',
                jobStatus: job.status,
                pagesPrinted: job.pagesPrinted,
                totalPages: job.totalPages,
                monitorElapsedMs: Date.now() - startedAtMs,
                handoffLatencyMs,
                pollCount,
                queryFailureCount,
              },
            });
          } catch (checkpointError) {
            console.error(
              '[SPOOLER-MONITOR] Failed to checkpoint recovery session (confirmed)',
              checkpointError,
            );
          }
        }
        try {
          await adminService.appendAdminLog(
            'print_spooler_confirmed',
            `Print spooler confirmed successful print: ${job.status}.`,
            {
              spoolerJobId: job.id,
              spoolerStatus: job.status,
              pagesPrinted: job.pagesPrinted,
              totalPages: job.totalPages,
              printerName: normalizedPrinterName,
              transactionId,
              spoolerCorrelationKey: correlationKey,
              monitorElapsedMs: Date.now() - startedAtMs,
              handoffLatencyMs,
              pollCount,
              queryFailureCount,
            },
          );
        } catch (error) {
          console.error(
            '[SPOOLER-MONITOR] Failed to append spooler confirmed admin log.',
            error,
          );
        }
        if (onConfirmed) {
          try {
            await onConfirmed({
              spoolerJobId: job.id,
              status: job.status,
              pagesPrinted: job.pagesPrinted,
              totalPages: job.totalPages,
            });
          } catch (cleanupError) {
            const message =
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError);
            console.error(
              '[SPOOLER-MONITOR] Post-confirmed cleanup callback failed.',
              {
                transactionId,
                spoolerJobId: job.id,
                error: message,
              },
            );
            try {
              await adminService.appendAdminLog(
                'print_spooler_success_cleanup_failed',
                'Spooler-confirmed print cleanup callback failed.',
                {
                  transactionId,
                  spoolerJobId: job.id,
                  spoolerStatus: job.status,
                  error: message,
                },
              );
            } catch (adminLogError) {
              console.error(
                '[SPOOLER-MONITOR] Failed to append cleanup callback failure log.',
                {
                  error:
                    adminLogError instanceof Error
                      ? adminLogError.message
                      : String(adminLogError),
                  transactionId,
                  spoolerJobId: job.id,
                },
              );
            }
          }
        }
        await safeUpdateReceiptTerminalStatus({
          transactionId,
          status: 'printed',
          phase: 'printed',
          spoolerCorrelationKey: correlationKey,
          spoolerJobId: job.id,
          reason: job.status,
        });
        return {
          detected: true,
          jobStatus: job.status,
          pagesPrinted: job.pagesPrinted,
          failed: false,
        };
      }

      if (matchesStatusSet(job.status, TERMINAL_FAILURE_TOKENS)) {
        console.error(
          `[SPOOLER-MONITOR] ✗ Job #${job.id} FAILED — status="${job.status}"`,
        );

        setPrinterFaultLock({
          source: 'print_spooler_failure',
          reason: `Print spooler reported failure: ${job.status}`,
          status: job.status,
          context: {
            spoolerJobId: job.id,
            pagesPrinted: job.pagesPrinted,
            totalPages: job.totalPages,
            chargedAmount,
            printerName: normalizedPrinterName,
          },
        });

        const reason = `Print spooler reported failure: ${job.status}`;
        const autoRefund = job.pagesPrinted === 0;
        let refundOutcome: Awaited<
          ReturnType<typeof upsertSpoolerFailureRefund>
        >;
        try {
          refundOutcome = await upsertSpoolerFailureRefund({
            chargedAmount,
            reason,
            autoRefund,
            jobContext: {
              ...jobContext,
              spoolerJobId: job.id,
              spoolerStatus: job.status,
              pagesPrinted: job.pagesPrinted,
              totalPages: job.totalPages,
              jobDispatchedAt,
              printerName: normalizedPrinterName,
              spoolerCorrelationKey: correlationKey,
            },
          });
        } catch (error) {
          if (
            error instanceof PendingRefundServiceError &&
            error.code === 'TRUSTED_TIME_UNAVAILABLE'
          ) {
            const trustedDetail =
              typeof error.context?.trustedTime === 'object' &&
              error.context.trustedTime !== null
                ? error.context.trustedTime
                : null;
            try {
              await adminService.appendAdminLog(
                'trusted_time_unsynced',
                'Spooler refund creation blocked because trusted time is unavailable.',
                {
                  chargedAmount,
                  spoolerJobId: job.id,
                  spoolerStatus: job.status,
                  transactionId,
                  spoolerCorrelationKey: correlationKey,
                  trustedTime:
                    trustedDetail != null
                      ? JSON.stringify(trustedDetail)
                      : null,
                },
              );
            } catch (logError) {
              console.error(
                '[SPOOLER-MONITOR] Failed to append trusted-time unsynced log',
                logError,
              );
            }
            await persistAndEmitPrintLifecycleState(
              io,
              {
                mode: 'print',
                state: 'failed',
                printerName: normalizedPrinterName,
                transactionId,
                spoolerCorrelationKey: correlationKey,
                spoolerJobId: job.id,
                jobStatus: job.status,
                pagesPrinted: job.pagesPrinted,
                totalPages: job.totalPages,
                reason,
                refundDisposition: 'refund_blocked_trusted_time',
              },
              {
                requiredAmount: chargedAmount,
                sessionId,
                documentId,
                meta: buildLifecycleMeta({
                  marker: 'failed_trusted_time',
                }),
              },
            );
            io.emit('printerSpoolerFailure', {
              jobStatus: job.status,
              chargedAmount,
              refundId: null,
              pagesPrinted: job.pagesPrinted,
              totalPages: job.totalPages,
              printerName: normalizedPrinterName,
              spoolerJobId: job.id,
              reason,
              refundDisposition: 'refund_blocked_trusted_time',
              restoredBalanceAmount: 0,
              transactionId,
              spoolerCorrelationKey: correlationKey,
              jobDispatchedAt,
              monitorStartedAt: startedAtIso,
              monitorElapsedMs: Date.now() - startedAtMs,
              handoffLatencyMs,
              pollCount,
              queryFailureCount,
            });
            if (transactionId) {
              try {
                await checkpointRecoverySession({
                  transactionId,
                  mode: 'print',
                  phase: 'spooler_failed',
                  requiredAmount: chargedAmount,
                  chargedAmount,
                  sessionId,
                  documentId,
                  spoolerCorrelationKey: correlationKey,
                  spoolerJobId: job.id,
                  jobDispatchedAt,
                  settledAt: null,
                  spoolerTerminalAt: new Date().toISOString(),
                  context: {
                    spoolerOutcome: 'failed',
                    jobStatus: job.status,
                    pagesPrinted: job.pagesPrinted,
                    totalPages: job.totalPages,
                    refundDisposition: 'refund_blocked_trusted_time',
                    monitorElapsedMs: Date.now() - startedAtMs,
                    handoffLatencyMs,
                    pollCount,
                    queryFailureCount,
                  },
                  lastError:
                    'Refund blocked because trusted time is unavailable.',
                });
              } catch (checkpointError) {
                console.error(
                  '[SPOOLER-MONITOR] Failed to checkpoint recovery session (trusted time blocked)',
                  checkpointError,
                );
              }
            }
            await safeUpdateReceiptTerminalStatus({
              transactionId,
              status: 'failed',
              phase: 'failed_trusted_time',
              spoolerCorrelationKey: correlationKey,
              spoolerJobId: job.id,
              reason,
            });
            return {
              detected: true,
              jobStatus: job.status,
              pagesPrinted: job.pagesPrinted,
              failed: true,
            };
          }
          throw error;
        }

        // upsertSpoolerFailureRefund() returns a non-null result or throws;
        // TRUSTED_TIME_UNAVAILABLE is handled in the catch branch above.

        const shouldEmitBalance =
          refundOutcome.autoRefunded && refundOutcome.restoredBalanceAmount > 0;

        if (shouldEmitBalance) {
          io.emit('balance', db.data!.balance);
        }

        const refundDisposition = refundOutcome.autoRefunded
          ? 'auto_refunded'
          : 'pending_admin_review';
        const logType = refundOutcome.autoRefunded
          ? 'print_spooler_auto_refund'
          : 'print_spooler_job_failed';
        const logMessage = refundOutcome.autoRefunded
          ? `Print spooler failure detected: ${job.status}. Auto-refunded ₱${chargedAmount}.`
          : `Print spooler failure detected: ${job.status}. Pending refund ₱${chargedAmount} created.`;

        try {
          await adminService.appendAdminLog(logType, logMessage, {
            spoolerJobId: job.id,
            spoolerStatus: job.status,
            chargedAmount,
            refundId: refundOutcome.entry.id,
            refundDisposition,
            refundCreated: refundOutcome.created,
            restoredBalanceAmount: refundOutcome.restoredBalanceAmount,
            pagesPrinted: job.pagesPrinted,
            printerName: normalizedPrinterName,
            transactionId,
            spoolerCorrelationKey: correlationKey,
            monitorElapsedMs: Date.now() - startedAtMs,
            handoffLatencyMs,
            pollCount,
            queryFailureCount,
          });
        } catch (error) {
          console.error('[SPOOLER-MONITOR] Failed to append admin log', error);
        }

        await persistAndEmitPrintLifecycleState(
          io,
          {
            mode: 'print',
            state: 'failed',
            printerName: normalizedPrinterName,
            transactionId,
            spoolerCorrelationKey: correlationKey,
            spoolerJobId: job.id,
            jobStatus: job.status,
            pagesPrinted: job.pagesPrinted,
            totalPages: job.totalPages,
            reason,
            refundDisposition,
          },
          {
            requiredAmount: chargedAmount,
            sessionId,
            documentId,
            meta: buildLifecycleMeta({
              marker: 'failed',
            }),
          },
        );
        io.emit('printerSpoolerFailure', {
          jobStatus: job.status,
          chargedAmount,
          refundId: refundOutcome.entry.id,
          pagesPrinted: job.pagesPrinted,
          totalPages: job.totalPages,
          printerName: normalizedPrinterName,
          spoolerJobId: job.id,
          reason,
          refundDisposition,
          restoredBalanceAmount: refundOutcome.restoredBalanceAmount,
          transactionId,
          spoolerCorrelationKey: correlationKey,
          jobDispatchedAt,
          monitorStartedAt: startedAtIso,
          monitorElapsedMs: Date.now() - startedAtMs,
          handoffLatencyMs,
          pollCount,
          queryFailureCount,
        });

        await anomalyService.report({
          type: 'print_spooler_failure',
          source: 'print-spooler',
          category: 'spooler',
          severity: 'critical',
          message: `Print spooler reported failure: ${job.status}`,
          fingerprint: buildAnomalyFingerprint([
            'spooler',
            normalizedPrinterName,
            job.status,
          ]),
          context: {
            spoolerJobId: job.id,
            spoolerStatus: job.status,
            pagesPrinted: job.pagesPrinted,
            totalPages: job.totalPages,
            chargedAmount,
            refundDisposition,
            transactionId,
            spoolerCorrelationKey: correlationKey,
            monitorElapsedMs: Date.now() - startedAtMs,
            handoffLatencyMs,
            pollCount,
            queryFailureCount,
          },
        });

        if (transactionId) {
          try {
            await checkpointRecoverySession({
              transactionId,
              mode: 'print',
              phase: 'reconciled',
              requiredAmount: chargedAmount,
              chargedAmount,
              sessionId,
              documentId,
              spoolerCorrelationKey: correlationKey,
              spoolerJobId: job.id,
              jobDispatchedAt,
              settledAt: null,
              spoolerTerminalAt: new Date().toISOString(),
              reconciledAt: new Date().toISOString(),
              startupReconciled: false,
              reconciliationAction:
                refundDisposition === 'auto_refunded'
                  ? 'auto_refund'
                  : 'pending_admin_review',
              reconciliationReason:
                refundDisposition === 'auto_refunded'
                  ? 'Spooler failure auto-refunded.'
                  : 'Spooler failure queued for admin refund review.',
              context: {
                spoolerOutcome: 'failed',
                jobStatus: job.status,
                pagesPrinted: job.pagesPrinted,
                totalPages: job.totalPages,
                refundDisposition,
                refundId: refundOutcome.entry.id,
                monitorElapsedMs: Date.now() - startedAtMs,
                handoffLatencyMs,
                pollCount,
                queryFailureCount,
              },
            });
          } catch (checkpointError) {
            console.error(
              '[SPOOLER-MONITOR] Failed to checkpoint recovery session (refunded)',
              checkpointError,
            );
          }
        }
        await safeUpdateReceiptTerminalStatus({
          transactionId,
          status: receiptStatusFromRefundDisposition(refundDisposition),
          phase: 'failed_refund_disposition',
          spoolerCorrelationKey: correlationKey,
          spoolerJobId: job.id,
          reason,
        });

        return {
          detected: true,
          jobStatus: job.status,
          pagesPrinted: job.pagesPrinted,
          failed: true,
          refundId: refundOutcome.entry.id,
        };
      }

      // Job is still in a transient state — sleep then re-query
      await new Promise<void>((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS),
      );
      queryResult = await queryRecentPrintJobs(normalizedPrinterName, ps);
      pollCount += 1;
      lastQueryElapsedMs = queryResult.elapsedMs;
    }

    return settleMonitorAmbiguity(
      'Spooler monitoring timed out before terminal status.',
      'monitor_window_expired',
    );
  } finally {
    // Always clean up the PS process — whether we returned early, timed out,
    // or an unexpected error was thrown. Without this the process leaks.
    ps.dispose();
  }
}
