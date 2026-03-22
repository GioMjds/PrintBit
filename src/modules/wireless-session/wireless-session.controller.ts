import { Router } from 'express';
import {
  uploadMiddleware,
  handleMulterError,
  validateMagicBytes,
  scanForMalware,
} from '@/middleware/file-validation';
import { WirelessSessionService } from './wireless-session.service';

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
      this.wirelessSessionService.getSessionPreview,
    );
    this.router.get(
      '/api/wireless/sessions/:sessionId/color-analysis',
      this.wirelessSessionService.getSessionColorAnalysis,
    );
    this.router.get('/api/wireless/sessions/:sessionId', this.wirelessSessionService.getSessionById);
    this.router.post(
      '/api/wireless/sessions/:sessionId/upload',
      this.wirelessSessionService.verifyOwnedUploadTarget,
      uploadMiddleware.single('file'),
      validateMagicBytes,
      scanForMalware,
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
