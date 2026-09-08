import fs from 'node:fs';
import path from 'node:path';

describe('Document care modal visibility', () => {
  for (const page of ['copy', 'scan']) {
    it(`${page} opens its document-care modal with the CSS display class`, () => {
      const app = fs.readFileSync(
        path.resolve(__dirname, `../../src/public/${page}/app.ts`),
        'utf-8',
      );
      const styles = fs.readFileSync(
        path.resolve(__dirname, `../../src/public/${page}/styles.css`),
        'utf-8',
      );

      expect(app).toMatch(/documentCareModal\?\.classList\.add\('is-open'\)/);
      expect(app).toMatch(/documentCareModal\?\.classList\.remove\('is-open'\)/);
      expect(styles).toMatch(/\.document-care-modal\.is-open\s*\{\s*display:\s*grid;/);
    });
  }
});
