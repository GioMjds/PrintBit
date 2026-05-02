import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import type { Request } from 'express';
import { PrintDispatchError } from '@/services/print-dispatcher';
import { jobStore } from '@/services/job-store';
import { printFile, type PrintJobOptions } from '@/services/printer';
import {
  db,
  type ReceiptRecordStatus,
  acquireIdempotencyKey,
  storeIdempotencyKey,
  releaseIdempotencyKey,
} from '@/services/db';
import { adminService } from '@/services/admin';
import {
  evaluateInkPreflight,
  persistAndEmitPrintLifecycleState,
  refreshPrinterTelemetry,
  settlementService,
  watchJobForMalfunction,
} from '@/services';
import { BLOCKED_STATUSES } from '@/utils';
import { financialLedgerService } from '@/services/financial-ledger';
import {
  assertTrustedTimeForFinancialOperation,
  getTrustedTimestamp,
  isTrustedTimeError,
} from '@/services/time-source';
import { deleteTransientScanFile } from '@/services/transient-scan-file';
import {
  normalizeRotationDeg,
  parseRotationDeg,
  type RotationDeg,
} from '@/services/document-rotation';
import { consumablesStore } from '@/core/database/sqlite-storage';
import { evaluateConsumablesForecastAlerts } from '@/modules/admin/consumables.service';
import { ReceiptService } from '@/modules/receipt/receipt.service';
import { estimateInkUsageByJob } from '@/services/consumable-estimator';
import { analyzeDocument } from '@/services/document-analysis';
import { buildEnhancedPrintQuote } from '@/services/print-quote';

const VALID_COLOR_MODES = new Set(['colored', 'grayscale']);
const VALID_ORIENTATIONS = new Set(['portrait', 'landscape']);
const IDEMPOTENCY_SCOPE = 'POST:/api/copy/jobs';

export interface CreateCopyJobInput {
  copies?: number;
  colorMode?: string;
  orientation?: string;
  rotationDeg?: number;
  paperSize?: string;
  amount?: number;
  previewPath?: string;
}

export interface GetCopyQuoteInput {
  copyPreviewPath?: string;
  copies?: number;
  colorMode?: 'colored' | 'grayscale';
  paperSize?: 'A4' | 'Legal';
  pageRange?: {
    type: string;
    start?: number;
    end?: number;
  };
  duplex?: boolean;
}

export interface IdempotencyKeyHitResult {
  kind: 'hit';
  statusCode: number;
  body: unknown;
}

export interface IdempotencyKeyInflightResult {
  kind: 'inflight';
  promise: Promise<{ statusCode: number; response: unknown } | null>;
}

export interface IdempotencyKeyClaimedResult {
  kind: 'claimed';
}

export type ClaimIdempotencyResult =
  | IdempotencyKeyHitResult
  | IdempotencyKeyInflightResult
  | IdempotencyKeyClaimedResult;

export interface ServiceResponse {
  statusCode: number;
  body: unknown;
}

interface CreateCopyJobResult extends ServiceResponse {
  cacheIdempotencyResponse: boolean;
}

interface NormalizedCopyJobInput {
  copies: number;
  colorMode: 'colored' | 'grayscale';
  orientation: 'portrait' | 'landscape';
  rotationDeg: RotationDeg;
  paperSize: 'A4' | 'Legal';
  amount?: number;
  previewPath: string;
}

export interface CopyServiceDeps {
  io: Server;
  resolvePublicBaseUrl: (req: Request) => URL;
}

export class CopyService {
  private readonly receiptService = new ReceiptService();

  constructor(private readonly deps: CopyServiceDeps) {}

  claimIdempotencyKey(idempotencyKey: string): ClaimIdempotencyResult {
    if (!idempotencyKey) return { kind: 'claimed' };
    const slot = acquireIdempotencyKey(idempotencyKey, IDEMPOTENCY_SCOPE);
    if (slot.type === 'hit') {
      return {
        kind: 'hit',
        statusCode: slot.entry.statusCode,
        body: slot.entry.response,
      };
    }
    if (slot.type === 'inflight') {
      return {
        kind: 'inflight',
        promise: slot.promise,
      };
    }
    return { kind: 'claimed' };
  }

