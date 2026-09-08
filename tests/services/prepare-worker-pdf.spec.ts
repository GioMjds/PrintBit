import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { prepareWorkerPdf } from '@/services/prepare-print-pdf';

test('leaves PDF pages untouched so the worker applies print settings once', async () => {
  const tempDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'printbit-prepare-worker-'),
  );
  const sourcePath = path.join(tempDirectory, 'source.pdf');
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  pdf.addPage([612, 792]);
  pdf.addPage([612, 792]);
  await fs.writeFile(sourcePath, await pdf.save());

  try {
    const prepared = await prepareWorkerPdf({ sourcePath });

    expect(prepared).toEqual({
      pdfPath: sourcePath,
      cleanupPaths: [],
      pageCount: 3,
    });
    const unchanged = await PDFDocument.load(await fs.readFile(sourcePath));
    expect(unchanged.getPageCount()).toBe(3);
    expect(unchanged.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});
