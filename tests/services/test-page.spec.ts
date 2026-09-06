import { PDFDocument } from 'pdf-lib';
import { generateTestPagePdf } from '../../src/services/test-page';

describe('admin test-page PDF', () => {
  test('generates a parseable one-page grayscale test document', async () => {
    const output = generateTestPagePdf(new Date('2026-09-06T01:00:00.000Z'));
    const document = await PDFDocument.load(output);

    expect(output.subarray(0, 8).toString('ascii')).toBe('%PDF-1.4');
    expect(document.getPageCount()).toBe(1);
    expect(output.toString('latin1')).not.toMatch(/\b(?:rg|RG)\b/);
  });
});
