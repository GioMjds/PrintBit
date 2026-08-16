import { Router, type RequestHandler } from 'express';
import {
  uploadMiddleware,
  handleMulterError,
  validateMagicBytes,
} from '@/middleware/file-validation';
import { createRateLimit } from '@/middleware/rate-limit';
import { WirelessSessionService } from './wireless-session.service';
import type { SessionMode } from './wireless-session.types';

const wirelessPreviewRateLimit = createRateLimit({
  keyPrefix: 'wireless-session-preview',
  windowMs: 60_000,
  max: 30,
});

const wirelessUploadRateLimit = createRateLimit({
  keyPrefix: 'wireless-session-upload',
  windowMs: 60_000,
  max: 10,
});

export class WirelessSessionController {
  public readonly router: Router;

  constructor(private readonly wirelessSessionService: WirelessSessionService) {
    this.router = Router();
    this.initializeRoutes();
  }

  public sessionTokenAuthGuard: RequestHandler = (req, res, next) => {
    const token = this.wirelessSessionService.extractUploadToken(req);
    if (!token || !this.wirelessSessionService.validateSessionToken(token)) {
      res.status(401).json({ success: false, error: 'UNAUTHORIZED_SESSION' });
      return;
    }
    next();
  };

  public requestPairing: RequestHandler = (req, res) => {
    const clientIp = (req.ip || req.socket.remoteAddress) as string | undefined;
    const result = this.wirelessSessionService.requestPairing(clientIp);
    if ('error' in result) {
      res.status(409).json({ success: false, error: result.error });
      return;
    }
    res.status(200).json({
      success: true,
      pairingId: result.pairingId,
      pin: result.pin,
      expiresIn: result.expiresIn,
    });
  };

  public verifyPairingPin: RequestHandler = (req, res) => {
    const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
    if (!pin) {
      res.status(400).json({ success: false, error: 'INVALID_PIN' });
      return;
    }
    const result = this.wirelessSessionService.verifyPairingPin(pin);
    if (!result.success) {
      res.status(400).json({ success: false, error: result.error ?? 'INVALID_PIN' });
      return;
    }
    res.status(200).json({
      success: true,
      sessionId: result.sessionId,
      sessionToken: result.sessionToken,
    });
  };

  public getPairingStatus: RequestHandler<{ pairingId: string }> = (req, res) => {
    const { pairingId } = req.params;
    const result = this.wirelessSessionService.getPairingStatus(pairingId);
    res.status(200).json(result);
  };

  public setSessionMode: RequestHandler = (req, res) => {
    const mode = req.body?.mode;
    const validModes: SessionMode[] = ['IDLE', 'PRINT', 'COPY', 'SCAN'];
    if (!mode || typeof mode !== 'string' || !validModes.includes(mode as SessionMode)) {
      res.status(400).json({ success: false, error: 'INVALID_MODE' });
      return;
    }
    this.wirelessSessionService.setSessionMode(mode as SessionMode);
    res.status(200).json({ success: true, mode });
  };

  public endActiveSession: RequestHandler = async (req, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'user_ended';
    const result = await this.wirelessSessionService.endActiveSession(reason);
    res.status(200).json({
      success: true,
      dispensedChange: result.dispensedChange,
    });
  };

