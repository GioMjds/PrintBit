import { Router } from 'express';
import {
  uploadMiddleware,
  handleMulterError,
  validateMagicBytes,
} from '@/middleware/file-validation';
import { createRateLimit } from '@/middleware/rate-limit';
import { WirelessSessionService } from './wireless-session.service';

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

  private initializeRoutes(): void {
    this.router.get('/api/wireless/sessions', this.wirelessSessionService.createSession);
    this.router.get(
      '/api/wireless/sessions/by-token/:token',
      this.wirelessSessionService.getSessionByToken,
    );
    this.router.get(
      '/api/wireless/sessions/:sessionId/preview',
      wirelessPreviewRateLimit,
      this.wirelessSessionService.getSessionPreview,
    );
    this.router.get(
      '/api/wireless/sessions/:sessionId/color-analysis',
      this.wirelessSessionService.getSessionColorAnalysis,
    );
    this.router.get('/api/wireless/sessions/:sessionId', this.wirelessSessionService.getSessionById);
    this.router.post(
      '/api/wireless/sessions/:sessionId/upload',
      wirelessUploadRateLimit,
      this.wirelessSessionService.verifyOwnedUploadTarget,
      uploadMiddleware.single('file'),
      validateMagicBytes,
      this.wirelessSessionService.uploadToSession,
    );
    this.router.delete(
      '/api/wireless/sessions/:sessionId/documents/:documentId',
      this.wirelessSessionService.verifyUploadTarget,
      this.wirelessSessionService.removeSessionDocument,
    );
    this.router.delete(
      '/api/wireless/sessions/:sessionId/cancel',
      this.wirelessSessionService.verifyUploadTarget,
      this.wirelessSessionService.cancelSession,
    );
    this.router.post(
      '/api/wireless/sessions/:sessionId/analyze',
      this.wirelessSessionService.verifyUploadTarget,
      this.wirelessSessionService.analyzeSessionDocument,
    );
    this.router.use('/api/wireless/sessions/:sessionId/upload', handleMulterError);
  }
}
