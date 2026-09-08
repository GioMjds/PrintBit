import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, degrees } from 'pdf-lib';
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

test('normalizes every PDF page to the selected paper orientation', async () => {
  const tempDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'printbit-prepare-worker-orientation-'),
  );
  const sourcePath = path.join(tempDirectory, 'mixed-orientation-source.pdf');
  const pdf = await PDFDocument.create();
  pdf.addPage([792, 612]);
  pdf.addPage([612, 792]);
  const metadataRotatedPage = pdf.addPage([612, 792]);
  metadataRotatedPage.setRotation(degrees(90));
  await fs.writeFile(sourcePath, await pdf.save());

  let cleanupPaths: string[] = [];
  try {
    const prepared = await prepareWorkerPdf({
      sourcePath,
      colorMode: 'colored',
      orientation: 'portrait',
      rotationDeg: 0,
      paperSize: 'A4',
    });
    cleanupPaths = prepared.cleanupPaths;

    const preparedPdf = await PDFDocument.load(
      await fs.readFile(prepared.pdfPath),
    );
    expect(preparedPdf.getPageCount()).toBe(3);
    expect(preparedPdf.getPage(0).getRotation().angle).toBe(90);
    expect(preparedPdf.getPage(1).getRotation().angle).toBe(0);
    expect(preparedPdf.getPage(2).getRotation().angle).toBe(180);
  } finally {
    await Promise.all(
      cleanupPaths.map((cleanupPath) => fs.rm(cleanupPath, { force: true })),
    );
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});

test('applies explicit content rotation before enforcing the selected orientation', async () => {
  const tempDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'printbit-prepare-worker-rotation-'),
  );
  const sourcePath = path.join(tempDirectory, 'source.pdf');
  const pdf = await PDFDocument.create();
  pdf.addPage([792, 612]);
  await fs.writeFile(sourcePath, await pdf.save());

  let cleanupPaths: string[] = [];
  try {
    const prepared = await prepareWorkerPdf({
      sourcePath,
      colorMode: 'colored',
      orientation: 'landscape',
      rotationDeg: 90,
      paperSize: 'A4',
    });
    cleanupPaths = prepared.cleanupPaths;

    const preparedPdf = await PDFDocument.load(
      await fs.readFile(prepared.pdfPath),
    );

    expect(preparedPdf.getPage(0).getRotation().angle).toBe(180);
  } finally {
    await Promise.all(
      cleanupPaths.map((cleanupPath) => fs.rm(cleanupPath, { force: true })),
    );
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});

test('keeps an appended duplex blank page in the selected orientation', async () => {
  const tempDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'printbit-prepare-worker-duplex-orientation-'),
  );
  const sourcePath = path.join(tempDirectory, 'landscape-source.pdf');
  const pdf = await PDFDocument.create();
  pdf.addPage([792, 612]);
  await fs.writeFile(sourcePath, await pdf.save());

  let cleanupPaths: string[] = [];
  try {
    const prepared = await prepareWorkerPdf({
      sourcePath,
      colorMode: 'colored',
      orientation: 'portrait',
      rotationDeg: 0,
      paperSize: 'A4',
      duplex: true,
    });
    cleanupPaths = prepared.cleanupPaths;

    const preparedPdf = await PDFDocument.load(
      await fs.readFile(prepared.pdfPath),
    );

    expect(preparedPdf.getPageCount()).toBe(2);
    expect(preparedPdf.getPage(0).getRotation().angle).toBe(90);
    expect(preparedPdf.getPage(1).getRotation().angle).toBe(90);
  } finally {
    await Promise.all(
      cleanupPaths.map((cleanupPath) => fs.rm(cleanupPath, { force: true })),
    );
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});