  private initializeRoutes(): void {
    // Pairing & Session Lifecycle Endpoints
    this.router.get('/pairing/request', this.requestPairing);
    this.router.get('/api/pairing/request', this.requestPairing);

    this.router.post('/pairing/verify', this.verifyPairingPin);
    this.router.post('/api/pairing/verify', this.verifyPairingPin);

    this.router.get('/pairing/status/:pairingId', this.getPairingStatus);
    this.router.get('/api/pairing/status/:pairingId', this.getPairingStatus);

    this.router.post('/session/mode', this.sessionTokenAuthGuard, this.setSessionMode);
    this.router.post('/api/session/mode', this.sessionTokenAuthGuard, this.setSessionMode);

    this.router.post('/session/end', this.endActiveSession);
    this.router.post('/api/session/end', this.endActiveSession);

    // Existing wireless routes
    this.router.get('/wireless/sessions', this.wirelessSessionService.createSession);
    this.router.get('/api/wireless/sessions', this.wirelessSessionService.createSession);
    this.router.get(
      '/wireless/sessions/by-token/:token',
      this.wirelessSessionService.getSessionByToken,
    );
    this.router.get(
      '/api/wireless/sessions/by-token/:token',
      this.wirelessSessionService.getSessionByToken,
    );
    this.router.get(
      '/wireless/sessions/:sessionId/preview',
      wirelessPreviewRateLimit,
      this.wirelessSessionService.getSessionPreview,
    );
    this.router.get(
      '/api/wireless/sessions/:sessionId/preview',
      wirelessPreviewRateLimit,
      this.wirelessSessionService.getSessionPreview,
    );
    this.router.get(
      '/wireless/sessions/:sessionId/color-analysis',
      this.wirelessSessionService.getSessionColorAnalysis,
    );
    this.router.get(
      '/api/wireless/sessions/:sessionId/color-analysis',
      this.wirelessSessionService.getSessionColorAnalysis,
    );
    this.router.get(
      '/wireless/sessions/:sessionId/analysis/:documentId',
      this.wirelessSessionService.getSessionDocumentAnalysis,
    );
    this.router.get(
      '/api/wireless/sessions/:sessionId/analysis/:documentId',
      this.wirelessSessionService.getSessionDocumentAnalysis,
    );
    this.router.get('/wireless/sessions/:sessionId', this.wirelessSessionService.getSessionById);
    this.router.get('/api/wireless/sessions/:sessionId', this.wirelessSessionService.getSessionById);
    this.router.post(
      '/wireless/sessions/:sessionId/upload',
      wirelessUploadRateLimit,
      this.wirelessSessionService.verifyOwnedUploadTarget,
      uploadMiddleware.single('file'),
      validateMagicBytes,
      this.wirelessSessionService.uploadToSession,
    );
    this.router.post(
      '/api/wireless/sessions/:sessionId/upload',
      wirelessUploadRateLimit,
      this.wirelessSessionService.verifyOwnedUploadTarget,
      uploadMiddleware.single('file'),
      validateMagicBytes,
      this.wirelessSessionService.uploadToSession,
    );
    this.router.delete(
      '/wireless/sessions/:sessionId/documents/:documentId',
      this.wirelessSessionService.verifyUploadTarget,
      this.wirelessSessionService.removeSessionDocument,
    );
    this.router.delete(
      '/api/wireless/sessions/:sessionId/documents/:documentId',
      this.wirelessSessionService.verifyUploadTarget,
      this.wirelessSessionService.removeSessionDocument,
    );
    this.router.delete(
      '/wireless/sessions/:sessionId/cancel',
      this.wirelessSessionService.verifyUploadTarget,
      this.wirelessSessionService.cancelSession,
    );
    this.router.delete(
      '/api/wireless/sessions/:sessionId/cancel',
      this.wirelessSessionService.verifyUploadTarget,
      this.wirelessSessionService.cancelSession,
    );
    this.router.post(
      '/wireless/sessions/:sessionId/analyze',
      this.wirelessSessionService.verifyUploadTarget,
      this.wirelessSessionService.analyzeSessionDocument,
    );
    this.router.post(
      '/api/wireless/sessions/:sessionId/analyze',
      this.wirelessSessionService.verifyUploadTarget,
      this.wirelessSessionService.analyzeSessionDocument,
    );
    this.router.post(
      '/analyze-job',
      this.wirelessSessionService.verifyAnalyzeJobTarget,
      this.wirelessSessionService.analyzeJob,
    );
    this.router.post(
      '/api/analyze-job',
      this.wirelessSessionService.verifyAnalyzeJobTarget,
      this.wirelessSessionService.analyzeJob,
    );
    this.router.use('/wireless/sessions/:sessionId/upload', handleMulterError);
    this.router.use('/api/wireless/sessions/:sessionId/upload', handleMulterError);
  }
}