  storeIdempotencyResponse(
    idempotencyKey: string,
    statusCode: number,
    body: unknown,
  ): void {
    if (!idempotencyKey) return;
    storeIdempotencyKey(idempotencyKey, IDEMPOTENCY_SCOPE, statusCode, body);
  }

  releaseIdempotencyKey(idempotencyKey: string): void {
    if (!idempotencyKey) return;
    releaseIdempotencyKey(idempotencyKey, IDEMPOTENCY_SCOPE);
  }

  async createCopyJob(
    input: CreateCopyJobInput,
    idempotencyKeyClaimed: boolean,
    idempotencyKey: string,
    req: Request,
  ): Promise<CreateCopyJobResult> {
    if (
      typeof input.rotationDeg !== 'undefined' &&
      parseRotationDeg(input.rotationDeg) === null
    ) {
      return {
        statusCode: 400,
        body: {
          error: 'Invalid rotation. Accepted values: 0, 90, 180, 270.',
        },
        cacheIdempotencyResponse: idempotencyKeyClaimed,
      };
    }

    const normalized = this.normalizeInput(input);

    if (!normalized.previewPath) {
      return {
        statusCode: 400,
        body: {
          error:
            'Missing checked document. Please go back to /copy and tap Check for Document again.',
        },
        cacheIdempotencyResponse: idempotencyKeyClaimed,
      };
    }

    const previewFilename = path.basename(normalized.previewPath);
    if (previewFilename !== normalized.previewPath) {
      return {
        statusCode: 400,
        body: {
          error: 'Invalid preview path. Please check your document again.',
        },
        cacheIdempotencyResponse: idempotencyKeyClaimed,
      };
    }

    const previewAbsPath = path.resolve('uploads', 'scans', previewFilename);
    if (!fs.existsSync(previewAbsPath)) {
      return {
        statusCode: 409,
        body: {
          error:
            'Checked document not found. Please go back to /copy and scan again.',
        },
        cacheIdempotencyResponse: idempotencyKeyClaimed,
      };
    }

    const requiredAmount = adminService.calculateJobAmount(
      'copy',
      normalized.colorMode,
      normalized.copies,
    );

    if ((db.data?.balance ?? 0) < requiredAmount) {
      const errorBody = {
        error: 'Insufficient balance',
        balance: db.data?.balance ?? 0,
        requiredAmount,
      };
      void adminService.appendAdminLog(
        'payment_failed',
        'Copy job failed: insufficient balance.',
        {
          balance: db.data?.balance ?? 0,
          requiredAmount,
        },
      );
      if (idempotencyKeyClaimed) {
        this.releaseIdempotencyKey(idempotencyKey);
      }
      return {
        statusCode: 400,
        body: errorBody,
        cacheIdempotencyResponse: false,
      };
    }

    if (
      typeof normalized.amount === 'number' &&
      Number.isFinite(normalized.amount) &&
      normalized.amount !== requiredAmount
    ) {
      void adminService.appendAdminLog(
        'payment_amount_mismatch',
        'Client amount differed from server pricing.',
        {
          amount: normalized.amount,
          requiredAmount,
        },
      );
    }

    try {
      assertTrustedTimeForFinancialOperation('copy_job');
    } catch (error) {
      const trustedPayload = isTrustedTimeError(error)
        ? {
            code: error.code,
            error: `Copy is temporarily unavailable: ${error.trustedTime.detail}`,
            trustedTime: {
              operation: error.operation,
              source: error.trustedTime.source,
              synced: error.trustedTime.synced,
              offsetMs: error.trustedTime.offsetMs,
              driftExceeded: error.trustedTime.driftExceeded,
              maxDriftMs: error.trustedTime.maxDriftMs,
              detail: error.trustedTime.detail,
              checkedAt: error.trustedTime.checkedAt,
              ntpSource: error.trustedTime.ntpSource,
            },
          }
        : {
            code: 'TRUSTED_TIME_UNAVAILABLE',
            error:
              'Copy is temporarily unavailable because trusted time is not synchronized.',
          };
      void adminService.appendAdminLog(
        'trusted_time_unsynced',
        'Copy job blocked because trusted time is unavailable.',
        {
          detail: trustedPayload.error,
          mode: 'copy',
        },
      );
      if (idempotencyKeyClaimed) {
        this.releaseIdempotencyKey(idempotencyKey);
      }
      return {
        statusCode: 503,
        body: trustedPayload,
        cacheIdempotencyResponse: false,
      };
    }

    const settings = {
      copies: normalized.copies,
      colorMode: normalized.colorMode,
      orientation: normalized.orientation,
      rotationDeg: normalized.rotationDeg,
      paperSize: normalized.paperSize,
    };

    const job = jobStore.createCopyJob(settings, null);
    void adminService.appendAdminLog('copy_job_created', 'Copy job created.', {
      jobId: job.id,
      copies: normalized.copies,
      colorMode: normalized.colorMode,
      orientation: normalized.orientation,
      rotationDeg: normalized.rotationDeg,
      paperSize: normalized.paperSize,
    });
    await persistAndEmitPrintLifecycleState(
      this.deps.io,
      {
        mode: 'copy',
        state: 'queued',
        transactionId: job.id,
        spoolerCorrelationKey: null,
        printerName: null,
      },
      {
        requiredAmount,
      },
    );
    this.runCopyJob(
      job.id,
      normalized,
      previewFilename,
      requiredAmount,
      this.deps.resolvePublicBaseUrl(req).toString(),
    );

    const responseBody = JSON.parse(JSON.stringify(job)) as typeof job;
    return {
      statusCode: 201,
      body: responseBody,
      cacheIdempotencyResponse: idempotencyKeyClaimed,
    };
  }

