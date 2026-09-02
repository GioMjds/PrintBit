import fs from 'node:fs';
import path from 'node:path';

const page = fs.readFileSync(
  path.resolve('src/public/config/index.html'),
  'utf8',
);

test('keeps the full price list in the header and pins the live price in the settings pane', () => {
  expect(page).toContain('class="topbar-spacer topbar-actions"');
  expect(page).toContain('id="openPricingBtn"');
  expect(page).toContain('class="config-pane-footer"');
  expect(page).toContain('id="footerTotal"');
  expect(page).toContain('id="footerSelections"');
  expect(page).toContain('id="footerBreakdown"');
  expect(page).toContain('class="config-continue-btn"');
  expect(page).not.toContain('class="sticky-footer"');
  expect(page).not.toContain('class="pricing-summary"');
});

test('keeps preview navigation and zoom controls in the toolbar, outside the paper', () => {
  const paperStart = page.indexOf('<div class="paper-sheet"');
  const paperEnd = page.indexOf('<!-- /.paper-sheet -->', paperStart);
  const paper = page.slice(paperStart, paperEnd);
  const toolbarStart = page.indexOf('<div class="preview-toolbar">');
  const toolbarEnd = page.indexOf('</section>', toolbarStart);
  const toolbar = page.slice(toolbarStart, toolbarEnd);

  expect(page).toContain('class="preview-toolbar"');
  expect(page).toContain('id="pagePrev"');
  expect(page).toContain('id="zoomOut"');
  expect(paper).not.toContain('id="pagePrev"');
  expect(paper).not.toContain('id="zoomOut"');
  expect(toolbar.indexOf('id="pagePrev"')).toBeLessThan(toolbar.indexOf('id="zoomOut"'));
});

test('elevates the lower-right preview toolbar and stacks navigation above zoom', () => {
  const styles = fs.readFileSync(
    path.resolve('src/public/config/styles.css'),
    'utf8',
  );

  expect(styles).toMatch(/\.preview-toolbar\s*\{[\s\S]*?position:\s*absolute;/);
  expect(styles).toMatch(/\.preview-toolbar\s*\{[\s\S]*?right:\s*20px;/);
  expect(styles).toMatch(/\.preview-toolbar\s*\{[\s\S]*?bottom:\s*clamp\(80px,\s*12vh,\s*112px\);/);
  expect(styles).toMatch(/\.preview-toolbar\s*\{[\s\S]*?flex-direction:\s*column;/);
});

test('keeps kiosk configuration non-scrollable and controls touch-sized', () => {
  const styles = fs.readFileSync(
    path.resolve('src/public/config/styles.css'),
    'utf8',
  );

  expect(styles).toMatch(/\.settings-scroll\s*\{[\s\S]*?overflow:\s*hidden;/);
  expect(styles).toMatch(/\.preview-toolbar \.pager-btn,[\s\S]*?min-width:\s*44px;/);
  expect(styles).toContain('.option-card:has(input:focus-visible)');
  expect(page).toMatch(/id="copies"[\s\S]*?max="30"/);
});

test('groups paper size and page range in a color-coded full-width grid', () => {
  const styles = fs.readFileSync(
    path.resolve('src/public/config/styles.css'),
    'utf8',
  );
  const groupStart = page.indexOf('class="document-options-grid"');
  const groupEnd = page.indexOf('<!-- /.document-options-grid -->', groupStart);
  const documentOptions = page.slice(groupStart, groupEnd);

  expect(groupStart).toBeGreaterThan(-1);
  expect(documentOptions).toContain('id="paperSizeGroup"');
  expect(documentOptions).toContain('id="pageRangeGroup"');
  expect(styles).toMatch(/\.document-options-grid\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1;/);
  expect(styles).toMatch(/\.document-options-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,/);
  expect(styles).toContain('#paperSizeGroup .option-card:has(input:checked)');
  expect(styles).toContain('#pageRangeGroup .option-card:has(input:checked)');
});

test('raises the settings footer above the kiosk bottom edge', () => {
  const styles = fs.readFileSync(
    path.resolve('src/public/config/styles.css'),
    'utf8',
  );

  expect(styles).toMatch(/\.config-pane-footer\s*\{[\s\S]*?padding:\s*18px 20px clamp\(48px,\s*7vh,\s*72px\);/);
});

test('stacks settings vertically instead of overflowing narrow screens', () => {
  const styles = fs.readFileSync(
    path.resolve('src/public/config/styles.css'),
    'utf8',
  );
  const narrowStyles = styles.slice(styles.indexOf('@media (max-width: 900px)'));

  expect(narrowStyles).toMatch(/\.settings-scroll\s*\{[\s\S]*?flex-direction:\s*column;/);
});
