import path from 'node:path';
import fs from 'node:fs/promises';
import { db, type SupportedLanguage } from '@/services/db';

const SUPPORTED_LANGUAGES = ['en', 'fil'] as const;

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  fil: 'Filipino',
};

export interface SupportedLanguageRecord {
  code: SupportedLanguage;
  label: string;
}

export interface LanguageData {
  language: SupportedLanguage;
  languages: SupportedLanguageRecord[];
  highContrast: boolean;
  translations: Record<string, string>;
}

export class LanguageService {
  isSupportedLanguage(value: unknown): value is SupportedLanguage {
    return value === 'en' || value === 'fil';
  }

  async readTranslations(
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

  getSupportedLanguages(): SupportedLanguageRecord[] {
    return SUPPORTED_LANGUAGES.map((code) => ({
      code,
      label: LANGUAGE_LABELS[code],
    }));
  }

  getActiveLanguage(): SupportedLanguage {
    return db.data!.settings.kioskPreferences.language;
  }

  getHighContrast(): boolean {
    return db.data!.settings.kioskPreferences.highContrast;
  }

  async getLanguageData(): Promise<LanguageData> {
    const activeLanguage = this.getActiveLanguage();
    const translations = await this.readTranslations(activeLanguage);
    return {
      language: activeLanguage,
      languages: this.getSupportedLanguages(),
      highContrast: this.getHighContrast(),
      translations,
    };
  }

  async setLanguage(language: SupportedLanguage): Promise<SupportedLanguage> {
    db.data!.settings.kioskPreferences.language = language;
    await db.write();
    return db.data!.settings.kioskPreferences.language;
  }

  async setHighContrast(highContrast: boolean): Promise<boolean> {
    db.data!.settings.kioskPreferences.highContrast = highContrast;
    await db.write();
    return db.data!.settings.kioskPreferences.highContrast;
  }
}
