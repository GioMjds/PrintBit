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

test('places the preview toolbar inside the settings footer above the continue action', () => {
  const styles = fs.readFileSync(
    path.resolve('src/public/config/styles.css'),
    'utf8',
  );

  expect(styles).toMatch(/\.preview-toolbar\s*\{[\s\S]*?display:\s*flex;/);
  expect(styles).toMatch(/\.preview-toolbar\s*\{[\s\S]*?justify-content:\s*space-between;/);
  const footerStart = page.indexOf('class="config-pane-footer"');
  const footerEnd = page.indexOf('</section>', footerStart);
  const footer = page.slice(footerStart, footerEnd);
  expect(footer).toContain('class="preview-toolbar"');
  expect(footer.indexOf('class="preview-toolbar"')).toBeLessThan(footer.indexOf('id="continueBtn"'));
});

test('keeps kiosk configuration controls touch-sized and protects numeric fields from virtual keyboard popups', () => {
  const styles = fs.readFileSync(
    path.resolve('src/public/config/styles.css'),
    'utf8',
  );

  expect(styles).toMatch(/\.settings-scroll\s*\{[\s\S]*?overflow:\s*hidden;/);
  expect(styles).toMatch(/\.preview-toolbar \.pager-btn,[\s\S]*?min-width:\s*44px;/);
  expect(styles).toMatch(/\.copies-input\s*\{[\s\S]*?pointer-events:\s*none;/);
  expect(page).toMatch(/id="copies"[\s\S]*?max="30"/);
  expect(page).toMatch(/id="copies"[\s\S]*?readonly/);
  expect(page).toMatch(/id="singlePageInput"[\s\S]*?readonly/);
  expect(page).toMatch(/id="customRangeStartInput"[\s\S]*?readonly/);
  expect(page).toMatch(/id="customRangeEndInput"[\s\S]*?readonly/);
});

test('separates paper size and page range each into its own full-width grid line and hides extra settings for all pages', () => {
  const styles = fs.readFileSync(
    path.resolve('src/public/config/styles.css'),
    'utf8',
  );

  expect(page).not.toContain('class="document-options-grid"');
  expect(page).toContain('id="paperSizeGroup"');
  expect(page).toContain('id="pageRangeGroup"');
  expect(styles).toMatch(/#paperSizeGroup,\s*\n\s*#pageRangeGroup\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1;/);
  expect(styles).toContain('#paperSizeGroup .option-card:has(input:checked)');
  expect(styles).toContain('#pageRangeGroup .option-card:has(input:checked)');
  expect(page).toMatch(/id="pageRangeCustomWrap"[\s\S]*?class="[^"]*hidden/);
  expect(page).toMatch(/id="pageRangeSingleWrap"[\s\S]*?class="[^"]*hidden/);
});

test('keeps color evidence but removes the orientation document check', () => {
  const styles = fs.readFileSync(
    path.resolve('src/public/config/styles.css'),
    'utf8',
  );

  expect(page.indexOf('id="colorModeGroup"')).toBeLessThan(page.indexOf('id="qualityGroup"'));
  expect(page.indexOf('id="qualityGroup"')).toBeLessThan(page.indexOf('id="colorDetectionEvidence"'));
  expect(page).not.toContain('id="orientationDetectionEvidence"');
  expect(styles).toMatch(/\.detection-evidence\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1;/);
});

test('positions the settings footer with compact padding to lower the continue action', () => {
  const styles = fs.readFileSync(
    path.resolve('src/public/config/styles.css'),
    'utf8',
  );

  expect(styles).toMatch(/\.config-pane-footer\s*\{[\s\S]*?padding:\s*12px 18px 14px;/);
});

test('stacks settings vertically instead of overflowing narrow screens', () => {
  const styles = fs.readFileSync(
    path.resolve('src/public/config/styles.css'),
    'utf8',
  );
  const narrowStyles = styles.slice(styles.indexOf('@media (max-width: 900px)'));

  expect(narrowStyles).toMatch(/\.settings-scroll\s*\{[\s\S]*?flex-direction:\s*column;/);
});
