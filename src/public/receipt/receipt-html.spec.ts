import fs from 'node:fs';
import path from 'node:path';

describe('Receipt HTML Template', () => {
  const htmlPath = path.resolve(__dirname, 'index.html');
  let html: string;

  beforeAll(() => {
    html = fs.readFileSync(htmlPath, 'utf8');
  });

  it('contains Missing Change label instead of Remaining Owed', () => {
    expect(html).toContain('Missing Change');
    expect(html).not.toContain('Remaining Owed');
  });

  it('contains the document name row and placeholder', () => {
    expect(html).toContain('id="rowDocumentName"');
    expect(html).toContain('id="rDocumentNameText"');
  });

  it('contains coins inserted row and placeholder', () => {
    expect(html).toContain('id="rowCoinsInserted"');
    expect(html).toContain('id="rCoinsInserted"');
  });

  it('contains all print configuration rows and placeholders', () => {
    expect(html).toContain('id="rowCopies"');
    expect(html).toContain('id="rCopies"');
    expect(html).toContain('id="rowColorMode"');
    expect(html).toContain('id="rColorMode"');
    expect(html).toContain('id="rowPaperSize"');
    expect(html).toContain('id="rPaperSize"');
    expect(html).toContain('id="rowQuality"');
    expect(html).toContain('id="rQuality"');
    expect(html).toContain('id="rowDuplex"');
    expect(html).toContain('id="rDuplex"');
    expect(html).toContain('id="rowOrientation"');
    expect(html).toContain('id="rOrientation"');
    expect(html).toContain('id="rowPageRange"');
    expect(html).toContain('id="rPageRange"');
  });
});
