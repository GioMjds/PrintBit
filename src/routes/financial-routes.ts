import type { Express, Request, RequestHandler, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'socket.io';
import {
  db,
  acquireIdempotencyKey,
  storeIdempotencyKey,
  releaseIdempotencyKey,
} from '@/services/db';
import { getPrinterTelemetry } from '@/services';
import { adminService } from '@/services/admin';
import { settlementService } from '@/services/settlement';
import { printFile, type PrintJobOptions } from '@/services/printer';
import { monitorSpoolerJob } from '@/services/print-spooler';
import type { SessionStore, UploadedDocument } from '@/services/session';
import { buildPrintQuote } from '@/services/print-quote';
import { randomUUID } from 'node:crypto';
import { BLOCKED_STATUSES } from '@/utils';
import { financialLedgerService } from '@/services/financial-ledger';
import {
  assertTrustedTimeForFinancialOperation,
  getTrustedTimestamp,
  isTrustedTimeError,
} from '@/services/time-source';

interface RegisterFinancialRoutesDeps {
  io: Server;
  sessionStore: SessionStore;
  uploadSingle: RequestHandler;
  resolvePublicBaseUrl: (req: Request) => URL;
}

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

interface UploadDeletionResult {
  deleted: boolean;
  alreadyMissing: boolean;
  filePath: string;
  error: string | null;
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

export function registerFinancialRoutes(
  app: Express,
  deps: RegisterFinancialRoutesDeps,
) {
  app.get('/api/balance', (_req: Request, res: Response) => {
    res.json({
      balance: db.data?.balance ?? 0,
      earnings: db.data?.earnings ?? 0,
    });
  });

  app.get('/api/pricing', (_req: Request, res: Response) => {
    res.json(adminService.getPricingSettings());
  });

  app.post('/api/print/quote', (req: Request, res: Response) => {
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

    const sessionState = deps.sessionStore.getSessionState(sessionId);
    if (sessionState === 'expired') {
      return res.status(410).json({
        code: 'SESSION_EXPIRED',
        error: 'Session has expired. Please start a new upload session.',
      });
    }
    if (sessionState === 'missing') {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = deps.sessionStore.tryGetSession(
      sessionId,
      deps.resolvePublicBaseUrl(req),
    );
    if (!session) {
      return res.status(410).json({
        code: 'SESSION_EXPIRED',
        error: 'Session has expired. Please start a new upload session.',
      });
    }
    deps.sessionStore.touchSession(sessionId);

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
  });

  app.post('/api/balance/reset', async (_req: Request, res: Response) => {
    const previousBalance = db.data!.balance;
    db.data!.balance = 0;
    await db.write();
    deps.io.emit('balance', 0);
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
  });

  const ACCEPTED_TEST_COINS = new Set([1, 5, 10, 20]);

  // This route is for testing/demo purposes only, allowing insertion of test coins without real payment processing.
  app.post(
    '/api/balance/add-test-coin',
    async (req: Request, res: Response) => {
      const { value } = req.body as { value?: unknown };
      const coinValue =
        typeof value === 'number' && Number.isFinite(value) ? value : null;

      if (coinValue === null || !ACCEPTED_TEST_COINS.has(coinValue)) {
        return res
          .status(400)
          .json({ error: 'Invalid coin value. Accepted: 1, 5, 10, 20' });
      }
      try {
        assertTrustedTimeForFinancialOperation('coin_inserted:test');
      } catch (error) {
        const payload = buildTrustedTimeBlockedResponse(error);
        void adminService.appendAdminLog(
          'trusted_time_unsynced',
          'Test coin rejected because trusted time is unavailable.',
          {
            source: 'test-ui',
            detail: payload.error,
          },
        );
        return res.status(503).json(payload);
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

      deps.io.emit('balance', db.data!.balance);
      deps.io.emit('coinAccepted', {
        value: coinValue,
        balance: db.data!.balance,
      });

      res.json({
        ok: true,
        coinValue,
        balance: db.data!.balance,
      });
    },
  );

  app.post('/upload', deps.uploadSingle, (req: Request, res: Response) => {
    if (!req.file) {
      void adminService.appendAdminLog(
        'upload_failed',
        'Upload failed: no file provided.',
      );
      return res.status(400).json({ error: 'No file uploaded' });
    }

    void adminService.appendAdminLog(
      'upload_completed',
      'Upload completed via /upload.',
      {
        filename: req.file.originalname,
        storedFilename: req.file.filename,
        sizeBytes: req.file.size,
      },
    );
    res.status(200).json({ filename: req.file.filename });
  });

  app.post('/print', async (req: Request, res: Response) => {
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

    deps.io.emit('balance', 0);
    res.sendStatus(200);
  });

  app.post('/api/confirm-payment', async (req: Request, res: Response) => {
    // ── Idempotency guard ──────────────────────────────────────────────
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
      return sendResponse(503, payload);
    }

    const { amount, mode, sessionId, documentId } = req.body as {
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
    };
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
      return sendResponse(400, { error: 'Invalid mode' });
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

    if (mode === 'print') {
      if (!sessionId) {
        void adminService.appendAdminLog(
          'payment_failed',
          'Confirm payment failed: missing print session.',
          { transactionId },
        );
        return sendResponse(400, { error: 'Print session is required' });
      }

      const sessionState = deps.sessionStore.getSessionState(sessionId);
      if (sessionState === 'expired') {
        void adminService.appendAdminLog(
          'payment_failed',
          'Confirm payment failed: session expired.',
          { transactionId, sessionId },
        );
        return sendResponse(410, {
          code: 'SESSION_EXPIRED',
          error: 'Session has expired. Please start a new upload session.',
        });
      }
      if (sessionState === 'missing') {
        void adminService.appendAdminLog(
          'payment_failed',
          'Confirm payment failed: session not found.',
          { transactionId, sessionId },
        );
        return sendResponse(404, { error: 'Session not found' });
      }

      const session = deps.sessionStore.tryGetSession(
        sessionId,
        deps.resolvePublicBaseUrl(req),
      );
      if (!session) {
        void adminService.appendAdminLog(
          'payment_failed',
          'Confirm payment failed: session not found.',
          { transactionId, sessionId },
        );
        return sendResponse(410, {
          code: 'SESSION_EXPIRED',
          error: 'Session has expired. Please start a new upload session.',
        });
      }
      deps.sessionStore.touchSession(sessionId);

      const target = resolveTargetDocument(session, documentId);
      if (!target) {
        void adminService.appendAdminLog(
          'payment_failed',
          documentId
            ? 'Confirm payment failed: target document not found.'
            : 'Confirm payment failed: no uploaded document in session.',
          { transactionId, sessionId, documentId: documentId ?? null },
        );
        return sendResponse(400, {
          error: documentId
            ? `Document "${documentId}" not found in session`
            : 'No uploaded document found for this session',
        });
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
        return sendResponse(409, {
          error:
            'Document analysis is unavailable. Re-upload the file and try again.',
        });
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
        return sendResponse(400, { error: quoteComputation.error });
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

    // ── Pre-check balance ────────────────────────────────────────────────────
    if ((db.data?.balance ?? 0) < requiredAmount) {
      void adminService.appendAdminLog(
        'payment_failed',
        'Confirm payment failed: insufficient balance.',
        { transactionId, balance: db.data?.balance ?? 0, requiredAmount },
      );
      if (idempotencyClaimed)
        releaseIdempotencyKey(idempotencyKey, 'POST:/api/confirm-payment');
      return res.status(400).json({
        error: 'Insufficient balance',
        balance: db.data?.balance ?? 0,
        requiredAmount,
      });
    }

    // ── Printer preflight ────────────────────────────────────────────────────
    const telemetry = getPrinterTelemetry();
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
        if (idempotencyClaimed)
          releaseIdempotencyKey(idempotencyKey, 'POST:/api/confirm-payment');
        return res.status(409).json({
          error: `Printer is not ready: ${telemetry.status}. Please notify the operator.`,
          printerStatus: telemetry.status,
        });
      }

      try {
        jobDispatchedAt = getTrustedTimestamp().timestamp;
        await printFile(serverFilename, printOptions);
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
        return sendResponse(500, { error: 'Print failed. Please try again.' });
      }
    }

    // ── Settlement ───────────────────────────────────────────────────────────
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
      return sendResponse(500, { error: 'Failed to record financial event.' });
    }

    const settlement = await settlementService.settle({
      requiredAmount,
      io: deps.io,
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
      return sendResponse(500, { error: 'Failed to record financial event.' });
    }

    if (mode === 'print' && serverFilename) {
      let cleaned = false;
      if (sessionId && targetDocumentId) {
        const removedDocument = await deps.sessionStore.removeDocument(
          sessionId,
          targetDocumentId,
        );
        if (removedDocument.success && removedDocument.deletedFile) {
          cleaned = true;
          await adminService.appendAdminLog(
            'upload_deleted_after_print',
            'Uploaded file deleted after print payment confirmation.',
            {
              transactionId,
              sessionId,
              documentId: targetDocumentId,
              filename: serverFilename,
              source: 'session-store',
              alreadyMissing: false,
            },
          );
        } else {
          const fallbackCleanup =
            await deleteUploadByStoredFilename(serverFilename);
          if (fallbackCleanup.deleted) {
            cleaned = true;
            await adminService.appendAdminLog(
              'upload_deleted_after_print',
              'Uploaded file deleted after print payment confirmation.',
              {
                transactionId,
                sessionId,
                documentId: targetDocumentId,
                filename: serverFilename,
                source: 'fallback-unlink',
                alreadyMissing: fallbackCleanup.alreadyMissing,
                sessionRemoveErrorCode: removedDocument.errorCode ?? null,
              },
            );
          } else {
            await adminService.appendAdminLog(
              'upload_delete_after_print_failed',
              'Failed to delete uploaded file after print payment confirmation.',
              {
                transactionId,
                sessionId,
                documentId: targetDocumentId,
                filename: serverFilename,
                source: 'confirm-payment',
                sessionRemoveErrorCode: removedDocument.errorCode ?? null,
                sessionDeletedFile: removedDocument.deletedFile,
                error: fallbackCleanup.error ?? 'Unknown error',
              },
            );
          }
        }
      } else {
        const cleanup = await deleteUploadByStoredFilename(serverFilename);
        cleaned = cleanup.deleted;
        if (cleanup.deleted) {
          await adminService.appendAdminLog(
            'upload_deleted_after_print',
            'Uploaded file deleted after print payment confirmation.',
            {
              transactionId,
              sessionId: sessionId ?? null,
              documentId: targetDocumentId ?? null,
              filename: serverFilename,
              source: 'confirm-payment',
              alreadyMissing: cleanup.alreadyMissing,
            },
          );
        } else {
          await adminService.appendAdminLog(
            'upload_delete_after_print_failed',
            'Failed to delete uploaded file after print payment confirmation.',
            {
              transactionId,
              sessionId: sessionId ?? null,
              documentId: targetDocumentId ?? null,
              filename: serverFilename,
              source: 'confirm-payment',
              error: cleanup.error ?? 'Unknown error',
            },
          );
        }
      }

      if (!cleaned) {
        console.error(
          '[CONFIRM-PAYMENT] Uploaded file cleanup failed after successful settlement.',
          {
            transactionId,
            sessionId: sessionId ?? null,
            documentId: targetDocumentId ?? null,
            filename: serverFilename,
          },
        );
      }
    }

    sendResponse(200, {
      ok: true,
      chargedAmount: settlement.chargedAmount,
      balance: settlement.remainingBalance,
      earnings: settlement.earnings,
      change: settlement.change,
    });

    // ── Fire-and-forget: audit logs ──────────────────────────────────────────
    // Capture settlement snapshot in local variables so the async IIFE below
    // closes over stable values and not over mutable route-handler state.
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

    // ── Fire-and-forget: monitor the Windows print spooler for post-settlement failures ──
    // Settlement has already completed and the response is sent. This runs in the
    // background — if the spooler reports the job as failed (Paper Jam, Offline, etc.)
    // a PendingRefundEntry is created so the admin can restore the user's balance.
    if (mode === 'print' && jobDispatchedAt && telemetry.name) {
      void monitorSpoolerJob({
        printerName: telemetry.name,
        chargedAmount: settledAmount,
        jobDispatchedAt,
        spoolerCorrelationKey,
        io: deps.io,
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
      }).catch((err) => {
        console.error(
          '[SPOOLER-MONITOR] monitorSpoolerJob failed:',
          err instanceof Error ? err.message : err,
        );
      });
    }
  });
}
