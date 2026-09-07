import express from 'express';
import type { Express } from 'express';
import path from 'node:path';

export function registerStaticAssets(app: Express) {
  app.use(
    '/assets',
    express.static(path.resolve('src', 'assets')),
  );
  app.use(
    '/assets',
    express.static(path.resolve('dist', 'assets')),
  );
  app.use(
    '/fonts',
    express.static(path.resolve('src', 'fonts'), {
      maxAge: '365d',
      immutable: true,
    }),
  );
  app.use(
    '/libs/pdfjs',
    express.static(
      path.resolve('node_modules', 'pdfjs-dist', 'build'),
      {
        maxAge: '7d',
        setHeaders(res, filePath) {
          if (filePath.endsWith('.mjs')) {
            res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          }
        },
      },
    ),
  );
  // Dedicated PWA route headers for service worker and manifest
  app.get('/admin/sw.js', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Service-Worker-Allowed', '/admin/');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    next();
  });

  app.get('/admin/manifest.webmanifest', (_req, res, next) => {
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    next();
  });

  app.use(express.static(path.resolve('src', 'public')));
  app.use(express.static(path.resolve('dist', 'public')));
}
