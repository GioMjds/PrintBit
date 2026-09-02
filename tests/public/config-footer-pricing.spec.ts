import fs from 'node:fs';
import path from 'node:path';

const page = fs.readFileSync(
  path.resolve('src/public/config/index.html'),
  'utf8',
);

test('keeps the full price list in the header and the live price in the footer', () => {
  expect(page).toContain('class="topbar-spacer topbar-actions"');
  expect(page).toContain('id="openPricingBtn"');
  expect(page).toContain('id="footerTotal"');
  expect(page).toContain('id="footerSelections"');
  expect(page).not.toContain('class="pricing-summary"');
});
