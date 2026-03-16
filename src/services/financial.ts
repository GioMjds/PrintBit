import type { Request } from 'express';
import type { SessionStore, UploadedDocument } from './session';
import { buildPrintQuote, type PrintQuoteResult } from './print-quote';
import { moneyRepository } from '@/state/repositories';

const ACCEPTED_TEST_COINS = new Set([1, 5, 10, 20]);

interface BuildPrintQuoteFromSessionInput {
  req: Request;
  sessionStore: SessionStore;
  resolvePublicBaseUrl: (req: Request) => URL;
  sessionId?: string;
  documentId?: string;
  copies?: number;
  colorMode?: unknown;
  pageRange?: unknown;
  duplex?: unknown;
}

type BuildPrintQuoteFromSessionResult =
  | {
      ok: true;
      data: {
        sessionId: string;
        documentId: string;
        filename: string;
        quote: PrintQuoteResult;
      };
    }
  | { ok: false; status: number; body: { error: string; code?: string } };

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

class FinancialService {
  getBalanceSummary(): { balance: number; earnings: number } {
    return {
      balance: moneyRepository.getBalance(),
      earnings: moneyRepository.getEarnings(),
    };
  }

  async resetBalance(): Promise<{
    previousBalance: number;
    balance: number;
    earnings: number;
  }> {
    const { previousBalance, balance } = await moneyRepository.resetBalance();
    return {
      previousBalance,
      balance,
      earnings: moneyRepository.getEarnings(),
    };
  }

  isAcceptedTestCoin(value: number): boolean {
    return ACCEPTED_TEST_COINS.has(value);
  }

  async addTestCoin(value: number): Promise<number> {
    return moneyRepository.incrementBalance(value);
  }

  buildPrintQuoteFromSession(
    input: BuildPrintQuoteFromSessionInput,
  ): BuildPrintQuoteFromSessionResult {
    const {
      req,
      sessionStore,
      resolvePublicBaseUrl,
      sessionId,
      documentId,
      copies,
      colorMode,
      pageRange,
      duplex,
    } = input;

    if (!sessionId) {
      return {
        ok: false,
        status: 400,
        body: { error: 'Print session is required' },
      };
    }

    const sessionState = sessionStore.getSessionState(sessionId);
    if (sessionState === 'expired') {
      return {
        ok: false,
        status: 410,
        body: {
          code: 'SESSION_EXPIRED',
          error: 'Session has expired. Please start a new upload session.',
        },
      };
    }
    if (sessionState === 'missing') {
      return { ok: false, status: 404, body: { error: 'Session not found' } };
    }

    const session = sessionStore.tryGetSession(
      sessionId,
      resolvePublicBaseUrl(req),
    );
    if (!session) {
      return {
        ok: false,
        status: 410,
        body: {
          code: 'SESSION_EXPIRED',
          error: 'Session has expired. Please start a new upload session.',
        },
      };
    }
    sessionStore.touchSession(sessionId);

    const target = resolveTargetDocument(session, documentId);
    if (!target) {
      return {
        ok: false,
        status: 400,
        body: {
          error: documentId
            ? `Document "${documentId}" not found in session`
            : 'No uploaded document found for this session',
        },
      };
    }

    if (!target.analysis) {
      return {
        ok: false,
        status: 409,
        body: {
          error:
            'Document analysis is unavailable. Re-upload the file and try again.',
        },
      };
    }

    const safeCopies =
      typeof copies === 'number' && Number.isFinite(copies)
        ? Math.max(1, Math.floor(copies))
        : 1;
    const requestedColorMode =
      colorMode === 'colored' || colorMode === 'grayscale'
        ? colorMode
        : 'grayscale';

    const quoteComputation = buildPrintQuote({
      analysis: target.analysis,
      copies: safeCopies,
      colorMode: requestedColorMode,
      pageRange,
      duplex: duplex === true,
    });
    if (!quoteComputation.ok) {
      return {
        ok: false,
        status: 400,
        body: { error: quoteComputation.error },
      };
    }

    return {
      ok: true,
      data: {
        sessionId,
        documentId: target.documentId,
        filename: target.filename,
        quote: quoteComputation.quote,
      },
    };
  }
}

export const financialService = new FinancialService();
