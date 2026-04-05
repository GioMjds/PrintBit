import type { Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import {
  db,
  acquireIdempotencyKey,
  storeIdempotencyKey,
  releaseIdempotencyKey,
} from '@/services/db';
import {
  evaluateInkPreflight,
  getPrinterTelemetry,
  refreshPrinterTelemetry,
} from '@/services';
import { adminService } from '@/services/admin';
import { settlementService } from '@/services/settlement';
import { printFile, type PrintJobOptions } from '@/services/printer';
import { monitorSpoolerJob } from '@/services/print-spooler';
import type { SessionStore, UploadedDocument } from '@/services/session';
import { buildPrintQuote } from '@/services/print-quote';
import { BLOCKED_STATUSES } from '@/utils';
import { financialLedgerService } from '@/services/financial-ledger';
import {
  checkpointRecoverySession,
  reconcileFinalizedCopySession,
} from '@/services/recovery';
import {
  assertTrustedTimeForFinancialOperation,
  getTrustedTimeStatus,
  getTrustedTimestamp,
  isTrustedTimeError,
} from '@/services/time-source';
import {
  PendingRefundServiceError,
  upsertSpoolerFailureRefund,
} from '@/services/pending-refund';

export interface FinancialServiceDeps {
  io: Server;
  sessionStore: SessionStore;
  resolvePublicBaseUrl: (req: Request) => URL;
}

interface UploadDeletionResult {
  deleted: boolean;
  alreadyMissing: boolean;
  filePath: string;
  error: string | null;
}

interface ConfirmPaymentBody {
  amount?: number;
  mode?: 'print' | 'copy';
  sessionId?: string;
  documentId?: string;
  spoolerCorrelationKey?: string;
  copies?: number;
  colorMode?: 'colored' | 'grayscale';
  orientation?: 'portrait' | 'landscape';
  paperSize?: 'A4' | 'Letter' | 'Legal';
  pageRange?: unknown;
  duplex?: boolean;
}

const LEGACY_UPLOAD_STAGING_DIR = path.resolve('uploads/staging/legacy');
const ACCEPTED_TEST_COINS = new Set([1, 5, 10, 20]);

function buildTrustedTimeBlockedResponse(error: unknown): {
  code: 'TRUSTED_TIME_UNAVAILABLE';
  error: string;
  trustedTime?: Record<string, unknown>;
} {
  if (!isTrustedTimeError(error)) {
    return {
      code: 'TRUSTED_TIME_UNAVAILABLE',
      error:
        'Financial operations are temporarily unavailable because trusted time is not synchronized.',
    };
  }
  return {
    code: error.code,
    error: `Financial operations are temporarily unavailable: ${error.trustedTime.detail}`,
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
  };
}

function getSessionDocuments(session: {
  documents?: UploadedDocument[];
  document?: UploadedDocument;
}): UploadedDocument[] {
  return session.documents && session.documents.length > 0
    ? session.documents
    : session.document
      ? [session.document]
      : [];
}

function resolveTargetDocument(
  session: { documents?: UploadedDocument[]; document?: UploadedDocument },
  documentId?: string,
): UploadedDocument | null {
  const allDocs = getSessionDocuments(session);
  if (allDocs.length === 0) return null;

  if (!documentId) return allDocs[allDocs.length - 1];
  return allDocs.find((doc) => doc.documentId === documentId) ?? null;
}

async function persistLegacyUploadWithStaging(
  buffer: Buffer,
  storedFilename: string,
): Promise<string> {
  const uploadsDir = path.resolve('uploads');
  const finalPath = path.resolve(uploadsDir, storedFilename);
  const relativePath = path.relative(uploadsDir, finalPath);
  const outsideUploads =
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath);
  if (outsideUploads) {
    throw new Error('Invalid filename');
  }

  await fs.promises.mkdir(uploadsDir, { recursive: true });
  await fs.promises.mkdir(LEGACY_UPLOAD_STAGING_DIR, { recursive: true });

  const stagingPath = path.join(
    LEGACY_UPLOAD_STAGING_DIR,
    `${storedFilename}.part`,
  );
  await fs.promises.writeFile(stagingPath, buffer, { flag: 'wx' });

  try {
    await fs.promises.rename(stagingPath, finalPath);
  } catch (error) {
    await fs.promises.unlink(stagingPath).catch(() => {});
    throw error;
  }

  return finalPath;
}

async function deleteUploadByStoredFilename(
  storedFilename: string,
): Promise<UploadDeletionResult> {
  const uploadsDir = path.resolve('uploads');
  const normalizedFilename = storedFilename.trim();
  if (!normalizedFilename) {
    return {
      deleted: false,
      alreadyMissing: false,
      filePath: '',
      error: 'Invalid filename',
    };
  }

  const filePath = path.resolve(uploadsDir, normalizedFilename);
  const relativePath = path.relative(uploadsDir, filePath);
  const outsideUploads =
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath);
  if (outsideUploads) {
    return {
      deleted: false,
      alreadyMissing: false,
      filePath,
      error: 'Invalid filename',
    };
  }

  try {
    await fs.promises.unlink(filePath);
    return {
      deleted: true,
      alreadyMissing: false,
      filePath,
      error: null,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return {
        deleted: true,
        alreadyMissing: true,
        filePath,
        error: null,
      };
    }
    return {
      deleted: false,
      alreadyMissing: false,
      filePath,
      error: err.message,
    };
  }
}

export class FinancialService {
  constructor(private readonly deps: FinancialServiceDeps) {}

  getBalance = (_req: Request, res: Response): void => {
    res.json({
      balance: db.data?.balance ?? 0,
      earnings: db.data?.earnings ?? 0,
    });
  };

  getPricing = (_req: Request, res: Response): void => {
    res.json(adminService.getPricingSettings());
  };

