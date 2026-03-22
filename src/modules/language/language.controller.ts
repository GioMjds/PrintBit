import { Router, Request, Response } from 'express';
import { LanguageService } from './language.service';

export class LanguageController {
  public readonly router: Router;
  public readonly accessibilityRouter: Router;

  constructor(private readonly languageService: LanguageService) {
    this.router = Router();
    this.accessibilityRouter = Router();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    // Routes mounted at /api/language
    this.router.get('/', this.getLanguage);
    this.router.put('/', this.setLanguage);

    // Route mounted at /api/accessibility (for backward compatibility)
    this.accessibilityRouter.put('/', this.setAccessibility);
  }

  private getLanguage = async (_req: Request, res: Response): Promise<void> => {
    try {
      const data = await this.languageService.getLanguageData();
      res.json(data);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load translations.';
      res.status(500).json({ error: message });
    }
  };

  private setLanguage = async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { language?: unknown };
    if (!this.languageService.isSupportedLanguage(body.language)) {
      res.status(400).json({ error: 'language must be one of: en, fil.' });
      return;
    }

    const language = await this.languageService.setLanguage(body.language);
    res.json({ language });
  };

  private setAccessibility = async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { highContrast?: unknown };
    if (typeof body.highContrast !== 'boolean') {
      res.status(400).json({ error: 'highContrast must be a boolean.' });
      return;
    }

    const highContrast = await this.languageService.setHighContrast(body.highContrast);
    res.json({ highContrast });
  };
}