  getCopyJob(jobId: string): ServiceResponse {
    const job = jobStore.getJob(jobId);
    if (!job) {
      return {
        statusCode: 404,
        body: { error: 'Job not found' },
      };
    }
    return {
      statusCode: 200,
      body: job,
    };
  }

  cancelCopyJob(jobId: string): ServiceResponse {
    const job = jobStore.getJob(jobId);
    if (!job) {
      return {
        statusCode: 404,
        body: { error: 'Job not found' },
      };
    }

    const cancelled = jobStore.requestCancel(job.id);
    if (!cancelled) {
      return {
        statusCode: 409,
        body: { error: 'Job is already in a terminal state' },
      };
    }

    return {
      statusCode: 202,
      body: { ok: true, state: 'cancel_requested' },
    };
  }

  async getCopyQuote(input: GetCopyQuoteInput): Promise<ServiceResponse> {
    const previewPath = input.copyPreviewPath;
    if (!previewPath) {
      return {
        statusCode: 400,
        body: { error: 'No document to analyze.' },
      };
    }

    const previewFilename = path.basename(previewPath);
    const previewAbsPath = path.resolve('uploads', 'scans', previewFilename);
    if (!fs.existsSync(previewAbsPath)) {
      return {
        statusCode: 404,
        body: { error: 'Document not found.' },
      };
    }

    try {
      const analysis = await analyzeDocument({
        filePath: previewAbsPath,
        filename: previewFilename,
        contentType: 'application/pdf', // Scans are usually PDFs
      });

      const quote = buildEnhancedPrintQuote({
        analysis: {
          ...analysis,
          analyzedAt: new Date(),
          confidence: 'high',
        },
        copies: input.copies || 1,
        colorMode: input.colorMode || 'grayscale',
        paperSize: input.paperSize || 'A4',
        pageRange: input.pageRange || { type: 'all' },
        duplex: input.duplex || false,
        includePricingEngineBreakdown: true,
      });

      return {
        statusCode: 200,
        body: quote,
      };
    } catch (error) {
      console.error('[COPY] Quote calculation failed:', error);
      return {
        statusCode: 500,
        body: { error: 'Failed to calculate price.' },
      };
    }
  }

