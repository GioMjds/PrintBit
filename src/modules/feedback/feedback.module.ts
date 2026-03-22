import type { Express, Request } from 'express';
import type { ModuleContext } from '../module.types';
import { FeedbackService } from './feedback.service';
import { FeedbackController } from './feedback.controller';

export interface FeedbackModuleDeps extends ModuleContext {
  resolvePublicBaseUrl: (req: Request) => URL;
}

export function registerFeedbackModule(
  app: Express,
  deps: FeedbackModuleDeps,
): void {
  const feedbackService = new FeedbackService();
  const feedbackController = new FeedbackController(feedbackService, {
    resolvePublicBaseUrl: deps.resolvePublicBaseUrl,
  });

  // Mount API routes at /api/feedback
  app.use('/api/feedback', feedbackController.router);

  // Mount portal routes at /feedback
  app.use('/feedback', feedbackController.portalRouter);

  // Mount admin routes at /api/admin/feedback
  app.use('/api/admin/feedback', feedbackController.createAdminRouter());
}

