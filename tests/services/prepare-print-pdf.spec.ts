import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { preparePrintPdf } from '@/services/prepare-print-pdf';

async function createPdf(pageCount: number): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pb-prepare-'));
  const filePath = path.join(dir, 'source.pdf');
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    pdf.addPage([595, 842]);
  }
  await fs.writeFile(filePath, await pdf.save());
  return filePath;
}

describe('prepare-print-pdf', () => {
  it('applies page-range selection before handoff', async () => {
    const sourcePath = await createPdf(3);

    const prepared = await preparePrintPdf({
      sourcePath,
      colorMode: 'colored',
      orientation: 'portrait',
      pageRange: '2-3',
      duplex: false,
    });

    const preparedPdf = await PDFDocument.load(
      await fs.readFile(prepared.pdfPath),
    );
    expect(preparedPdf.getPageCount()).toBe(2);

    await Promise.allSettled(
      prepared.cleanupPaths.map((cleanupPath) => fs.unlink(cleanupPath)),
    );
  });

  it('pads an odd page selection for duplex handoff', async () => {
    const sourcePath = await createPdf(1);

    const prepared = await preparePrintPdf({
      sourcePath,
      colorMode: 'colored',
      orientation: 'portrait',
      duplex: true,
    });

    const preparedPdf = await PDFDocument.load(
      await fs.readFile(prepared.pdfPath),
    );
    expect(preparedPdf.getPageCount()).toBe(2);

    await Promise.allSettled(
      prepared.cleanupPaths.map((cleanupPath) => fs.unlink(cleanupPath)),
    );
  });
});
