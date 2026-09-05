import fs from 'node:fs';
import path from 'node:path';
import {
  PRINT_PAGE_WARNING_THRESHOLD,
  formatPrintSessionLimitNote,
  formatLargePrintDisclaimer,
  isLargePrintDocument,
} from '../../src/public/shared/large-print-warning';

const printPagePath = path.resolve(__dirname, '../../src/public/print/index.html');

test('recognizes documents at or above the 30-page threshold', () => {
  expect(PRINT_PAGE_WARNING_THRESHOLD).toBe(30);
  expect(isLargePrintDocument(29)).toBe(false);
  expect(isLargePrintDocument(30)).toBe(true);
  expect(isLargePrintDocument(31)).toBe(true);
});

test('rejects invalid page counts without showing a warning', () => {
  expect(isLargePrintDocument(undefined)).toBe(false);
  expect(isLargePrintDocument(0)).toBe(false);
  expect(isLargePrintDocument('30')).toBe(false);
  expect(isLargePrintDocument(Number.NaN)).toBe(false);
});

test('formats a customer-facing print disclaimer', () => {
  expect(formatLargePrintDisclaimer(30)).toBe(
    'Print-only notice: This kiosk allows a maximum of 30 printed pages per session. Your document contains 30 pages. If you print more than 30 pages or use copies that exceed 30 total pages, choose a smaller page range or fewer copies. Review the page range, copies, and total price before continuing. This limit applies only to Print and this session.',
  );
});

test('formats the print-session maximum note', () => {
  expect(formatPrintSessionLimitNote()).toBe(
    'Print limit: A maximum of 30 pages can be printed in this session. Your selected page range multiplied by copies must stay within 30 pages.',
  );
});

test('places the 30-page print limit in the left upload panel', () => {
  const page = fs.readFileSync(printPagePath, 'utf8');

  expect(page).toMatch(
    /class="upload-tip upload-tip--print-limit"[\s\S]*?maximum of 30 pages can be printed in this session/i,
  );
});
