/**
 * Reproduces the bug:
 *  - The /loading page is served from src/public/loading/index.html
 *  - The HTML references styles.css and app.js via relative URLs
 *  - When the browser is at /loading, it requests /loading/styles.css and /loading/app.js
 *  - The /loading route in server.ts only serves index.html; the static middleware
 *    should serve the assets, but in production builds (dist/server.js) only dist/public
 *    is served — src/public is not bundled.
 *  - Even in dev, an explicit confirmation is needed.
 */
import express from 'express';
import path from 'node:path';
// @ts-expect-error supertest is an optional dev package
import request from 'supertest';

describe('Loading page asset serving', () => {
  const app = express();
  // Mimic the server.ts behavior for /loading
  app.get('/loading', (_req, res) => {
    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate',
    );
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.resolve('src/public/loading/index.html'));
  });
  // Mimic the static-assets middleware
  app.use(express.static(path.resolve('src/public')));

  it('should serve the loading index.html', async () => {
    const res = await request(app).get('/loading');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Starting PrintBit');
  });

  it('should serve /loading/styles.css', async () => {
    const res = await request(app).get('/loading/styles.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/css/);
  });

  it('should serve /loading/app.js', async () => {
    const res = await request(app).get('/loading/app.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
  });
});
