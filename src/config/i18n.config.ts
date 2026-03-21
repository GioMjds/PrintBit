import path from 'path';
import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import middleware from 'i18next-http-middleware';

i18next
  .use(Backend)
  .use(middleware.LanguageDetector)
  .init({
    backend: {},
    detection: {},
    fallbackLng: 'en',
    preload: ['en', 'tl'],
    ns: ['translation'],
    defaultNS: 'translation',
  });

export default i18next;