  private normalizeInput(input: CreateCopyJobInput): NormalizedCopyJobInput {
    const safeCopies =
      typeof input.copies === 'number' && Number.isFinite(input.copies)
        ? Math.max(1, Math.floor(input.copies))
        : 1;
    const safeColorMode =
      input.colorMode && VALID_COLOR_MODES.has(input.colorMode)
        ? (input.colorMode as 'colored' | 'grayscale')
        : 'grayscale';
    const safeOrientation =
      input.orientation && VALID_ORIENTATIONS.has(input.orientation)
        ? (input.orientation as 'portrait' | 'landscape')
        : 'portrait';
    const safePaperSize: 'A4' | 'Legal' =
      input.paperSize === 'Legal' ? 'Legal' : 'A4';
    const safeRotationDeg = normalizeRotationDeg(input.rotationDeg, 0);
    const safePreviewPath =
      typeof input.previewPath === 'string' ? input.previewPath.trim() : '';

    return {
      copies: safeCopies,
      colorMode: safeColorMode,
      orientation: safeOrientation,
      rotationDeg: safeRotationDeg,
      paperSize: safePaperSize,
      amount: input.amount,
      previewPath: safePreviewPath,
    };
  }

  private runCopyJob(
    jobId: string,
    normalized: NormalizedCopyJobInput,
    previewFilename: string,
    requiredAmount: number,
    publicBaseUrl: string,
  ): void {
    void (async () => {
      jobStore.updateJobState(jobId, 'processing');
      await persistAndEmitPrintLifecycleState(
        this.deps.io,
        {
          mode: 'copy',
          state: 'processing',
          transactionId: jobId,
          spoolerCorrelationKey: null,
          printerName: null,
        },
        {
          requiredAmount,
        },
      );
      try {
        const telemetry = await refreshPrinterTelemetry();
        if (!telemetry.connected || BLOCKED_STATUSES.has(telemetry.status)) {
          void adminService.appendAdminLog(
            'copy_preflight_failed',
            'Copy job rejected: printer not ready.',
            {
              jobId,
              printerStatus: telemetry.status,
              printerConnected: telemetry.connected,
            },
          );
          jobStore.updateJobState(jobId, 'failed', {
            failure: {
              code: 'PRINTER_NOT_READY',
              message: `Printer is not ready: ${telemetry.status}. Please notify the operator.`,
              retryable: true,
              stage: 'precheck',
            },
          });
          await persistAndEmitPrintLifecycleState(
            this.deps.io,
            {
              mode: 'copy',
              state: 'failed',
              transactionId: jobId,
              spoolerCorrelationKey: null,
              printerName: telemetry.name ?? null,
              reason: `Printer is not ready: ${telemetry.status}`,
            },
            {
              requiredAmount,
              meta: { stage: 'precheck' },
            },
          );
          this.safeUpdateReceiptTerminalStatus({
            transactionId: jobId,
            status: 'failed',
            phase: 'copy_preflight_failed',
            reason: `Printer is not ready: ${telemetry.status}`,
          });
          return;
        }
        const inkPreflight = evaluateInkPreflight(telemetry);
        if (inkPreflight.blocked) {
          void adminService.appendAdminLog(
            'copy_preflight_failed_ink',
            'Copy job rejected: ink preflight policy blocked the job.',
            {
              jobId,
              printerStatus: telemetry.status,
              inkCode: inkPreflight.code,
              inkReason: inkPreflight.reason ?? 'Unknown ink policy reason',
              telemetryAvailable: inkPreflight.telemetryAvailable,
              inkDetectionMethod: telemetry.inkDetectionMethod,
            },
          );
          jobStore.updateJobState(jobId, 'failed', {
            failure: {
              code: 'INK_NOT_READY',
              message:
                inkPreflight.reason ??
                'Ink telemetry indicates printing should be blocked.',
              retryable: true,
              stage: 'precheck',
            },
          });
          await persistAndEmitPrintLifecycleState(
            this.deps.io,
            {
              mode: 'copy',
              state: 'failed',
              transactionId: jobId,
              spoolerCorrelationKey: null,
              printerName: telemetry.name ?? null,
              reason:
                inkPreflight.reason ??
                'Ink telemetry indicates printing should be blocked.',
            },
            {
              requiredAmount,
              meta: { stage: 'precheck' },
            },
          );
          this.safeUpdateReceiptTerminalStatus({
            transactionId: jobId,
            status: 'failed',
            phase: 'copy_preflight_failed_ink',
            reason:
              inkPreflight.reason ??
              'Ink telemetry indicates printing should be blocked.',
          });
          return;
        }

        const printOptions: PrintJobOptions = {
          copies: normalized.copies,
          colorMode: normalized.colorMode,
          orientation: normalized.orientation,
          rotationDeg: normalized.rotationDeg,
          paperSize: normalized.paperSize,
          printerName: telemetry.name ?? undefined,
        };
        const relPath = path.join('scans', previewFilename);
        await financialLedgerService.append({
          eventType: 'job_started',
          amount: requiredAmount,
          referenceId: jobId,
          meta: {
            mode: 'copy',
            copies: normalized.copies,
            colorMode: normalized.colorMode,
            rotationDeg: normalized.rotationDeg,
            previewFilename,
          },
        });
        await printFile(relPath, printOptions, {
          transactionId: jobId,
          mode: 'copy',
          source: 'copy-service',
        });

        void watchJobForMalfunction(this.deps.io, {
          jobId,
          onFailure: (failedJobId, fault) => {
            const activeJob = jobStore.getJob(failedJobId);
            if (!activeJob || activeJob.state !== 'processing') {
              return;
            }

            jobStore.updateJobState(failedJobId, 'failed', {
              failure: {
                code: 'PRINTER_MALFUNCTION',
                message: `Printer fault detected during copy job: ${fault.reason}`,
                retryable: true,
                stage: 'running',
              },
            });
            void persistAndEmitPrintLifecycleState(
              this.deps.io,
              {
                mode: 'copy',
                state: 'failed',
                transactionId: failedJobId,
                spoolerCorrelationKey: null,
                printerName: null,
                reason: `Printer fault detected during copy job: ${fault.reason}`,
              },
              {
                requiredAmount,
                meta: { stage: 'running' },
              },
            );
            this.safeUpdateReceiptTerminalStatus({
              transactionId: failedJobId,
              status: 'failed',
              phase: 'copy_printer_malfunction',
              reason: `Printer fault detected during copy job: ${fault.reason}`,
            });

            void adminService.appendAdminLog(
              'copy_job_failed_printer_malfunction',
              'Copy job marked failed due to mid-job printer malfunction.',
              {
                jobId: failedJobId,
                reason: fault.reason,
                severity: fault.severity,
                timestamp: fault.timestamp,
              },
            );
          },
        });

        const settlement = await settlementService.settle({
          requiredAmount,
          io: this.deps.io,
          jobContext: {
            mode: 'copy',
            jobId,
            copies: normalized.copies,
            colorMode: normalized.colorMode,
            rotationDeg: normalized.rotationDeg,
          },
        });

        if (settlement.ok) {
          const settledAt = getTrustedTimestamp().timestamp;
          this.safeUpsertSettledReceiptSnapshot({
            transactionId: jobId,
            chargedAmount: settlement.chargedAmount,
            colorPages:
              normalized.colorMode === 'colored' ? normalized.copies : 0,
            bwPages: normalized.colorMode === 'colored' ? 0 : normalized.copies,
            change: {
              requested: settlement.change.requested,
              dispensed: settlement.change.dispensed,
              state:
                settlement.change.state === 'dispensed' ||
                settlement.change.state === 'failed'
                  ? settlement.change.state
                  : 'none',
              attempts: settlement.change.attempts ?? 0,
              owedChangeId: settlement.change.owedChangeId ?? null,
              message: settlement.change.message ?? null,
            },
            settledAt,
          });
          const completedJob = jobStore.getJob(jobId);
          if (completedJob && completedJob.type === 'copy') {
            completedJob.payment = {
              chargedAmount: settlement.chargedAmount,
              remainingBalance: settlement.remainingBalance,
            };
          }
          jobStore.updateJobState(jobId, 'printed');
          try {
            const tokenData = this.receiptService.mintToken(jobId, {
              revokeExisting: true,
            });
            if (tokenData) {
              const viewUrl = new URL(
                `/receipt/t/${encodeURIComponent(tokenData.token)}`,
                publicBaseUrl,
              ).toString();
              jobStore.updateJobState(jobId, 'printed', {
                receipt: {
                  token: tokenData.token,
                  viewUrl: viewUrl,
                  expiresAt: tokenData.expiresAt,
                },
              });
            }
          } catch (receiptError) {
            console.error('[COPY] Failed to mint receipt token.', {
              error:
                receiptError instanceof Error
                  ? receiptError.message
                  : String(receiptError),
              jobId,
            });
          }

          await persistAndEmitPrintLifecycleState(
            this.deps.io,
            {
              mode: 'copy',
              state: 'printed',
              transactionId: jobId,
              spoolerCorrelationKey: null,
              printerName: telemetry.name ?? null,
            },
            {
              requiredAmount,
            },
          );
          this.safeUpdateReceiptTerminalStatus({
            transactionId: jobId,
            status: 'printed',
            phase: 'copy_printed',
          });
          await financialLedgerService.append({
            eventType: 'job_completed',
            amount: settlement.chargedAmount,
            referenceId: jobId,
            meta: {
              mode: 'copy',
              changeState: settlement.change.state,
              changeRequested: settlement.change.requested,
              changeDispensed: settlement.change.dispensed,
            },
          });
          try {
            consumablesStore.appendUsageEvent({
              id: randomUUID(),
              timestamp: getTrustedTimestamp().timestamp,
              transactionId: jobId,
              mode: 'copy',
              copies: normalized.copies,
              duplex: false,
              selectedPages: 1,
              billableColorPages: normalized.colorMode === 'colored' ? 1 : 0,
              billableBwPages: normalized.colorMode === 'colored' ? 0 : 1,
              estimatedSheetsUsed: Math.max(1, normalized.copies),
              estimatedInkUnits: estimateInkUsageByJob({
                selectedColorPages: normalized.colorMode === 'colored' ? 1 : 0,
                selectedBwPages: normalized.colorMode === 'colored' ? 0 : 1,
                copies: normalized.copies,
                printerName: telemetry.name ?? null,
              }),
              source: 'copy-service',
              billingPageDetection: 'fallback-assumptions',
              analysisConfidence: 'unknown',
            });
            await evaluateConsumablesForecastAlerts();
          } catch (error) {
            console.error('[COPY] Failed to persist consumable usage event.', {
              error: error instanceof Error ? error.message : String(error),
              jobId,
            });
          }
          await adminService.incrementJobStats('copy');
          await this.cleanupPreviewFile(previewFilename, {
            jobId,
            trigger: 'copy_job_succeeded',
          });
          void adminService.appendAdminLog(
            'copy_job_completed',
            'Copy job completed and charged.',
            {
              jobId,
              chargedAmount: settlement.chargedAmount,
              remainingBalance: settlement.remainingBalance,
              changeState: settlement.change.state,
              changeRequested: settlement.change.requested,
              changeDispensed: settlement.change.dispensed,
            },
          );
        } else {
          jobStore.updateJobState(jobId, 'failed', {
            failure: {
              code: 'COPY_ERROR',
              message:
                settlement.error ??
                'Balance drained before charge could complete.',
              retryable: false,
              stage: 'running',
            },
          });
          await persistAndEmitPrintLifecycleState(
            this.deps.io,
            {
              mode: 'copy',
              state: 'failed',
              transactionId: jobId,
              spoolerCorrelationKey: null,
              printerName: telemetry.name ?? null,
              reason:
                settlement.error ??
                'Balance drained before charge could complete.',
            },
            {
              requiredAmount,
              meta: { stage: 'running' },
            },
          );
          this.safeUpdateReceiptTerminalStatus({
            transactionId: jobId,
            status: 'failed',
            phase: 'copy_settlement_failed',
            reason:
              settlement.error ??
              'Balance drained before charge could complete.',
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        const unsupportedRequestedOptions =
          err instanceof PrintDispatchError &&
          err.result.failureCode === 'no_capable_engine';
        jobStore.updateJobState(jobId, 'failed', {
          failure: {
            code: 'COPY_ERROR',
            message,
            retryable: !unsupportedRequestedOptions,
            stage: 'running',
          },
        });
        await persistAndEmitPrintLifecycleState(
          this.deps.io,
          {
            mode: 'copy',
            state: 'failed',
            transactionId: jobId,
            spoolerCorrelationKey: null,
            printerName: null,
            reason: message,
          },
          {
            requiredAmount,
            meta: { stage: 'running' },
          },
        );
        this.safeUpdateReceiptTerminalStatus({
          transactionId: jobId,
          status: 'failed',
          phase: 'copy_dispatch_failed',
          reason: message,
        });
        void adminService.appendAdminLog(
          'copy_job_failed',
          'Copy job failed — balance NOT charged.',
          {
            jobId,
            error: message,
            failureCode:
              err instanceof PrintDispatchError ? err.result.failureCode : null,
            requiredCapabilities:
              err instanceof PrintDispatchError
                ? err.result.requiredCapabilities.length > 0
                  ? err.result.requiredCapabilities.join(',')
                  : null
                : null,
            requestedOptions:
              err instanceof PrintDispatchError
                ? JSON.stringify(err.result.requestedOptions)
                : null,
          },
        );
      }
    })();
  }

  private safeUpsertSettledReceiptSnapshot(input: {
    transactionId: string;
    chargedAmount: number;
    colorPages?: number | null;
    bwPages?: number | null;
    change: {
      requested: number;
      dispensed: number;
      state: 'none' | 'dispensed' | 'failed';
      attempts: number;
      owedChangeId: string | null;
      message: string | null;
    };
    settledAt: string;
  }): void {
    try {
      this.receiptService.upsertReceiptSnapshot({
        transactionId: input.transactionId,
        mode: 'copy',
        chargedAmount: input.chargedAmount,
        // Persist reported color/BW page counts when available
        colorPages:
          typeof input.colorPages === 'number'
            ? Math.max(0, Math.floor(input.colorPages))
            : null,
        bwPages:
          typeof input.bwPages === 'number'
            ? Math.max(0, Math.floor(input.bwPages))
            : null,
        status: 'settled_pending_terminal',
        change: input.change,
        settledAt: input.settledAt,
      });
    } catch (error) {
      void adminService.appendAdminLog(
        'receipt_generation_failed',
        'Failed to create copy receipt snapshot after settlement.',
        {
          transactionId: input.transactionId,
          mode: 'copy',
          chargedAmount: input.chargedAmount,
          error: error instanceof Error ? error.message : String(error),
          phase: 'copy_settled',
        },
      );
    }
  }

  private safeUpdateReceiptTerminalStatus(input: {
    transactionId: string;
    status: ReceiptRecordStatus;
    phase: string;
    reason?: string;
    terminalAt?: string;
  }): void {
    try {
      this.receiptService.updateTerminalStatus({
        transactionId: input.transactionId,
        status: input.status,
        terminalAt: input.terminalAt ?? new Date().toISOString(),
      });
    } catch (error) {
      void adminService.appendAdminLog(
        'receipt_status_update_failed',
        'Failed to update copy receipt terminal status.',
        {
          transactionId: input.transactionId,
          status: input.status,
          phase: input.phase,
          reason: input.reason ?? null,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  private async cleanupPreviewFile(
    previewFilename: string,
    context: { jobId: string; trigger: string },
  ): Promise<void> {
    try {
      const releaseResult = await deleteTransientScanFile(previewFilename);
      try {
        await adminService.appendAdminLog(
          'copy_preview_released',
          'Transient copy preview file released.',
          {
            jobId: context.jobId,
            trigger: context.trigger,
            filename: releaseResult.fileName,
            alreadyMissing: releaseResult.alreadyMissing,
          },
        );
      } catch (logError) {
        console.error('[COPY] Failed to append cleanup success admin log.', {
          error:
            logError instanceof Error ? logError.message : String(logError),
          jobId: context.jobId,
          previewFilename,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      try {
        await adminService.appendAdminLog(
          'copy_preview_release_failed',
          'Failed to release transient copy preview file.',
          {
            jobId: context.jobId,
            trigger: context.trigger,
            filename: previewFilename,
            error: message,
          },
        );
      } catch (logError) {
        console.error('[COPY] Failed to append cleanup failure admin log.', {
          error:
            logError instanceof Error ? logError.message : String(logError),
          jobId: context.jobId,
          previewFilename,
        });
      }
    }
  }
}
