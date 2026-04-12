import path from 'node:path';
import type { Request, RequestHandler } from 'express';
import type { Server } from 'socket.io';
import { adminService } from '@/services/admin';
import { db, withBalanceLock } from '@/services/db';
import type { DocumentAnalysis, SessionStore } from '@/services/session';
import { generateHtmlPreview, supportsHtmlPreview } from '@/services/preview';
import { detectPdfColorContent } from '@/services/color-detection';
import { analyzeDocument } from '@/services/document-analysis';

export interface WirelessSessionServiceDeps {
  io: Server;
  sessionStore: SessionStore;
  resolvePublicBaseUrl: (req: Request) => URL;
  convertToPdfPreview: (sourcePath: string) => Promise<string>;
}

const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

const PDF_CONVERT_EXTENSIONS = new Set(['.doc', '.docx', '.ppt', '.pptx']);
const POWERPOINT_EXTENSIONS = new Set(['.ppt', '.pptx']);
const BEARER_SCHEME = 'bearer';

function isWhitespaceCharacter(value: string): boolean {
  return value.trim().length === 0;
}

export class WirelessSessionService {
  constructor(private readonly deps: WirelessSessionServiceDeps) {}

  extractUploadToken(req: Request): string {
    const queryToken = req.query.token;
    if (typeof queryToken === 'string' && queryToken.trim().length > 0) {
      return queryToken;
    }

    const headerToken =
      req.header('x-session-token') ?? req.header('x-upload-token');
    if (headerToken && headerToken.trim().length > 0) {
      return headerToken;
    }

    const authorizationHeader = req.header('authorization');
    if (!authorizationHeader) return '';

    if (authorizationHeader.length <= BEARER_SCHEME.length) return '';
    if (
      authorizationHeader.slice(0, BEARER_SCHEME.length).toLowerCase() !==
      BEARER_SCHEME
    ) {
      return '';
    }

    let tokenStartIndex = BEARER_SCHEME.length;
    if (!isWhitespaceCharacter(authorizationHeader[tokenStartIndex])) return '';
    while (
      tokenStartIndex < authorizationHeader.length &&
      isWhitespaceCharacter(authorizationHeader[tokenStartIndex])
    ) {
      tokenStartIndex += 1;
    }

    return authorizationHeader.slice(tokenStartIndex).trim();
  }

  extractUploadClientId(req: Request): string {
    const queryClient = req.query.clientId;
    if (typeof queryClient === 'string' && queryClient.trim().length > 0) {
      return queryClient.trim();
    }

    const headerClientId =
      req.header('x-upload-client-id') ?? req.header('x-session-client-id');
    if (headerClientId && headerClientId.trim().length > 0) {
      return headerClientId.trim();
    }

    return '';
  }

  verifyUploadTarget: RequestHandler<{ sessionId: string }> = (
    req,
    res,
    next,
  ) => {
    const { sessionId } = req.params;
    const token = this.extractUploadToken(req);

    if (!sessionId || !token) {
      res.status(401).json({ error: 'Missing session or token.' });
      return;
    }

    const sessionState = this.deps.sessionStore.getSessionState(sessionId);
    if (sessionState === 'expired') {
      res.status(410).json({
        code: 'SESSION_EXPIRED',
        error: 'Session has expired. Please start a new session.',
      });
      return;
    }
    if (sessionState === 'missing') {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    const publicBaseUrl = this.deps.resolvePublicBaseUrl(req);
    const session = this.deps.sessionStore.tryGetSession(
      sessionId,
      publicBaseUrl,
    );
    if (!session) {
      res.status(410).json({
        code: 'SESSION_EXPIRED',
        error: 'Session has expired. Please start a new session.',
      });
      return;
    }

    if (session.token !== token) {
      res.status(403).json({ error: 'Invalid token for session.' });
      return;
    }

    next();
  };

  verifyOwnedUploadTarget: RequestHandler<{ sessionId: string }> = (
    req,
    res,
    next,
  ) => {
    this.verifyUploadTarget(req, res, () => {
      const { sessionId } = req.params;
      const token = this.extractUploadToken(req);
      const clientId = this.extractUploadClientId(req);
      if (!clientId) {
        res.status(400).json({
          code: 'INVALID_CLIENT_ID',
          error: 'Invalid upload client identifier.',
        });
        return;
      }

      const claim = this.deps.sessionStore.claimOwner(
        sessionId,
        token,
        clientId,
      );
      if (!claim.ok && claim.errorCode) {
        res.status(this.statusForClaimError(claim.errorCode)).json({
          code: claim.errorCode,
          error: claim.errorMsg ?? 'Unable to validate session ownership.',
        });
        return;
      }

      next();
    });
  };

  createSession: RequestHandler = async (req, res) => {
    try {
      const previousBalance = await withBalanceLock(async () => {
        const currentBalance = db.data?.balance ?? 0;
        if (currentBalance <= 0) return 0;
        db.data!.balance = 0;
        await db.write();
        return currentBalance;
      });

      this.deps.io.emit('balance', 0);

      const publicBaseUrl = this.deps.resolvePublicBaseUrl(req);
      const session = this.deps.sessionStore.createSession(publicBaseUrl);
      void adminService.appendAdminLog(
        'session_created',
        'Wireless upload session created.',
        {
          sessionId: session.sessionId,
          previousBalance,
          newBalance: 0,
          balanceReset: previousBalance > 0,
        },
      );
      res.status(201).json(session);
    } catch (error) {
      console.error('[wireless-session] Failed to create session.', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        error: 'Failed to create wireless session.',
      });
    }
  };