  getPrintQuote = (req: Request, res: Response): Response => {
    const { sessionId, documentId } = req.body as {
      sessionId?: string;
      documentId?: string;
      copies?: number;
      colorMode?: 'colored' | 'grayscale';
      pageRange?: unknown;
      duplex?: boolean;
    };

    if (!sessionId) {
      return res.status(400).json({ error: 'Print session is required' });
    }

    const sessionState = this.deps.sessionStore.getSessionState(sessionId);
    if (sessionState === 'expired') {
      return res.status(410).json({
        code: 'SESSION_EXPIRED',
        error: 'Session has expired. Please start a new upload session.',
      });
    }
    if (sessionState === 'missing') {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = this.deps.sessionStore.tryGetSession(
      sessionId,
      this.deps.resolvePublicBaseUrl(req),
    );
    if (!session) {
      return res.status(410).json({
        code: 'SESSION_EXPIRED',
        error: 'Session has expired. Please start a new upload session.',
      });
    }
    this.deps.sessionStore.touchSession(sessionId);

    const target = resolveTargetDocument(session, documentId);
    if (!target) {
      return res.status(400).json({
        error: documentId
          ? `Document "${documentId}" not found in session`
          : 'No uploaded document found for this session',
      });
    }

    if (!target.analysis) {
      return res.status(409).json({
        error:
          'Document analysis is unavailable. Re-upload the file and try again.',
      });
    }

    const safeCopies =
      typeof req.body?.copies === 'number' && Number.isFinite(req.body.copies)
        ? Math.max(1, Math.floor(req.body.copies))
        : 1;
    const requestedColorMode =
      req.body?.colorMode === 'colored' || req.body?.colorMode === 'grayscale'
        ? req.body.colorMode
        : 'grayscale';
    const duplex = req.body?.duplex === true;

    const quoteComputation = buildPrintQuote({
      analysis: target.analysis,
      copies: safeCopies,
      colorMode: requestedColorMode,
      pageRange: req.body?.pageRange,
      duplex,
    });
    if (!quoteComputation.ok) {
      return res.status(400).json({ error: quoteComputation.error });
    }

    return res.json({
      ok: true,
      sessionId,
      documentId: target.documentId,
      filename: target.filename,
      quote: quoteComputation.quote,
    });
  };

  getTransactionReceipt = (req: Request, res: Response): Response => {
    const transactionId = String(req.params.transactionId ?? '').trim();
    if (!transactionId) {
      return res.status(400).json({ error: 'transactionId is required.' });
    }

    const ledgerEntries = db
      .data!.financialLedger.filter(
        (entry) => entry.referenceId === transactionId,
      )
      .map((entry) => ({
        eventType: entry.eventType,
        amount: entry.amount,
        timestamp: entry.timestamp,
      }));
    const jobCompleted = ledgerEntries.find(
      (entry) => entry.eventType === 'job_completed',
    );
    const recoverySession =
      db.data!.recovery.sessions.find(
        (session) => session.id === transactionId,
      ) ?? null;
    const pendingRefund = db.data!.pendingRefunds.find((entry) => {
      const ref = entry.jobContext.transactionId;
      return typeof ref === 'string' && ref === transactionId;
    });

    if (!jobCompleted && !recoverySession && !pendingRefund) {
      return res.status(404).json({ error: 'Receipt not found.' });
    }

    return res.json({
      transactionId,
      mode: recoverySession?.mode ?? null,
      chargedAmount:
        jobCompleted?.amount ??
        recoverySession?.chargedAmount ??
        pendingRefund?.chargedAmount ??
        null,
      status: recoverySession?.phase ?? null,
      settledAt: recoverySession?.settledAt ?? null,
      printedAt: recoverySession?.spoolerTerminalAt ?? null,
      refundStatus: pendingRefund?.status ?? null,
      refundReason: pendingRefund?.reason ?? null,
      generatedAt: getTrustedTimestamp().timestamp,
    });
  };

  resetBalance = async (_req: Request, res: Response): Promise<void> => {
    const previousBalance = db.data!.balance;
    db.data!.balance = 0;
    await db.write();
    this.deps.io.emit('balance', 0);
    await adminService.appendAdminLog(
      'balance_reset',
      'Balance reset from admin/testing.',
      {
        previousBalance,
        newBalance: 0,
      },
    );

    res.json({
      ok: true,
      balance: db.data!.balance,
      earnings: db.data!.earnings,
    });
  };

  addTestCoin = async (
    req: Request,
    res: Response,
  ): Promise<Response | void> => {
    const { value } = req.body as { value?: unknown };
    const coinValue =
      typeof value === 'number' && Number.isFinite(value) ? value : null;

    if (coinValue === null || !ACCEPTED_TEST_COINS.has(coinValue)) {
      return res
        .status(400)
        .json({ error: 'Invalid coin value. Accepted: 1, 5, 10, 20' });
    }
    const trustedTime = getTrustedTimeStatus();
    if (
      trustedTime.enforceForFinancial &&
      (!trustedTime.synced ||
        trustedTime.offsetMs === null ||
        trustedTime.driftExceeded)
    ) {
      void adminService.appendAdminLog(
        'coin_accepted_trusted_time_unsynced',
        'Test coin accepted while trusted time is unsynchronized.',
        {
          source: 'test-ui',
          coinValue,
          detail: trustedTime.detail,
          offsetMs: trustedTime.offsetMs,
          driftExceeded: trustedTime.driftExceeded,
          checkedAt: trustedTime.checkedAt,
        },
      );
    }

    db.data!.balance += coinValue;
    await db.write();

    await adminService.appendAdminLog(
      'coin_accepted',
      `Test coin inserted: ${coinValue}`,
      {
        coinValue,
        balance: db.data!.balance,
        source: 'test-ui',
      },
    );
    await financialLedgerService.append({
      eventType: 'coin_inserted',
      amount: coinValue,
      meta: {
        source: 'test-ui',
        balance: db.data!.balance,
      },
    });

    this.deps.io.emit('balance', db.data!.balance);
    this.deps.io.emit('coinAccepted', {
      value: coinValue,
      balance: db.data!.balance,
    });

    res.json({
      ok: true,
      coinValue,
      balance: db.data!.balance,
    });
  };

  uploadLegacy = async (
    req: Request,
    res: Response,
  ): Promise<Response | void> => {
    if (!req.file) {
      await adminService.appendAdminLog(
        'upload_failed',
        'Upload failed: no file provided.',
      );
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const safeFilename = `${randomUUID()}${path.extname(req.file.originalname).toLowerCase()}`;

    try {
      await persistLegacyUploadWithStaging(req.file.buffer, safeFilename);
    } catch (error) {
      await adminService.appendAdminLog(
        'upload_failed',
        'Upload failed while persisting validated file.',
        {
          filename: req.file.originalname,
          sizeBytes: req.file.size,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return res.status(500).json({ error: 'Failed to store uploaded file.' });
    }

    await adminService.appendAdminLog(
      'upload_completed',
      'Upload completed via /upload.',
      {
        filename: req.file.originalname,
        storedFilename: safeFilename,
        sizeBytes: req.file.size,
      },
    );
    res.status(200).json({ filename: safeFilename });
  };

  printLegacy = async (
    req: Request,
    res: Response,
  ): Promise<Response | void> => {
    const { filename } = req.body as { filename?: string };

    if (!filename) {
      void adminService.appendAdminLog(
        'print_failed',
        'Legacy print failed: filename missing.',
      );
      return res.status(400).json({ error: 'Filename is required' });
    }
    try {
      assertTrustedTimeForFinancialOperation('legacy_print');
    } catch (error) {
      const payload = buildTrustedTimeBlockedResponse(error);
      void adminService.appendAdminLog(
        'trusted_time_unsynced',
        'Legacy print blocked because trusted time is unavailable.',
        {
          source: 'legacy-print',
          filename,
          detail: payload.error,
        },
      );
      return res.status(503).json(payload);
    }

    const minimumAmount = adminService.calculateJobAmount(
      'print',
      'grayscale',
      1,
    );
    if ((db.data?.balance ?? 0) < minimumAmount) {
      void adminService.appendAdminLog(
        'print_failed',
        'Legacy print failed: insufficient balance.',
        { balance: db.data?.balance ?? 0, required: minimumAmount },
      );
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const defaultOptions: PrintJobOptions = {
      copies: 1,
      colorMode: 'grayscale',
      orientation: 'portrait',
      paperSize: 'A4',
    };

    const legacyTelemetry = await refreshPrinterTelemetry();
    if (
      !legacyTelemetry.connected ||
      BLOCKED_STATUSES.has(legacyTelemetry.status)
    ) {
      void adminService.appendAdminLog(
        'print_preflight_failed',
        'Legacy print rejected: printer not ready.',
        {
          filename,
          printerStatus: legacyTelemetry.status,
          printerConnected: legacyTelemetry.connected,
        },
      );
      return res.status(409).json({
        error: `Printer is not ready: ${legacyTelemetry.status}. Please notify the operator.`,
        printerStatus: legacyTelemetry.status,
      });
    }

    const legacyInkPreflight = evaluateInkPreflight(legacyTelemetry);
    if (legacyInkPreflight.blocked) {
      void adminService.appendAdminLog(
        'print_preflight_failed_ink',
        'Legacy print rejected: ink preflight policy blocked the job.',
        {
          filename,
          printerStatus: legacyTelemetry.status,
          inkCode: legacyInkPreflight.code,
          inkReason: legacyInkPreflight.reason ?? 'Unknown ink policy reason',
          telemetryAvailable: legacyInkPreflight.telemetryAvailable,
          inkDetectionMethod: legacyTelemetry.inkDetectionMethod,
        },
      );
      return res.status(409).json({
        error:
          legacyInkPreflight.reason ??
          'Printer ink state is not ready for printing.',
        printerStatus: legacyTelemetry.status,
        inkStatus: legacyInkPreflight.code,
        inkReason: legacyInkPreflight.reason,
        telemetryAvailable: legacyInkPreflight.telemetryAvailable,
      });
    }

    try {
      await printFile(filename, defaultOptions);
    } catch (err) {
      void adminService.appendAdminLog(
        'print_failed',
        'Legacy print failed: printer error.',
        {
          filename,
          error: err instanceof Error ? err.message : 'Unknown error',
        },
      );
      return res.status(500).json({ error: 'Print failed' });
    }

    await financialLedgerService.append({
      eventType: 'job_started',
      amount: minimumAmount,
      referenceId: filename,
      meta: {
        mode: 'print',
        source: 'legacy',
        filename,
      },
    });

    const chargedAmount = db.data!.balance;
    db.data!.earnings += chargedAmount;
    db.data!.balance = 0;
    await db.write();
    await financialLedgerService.append({
      eventType: 'job_completed',
      amount: chargedAmount,
      referenceId: filename,
      meta: {
        mode: 'print',
        source: 'legacy',
        filename,
      },
    });
    await adminService.appendAdminLog(
      'print_completed',
      'Legacy print completed and charged.',
      {
        filename,
        chargedAmount,
      },
    );
    await adminService.incrementJobStats('print');

    const legacyCleanup = await deleteUploadByStoredFilename(filename);
    if (legacyCleanup.deleted) {
      await adminService.appendAdminLog(
        'upload_deleted_after_print',
        'Uploaded file deleted after legacy print.',
        {
          filename,
          filePath: legacyCleanup.filePath || null,
          alreadyMissing: legacyCleanup.alreadyMissing,
          source: 'legacy-print',
        },
      );
    } else {
      await adminService.appendAdminLog(
        'upload_delete_after_print_failed',
        'Failed to delete uploaded file after legacy print.',
        {
          filename,
          filePath: legacyCleanup.filePath || null,
          source: 'legacy-print',
          error: legacyCleanup.error ?? 'Unknown error',
        },
      );
    }

    this.deps.io.emit('balance', 0);
    res.sendStatus(200);
  };

  confirmPayment = async (req: Request, res: Response): Promise<void> => {
    const idempotencyKey = req.get('Idempotency-Key') ?? '';
    let idempotencyClaimed = false;
    if (idempotencyKey) {
      const slot = acquireIdempotencyKey(
        idempotencyKey,
        'POST:/api/confirm-payment',
      );
      if (slot.type === 'hit') {
        res.status(slot.entry.statusCode).json(slot.entry.response);
        return;
      }
      if (slot.type === 'inflight') {
        const entry = await slot.promise;
        if (entry) {
          res.status(entry.statusCode).json(entry.response);
        } else {
          res
            .status(503)
            .json({ error: 'Concurrent request failed. Please retry.' });
        }
        return;
      }
      idempotencyClaimed = true;
    }

    const transactionId = randomUUID();

    const sendResponse = (status: number, body: unknown): void => {
      if (idempotencyClaimed) {
        if (status < 500) {
          storeIdempotencyKey(
            idempotencyKey,
            'POST:/api/confirm-payment',
            status,
            body,
          );
        } else {
          releaseIdempotencyKey(idempotencyKey, 'POST:/api/confirm-payment');
        }
      }
      res.status(status).json(body);
    };

    try {
      assertTrustedTimeForFinancialOperation('confirm_payment');
    } catch (error) {
      const payload = buildTrustedTimeBlockedResponse(error);
      void adminService.appendAdminLog(
        'trusted_time_unsynced',
        'Confirm payment blocked because trusted time is unavailable.',
        {
          transactionId,
          detail: payload.error,
        },
      );
      sendResponse(503, payload);
      return;
    }

    const { amount, mode, sessionId, documentId } =
      req.body as ConfirmPaymentBody;
    const spoolerCorrelationKey =
      typeof req.body?.spoolerCorrelationKey === 'string' &&
      req.body.spoolerCorrelationKey.trim()
        ? req.body.spoolerCorrelationKey.trim()
        : null;

    if (mode !== 'print' && mode !== 'copy') {
      void adminService.appendAdminLog(
        'payment_failed',
        'Confirm payment failed: invalid mode.',
        {
          transactionId,
          mode: mode ?? null,
        },
      );
      sendResponse(400, { error: 'Invalid mode' });
      return;
    }

    const copies =
      typeof req.body?.copies === 'number' && Number.isFinite(req.body.copies)
        ? Math.max(1, Math.floor(req.body.copies))
        : 1;
    const colorMode =
      req.body?.colorMode === 'colored' || req.body?.colorMode === 'grayscale'
        ? req.body.colorMode
        : 'grayscale';
    const orientation =
      req.body?.orientation === 'portrait' ||
      req.body?.orientation === 'landscape'
        ? req.body.orientation
        : 'portrait';
    const paperSize =
      req.body?.paperSize === 'A4' ||
      req.body?.paperSize === 'Letter' ||
      req.body?.paperSize === 'Legal'
        ? req.body.paperSize
        : 'A4';
    const duplex = req.body?.duplex === true;
    let requiredAmount =
      mode === 'copy'
        ? adminService.calculateJobAmount('copy', colorMode, copies)
        : 0;

    let serverFilename: string | null = null;
    let targetDocumentId: string | null = null;
    let printOptions: PrintJobOptions | null = null;
    let printQuotePages: {
      selectedPages: number;
      selectedColorPages: number;
      selectedBwPages: number;
      billableColorPages: number;
      billableBwPages: number;
      effectiveColorMode: 'colored' | 'grayscale';
    } | null = null;

    await checkpointRecoverySession({
      transactionId,
      mode,
      phase: 'initiated',
      requiredAmount: 0,
      sessionId: sessionId ?? null,
      documentId: documentId ?? null,
      spoolerCorrelationKey,
      context: {
        endpoint: 'confirm_payment',
      },
    });

    if (mode === 'print') {
      if (!sessionId) {
        void adminService.appendAdminLog(
          'payment_failed',
          'Confirm payment failed: missing print session.',
          { transactionId },
        );
        sendResponse(400, { error: 'Print session is required' });
        return;
      }

      const sessionState = this.deps.sessionStore.getSessionState(sessionId);
      if (sessionState === 'expired') {
        void adminService.appendAdminLog(
          'payment_failed',
          'Confirm payment failed: session expired.',
          { transactionId, sessionId },
        );
        sendResponse(410, {
          code: 'SESSION_EXPIRED',
          error: 'Session has expired. Please start a new upload session.',
        });
        return;
      }
      if (sessionState === 'missing') {
        void adminService.appendAdminLog(
          'payment_failed',
          'Confirm payment failed: session not found.',
          { transactionId, sessionId },
        );
        sendResponse(404, { error: 'Session not found' });
        return;
      }

      const session = this.deps.sessionStore.tryGetSession(
        sessionId,
        this.deps.resolvePublicBaseUrl(req),
      );
      if (!session) {
        void adminService.appendAdminLog(
          'payment_failed',
          'Confirm payment failed: session not found.',
          { transactionId, sessionId },
        );
        sendResponse(410, {
          code: 'SESSION_EXPIRED',
          error: 'Session has expired. Please start a new upload session.',
        });
        return;
      }
      this.deps.sessionStore.touchSession(sessionId);

      const target = resolveTargetDocument(session, documentId);
      if (!target) {
        void adminService.appendAdminLog(
          'payment_failed',
          documentId
            ? 'Confirm payment failed: target document not found.'
            : 'Confirm payment failed: no uploaded document in session.',
          { transactionId, sessionId, documentId: documentId ?? null },
        );
        sendResponse(400, {
          error: documentId
            ? `Document "${documentId}" not found in session`
            : 'No uploaded document found for this session',
        });
        return;
      }

      if (!target.analysis) {
        void adminService.appendAdminLog(
          'payment_failed',
          'Confirm payment failed: document analysis unavailable.',
          {
            transactionId,
            sessionId,
            filename: target.filename,
          },
        );
        sendResponse(409, {
          error:
            'Document analysis is unavailable. Re-upload the file and try again.',
        });
        return;
      }

      const quoteComputation = buildPrintQuote({
        analysis: target.analysis,
        copies,
        colorMode,
        pageRange: req.body?.pageRange,
        duplex,
      });
      if (!quoteComputation.ok) {
        void adminService.appendAdminLog(
          'payment_failed',
          'Confirm payment failed: invalid quote input.',
          {
            transactionId,
            sessionId,
            pageRange: req.body?.pageRange ?? null,
            error: quoteComputation.error,
          },
        );
        sendResponse(400, { error: quoteComputation.error });
        return;
      }

      requiredAmount = quoteComputation.quote.requiredAmount;
      printQuotePages = {
        selectedPages: quoteComputation.quote.selectedPages,
        selectedColorPages: quoteComputation.quote.selectedColorPages,
        selectedBwPages: quoteComputation.quote.selectedBwPages,
        billableColorPages: quoteComputation.quote.billableColorPages,
        billableBwPages: quoteComputation.quote.billableBwPages,
        effectiveColorMode: quoteComputation.quote.effectiveColorMode,
      };

      serverFilename = path.basename(target.filePath);
      targetDocumentId = target.documentId;
      printOptions = {
        copies: quoteComputation.quote.copies,
        colorMode: quoteComputation.quote.effectiveColorMode,
        orientation,
        paperSize,
        pageRange: quoteComputation.quote.pageRange ?? undefined,
        duplex: quoteComputation.quote.duplex,
      };
    }

    await checkpointRecoverySession({
      transactionId,
      mode,
      phase: 'preflight_passed',
      requiredAmount,
      sessionId: sessionId ?? null,
      documentId: targetDocumentId ?? documentId ?? null,
      spoolerCorrelationKey,
      context: {
        copies,
        colorMode: printOptions?.colorMode ?? colorMode,
        duplex: printOptions?.duplex ?? false,
      },
    });

    if (
      typeof amount === 'number' &&
      Number.isFinite(amount) &&
      amount !== requiredAmount
    ) {
      void adminService.appendAdminLog(
        'payment_amount_mismatch',
        'Client amount differed from server pricing.',
        {
          transactionId,
          amount,
          requiredAmount,
        },
      );
    }

    if ((db.data?.balance ?? 0) < requiredAmount) {
      void adminService.appendAdminLog(
        'payment_failed',
        'Confirm payment failed: insufficient balance.',
        { transactionId, balance: db.data?.balance ?? 0, requiredAmount },
      );
      if (idempotencyClaimed) {
        releaseIdempotencyKey(idempotencyKey, 'POST:/api/confirm-payment');
      }
      res.status(400).json({
        error: 'Insufficient balance',
        balance: db.data?.balance ?? 0,
        requiredAmount,
      });
      return;
    }

    const telemetry =
      mode === 'print'
        ? await refreshPrinterTelemetry()
        : getPrinterTelemetry();
    let jobDispatchedAt: string | null = null;

    if (mode === 'print' && serverFilename && printOptions) {
      if (!telemetry.connected || BLOCKED_STATUSES.has(telemetry.status)) {
        void adminService.appendAdminLog(
          'print_preflight_failed',
          'Print rejected: printer not ready.',
          {
            transactionId,
            printerStatus: telemetry.status,
            printerConnected: telemetry.connected,
            sessionId: sessionId ?? null,
          },
        );
        if (idempotencyClaimed) {
          releaseIdempotencyKey(idempotencyKey, 'POST:/api/confirm-payment');
        }
        res.status(409).json({
          error: `Printer is not ready: ${telemetry.status}. Please notify the operator.`,
          printerStatus: telemetry.status,
        });
        return;
      }

      const inkPreflight = evaluateInkPreflight(telemetry);
      if (inkPreflight.blocked) {
        void adminService.appendAdminLog(
          'print_preflight_failed_ink',
          'Print rejected: ink preflight policy blocked the job.',
          {
            transactionId,
            printerStatus: telemetry.status,
            inkCode: inkPreflight.code,
            inkReason: inkPreflight.reason ?? 'Unknown ink policy reason',
            telemetryAvailable: inkPreflight.telemetryAvailable,
            inkDetectionMethod: telemetry.inkDetectionMethod,
          },
        );
        if (idempotencyClaimed) {
          releaseIdempotencyKey(idempotencyKey, 'POST:/api/confirm-payment');
        }
        res.status(409).json({
          error:
            inkPreflight.reason ??
            'Printer ink state is not ready for printing.',
          printerStatus: telemetry.status,
          inkStatus: inkPreflight.code,
          inkReason: inkPreflight.reason,
          telemetryAvailable: inkPreflight.telemetryAvailable,
        });
        return;
      }

      try {
        jobDispatchedAt = getTrustedTimestamp().timestamp;
        await printFile(serverFilename, printOptions);
        await checkpointRecoverySession({
          transactionId,
          mode,
          phase: 'job_dispatched',
          requiredAmount,
          chargedAmount: 0,
          sessionId: sessionId ?? null,
          documentId: targetDocumentId ?? null,
          spoolerCorrelationKey,
          jobDispatchedAt,
          context: {
            filename: serverFilename,
            spoolerDispatched: true,
          },
        });
      } catch (err) {
        void adminService.appendAdminLog(
          'print_failed',
          'Print failed: printer error.',
          {
            transactionId,
            sessionId: sessionId ?? null,
            filename: serverFilename,
            error: err instanceof Error ? err.message : 'Unknown error',
          },
        );
        sendResponse(500, { error: 'Print failed. Please try again.' });
        return;
      }
    }

    try {
      await financialLedgerService.append({
        eventType: 'job_started',
        amount: requiredAmount,
        referenceId: transactionId,
        meta: {
          mode,
          sessionId: sessionId ?? null,
          documentId: targetDocumentId ?? null,
          filename: serverFilename ?? null,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown ledger error.';
      void adminService.appendAdminLog(
        'financial_ledger_write_failed',
        'Failed to record immutable job_started event.',
        { transactionId, mode, error: message },
      );
      sendResponse(500, { error: 'Failed to record financial event.' });
      return;
    }

    const settlement = await settlementService.settle({
      requiredAmount,
      io: this.deps.io,
      jobContext: {
        mode,
        copies,
        colorMode: printOptions?.colorMode ?? colorMode,
        duplex: printOptions?.duplex ?? false,
        sessionId: sessionId ?? null,
        documentId: targetDocumentId ?? null,
        filename: serverFilename ?? null,
      },
    });

    if (!settlement.ok) {
      sendResponse(400, {
        error: settlement.error ?? 'Insufficient balance',
        balance: settlement.remainingBalance,
        requiredAmount,
      });
      return;
    }

    await checkpointRecoverySession({
      transactionId,
      mode,
      phase: 'settled',
      requiredAmount,
      chargedAmount: settlement.chargedAmount,
      sessionId: sessionId ?? null,
      documentId: targetDocumentId ?? null,
      spoolerCorrelationKey,
      jobDispatchedAt,
      settledAt: getTrustedTimestamp().timestamp,
      context: {
        changeState: settlement.change.state,
        changeRequested: settlement.change.requested,
        changeDispensed: settlement.change.dispensed,
      },
    });

    try {
      await financialLedgerService.append({
        eventType: 'job_completed',
        amount: settlement.chargedAmount,
        referenceId: transactionId,
        meta: {
          mode,
          changeState: settlement.change.state,
          changeRequested: settlement.change.requested,
          changeDispensed: settlement.change.dispensed,
          remainingBalance: settlement.remainingBalance,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown ledger error.';
      void adminService.appendAdminLog(
        'financial_ledger_write_failed',
        'Failed to record immutable job_completed event.',
        { transactionId, mode, error: message },
      );
      sendResponse(500, { error: 'Failed to record financial event.' });
      return;
    }

    sendResponse(200, {
      ok: true,
      transactionId,
      chargedAmount: settlement.chargedAmount,
      balance: settlement.remainingBalance,
      earnings: settlement.earnings,
      change: settlement.change,
    });

    const settledAmount = settlement.chargedAmount;
    const settledChangeState = settlement.change.state;
    const settledChangeRequested = settlement.change.requested;
    const settledChangeDispensed = settlement.change.dispensed;
    const settledChangeAttempts = settlement.change.attempts ?? 0;
    const settledOwedChangeId = settlement.change.owedChangeId ?? null;
    const settledChangeMessage = settlement.change.message ?? null;
    const settledRemainingBalance = settlement.remainingBalance;

    void (async () => {
      const runAuditStep = async (
        step: string,
        operation: () => Promise<unknown>,
      ): Promise<void> => {
        try {
          await operation();
        } catch (err) {
          console.error(
            `[CONFIRM-PAYMENT] Audit step failed (${step}):`,
            err instanceof Error ? err.message : err,
          );
        }
      };

      await runAuditStep('increment_job_stats', () =>
        adminService.incrementJobStats(mode),
      );

      await runAuditStep('payment_confirmed', () =>
        adminService.appendAdminLog('payment_confirmed', 'Payment confirmed.', {
          transactionId,
          mode,
          amount: requiredAmount,
          copies,
          colorMode: printOptions?.colorMode ?? colorMode,
          duplex: printOptions?.duplex ?? false,
          pageRange: printOptions?.pageRange ?? null,
          selectedPages: printQuotePages?.selectedPages ?? null,
          selectedColorPages: printQuotePages?.selectedColorPages ?? null,
          selectedBwPages: printQuotePages?.selectedBwPages ?? null,
          billableColorPages: printQuotePages?.billableColorPages ?? null,
          billableBwPages: printQuotePages?.billableBwPages ?? null,
          documentId: targetDocumentId ?? null,
          sessionId: sessionId ?? null,
          filename: serverFilename ?? null,
          remainingBalance: settledRemainingBalance,
          changeState: settledChangeState,
          changeRequested: settledChangeRequested,
          changeDispensed: settledChangeDispensed,
        }),
      );

      if (settledChangeState === 'dispensed') {
        await runAuditStep('hopper_dispense_succeeded', () =>
          adminService.appendAdminLog(
            'hopper_dispense_succeeded',
            'Coin change dispensed.',
            {
              transactionId,
              requested: settledChangeRequested,
              dispensed: settledChangeDispensed,
              attempts: settledChangeAttempts,
            },
          ),
        );
      }

      if (settledChangeState === 'failed') {
        await runAuditStep('hopper_dispense_failed', () =>
          adminService.appendAdminLog(
            'hopper_dispense_failed',
            'Coin change dispense failed.',
            {
              transactionId,
              requested: settledChangeRequested,
              dispensed: settledChangeDispensed,
              attempts: settledChangeAttempts,
              owedChangeId: settledOwedChangeId,
              message: settledChangeMessage,
            },
          ),
        );
      }
    })();

    if (mode === 'print' && jobDispatchedAt) {
      if (telemetry.name) {
        void monitorSpoolerJob({
          printerName: telemetry.name,
          chargedAmount: settledAmount,
          jobDispatchedAt,
          spoolerCorrelationKey,
          io: this.deps.io,
          jobContext: {
            transactionId,
            mode,
            copies,
            colorMode: printOptions?.colorMode ?? colorMode,
            duplex: printOptions?.duplex ?? false,
            spoolerCorrelationKey,
            sessionId: sessionId ?? null,
            documentId: targetDocumentId ?? null,
            filename: serverFilename ?? null,
            pageRange: printOptions?.pageRange ?? null,
          },
          onConfirmed: async () => {
            if (!serverFilename) return;
            await this.cleanupPrintUploadAfterSpoolerSuccess({
              transactionId,
              sessionId: sessionId ?? null,
              documentId: targetDocumentId ?? null,
              filename: serverFilename,
            });
          },
        }).catch((err) => {
          console.error(
            '[SPOOLER-MONITOR] monitorSpoolerJob failed:',
            err instanceof Error ? err.message : err,
          );
        });
      } else {
        void this.handleMissingSpoolerTelemetry({
          transactionId,
          chargedAmount: settledAmount,
          spoolerCorrelationKey,
          sessionId: sessionId ?? null,
          documentId: targetDocumentId ?? null,
          filename: serverFilename ?? null,
          copies,
          colorMode: printOptions?.colorMode ?? colorMode,
          duplex: printOptions?.duplex ?? false,
          pageRange: printOptions?.pageRange ?? null,
          jobDispatchedAt,
        }).catch((error) => {
          console.error(
            '[CONFIRM-PAYMENT] Missing telemetry fallback failed:',
            error instanceof Error ? error.message : error,
          );
        });
      }
    } else if (mode === 'copy') {
      void reconcileFinalizedCopySession(transactionId).catch((error) => {
        console.error(
          '[CONFIRM-PAYMENT] Failed to reconcile finalized copy session:',
          error instanceof Error ? error.message : error,
        );
      });
    }
  };

  private async cleanupPrintUploadAfterSpoolerSuccess(input: {
    transactionId: string;
    sessionId: string | null;
    documentId: string | null;
    filename: string;
  }): Promise<void> {
    const { transactionId, sessionId, documentId, filename } = input;

    let cleaned = false;
    if (sessionId && documentId) {
      const removedDocument = await this.deps.sessionStore.removeDocument(
        sessionId,
        documentId,
      );
      if (removedDocument.success && removedDocument.deletedFile) {
        cleaned = true;
        await adminService.appendAdminLog(
          'upload_deleted_after_print',
          'Uploaded file deleted after spooler-confirmed print completion.',
          {
            transactionId,
            sessionId,
            documentId,
            filename,
            source: 'session-store-spooler-confirmed',
            alreadyMissing: false,
          },
        );
      } else {
        const fallbackCleanup = await deleteUploadByStoredFilename(filename);
        if (fallbackCleanup.deleted) {
          cleaned = true;
          await adminService.appendAdminLog(
            'upload_deleted_after_print',
            'Uploaded file deleted after spooler-confirmed print completion.',
            {
              transactionId,
              sessionId,
              documentId,
              filename,
              source: 'fallback-unlink-spooler-confirmed',
              alreadyMissing: fallbackCleanup.alreadyMissing,
              sessionRemoveErrorCode: removedDocument.errorCode ?? null,
              sessionDeletedFile: removedDocument.deletedFile,
            },
          );
        } else {
          await adminService.appendAdminLog(
            'upload_delete_after_print_failed',
            'Failed to delete uploaded file after spooler-confirmed print completion.',
            {
              transactionId,
              sessionId,
              documentId,
              filename,
              source: 'spooler-confirmed',
              sessionRemoveErrorCode: removedDocument.errorCode ?? null,
              sessionDeletedFile: removedDocument.deletedFile,
              error: fallbackCleanup.error ?? 'Unknown error',
            },
          );
        }
      }
    } else {
      const cleanup = await deleteUploadByStoredFilename(filename);
      cleaned = cleanup.deleted;
      if (cleanup.deleted) {
        await adminService.appendAdminLog(
          'upload_deleted_after_print',
          'Uploaded file deleted after spooler-confirmed print completion.',
          {
            transactionId,
            sessionId,
            documentId,
            filename,
            source: 'spooler-confirmed',
            alreadyMissing: cleanup.alreadyMissing,
          },
        );
      } else {
        await adminService.appendAdminLog(
          'upload_delete_after_print_failed',
          'Failed to delete uploaded file after spooler-confirmed print completion.',
          {
            transactionId,
            sessionId,
            documentId,
            filename,
            source: 'spooler-confirmed',
            error: cleanup.error ?? 'Unknown error',
          },
        );
      }
    }

    if (!cleaned) {
      throw new Error(
        'Uploaded file cleanup failed after spooler-confirmed print completion.',
      );
    }
  }

  private async handleMissingSpoolerTelemetry(input: {
    transactionId: string;
    chargedAmount: number;
    spoolerCorrelationKey: string;
    sessionId: string | null;
    documentId: string | null;
    filename: string | null;
    copies: number;
    colorMode: 'colored' | 'grayscale';
    duplex: boolean;
    pageRange: string | null;
    jobDispatchedAt: string;
  }): Promise<void> {
    const {
      transactionId,
      chargedAmount,
      spoolerCorrelationKey,
      sessionId,
      documentId,
      filename,
      copies,
      colorMode,
      duplex,
      pageRange,
      jobDispatchedAt,
    } = input;

    const reason =
      'Print spooler monitoring unavailable because printer telemetry name is missing.';
    await adminService
      .appendAdminLog(
        'print_spooler_monitor_unavailable',
        'Unable to monitor spooler job because printer telemetry is missing.',
        {
          transactionId,
          spoolerCorrelationKey,
          sessionId,
          documentId,
          filename,
        },
      )
      .catch((logError) => {
        console.error(
          '[CONFIRM-PAYMENT] Failed to append monitor-unavailable admin log:',
          logError instanceof Error ? logError.message : logError,
        );
      });

    try {
      const refundOutcome = await upsertSpoolerFailureRefund({
        chargedAmount,
        reason,
        autoRefund: false,
        jobContext: {
          transactionId,
          mode: 'print',
          copies,
          colorMode,
          duplex,
          pageRange,
          spoolerCorrelationKey,
          sessionId,
          documentId,
          filename,
          spoolerStatus: 'monitor_unavailable',
          jobDispatchedAt,
        },
      });
      const refundDisposition = refundOutcome.autoRefunded
        ? 'auto_refunded'
        : 'pending_admin_review';

      if (
        refundOutcome.autoRefunded &&
        refundOutcome.restoredBalanceAmount > 0
      ) {
        this.deps.io.emit('balance', db.data!.balance);
      }

      await adminService
        .appendAdminLog(
          refundOutcome.autoRefunded
            ? 'print_spooler_auto_refund'
            : 'print_spooler_job_failed',
          refundOutcome.autoRefunded
            ? `Print monitor fallback auto-refunded ₱${chargedAmount}.`
            : `Print monitor fallback queued pending refund ₱${chargedAmount}.`,
          {
            transactionId,
            spoolerCorrelationKey,
            refundId: refundOutcome.entry.id,
            refundDisposition,
            restoredBalanceAmount: refundOutcome.restoredBalanceAmount,
            reason,
          },
        )
        .catch((logError) => {
          console.error(
            '[CONFIRM-PAYMENT] Failed to append fallback refund admin log:',
            logError instanceof Error ? logError.message : logError,
          );
        });

      this.deps.io.emit('printerSpoolerFailure', {
        jobStatus: 'monitor_unavailable',
        chargedAmount,
        refundId: refundOutcome.entry.id,
        pagesPrinted: 0,
        totalPages: 0,
        printerName: null,
        reason,
        refundDisposition,
        restoredBalanceAmount: refundOutcome.restoredBalanceAmount,
        transactionId,
        spoolerCorrelationKey,
      });

      await checkpointRecoverySession({
        transactionId,
        mode: 'print',
        phase: 'reconciled',
        requiredAmount: chargedAmount,
        chargedAmount,
        sessionId,
        documentId,
        spoolerCorrelationKey,
        spoolerJobId: null,
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
            ? 'Spooler monitor unavailable; auto-refunded.'
            : 'Spooler monitor unavailable; pending admin refund review.',
        context: {
          spoolerOutcome: 'monitor_unavailable',
          refundDisposition,
          refundId: refundOutcome.entry.id,
        },
      });
      if (filename) {
        await this.cleanupPrintUploadAfterSpoolerSuccess({
          transactionId,
          sessionId,
          documentId,
          filename,
        }).catch((cleanupError) => {
          console.error(
            '[CONFIRM-PAYMENT] Fallback print upload cleanup failed:',
            cleanupError instanceof Error
              ? cleanupError.message
              : cleanupError,
          );
        });
      }
    } catch (error) {
      if (
        error instanceof PendingRefundServiceError &&
        error.code === 'TRUSTED_TIME_UNAVAILABLE'
      ) {
        await adminService
          .appendAdminLog(
            'trusted_time_unsynced',
            'Print fallback refund blocked because trusted time is unavailable.',
            {
              transactionId,
              spoolerCorrelationKey,
              detail: error.message,
            },
          )
          .catch((logError) => {
            console.error(
              '[CONFIRM-PAYMENT] Failed to append trusted-time fallback admin log:',
              logError instanceof Error ? logError.message : logError,
            );
          });
        this.deps.io.emit('printerSpoolerFailure', {
          jobStatus: 'monitor_unavailable',
          chargedAmount,
          refundId: null,
          pagesPrinted: 0,
          totalPages: 0,
          printerName: null,
          reason: 'Refund blocked because trusted time is unavailable.',
          refundDisposition: 'pending_admin_review',
          restoredBalanceAmount: 0,
          transactionId,
          spoolerCorrelationKey,
        });
        await checkpointRecoverySession({
          transactionId,
          mode: 'print',
          phase: 'spooler_failed',
          requiredAmount: chargedAmount,
          chargedAmount,
          sessionId,
          documentId,
          spoolerCorrelationKey,
          spoolerJobId: null,
          jobDispatchedAt,
          settledAt: null,
          spoolerTerminalAt: new Date().toISOString(),
          lastError: 'Refund blocked because trusted time is unavailable.',
          context: {
            spoolerOutcome: 'monitor_unavailable',
            refundDisposition: 'pending_admin_review',
            trustedTimeBlocked: true,
          },
        });
        if (filename) {
          await this.cleanupPrintUploadAfterSpoolerSuccess({
            transactionId,
            sessionId,
            documentId,
            filename,
          }).catch((cleanupError) => {
            console.error(
              '[CONFIRM-PAYMENT] Fallback print upload cleanup failed:',
              cleanupError instanceof Error
                ? cleanupError.message
                : cleanupError,
            );
          });
        }
        return;
      }
      throw error;
    }
  }
}
