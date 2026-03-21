import type { Express, Response, Request } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { db, type SupportedLanguage } from '@/services/db';

const SUPPORTED_LANGUAGES = ['en', 'fil'] as const;
type SupportedLanguageRecord = {
  code: SupportedLanguage;
  label: string;
};

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  fil: 'Filipino',
};

function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return value === 'en' || value === 'fil';
}

async function readTranslations(
  language: SupportedLanguage,
): Promise<Record<string, string>> {
  const filePath = path.resolve('src', 'locales', language, 'translation.json');
  const content = await fs.readFile(filePath, 'utf-8');
  const parsed = JSON.parse(content) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid translation file for language "${language}".`);
  }
  return parsed as Record<string, string>;
}

export function registerLanguageRoutes(app: Express) {
  app.get('/api/language', async (_req: Request, res: Response) => {
    const activeLanguage = db.data!.settings.kioskPreferences.language;
    const languages: SupportedLanguageRecord[] = SUPPORTED_LANGUAGES.map(
      (code) => ({
        code,
        label: LANGUAGE_LABELS[code],
      }),
    );

    try {
      const translations = await readTranslations(activeLanguage);
      return res.json({
        language: activeLanguage,
        languages,
        highContrast: db.data!.settings.kioskPreferences.highContrast,
        translations,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load translations.';
      return res.status(500).json({ error: message });
    }
  });

  app.put('/api/language', async (req: Request, res: Response) => {
    const body = req.body as { language?: unknown };
    if (!isSupportedLanguage(body.language)) {
      return res
        .status(400)
        .json({ error: 'language must be one of: en, fil.' });
    }

    db.data!.settings.kioskPreferences.language = body.language;
    await db.write();
    return res.json({ language: db.data!.settings.kioskPreferences.language });
  });

  app.put('/api/accessibility', async (req: Request, res: Response) => {
    const body = req.body as { highContrast?: unknown };
    if (typeof body.highContrast !== 'boolean') {
      return res.status(400).json({ error: 'highContrast must be a boolean.' });
    }

    db.data!.settings.kioskPreferences.highContrast = body.highContrast;
    await db.write();
    return res.json({
      highContrast: db.data!.settings.kioskPreferences.highContrast,
    });
  });
}
