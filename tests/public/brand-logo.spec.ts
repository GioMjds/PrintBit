import fs from 'node:fs';
import path from 'node:path';

const brandStyleFiles = [
  'src/public/idle-screen.css',
  'src/public/loading/styles.css',
  'src/public/upload/styles.css',
  'src/public/feedback/styles.css',
  'src/public/admin/shared.css',
];

describe('PrintBit brand logo', () => {
  it.each(brandStyleFiles)('%s uses the shared logo asset', (styleFile) => {
    const stylesheet = fs.readFileSync(path.resolve(styleFile), 'utf8');

    expect(stylesheet).toContain('url("/assets/logo.png")');
  });

  it('keeps a decorative logo slot in the upload header', () => {
    const page = fs.readFileSync(
      path.resolve('src/public/upload/index.html'),
      'utf8',
    );

    expect(page).toContain('<div class="brand-mark" aria-hidden="true"></div>');
  });
});
