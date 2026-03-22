import type { Express } from 'express';
import type { ModuleContext } from '../module.types';
import { LanguageService } from './language.service';
import { LanguageController } from './language.controller';

export interface LanguageModuleDeps extends ModuleContext {
  // No additional dependencies required
}

export function registerLanguageModule(
  app: Express,
  _deps: LanguageModuleDeps,
): void {
  const languageService = new LanguageService();
  const languageController = new LanguageController(languageService);

  app.use('/api/language', languageController.router);
  app.use('/api/accessibility', languageController.accessibilityRouter);
}