  getSessionByToken: RequestHandler<{ token: string }> = (req, res) => {
    const { token } = req.params;
    const clientId = this.extractUploadClientId(req);
    if (!clientId) {
      res.status(400).json({
        code: 'MISSING_CLIENT_ID',
        error: 'Missing upload client identifier.',
      });
      return;
    }

    const tokenState = this.deps.sessionStore.getTokenState(token);
    if (tokenState === 'expired') {
      res.status(410).json({
        code: 'SESSION_EXPIRED',
        error: 'Session has expired. Please start a new session.',
      });
      return;
    }
    if (tokenState === 'missing') {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    const claim = this.deps.sessionStore.claimOwnerByToken(token, clientId);
    if (!claim.ok && claim.errorCode) {
      res.status(this.statusForClaimError(claim.errorCode)).json({
        code: claim.errorCode,
        error: claim.errorMsg ?? 'Unable to validate session ownership.',
      });
      return;
    }

    const publicBaseUrl = this.deps.resolvePublicBaseUrl(req);
    const session = this.deps.sessionStore.tryGetSessionByToken(
      token,
      publicBaseUrl,
    );

    if (!session) {
      res.status(410).json({
        code: 'SESSION_EXPIRED',
        error: 'Session has expired. Please start a new session.',
      });
      return;
    }

    res.json(session);
  };

  getSessionPreview: RequestHandler<{ sessionId: string }> = async (
    req,
    res,
  ) => {
    const { sessionId } = req.params;
    const publicBaseUrl = this.deps.resolvePublicBaseUrl(req);
    const session = this.deps.sessionStore.tryGetSession(
      sessionId,
      publicBaseUrl,
    );

    const requestedFilename = req.query.filename as string;
    const allDocs =
      session?.documents && session.documents.length > 0
        ? session.documents
        : session?.document
          ? [session.document]
          : [];

    const target = requestedFilename
      ? allDocs.find((doc) => doc.filename === requestedFilename)
      : (session?.document ?? allDocs[0]);

    if (!target) {
      if (requestedFilename) {
        res.status(404).json({ error: 'Document not found.' });
      } else {
        res.status(404).json({ error: 'No documents available for preview.' });
      }
      return;
    }

    if (!this.deps.sessionStore.touchSession(sessionId)) {
      res.status(410).json({
        code: 'SESSION_EXPIRED',
        error: 'Session has expired. Please start a new session.',
      });
      return;
    }

    const absolutePath = path.resolve(target.filePath);
    const extension = path.extname(absolutePath).toLowerCase();
    const startedAt = Date.now();
    console.log('[preview] request', {
      sessionId,
      filename: target.filename,
      extension,
    });

    try {
      if (extension === '.pdf') {
        res.setHeader('Content-Type', 'application/pdf');
        console.log('[preview] serving pdf file', {
          path: absolutePath,
          tookMs: Date.now() - startedAt,
        });
        res.sendFile(absolutePath);
        return;
      }

      if (IMAGE_TYPES[extension]) {
        res.setHeader('Content-Type', IMAGE_TYPES[extension]);
        console.log('[preview] serving image file', {
          path: absolutePath,
          contentType: IMAGE_TYPES[extension],
          tookMs: Date.now() - startedAt,
        });
        res.sendFile(absolutePath);
        return;
      }

      if (supportsHtmlPreview(extension)) {
        const html = await generateHtmlPreview(absolutePath);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        console.log('[preview] serving html preview', {
          extension,
          htmlChars: html.length,
          tookMs: Date.now() - startedAt,
        });
        res.send(html);
        return;
      }

      if (PDF_CONVERT_EXTENSIONS.has(extension)) {
        const pdfPreviewPath =
          await this.deps.convertToPdfPreview(absolutePath);
        res.setHeader('Content-Type', 'application/pdf');
        console.log('[preview] serving converted pdf', {
          sourcePath: absolutePath,
          convertedPath: pdfPreviewPath,
          tookMs: Date.now() - startedAt,
        });
        res.sendFile(pdfPreviewPath);
        return;
      }

      console.warn('[preview] unsupported extension', {
        extension,
        filename: target.filename,
        tookMs: Date.now() - startedAt,
      });
      res.status(400).json({
        error: `Preview not supported for ${extension}.`,
        code: 'UNSUPPORTED_PREVIEW',
      });
    } catch (error) {
      console.error('[preview] route error:', error);
      const reason =
        error instanceof Error ? error.message : 'Unknown preview error';
      res.status(500).json({
        error:
          'Preview conversion failed. Ensure Microsoft Word or LibreOffice is installed and available.',
        reason,
        code: 'PREVIEW_CONVERSION_FAILED',
      });
    }
  };

  getSessionColorAnalysis: RequestHandler<{ sessionId: string }> = async (
    req,
    res,
  ) => {
    const { sessionId } = req.params;
    const publicBaseUrl = this.deps.resolvePublicBaseUrl(req);
    const session = this.deps.sessionStore.tryGetSession(
      sessionId,
      publicBaseUrl,
    );

    if (!session) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    const requestedFilename = req.query.filename as string | undefined;
    const allDocs =
      session.documents && session.documents.length > 0
        ? session.documents
        : session.document
          ? [session.document]
          : [];

    const target = requestedFilename
      ? allDocs.find((doc) => doc.filename === requestedFilename)
      : (session.document ?? allDocs[0]);

    if (!target) {
      res.json({
        hasColor: true,
        isGrayscale: false,
        sampledPages: 0,
      });
      return;
    }

    if (!this.deps.sessionStore.touchSession(sessionId)) {
      res.status(410).json({
        code: 'SESSION_EXPIRED',
        error: 'Session has expired. Please start a new session.',
      });
      return;
    }

    const absolutePath = path.resolve(target.filePath);
    const extension = path.extname(absolutePath).toLowerCase();

    try {
      let pdfPath: string;

      if (extension === '.pdf') {
        pdfPath = absolutePath;
      } else if (['.doc', '.docx', '.ppt', '.pptx'].includes(extension)) {
        pdfPath = await this.deps.convertToPdfPreview(absolutePath);
      } else {
        res.json({
          hasColor: true,
          isGrayscale: false,
          sampledPages: 0,
        });
        return;
      }

      const result = await detectPdfColorContent(pdfPath);
      res.json({
        hasColor: result.hasColor,
        isGrayscale: result.isGrayscale,
        sampledPages: result.sampledPages,
      });
    } catch (err) {
      console.warn(
        '[color-analysis] Detection failed, defaulting to color:',
        err,
      );
      res.json({
        hasColor: true,
        isGrayscale: false,
        sampledPages: 0,
      });
    }
  };

  getSessionById: RequestHandler<{ sessionId: string }> = (req, res) => {
    const { sessionId } = req.params;
    const sessionState = this.deps.sessionStore.getSessionState(sessionId);
    if (sessionState === 'expired') {
      res.status(410).json({
        code: 'SESSION_EXPIRED',
        error: 'Session has expired. Please start a new session.',
      });
      return;
    }
    if (sessionState === 'missing') {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    const publicBaseUrl = this.deps.resolvePublicBaseUrl(req);
    const session = this.deps.sessionStore.tryGetSession(
      sessionId,
      publicBaseUrl,
    );
    if (!session) {
      res.status(410).json({
        code: 'SESSION_EXPIRED',
        error: 'Session has expired. Please start a new session.',
      });
      return;
    }

    // Keep kiosk sessions alive while the print page is actively polling this
    // endpoint. Without this, active kiosk flows can expire even when users
    // are still interacting with the same session.
    if (!this.deps.sessionStore.touchSession(sessionId)) {
      res.status(410).json({
        code: 'SESSION_EXPIRED',
        error: 'Session has expired. Please start a new session.',
      });
      return;
    }

    res.json(session);
  };

  uploadToSession: RequestHandler<{ sessionId: string }> = async (req, res) => {
    const { sessionId } = req.params;
    const token = this.extractUploadToken(req);
    const file = req.file;

    if (!file) {
      void adminService.appendAdminLog(
        'upload_failed',
        'Wireless upload failed: no file provided.',
        {
          sessionId,
        },
      );
      res.status(400).json({ code: 'no_file', error: 'No file provided.' });
      return;
    }

    this.deps.io
      .to(`session:${sessionId}`)
      .emit('UploadStarted', file.originalname);
    void adminService.appendAdminLog(
      'upload_started',
      'Wireless upload started.',
      {
        sessionId,
        filename: file.originalname,
        sizeBytes: file.size,
      },
    );

    const result = await this.deps.sessionStore.storeUpload(
      sessionId,
      token,
      file,
    );
    if (!result.isSuccess || !result.document) {
      this.deps.io.to(`session:${sessionId}`).emit('UploadFailed');
      await adminService.appendAdminLog(
        'upload_failed',
        'Wireless upload failed.',
        {
          sessionId,
          filename: file.originalname,
          errorCode: result.errorCode ?? null,
        },
      );
      res.status(400).json({
        code: result.errorCode ?? 'UPLOAD_FAILED',
        error: result.errorMsg ?? 'Upload failed.',
      });
      return;
    }

    const doc = result.document;
    this.deps.io.to(`session:${sessionId}`).emit('UploadCompleted', doc);
    await adminService.appendAdminLog(
      'upload_completed',
      'Wireless upload completed.',
      {
        sessionId,
        filename: doc.filename,
        documentId: doc.documentId,
        sizeBytes: doc.sizeBytes,
      },
    );

    res.status(200).json({
      documentId: doc.documentId,
      sessionId: doc.sessionId,
      fileName: doc.filename,
      contentType: doc.contentType,
      sizeBytes: doc.sizeBytes,
      uploadedAt: doc.uploadedAt,
    });

    this.deps.io.to(`session:${sessionId}`).emit('AnalysisStarted', {
      documentId: doc.documentId,
      filename: doc.filename,
    });

    try {
      const analyzed = await this.analyzeAndStoreDocument(
        req,
        sessionId,
        doc.documentId,
      );
      if ('analysis' in analyzed) {
        this.deps.io.to(`session:${sessionId}`).emit('AnalysisCompleted', {
          documentId: doc.documentId,
          filename: doc.filename,
          analysis: analyzed.analysis,
        });
      } else {
        this.deps.io.to(`session:${sessionId}`).emit('AnalysisFailed', {
          documentId: doc.documentId,
          filename: doc.filename,
          error: analyzed.error,
        });
        console.warn(
          `[analyze-document] Analysis failed for ${doc.filename}:`,
          analyzed.error,
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error';
      this.deps.io.to(`session:${sessionId}`).emit('AnalysisFailed', {
        documentId: doc.documentId,
        filename: doc.filename,
        error: reason,
      });
      console.warn(
        '[analyze-document] Failed to analyze uploaded file:',
        error,
      );
    }
  };

  removeSessionDocument: RequestHandler<{
    sessionId: string;
    documentId: string;
  }> = async (req, res) => {
    const { sessionId, documentId } = req.params;
    const result = await this.deps.sessionStore.removeDocument(
      sessionId,
      documentId,
    );
    if (!result.success) {
      const status =
        result.errorCode === 'DOCUMENT_NOT_FOUND'
          ? 404
          : result.errorCode === 'SESSION_EXPIRED'
            ? 410
            : 404;

      await adminService.appendAdminLog(
        'upload_delete_failed',
        'Failed to delete uploaded document from session.',
        {
          sessionId,
          documentId,
          errorCode: result.errorCode ?? null,
        },
      );
      res.status(status).json({
        error:
          result.errorCode === 'DOCUMENT_NOT_FOUND'
            ? 'Document not found in session.'
            : result.errorCode === 'SESSION_EXPIRED'
              ? 'Session has expired.'
              : 'Session not found.',
      });
      return;
    }

    this.deps.io.to(`session:${sessionId}`).emit('UploadRemoved', {
      documentId: result.removedDocumentId,
      remainingCount: result.remainingCount,
    });

    await adminService.appendAdminLog(
      'upload_deleted',
      'Uploaded document removed from active wireless session.',
      {
        sessionId,
        documentId: result.removedDocumentId ?? documentId,
        remainingCount: result.remainingCount,
        deletedFile: result.deletedFile,
      },
    );

    res.status(200).json({
      success: true,
      removedDocumentId: result.removedDocumentId,
      remainingCount: result.remainingCount,
      deletedFile: result.deletedFile,
    });
  };

  cancelSession: RequestHandler<{ sessionId: string }> = async (req, res) => {
    const { sessionId } = req.params;
    const result = await this.deps.sessionStore.cancelSession(sessionId);
    if (!result.success) {
      await adminService.appendAdminLog(
        'session_cancel_failed',
        'Failed to cancel session: session not found or already expired.',
        {
          sessionId,
        },
      );
      res.status(404).json({
        error: 'Session not found or already expired.',
        sessionId,
      });
      return;
    }

    await adminService.appendAdminLog(
      'session_abandoned',
      'User session abandoned and cleaned up.',
      {
        sessionId,
        deletedFileCount: result.deletedFileCount,
        reason: 'idle_timeout',
      },
    );

    res.status(200).json({
      success: true,
      message: 'Session cancelled and cleaned up.',
      deletedFileCount: result.deletedFileCount,
    });
  };

  analyzeSessionDocument: RequestHandler<{ sessionId: string }> = async (
    req,
    res,
  ) => {
    const { sessionId } = req.params;
    const { documentId } = (req.body ?? {}) as { documentId?: string };

    try {
      const analyzed = await this.analyzeAndStoreDocument(
        req,
        sessionId,
        documentId,
      );
      if (!('analysis' in analyzed)) {
        res.status(analyzed.status).json({ error: analyzed.error });
        return;
      }

      res.status(200).json({
        documentId: analyzed.documentId,
        fileName: analyzed.fileName,
        ...analyzed.analysis,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: 'Document analysis failed.', reason });
    }
  };

  private statusForClaimError(
    code:
      | 'SESSION_NOT_FOUND'
      | 'SESSION_EXPIRED'
      | 'INVALID_TOKEN'
      | 'INVALID_CLIENT_ID'
      | 'SESSION_OWNED',
  ): number {
    if (code === 'SESSION_EXPIRED') return 410;
    if (code === 'SESSION_OWNED') return 409;
    if (code === 'INVALID_TOKEN') return 403;
    if (code === 'INVALID_CLIENT_ID') return 400;
    return 404;
  }

  private async analyzeAndStoreDocument(
    req: Request,
    sessionId: string,
    documentId?: string,
  ): Promise<
    | { error: string; status: 404 | 422 | 500 }
    | {
        status: 200;
        analysis: DocumentAnalysis;
        documentId: string;
        fileName: string;
      }
  > {
    const publicBaseUrl = this.deps.resolvePublicBaseUrl(req);
    const session = this.deps.sessionStore.tryGetSession(
      sessionId,
      publicBaseUrl,
    );
    if (!session) {
      return { error: 'Session not found.', status: 404 };
    }

    const docs =
      session.documents && session.documents.length > 0
        ? session.documents
        : session.document
          ? [session.document]
          : [];

    const fallbackDocumentId = session.document?.documentId;
    const targetDocumentId = documentId ?? fallbackDocumentId;
    const target = targetDocumentId
      ? (docs.find((doc) => doc.documentId === targetDocumentId) ?? null)
      : (docs[docs.length - 1] ?? null);

    if (!target) {
      return { error: 'Document not found.', status: 404 };
    }

    const targetExtension = path.extname(target.filename).toLowerCase();
    let analysisFilePath = target.filePath;
    let analysisContentType = target.contentType;
    let analysisFilename = target.filename;

    if (
      PDF_CONVERT_EXTENSIONS.has(targetExtension) &&
      POWERPOINT_EXTENSIONS.has(targetExtension)
    ) {
      try {
        analysisFilePath = await this.deps.convertToPdfPreview(
          path.resolve(target.filePath),
        );
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : 'Unknown conversion error';
        return {
          error: `PowerPoint conversion failed before analysis: ${reason}`,
          status: 422,
        };
      }

      analysisContentType = 'application/pdf';
      analysisFilename = `${path.basename(target.filename, targetExtension)}.pdf`;
    }

    const analysis = await analyzeDocument({
      filePath: analysisFilePath,
      contentType: analysisContentType,
      filename: analysisFilename,
      convertToPdfPreview: this.deps.convertToPdfPreview,
    });

    const persisted = this.deps.sessionStore.setDocumentAnalysis(
      sessionId,
      target.documentId,
      analysis,
    );

    if (!persisted) {
      return {
        error: 'Failed to persist document analysis.',
        status: 500,
      };
    }

    return {
      status: 200,
      analysis: persisted,
      documentId: target.documentId,
      fileName: target.filename,
    };
  }
}
